import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const trackSchema = z.object({
  mediaAssetId: z.string().cuid(),
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200),
  album: z.string().trim().max(200).optional().nullable(),
  releaseYear: z.number().int().min(1877).max(2200).optional().nullable(),
  isExplicit: z.boolean().default(false)
});

function superAdminOnly(access) {
  if (!access.ok) {
    return accessDenied(access);
  }

  if (access.user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a Ruvanas Super Admin can manage catalogue tracks." },
      { status: 403 }
    );
  }

  return null;
}

export async function GET() {
  try {
    const access = await requirePlatformAdmin();
    const denied = superAdminOnly(access);

    if (denied) {
      return denied;
    }

    const tracks = await prisma.track.findMany({
      include: {
        mediaAsset: {
          include: {
            genres: { include: { mediaGenre: true } }
          }
        }
      },
      orderBy: [{ artist: "asc" }, { title: "asc" }]
    });

    return NextResponse.json({ tracks });
  } catch (error) {
    console.error("List catalogue tracks error:", error);
    return NextResponse.json(
      { error: "Unable to load catalogue tracks." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    const denied = superAdminOnly(access);

    if (denied) {
      return denied;
    }

    const parsed = trackSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter valid track metadata and a catalogue media asset." },
        { status: 400 }
      );
    }

    const asset = await prisma.mediaAsset.findFirst({
      where: {
        id: parsed.data.mediaAssetId,
        organisationId: null,
        libraryType: "RUVANAS_CATALOGUE",
        mediaType: "MUSIC",
        status: "READY"
      },
      select: { id: true }
    });

    if (!asset) {
      return NextResponse.json(
        { error: "Only approved Ruvanas catalogue music can become a track." },
        { status: 400 }
      );
    }

    const track = await prisma.$transaction(async (tx) => {
      const created = await tx.track.create({
        data: {
          ...parsed.data,
          album: parsed.data.album || null,
          status: "READY"
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: access.user.id,
          action: "CATALOGUE_TRACK_CREATED",
          entityType: "Track",
          entityId: created.id,
          details: {
            mediaAssetId: created.mediaAssetId,
            title: created.title,
            artist: created.artist
          }
        }
      });

      return created;
    });

    return NextResponse.json({ ok: true, track }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "This media asset already has track metadata." },
        { status: 409 }
      );
    }

    console.error("Create catalogue track error:", error);
    return NextResponse.json(
      { error: "Unable to create the catalogue track." },
      { status: 500 }
    );
  }
}

