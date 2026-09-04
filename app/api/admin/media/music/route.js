import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can review music rights." }, { status: 403 });
    }

    const tracks = await prisma.track.findMany({
      where: {
        mediaAsset: {
          libraryType: "ORGANISATION_MUSIC",
          status: { notIn: ["ARCHIVED", "DELETED"] }
        }
      },
      include: {
        mediaAsset: {
          include: { organisation: { select: { id: true, name: true } } }
        },
        rightsConfirmedBy: { select: { id: true, name: true, email: true } },
        rightsReviewedBy: { select: { id: true, name: true, email: true } }
      },
      orderBy: [{ updatedAt: "desc" }, { artist: "asc" }, { title: "asc" }]
    });

    return NextResponse.json({
      tracks: tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        status: track.status,
        rightsHolder: track.rightsHolder,
        rightsReference: track.rightsReference,
        rightsBasis: track.rightsBasis,
        permittedTerritories: track.permittedTerritories,
        permittedUses: track.permittedUses,
        licenceStartsAt: track.licenceStartsAt?.toISOString().slice(0, 10) || null,
        licenceExpiresAt: track.licenceExpiresAt?.toISOString().slice(0, 10) || null,
        rightsReviewStatus: track.rightsReviewStatus,
        rightsReviewNotes: track.rightsReviewNotes,
        rightsConfirmedAt: track.rightsConfirmedAt?.toISOString() || null,
        rightsReviewedAt: track.rightsReviewedAt?.toISOString() || null,
        organisation: track.mediaAsset.organisation,
        file: {
          id: track.mediaAsset.id,
          originalName: track.mediaAsset.originalName,
          sizeBytes: track.mediaAsset.sizeBytes.toString(),
          durationSeconds: track.mediaAsset.durationSeconds,
          previewUrl: `/api/media/${track.mediaAsset.id}/stream`
        },
        declaredBy: track.rightsConfirmedBy,
        reviewedBy: track.rightsReviewedBy
      }))
    });
  } catch (error) {
    console.error("Organisation music review queue error:", error);
    return NextResponse.json({ error: "Unable to load the music rights review queue." }, { status: 500 });
  }
}
