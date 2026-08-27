import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess, ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getR2Storage } from "@/lib/r2";

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

    try {
      const r2 = getR2Storage();

      await r2.client.send(
        new DeleteObjectCommand({
          Bucket: r2.bucketName,
          Key: mediaAsset.storageKey
        })
      );
    } catch (storageError) {
      console.error("Cloudflare R2 media deletion failed:", storageError);

      return NextResponse.json(
        {
          error:
            "The audio file could not be removed from storage. The library record was left unchanged."
        },
        { status: 502 }
      );
    }

    await prisma.mediaAsset.delete({
      where: {
        id: mediaAsset.id
      }
    });

    await prisma.auditLog.create({
      data: {
        organisationId: mediaAsset.organisationId,
        actorUserId: access.user.id,
        action: "MEDIA_ASSET_DELETED",
        entityType: "MediaAsset",
        entityId: mediaAsset.id,
        details: {
          name: mediaAsset.name,
          libraryType: mediaAsset.libraryType,
          storageKey: mediaAsset.storageKey
        }
      }
    });

    return NextResponse.json({
      success: true,
      id: mediaAsset.id,
      name: mediaAsset.name
    });
  } catch (error) {
    console.error("Media deletion request failed:", error);

    return NextResponse.json(
      { error: "The audio file could not be deleted." },
      { status: 500 }
    );
  }
}
