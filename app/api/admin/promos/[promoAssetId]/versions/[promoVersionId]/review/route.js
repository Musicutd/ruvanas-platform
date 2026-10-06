import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { reviewPromoVersion } from "@/lib/promo-versioning.mjs";
import {
  GENERAL_STUDIO_MEDIA_ASSET_WHERE,
  lockGeneralStudioAudioProject
} from "@/lib/studio-general-asset-boundary.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().trim().max(1000).optional()
});

// A supervised Corrections render deliberately remains IN_REVIEW while its
// programme passes Corrections Guard. Generic promo review must not mutate it.
const ordinaryPromoAsset = {
  versions: { every: { mediaAsset: { is: GENERAL_STUDIO_MEDIA_ASSET_WHERE } } }
};

export async function PATCH(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const promoAssetId = String(params.promoAssetId || "");
    const promoVersionId = String(params.promoVersionId || "");
    const parsed = reviewSchema.safeParse(await request.json());

    if (!promoAssetId || !promoVersionId || !parsed.success) {
      return NextResponse.json(
        { error: "Choose approve or reject and provide valid review notes." },
        { status: 400 }
      );
    }

    const version = await prisma.promoVersion.findFirst({
      where: {
        id: promoVersionId,
        promoAssetId,
        promoAsset: { is: ordinaryPromoAsset },
        mediaAsset: { is: GENERAL_STUDIO_MEDIA_ASSET_WHERE }
      },
      include: {
        promoAsset: true,
        processingJobs: { select: { status: true } }
      }
    });

    if (!version) {
      return NextResponse.json(
        { error: "The promotional version was not found." },
        { status: 404 }
      );
    }

    if (
      parsed.data.decision === "APPROVE" &&
      version.processingJobs.some((job) => job.status === "FAILED")
    ) {
      return NextResponse.json(
        { error: "Resolve failed processing jobs before approving this version." },
        { status: 409 }
      );
    }

    let transition;

    try {
      transition = reviewPromoVersion({
        currentStatus: version.status,
        decision: parsed.data.decision,
        notes: parsed.data.notes
      });
    } catch (transitionError) {
      return NextResponse.json(
        {
          error:
            transitionError instanceof Error
              ? transitionError.message
              : "This review transition is not allowed."
        },
        { status: 409 }
      );
    }

    const reviewedAt = new Date();

    const updated = await runSerializableTransaction(prisma, async (tx) => {
      // Corrections staff submission and supervised session creation share
      // these project locks. Lock every project using this promo's media before
      // the final provenance check and status change.
      const parentVersions = await tx.promoVersion.findMany({
        where: { promoAssetId },
        select: { id: true, mediaAssetId: true, mediaAsset: { select: { organisationId: true } } }
      });
      const ownedVersions = parentVersions.filter((item) => item.mediaAsset.organisationId === version.promoAsset.organisationId);
      const versionIds = ownedVersions.map((item) => item.id);
      const mediaAssetIds = [...new Set(ownedVersions.map((item) => item.mediaAssetId))];
      if (versionIds.length) {
        const projects = await tx.audioProject.findMany({
          where: { organisationId: version.promoAsset.organisationId, OR: [
            { renders: { some: { OR: [
              { outputPromoVersionId: { in: versionIds } },
              { outputMediaAssetId: { in: mediaAssetIds } }
            ] } } },
            { takes: { some: { mediaAssetId: { in: mediaAssetIds } } } },
            { tracks: { some: { clips: { some: { mediaAssetId: { in: mediaAssetIds } } } } } }
          ] },
          select: { id: true }
        });
        for (const { id } of projects.sort((a, b) => a.id.localeCompare(b.id))) {
          await lockGeneralStudioAudioProject(tx, version.promoAsset.organisationId, id);
        }
      }

      const changed = await tx.promoVersion.updateMany({
        where: {
          id: promoVersionId,
          promoAssetId,
          status: "IN_REVIEW",
          promoAsset: { is: ordinaryPromoAsset },
          mediaAsset: { is: GENERAL_STUDIO_MEDIA_ASSET_WHERE }
        },
        data: {
          ...transition,
          reviewedById: access.user.id,
          reviewedAt
        }
      });
      if (changed.count !== 1) throw new Error("PROMO_REVIEW_CONFLICT");

      if (transition.status === "APPROVED") {
        await tx.promoVersion.updateMany({
          where: {
            promoAssetId,
            status: "APPROVED",
            id: { not: promoVersionId }
          },
          data: { status: "SUPERSEDED" }
        });
        await tx.promoAsset.update({
          where: { id: promoAssetId },
          data: { currentApprovedVersionId: promoVersionId }
        });
      }

      await tx.auditLog.create({
        data: {
          organisationId: version.promoAsset.organisationId,
          actorUserId: access.user.id,
          action:
            transition.status === "APPROVED"
              ? "PROMO_VERSION_APPROVED"
              : "PROMO_VERSION_REJECTED",
          entityType: "PromoVersion",
          entityId: promoVersionId,
          details: {
            promoAssetId,
            version: version.version,
            qcStatus: transition.qcStatus,
            notes: transition.qcNotes
          }
        }
      });

      return tx.promoVersion.findUnique({ where: { id: promoVersionId } });
    });

    return NextResponse.json({
      version: {
        id: updated.id,
        version: updated.version,
        status: updated.status,
        qcStatus: updated.qcStatus,
        qcNotes: updated.qcNotes,
        reviewedAt: updated.reviewedAt?.toISOString() || null
      }
    });
  } catch (error) {
    if (error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") {
      return NextResponse.json(
        { error: "Private Ruvanas Inside audio must be reviewed in Corrections Guard." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "PROMO_REVIEW_CONFLICT") {
      return NextResponse.json(
        { error: "This version is no longer available for general promo review." },
        { status: 409 }
      );
    }
    console.error("Unable to review promotional audio:", error);
    return NextResponse.json(
      { error: "The promotional version could not be reviewed." },
      { status: 500 }
    );
  }
}
