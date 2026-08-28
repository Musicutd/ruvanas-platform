import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { verifyPlaybackProofToken } from "@/lib/playback-proof.mjs";

export const runtime = "nodejs";

const MAX_BATCH_SIZE = 100;
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_PROMO_START_EARLY_MS = 5 * 60 * 1000;
const MAX_PROMO_COMPLETION_LATE_MS = 2 * 60 * 60 * 1000;

const eventSchema = z.object({
  eventId: z.string().uuid(),
  manifestVersion: z.string().regex(/^[0-9a-f]{24}$/),
  proofToken: z.string().regex(/^[0-9a-f]{64}$/),
  scheduleItemId: z.string().regex(/^[0-9a-f]{64}$/),
  itemType: z.enum(["MUSIC", "PROMO", "SCHOOL_ANNOUNCEMENT"]),
  trackId: z.string().cuid().optional().nullable(),
  eventType: z.enum(["STARTED", "COMPLETED", "FAILED", "INTERRUPTED"]),
  occurredAt: z.string().datetime({ offset: true }),
  positionSeconds: z.number().int().min(0).max(86400).optional().nullable(),
  failureReason: z.string().trim().max(500).optional().nullable()
}).superRefine((event, context) => {
  if (event.itemType === "MUSIC" && !event.trackId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Music events need a track ID.", path: ["trackId"] });
  }
  if (event.itemType !== "MUSIC" && event.trackId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Insertion events cannot claim a catalogue track.", path: ["trackId"] });
  }
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(MAX_BATCH_SIZE)
});

function eventFailureReason(event) {
  return new Set(["FAILED", "INTERRUPTED"]).has(event.eventType)
    ? (event.failureReason || (event.eventType === "INTERRUPTED" ? "Playback interrupted" : "Playback error"))
    : null;
}

export async function POST(request) {
  try {
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED") {
      return NextResponse.json({ error: "This player is not enrolled or has been disabled." }, { status: 401 });
    }

    const parsed = batchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: `Submit between 1 and ${MAX_BATCH_SIZE} valid playback events.` }, { status: 400 });
    }

    const now = new Date();
    const events = parsed.data.events;
    const trackIds = [...new Set(events.filter((event) => event.itemType === "MUSIC").map((event) => event.trackId))];
    const scheduleItemIds = [...new Set(events.filter((event) => event.itemType !== "MUSIC").map((event) => event.scheduleItemId))];
    const [tracks, intents] = await Promise.all([
      prisma.track.findMany({ where: { id: { in: trackIds } }, include: { mediaAsset: true } }),
      prisma.playoutIntent.findMany({
        where: {
          scheduleItemId: { in: scheduleItemIds },
          playerId: player.id,
          organisationId: player.organisationId,
          zoneId: player.zoneId
        },
        include: {
          campaign: { select: { id: true, name: true } },
          schoolBroadcastSlot: { include: { announcement: { select: { id: true, title: true } }, episode: { select: { id: true, title: true } } } },
          schoolRundownItem: { select: { id: true, label: true, type: true } },
          promoVersion: { include: { promoAsset: { select: { id: true, name: true } } } },
          mediaAsset: true
        }
      })
    ]);
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    const intentsByScheduleItemId = new Map(intents.map((intent) => [intent.scheduleItemId, intent]));
    const channelId = player.zone.channelAssignments[0]?.channelId || null;

    for (const event of events) {
      const occurredAt = new Date(event.occurredAt);
      const age = now.getTime() - occurredAt.getTime();
      const track = event.itemType === "MUSIC" ? tracksById.get(event.trackId) : null;
      const intent = event.itemType !== "MUSIC" ? intentsByScheduleItemId.get(event.scheduleItemId) : null;
      const contentId = track?.id || intent?.promoVersionId || intent?.mediaAssetId;
      const validIntentType = !intent || (
        (event.itemType === "PROMO" && Boolean(intent.campaignId) && !intent.schoolBroadcastSlotId) ||
        (event.itemType === "SCHOOL_ANNOUNCEMENT" && Boolean(intent.schoolBroadcastSlotId) && !intent.campaignId)
      );
      const signedForPlayer = contentId && verifyPlaybackProofToken({
        playerId: player.id,
        manifestVersion: event.manifestVersion,
        scheduleItemId: event.scheduleItemId,
        contentId
      }, event.proofToken, process.env.SESSION_SECRET);
      const validPromoTime = !intent || (
        occurredAt.getTime() >= intent.plannedStart.getTime() - MAX_PROMO_START_EARLY_MS &&
        occurredAt.getTime() <= intent.plannedStart.getTime() + MAX_PROMO_COMPLETION_LATE_MS
      );
      const validChannel = !intent?.channelId || intent.channelId === channelId;

      if (!contentId || !signedForPlayer || !validIntentType || !validPromoTime || !validChannel || age > MAX_EVENT_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
        return NextResponse.json({ error: "One or more playback events could not be verified." }, { status: 400 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const inserted = await tx.proofOfPlayEvent.createMany({
        data: events.map((event) => {
          const track = event.itemType === "MUSIC" ? tracksById.get(event.trackId) : null;
          const intent = event.itemType !== "MUSIC" ? intentsByScheduleItemId.get(event.scheduleItemId) : null;
          return {
            clientEventId: event.eventId,
            organisationId: player.organisationId,
            playerId: player.id,
            zoneId: player.zoneId,
            channelId,
            scheduleItemId: event.scheduleItemId,
            itemType: event.itemType,
            trackId: track?.id || null,
            campaignId: intent?.campaignId || null,
            schoolBroadcastSlotId: intent?.schoolBroadcastSlotId || null,
            promoVersionId: intent?.promoVersionId || null,
            playoutIntentId: intent?.id || null,
            mediaAssetId: track?.mediaAssetId || intent?.mediaAssetId,
            manifestVersion: event.manifestVersion,
            eventType: event.eventType,
            occurredAt: new Date(event.occurredAt),
            positionSeconds: event.positionSeconds ?? null,
            failureReason: eventFailureReason(event),
            playerName: player.name,
            locationName: player.zone.location.name,
            zoneName: player.zone.name,
            trackTitle: track?.title || intent?.schoolRundownItem?.label || intent?.schoolBroadcastSlot?.announcement?.title || intent?.schoolBroadcastSlot?.episode?.title || intent?.promoVersion?.promoAsset?.name || "Scheduled audio",
            trackArtist: track?.artist || (event.itemType === "SCHOOL_ANNOUNCEMENT" ? (intent?.schoolRundownItem ? "School programme" : "School announcement") : "Promotion")
          };
        }),
        skipDuplicates: true
      });

      await tx.player.update({ where: { id: player.id }, data: { status: "ONLINE", lastHeartbeatAt: now } });
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
    return NextResponse.json({ error: "Unable to record playback confirmation." }, { status: 500 });
  }
}

