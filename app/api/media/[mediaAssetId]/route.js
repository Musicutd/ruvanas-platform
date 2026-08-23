import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { r2BucketName, r2Client } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const organisationDeleteRoles = new Set([
  "OWNER",
  "MANAGER",
  "CONTENT_EDITOR"
]);

export async function DELETE(request, { params }) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

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
        status: true
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

    let permitted = user.role === "SUPER_ADMIN";

    if (!permitted && organisationDeleteRoles.has(user.role)) {
      const membership = await prisma.organisationMember.findFirst({
        where: {
          userId: user.id,
          organisationId: mediaAsset.organisationId
        },
        select: {
          id: true,
          role: true
        }
      });

      permitted = Boolean(
        membership && organisationDeleteRoles.has(membership.role)
      );
    }

    if (!permitted) {
      return NextResponse.json(
        { error: "You do not have permission to delete this audio file." },
        { status: 403 }
      );
    }

    try {
      await r2Client.send(
        new DeleteObjectCommand({
          Bucket: r2BucketName,
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
        actorUserId: user.id,
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
