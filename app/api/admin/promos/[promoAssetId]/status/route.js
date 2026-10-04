import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  ORGANISATION_CONTENT_ROLES,
  requireOrganisationAccess
} from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { GENERAL_STUDIO_MEDIA_ASSET_WHERE, lockGeneralStudioAudioProject } from "@/lib/studio-general-asset-boundary.mjs";

export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "ARCHIVED"])
});

const ordinaryPromoAsset = {
  versions: { every: { mediaAsset: { is: GENERAL_STUDIO_MEDIA_ASSET_WHERE } } }
};

export async function PATCH(request, { params }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    const promoAssetId = String((await params).promoAssetId || "");
    const parsed = statusSchema.safeParse(await request.json());

    if (!promoAssetId || !parsed.success) {
      return NextResponse.json(
        { error: "Choose a valid promotional asset status." },
        { status: 400 }
      );
    }

    const promoAsset = await prisma.promoAsset.findFirst({
      where: { id: promoAssetId, ...ordinaryPromoAsset }
    });

    if (!promoAsset) {
      return NextResponse.json(
        { error: "The promotional asset was not found." },
        { status: 404 }
      );
    }

    const access = await requireOrganisationAccess(
      promoAsset.organisationId,
      ORGANISATION_CONTENT_ROLES
    );

    if (!access.ok) {
      return accessDenied(access);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // C3 submission and supervised session creation lock their source
      // projects. Take the same locks before rechecking the entire promo's
      // current versions, so a private transition cannot race this change.
      const versions = await tx.promoVersion.findMany({
        where: { promoAssetId },
        select: { id: true, mediaAssetId: true, mediaAsset: { select: { organisationId: true } } }
      });
      const ownedVersions = versions.filter((version) => version.mediaAsset.organisationId === promoAsset.organisationId);
      const versionIds = ownedVersions.map((version) => version.id);
      const mediaAssetIds = [...new Set(ownedVersions.map((version) => version.mediaAssetId))];
      if (versionIds.length) {
        const projects = await tx.audioProject.findMany({
          where: { organisationId: promoAsset.organisationId, OR: [
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
          await lockGeneralStudioAudioProject(tx, promoAsset.organisationId, id);
        }
      }

      // C5/C6/C7 can attach already-approved media directly, without an
      // AudioProject. Their foreign-key insert takes a KEY SHARE lock on the
      // referenced MediaAsset; FOR UPDATE waits for it. Read Committed then
      // lets the guarded UPDATE below see the newly committed private use.
      for (const mediaAssetId of mediaAssetIds.sort()) {
        const mediaRows = await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${mediaAssetId} AND "organisationId" = ${promoAsset.organisationId} FOR UPDATE`;
        if (mediaRows.length !== 1) throw new Error("PROMO_ASSET_CHANGED");
      }

      // Keep project -> media -> parent lock order compatible with ordinary
      // review and upload. The parent lock now freezes version additions until
      // the final predicate check and status write commit.
      const parentRows = await tx.$queryRaw`SELECT "id" FROM "PromoAsset" WHERE "id" = ${promoAssetId} AND "organisationId" = ${promoAsset.organisationId} FOR UPDATE`;
      if (parentRows.length !== 1) throw new Error("PROMO_ASSET_CHANGED");
      // A version could have been appended while we waited for an earlier
      // media row. We did not lock that new version's media; fail closed and
      // let a fresh request enumerate the complete version history.
      const currentVersions = await tx.promoVersion.findMany({
        where: { promoAssetId }, select: { id: true, mediaAssetId: true }
      });
      const versionKeys = (items) => items.map(({ id, mediaAssetId }) => `${id}:${mediaAssetId}`).sort();
      if (JSON.stringify(versionKeys(currentVersions)) !== JSON.stringify(versionKeys(versions))) {
        throw new Error("PROMO_ASSET_CHANGED");
      }

      const changed = await tx.promoAsset.updateMany({
        where: { id: promoAssetId, organisationId: promoAsset.organisationId, ...ordinaryPromoAsset },
        data: { status: parsed.data.status }
      });
      if (changed.count !== 1) throw new Error("PROMO_ASSET_CHANGED");

      await tx.auditLog.create({
        data: {
          organisationId: promoAsset.organisationId,
          actorUserId: access.user.id,
          action:
            parsed.data.status === "ARCHIVED"
              ? "PROMO_ASSET_ARCHIVED"
              : "PROMO_ASSET_RESTORED",
          entityType: "PromoAsset",
          entityId: promoAssetId,
          details: { name: promoAsset.name }
        }
      });

      return tx.promoAsset.findUnique({ where: { id: promoAssetId } });
    }, { isolationLevel: "ReadCommitted" });

    return NextResponse.json({
      asset: { id: updated.id, status: updated.status }
    });
  } catch (error) {
    if (error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED" || error?.message === "PROMO_ASSET_CHANGED") {
      return NextResponse.json(
        { error: "This asset is no longer available for general promotional changes." },
        { status: 409 }
      );
    }
    console.error("Unable to update promotional asset status:", error);
    return NextResponse.json(
      { error: "The promotional asset status could not be updated." },
      { status: 500 }
    );
  }
}
