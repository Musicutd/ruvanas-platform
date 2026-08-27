import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { verifyPlaybackProofToken } from "@/lib/playback-proof.mjs";

export const runtime = "nodejs";

const MAX_BATCH_SIZE = 100;
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const eventSchema = z.object({
  eventId: z.string().uuid(),
  manifestVersion: z.string().regex(/^[0-9a-f]{24}$/),
  proofToken: z.string().regex(/^[0-9a-f]{64}$/),
  trackId: z.string().cuid(),
  eventType: z.enum(["STARTED", "COMPLETED", "FAILED"]),
  occurredAt: z.string().datetime({ offset: true }),
  positionSeconds: z.number().int().min(0).max(86400).optional().nullable(),
  failureReason: z.string().trim().max(500).optional().nullable()
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(MAX_BATCH_SIZE)
});

export async function POST(request) {
  try {
    const player = await getCurrentPlayer();

    if (!player || player.status === "DISABLED") {
      return NextResponse.json(
        { error: "This player is not enrolled or has been disabled." },
        { status: 401 }
      );
    }

    const parsed = batchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Submit between 1 and ${MAX_BATCH_SIZE} valid playback events.` },
        { status: 400 }
      );
    }

    const now = new Date();
    const events = parsed.data.events;
    const trackIds = [...new Set(events.map((event) => event.trackId))];
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      include: { mediaAsset: true }
    });
    const tracksById = new Map(tracks.map((track) => [track.id, track]));

    for (const event of events) {
      const occurredAt = new Date(event.occurredAt);
      const age = now.getTime() - occurredAt.getTime();
      const track = tracksById.get(event.trackId);
      const signedForPlayer = verifyPlaybackProofToken({
        playerId: player.id,
        manifestVersion: event.manifestVersion,
        trackId: event.trackId
      }, event.proofToken, process.env.SESSION_SECRET);

      if (!track || !signedForPlayer || age > MAX_EVENT_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
        return NextResponse.json(
          { error: "One or more playback events could not be verified." },
          { status: 400 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const inserted = await tx.proofOfPlayEvent.createMany({
        data: events.map((event) => {
          const track = tracksById.get(event.trackId);
          return {
            clientEventId: event.eventId,
            organisationId: player.organisationId,
            playerId: player.id,
            zoneId: player.zoneId,
            trackId: track.id,
            mediaAssetId: track.mediaAssetId,
            manifestVersion: event.manifestVersion,
            eventType: event.eventType,
            occurredAt: new Date(event.occurredAt),
            positionSeconds: event.positionSeconds ?? null,
            failureReason: event.eventType === "FAILED" ? (event.failureReason || "Playback error") : null,
            playerName: player.name,
            locationName: player.zone.location.name,
            zoneName: player.zone.name,
            trackTitle: track.title,
            trackArtist: track.artist
          };
        }),
        skipDuplicates: true
      });

      await tx.player.update({
        where: { id: player.id },
        data: { status: "ONLINE", lastHeartbeatAt: now }
      });

      return inserted;
    });

    return NextResponse.json({
      ok: true,
      accepted: result.count,
      duplicates: events.length - result.count,
      receivedAt: now.toISOString()
    });
  } catch (error) {
    console.error("Proof-of-play ingestion error:", error);
    return NextResponse.json(
      { error: "Unable to record playback confirmation." },
      { status: 500 }
    );
  }
}
