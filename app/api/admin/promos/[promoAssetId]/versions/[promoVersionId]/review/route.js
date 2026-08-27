import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  ORGANISATION_MANAGER_ROLES,
  requireOrganisationAccess
} from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { reviewPromoVersion } from "@/lib/promo-versioning.mjs";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().trim().max(1000).optional()
});

export async function PATCH(request, { params }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
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
      where: { id: promoVersionId, promoAssetId },
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

    const access = await requireOrganisationAccess(
      version.promoAsset.organisationId,
      ORGANISATION_MANAGER_ROLES
    );

    if (!access.ok) {
      return accessDenied(access);
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

    const updated = await prisma.$transaction(async (tx) => {
      if (transition.status === "APPROVED") {
        await tx.promoVersion.updateMany({
          where: {
            promoAssetId,
            status: "APPROVED",
            id: { not: promoVersionId }
          },
          data: { status: "SUPERSEDED" }
        });
      }

      const reviewedVersion = await tx.promoVersion.update({
        where: { id: promoVersionId },
        data: {
          ...transition,
          reviewedById: access.user.id,
          reviewedAt
        }
      });

      if (transition.status === "APPROVED") {
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

      return reviewedVersion;
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
    console.error("Unable to review promotional audio:", error);
    return NextResponse.json(
      { error: "The promotional version could not be reviewed." },
      { status: 500 }
    );
  }
}
