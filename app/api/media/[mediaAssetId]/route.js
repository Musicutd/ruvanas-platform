import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess, ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getR2Storage } from "@/lib/r2";
import { GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "@/lib/studio-general-asset-boundary.mjs";
import { correctionsPrivateMediaPreviewScope } from "@/lib/corrections-private-media-preview.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request, { params }) {
  try {
    const mediaAssetId = String(params.mediaAssetId || "");

    if (!mediaAssetId) {
      return NextResponse.json(
        { error: "Missing media asset ID." },
        { status: 400 }
      );
    }

    const mediaAsset = await prisma.mediaAsset.findUnique({
      where: {
        id: mediaAssetId
      },
      select: {
        id: true,
        organisationId: true,
        libraryType: true,
        name: true,
        storageKey: true,
        status: true,
        _count: {
          select: { promoVersions: true }
        }
      }
    });

    if (!mediaAsset) {
      return NextResponse.json(
        { error: "The media asset was not found." },
        { status: 404 }
      );
    }

    if (mediaAsset.libraryType !== "ORGANISATION_PROMO") {
      return NextResponse.json(
        { error: "Only organisation promotional audio can be deleted here." },
        { status: 403 }
      );
    }

    if (!mediaAsset.organisationId) {
      return NextResponse.json(
        { error: "This promotional audio file has no organisation owner." },
        { status: 409 }
      );
    }

    if (mediaAsset._count.promoVersions > 0) {
      return NextResponse.json(
        {
          error:
            "Versioned promotional audio is retained for audit history. Archive the promotional asset instead."
        },
        { status: 409 }
      );
    }

    const access = await requireOrganisationAccess(
      mediaAsset.organisationId,
      ORGANISATION_CONTENT_ROLES
    );

    if (!access.ok) {
      return accessDenied(access);
    }

    // Delete the database row first. A late facility/submission reference must
    // never leave immutable Inside evidence pointing at an already-deleted R2
    // object. Lock the asset while rechecking its current protected uses.
    let deletedMedia;
    try {
      deletedMedia = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${mediaAsset.id} AND "organisationId" = ${mediaAsset.organisationId} FOR UPDATE`;
        if (!locked.length) throw Object.assign(new Error("The media asset was not found."), { status: 404 });
        const deletable = await tx.mediaAsset.findFirst({
          where: { id: mediaAsset.id, organisationId: mediaAsset.organisationId, libraryType: "ORGANISATION_PROMO", ...GENERAL_STUDIO_MEDIA_ASSET_WHERE },
          select: { id: true, name: true, libraryType: true, storageKey: true, _count: { select: { promoVersions: true } } }
        });
        const privateScope = await correctionsPrivateMediaPreviewScope(tx, mediaAsset.id);
        if (!deletable || privateScope.protectedUse) throw Object.assign(new Error("Private Ruvanas Inside media cannot be deleted here."), { status: 403 });
        if (deletable._count.promoVersions > 0) throw Object.assign(new Error("Versioned promotional audio is retained for audit history. Archive the promotional asset instead."), { status: 409 });
        await tx.mediaAsset.delete({ where: { id: mediaAsset.id } });
        await tx.auditLog.create({
          data: {
            organisationId: mediaAsset.organisationId, actorUserId: access.user.id,
            action: "MEDIA_ASSET_DELETED", entityType: "MediaAsset", entityId: mediaAsset.id,
            details: { name: deletable.name, libraryType: deletable.libraryType, storageKey: deletable.storageKey }
          }
        });
        return deletable;
      }, { isolationLevel: "Serializable" });
    } catch (deleteError) {
      if (deleteError?.status) return NextResponse.json({ error: deleteError.message }, { status: deleteError.status });
      throw deleteError;
    }

    try {
      const r2 = getR2Storage();
      await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: deletedMedia.storageKey }));
    } catch (storageError) {
      console.error("Cloudflare R2 cleanup failed after media record deletion:", { mediaAssetId: deletedMedia.id, storageKey: deletedMedia.storageKey, error: storageError });
      return NextResponse.json({ error: "The library record was removed, but storage cleanup failed. Contact support to remove the recoverable orphaned file." }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      id: deletedMedia.id,
      name: deletedMedia.name
    });
  } catch (error) {
    console.error("Media deletion request failed:", error);

    return NextResponse.json(
      { error: "The audio file could not be deleted." },
      { status: 500 }
    );
  }
}
