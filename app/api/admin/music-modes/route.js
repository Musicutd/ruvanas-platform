import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  canUseTrackForOrganisation,
  makeRadioSlug,
  validateMusicModeTracks
} from "@/lib/radio-control.mjs";

export const dynamic = "force-dynamic";

const musicModeSchema = z.object({
  organisationId: z.string().cuid(),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  tracks: z.array(
    z.object({
      trackId: z.string().min(1),
      weight: z.number().int()
    })
  ).default([])
});

function superAdminOnly(access) {
  if (!access.ok) {
    return accessDenied(access);
  }

  if (access.user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a Ruvanas Super Admin can manage music modes." },
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

    const modes = await prisma.musicMode.findMany({
      include: {
        organisation: { select: { id: true, name: true } },
        tracks: {
          include: {
            track: { select: { id: true, title: true, artist: true, status: true } }
          },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: [{ organisation: { name: "asc" } }, { name: "asc" }]
    });

    return NextResponse.json({ modes });
  } catch (error) {
    console.error("List music modes error:", error);
    return NextResponse.json(
      { error: "Unable to load music modes." },
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

    const parsed = musicModeSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a valid organisation, name, description, and track selection." },
        { status: 400 }
      );
    }

    const slug = makeRadioSlug(parsed.data.slug || parsed.data.name);

    if (!slug) {
      return NextResponse.json(
        { error: "Enter a name that can produce a valid slug." },
        { status: 400 }
      );
    }

    const trackSelection = validateMusicModeTracks(parsed.data.tracks);

    if (!trackSelection.ok) {
      return NextResponse.json({ error: trackSelection.error }, { status: 400 });
    }

    const organisation = await prisma.organisation.findUnique({
      where: { id: parsed.data.organisationId },
      select: { id: true }
    });

    if (!organisation) {
      return NextResponse.json(
        { error: "The selected organisation does not exist." },
        { status: 404 }
      );
    }

    const trackIds = trackSelection.tracks.map((entry) => entry.trackId);
    const tracks = trackIds.length
      ? await prisma.track.findMany({
          where: { id: { in: trackIds } },
          include: { mediaAsset: true }
        })
      : [];

    if (
      tracks.length !== trackIds.length ||
      tracks.some(
        (track) => !canUseTrackForOrganisation(track, organisation.id)
      )
    ) {
      return NextResponse.json(
        { error: "One or more tracks are unavailable to this organisation." },
        { status: 400 }
      );
    }

    const mode = await prisma.$transaction(async (tx) => {
      const created = await tx.musicMode.create({
        data: {
          organisationId: organisation.id,
          name: parsed.data.name,
          slug,
          description: parsed.data.description || null,
          tracks: {
            create: trackSelection.tracks.map((entry) => ({
              trackId: entry.trackId,
              weight: entry.weight
            }))
          }
        }
      });

      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: access.user.id,
          action: "MUSIC_MODE_CREATED",
          entityType: "MusicMode",
          entityId: created.id,
          details: {
            name: created.name,
            slug: created.slug,
            trackCount: trackSelection.tracks.length
          }
        }
      });

      return created;
    });

    return NextResponse.json({ ok: true, mode }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "A music mode with this slug already exists for the organisation." },
        { status: 409 }
      );
    }

    console.error("Create music mode error:", error);
    return NextResponse.json(
      { error: "Unable to create the music mode." },
      { status: 500 }
    );
  }
}

