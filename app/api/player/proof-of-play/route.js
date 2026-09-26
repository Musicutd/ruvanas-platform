import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { verifyPlaybackProofToken } from "@/lib/playback-proof.mjs";
import { queueOutgoingWebhookEvent } from "@/lib/outgoing-webhook-service";
import { appendRightsUsageLedger } from "@/lib/rights-royalty-service";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

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
  programmingSourceProofToken: z.string().regex(/^[0-9a-f]{64}$/).optional().nullable(),
  scheduleItemId: z.string().regex(/^[0-9a-f]{64}$/),
  itemType: z.enum(["MUSIC", "PROMO", "SCHOOL_ANNOUNCEMENT", "CORRECTIONS_AUDIO"]),
  programmingSource: z.enum([
    "ZONE_SLOT",
    "LOCATION_SLOT",
    "DEFAULT_AUTODJ",
    "BACKUP_AUTODJ",
    "CAMPAIGN",
    "SCHOOL_PROGRAMMING",
    "PROGRAMME_MUSIC_MODE",
    "PROGRAMME_RADIO_CLOCK",
    "PROGRAMME_SHOW_RUNDOWN",
    "CRITICAL_FAILURE",
    "CORRECTIONS_REQUEST",
    "CORRECTIONS_REHABILITATION",
    "CORRECTIONS_STANDARD", "CORRECTIONS_PRIORITY", "CORRECTIONS_EMERGENCY"
  ]).optional().nullable(),
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
  if (event.programmingSource && !event.programmingSourceProofToken) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Programming source evidence needs its signed token.", path: ["programmingSourceProofToken"] });
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
    const privateFacility = await prisma.correctionsFacility.findUnique({ where: { locationId: player.zone.locationId }, select: { locationId: true } });
    const events = parsed.data.events;
    const trackIds = [...new Set(events.filter((event) => event.itemType === "MUSIC").map((event) => event.trackId))];
    const scheduleItemIds = [...new Set(events.map((event) => event.scheduleItemId))];
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
          correctionsRequest: { select: { id: true, organisationId: true, facilityId: true, status: true } },
          correctionsRehabContent: { select: { id: true, organisationId: true, facilityId: true } },
          correctionsAnnouncement: { select: { id: true, organisationId: true, facilityId: true, status: true, mediaAssetId: true, promoVersionId: true, title: true } },
          correctionsOverride: { select: { id: true, organisationId: true, facilityId: true, type: true, status: true, startedAt: true, endedAt: true, expiresAt: true, targetZoneIds: true, targetPlayerIds: true } },
          promoVersion: { include: { promoAsset: { select: { id: true, name: true } } } },
          mediaAsset: true
        }
      })
    ]);
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    const intentsByScheduleItemId = new Map(intents.map((intent) => [intent.scheduleItemId, intent]));
    const channel = player.zone.channelAssignments[0]?.channel || null;
    const channelId = channel?.id || null;

    for (const event of events) {
      const occurredAt = new Date(event.occurredAt);
      const age = now.getTime() - occurredAt.getTime();
      const track = event.itemType === "MUSIC" ? tracksById.get(event.trackId) : null;
      const intent = intentsByScheduleItemId.get(event.scheduleItemId) || null;
      const inside = Boolean(intent?.correctionsRequestId || intent?.correctionsRehabContentId || intent?.correctionsAnnouncementId);
      const announcement = intent?.correctionsAnnouncement || null;
      const override = intent?.correctionsOverride || null;
      const c6 = Boolean(intent?.correctionsAnnouncementId);
      const contentId = track?.id || intent?.promoVersionId || intent?.mediaAssetId;
      const endedProofAllowed = override?.endedAt && (new Date(event.occurredAt) <= override.endedAt || (event.eventType === "INTERRUPTED" && new Date(event.occurredAt).getTime() <= override.endedAt.getTime() + 15000));
      const validIntentType = c6 ? (
        (!intent.cancelledAt || endedProofAllowed) &&
        !intent.campaignId && !intent.schoolBroadcastSlotId && !intent.correctionsRequestId && !intent.correctionsRehabContentId &&
        event.itemType === "CORRECTIONS_AUDIO" && !event.trackId &&
        announcement?.status === "APPROVED" && announcement.organisationId === player.organisationId && announcement.facilityId === player.zone.locationId &&
        announcement.mediaAssetId === intent.mediaAssetId && announcement.promoVersionId === intent.promoVersionId &&
        event.programmingSource === (override ? `CORRECTIONS_${override.type}` : "CORRECTIONS_STANDARD") &&
        (!override || (override.organisationId === player.organisationId && override.facilityId === player.zone.locationId && override.targetZoneIds.includes(player.zoneId) && override.targetPlayerIds.includes(player.id) &&
          (override.status === "ACTIVE" || endedProofAllowed)))
      ) : inside ? (
        !intent.cancelledAt && intent.organisationId === player.organisationId && intent.zoneId === player.zoneId &&
        !intent.campaignId && !intent.schoolBroadcastSlotId &&
        (event.programmingSource === (intent.correctionsRequestId ? "CORRECTIONS_REQUEST" : "CORRECTIONS_REHABILITATION")) &&
        (event.itemType === "MUSIC" ? Boolean(track && intent.correctionsTrackId === track.id && intent.mediaAssetId === track.mediaAssetId) :
          event.itemType === "CORRECTIONS_AUDIO" && !intent.correctionsTrackId) &&
        (!intent.correctionsRequest || (intent.correctionsRequest.facilityId === player.zone.locationId && ["SCHEDULED", "PLAYED"].includes(intent.correctionsRequest.status))) &&
        (!intent.correctionsRehabContent || (intent.correctionsRehabContent.organisationId === player.organisationId && (!intent.correctionsRehabContent.facilityId || intent.correctionsRehabContent.facilityId === player.zone.locationId)))
      ) : !intent || (
        (event.itemType === "PROMO" && Boolean(intent.campaignId) && !intent.schoolBroadcastSlotId) ||
        (event.itemType === "SCHOOL_ANNOUNCEMENT" && Boolean(intent.schoolBroadcastSlotId) && !intent.campaignId)
      );
      const signedForPlayer = contentId && verifyPlaybackProofToken({
        playerId: player.id,
        manifestVersion: event.manifestVersion,
        scheduleItemId: event.scheduleItemId,
        contentId
      }, event.proofToken, process.env.SESSION_SECRET);
      const signedProgrammingSource = !event.programmingSource || verifyPlaybackProofToken({
        playerId: player.id,
        manifestVersion: event.manifestVersion,
        scheduleItemId: event.scheduleItemId,
        contentId,
        programmingSource: event.programmingSource
      }, event.programmingSourceProofToken, process.env.SESSION_SECRET);
      const validPromoTime = !intent || (inside
        ? occurredAt.getTime() >= intent.plannedStart.getTime() - (event.eventType === "STARTED" ? 10_000 : 0) && occurredAt.getTime() <= intent.expiresAt.getTime()
        : occurredAt.getTime() >= intent.plannedStart.getTime() - MAX_PROMO_START_EARLY_MS && occurredAt.getTime() <= intent.plannedStart.getTime() + MAX_PROMO_COMPLETION_LATE_MS);
      const validChannel = !intent?.channelId || intent.channelId === channelId;
      const validCompletion = !inside || event.eventType !== "COMPLETED" ||
        (Number.isInteger(event.positionSeconds) && event.positionSeconds >= Math.max(1, Math.floor(Number(intent.mediaAsset.durationSeconds) - 5)));
      const interruptedByOverride = inside && !override && event.eventType === "COMPLETED" && Boolean(await prisma.correctionsOverride.findFirst({ where: {
        organisationId: player.organisationId, facilityId: player.zone.locationId, targetPlayerIds: { has: player.id },
        startedAt: { lte: occurredAt }, expiresAt: { gt: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }]
      }, select: { id: true } }));

      if (!contentId || !signedForPlayer || !signedProgrammingSource || !validIntentType || !validPromoTime || !validChannel || !validCompletion ||
          interruptedByOverride ||
          (Boolean(privateFacility) !== inside) ||
          (event.programmingSource?.startsWith("CORRECTIONS_") && !inside) ||
          (event.itemType === "CORRECTIONS_AUDIO" && !inside) ||
          age > MAX_EVENT_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
        return NextResponse.json({ error: "One or more playback events could not be verified." }, { status: 400 });
      }
    }

    const result = await runSerializableTransaction(prisma, async (tx) => {
      const insideIntentIds = intents.filter((intent) => intent.correctionsRequestId || intent.correctionsRehabContentId || intent.correctionsAnnouncementId).map((intent) => intent.id);
      const previousInside = insideIntentIds.length ? await tx.proofOfPlayEvent.findMany({ where: { playoutIntentId: { in: insideIntentIds }, eventType: { in: ["COMPLETED", "FAILED", "INTERRUPTED"] } }, select: { playoutIntentId: true, eventType: true } }) : [];
      const seenInside = new Set(previousInside.map((item) => `${item.playoutIntentId}:${item.eventType}`));
      const acceptedEvents = events.filter((event) => {
        const intent = intentsByScheduleItemId.get(event.scheduleItemId);
        if (!intent?.correctionsRequestId && !intent?.correctionsRehabContentId && !intent?.correctionsAnnouncementId) return true;
        if (event.eventType === "STARTED") return true;
        const key = `${intent.id}:${event.eventType}`;
        if (seenInside.has(key)) return false;
        seenInside.add(key);
        return true;
      });
      const inserted = await tx.proofOfPlayEvent.createMany({
        data: acceptedEvents.map((event) => {
          const track = event.itemType === "MUSIC" ? tracksById.get(event.trackId) : null;
          const intent = intentsByScheduleItemId.get(event.scheduleItemId) || null;
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
            programmingSource: event.programmingSource || null,
            eventType: event.eventType,
            occurredAt: new Date(event.occurredAt),
            positionSeconds: event.positionSeconds ?? null,
            failureReason: eventFailureReason(event),
            playerName: player.name,
            locationName: player.zone.location.name,
            zoneName: player.zone.name,
            trackTitle: track?.title || intent?.correctionsAnnouncement?.title || (intent?.correctionsRequestId ? "Approved Inside request" : null) || (intent?.correctionsRehabContentId ? "Approved rehabilitation audio" : null) || intent?.schoolRundownItem?.label || intent?.schoolBroadcastSlot?.announcement?.title || intent?.schoolBroadcastSlot?.episode?.title || intent?.promoVersion?.promoAsset?.name || "Scheduled audio",
            trackArtist: track?.artist || (intent?.correctionsRequestId || intent?.correctionsRehabContentId || intent?.correctionsAnnouncementId ? "Ruvanas Inside" : event.itemType === "SCHOOL_ANNOUNCEMENT" ? (intent?.schoolRundownItem ? "School programme" : "School announcement") : "Promotion")
          };
        }),
        skipDuplicates: true
      });

      for (const event of acceptedEvents) {
        const intent = intentsByScheduleItemId.get(event.scheduleItemId);
        if (privateFacility && intent && !intent.correctionsOverrideId && event.eventType === "STARTED") {
          const occurredAt = new Date(event.occurredAt);
          const previousOverride = await tx.correctionsOverride.findFirst({ where: { organisationId: player.organisationId, facilityId: player.zone.locationId, targetPlayerIds: { has: player.id }, status: { in: ["COMPLETED", "CLEARED", "SUPERSEDED", "EXPIRED"] }, endedAt: { lte: occurredAt, gte: new Date(occurredAt.getTime() - 30 * 60000) } }, orderBy: { endedAt: "desc" } });
          if (previousOverride) {
            const recorded = await tx.auditLog.findFirst({ where: { organisationId: player.organisationId, action: "CORRECTIONS_RESTORATION_CONFIRMED", entityType: "CorrectionsOverride", entityId: previousOverride.id, details: { path: ["playerId"], equals: player.id } }, select: { id: true } });
            if (!recorded) await tx.auditLog.create({ data: { organisationId: player.organisationId, action: "CORRECTIONS_RESTORATION_CONFIRMED", entityType: "CorrectionsOverride", entityId: previousOverride.id, details: { playerId: player.id, zoneId: player.zoneId, resumedIntentId: intent.id, proofEventId: event.eventId } } });
          }
        }
        if (!intent?.correctionsRequestId && !intent?.correctionsRehabContentId && !intent?.correctionsAnnouncementId) continue;
        if (intent.correctionsAnnouncementId) {
          const override = intent.correctionsOverride;
          const action = event.eventType === "COMPLETED" ? "CORRECTIONS_ANNOUNCEMENT_DELIVERED" : ["FAILED", "INTERRUPTED"].includes(event.eventType) ? "CORRECTIONS_ANNOUNCEMENT_DELIVERY_ISSUE" : "CORRECTIONS_ANNOUNCEMENT_STARTED";
          await tx.auditLog.create({ data: { organisationId: player.organisationId, action, entityType: override ? "CorrectionsOverride" : "CorrectionsAnnouncement", entityId: override?.id || intent.correctionsAnnouncementId, details: { intentId: intent.id, eventId: event.eventId, zoneId: player.zoneId, playerId: player.id, eventType: event.eventType } } });
          if (["FAILED", "INTERRUPTED"].includes(event.eventType)) await enqueueNotificationEvent(tx, { organisationId: player.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: override?.type === "EMERGENCY" ? "CRITICAL" : "WARNING", title: "Inside announcement delivery needs attention", message: "A targeted player did not confirm a complete announcement play.", entityType: override ? "CorrectionsOverride" : "CorrectionsAnnouncement", entityId: override?.id || intent.correctionsAnnouncementId, dedupeKey: `inside-announcement-failure:${intent.id}`, correlationId: intent.id });
          if (override && event.eventType === "COMPLETED" && override.status === "ACTIVE") {
            const completed = await tx.proofOfPlayEvent.count({ where: { eventType: "COMPLETED", playoutIntent: { correctionsOverrideId: override.id } } });
            if (completed >= override.targetPlayerIds.length) {
              const changed = await tx.correctionsOverride.updateMany({ where: { id: override.id, status: "ACTIVE" }, data: { status: "COMPLETED", endedAt: new Date() } });
              if (changed.count) await tx.auditLog.create({ data: { organisationId: player.organisationId, action: `CORRECTIONS_${override.type}_COMPLETED`, entityType: "CorrectionsOverride", entityId: override.id, details: { completedPlayerCount: completed, restoration: "RE_RESOLVE_CURRENT_PRIVATE_PROGRAMMING" } } });
            }
          }
          continue;
        }
        if (event.eventType === "COMPLETED" && intent.correctionsRequestId) {
          const changed = await tx.correctionsRequest.updateMany({ where: { id: intent.correctionsRequestId, organisationId: player.organisationId, facilityId: player.zone.locationId, status: "SCHEDULED" }, data: { status: "PLAYED" } });
          if (changed.count) await tx.auditLog.create({ data: { organisationId: player.organisationId, action: "CORRECTIONS_REQUEST_DELIVERY_CONFIRMED", entityType: "CorrectionsRequest", entityId: intent.correctionsRequestId, details: { intentId: intent.id, proofEventId: event.eventId, zoneId: player.zoneId, playerId: player.id } } });
        } else if (event.eventType === "COMPLETED" && intent.correctionsRehabContentId) {
          await tx.auditLog.create({ data: { organisationId: player.organisationId, action: "CORRECTIONS_REHAB_DELIVERY_CONFIRMED", entityType: "CorrectionsRehabContent", entityId: intent.correctionsRehabContentId, details: { intentId: intent.id, proofEventId: event.eventId, zoneId: player.zoneId, playerId: player.id } } });
        } else if (["FAILED", "INTERRUPTED"].includes(event.eventType)) {
          await enqueueNotificationEvent(tx, { organisationId: player.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "WARNING", title: "Inside delivery needs attention", message: "A scheduled private player did not confirm a complete play.", entityType: intent.correctionsRequestId ? "CorrectionsRequest" : "CorrectionsRehabContent", entityId: intent.correctionsRequestId || intent.correctionsRehabContentId, dedupeKey: `inside-delivery-issue:${intent.id}`, correlationId: intent.id });
          await tx.auditLog.create({ data: { organisationId: player.organisationId, action: "CORRECTIONS_DELIVERY_ISSUE", entityType: "PlayoutIntent", entityId: intent.id, details: { proofEventId: event.eventId, eventType: event.eventType, zoneId: player.zoneId, playerId: player.id } } });
        }
      }

      const rightsLedgerCount = await appendRightsUsageLedger(tx, { player, channel, events: acceptedEvents, tracksById, receivedAt: now });
      await tx.player.update({ where: { id: player.id }, data: { status: "ONLINE", lastHeartbeatAt: now } });
      if (inserted.count > 0) {
        await queueOutgoingWebhookEvent(tx, {
          organisationId: player.organisationId,
          eventType: "proof.accepted",
          sourceId: events.map((event) => event.eventId).sort().join(","),
          version: String(inserted.count),
          payload: { playerId: player.id, acceptedCount: inserted.count, receivedAt: now.toISOString() }
        });
      }
      return { inserted, rightsLedgerCount };
    });

    return NextResponse.json({
      ok: true,
      accepted: result.inserted.count,
      duplicates: events.length - result.inserted.count,
      rightsUsageRecorded: result.rightsLedgerCount,
      receivedAt: now.toISOString()
    });
  } catch (error) {
    console.error("Proof-of-play ingestion error:", error);
    return NextResponse.json({ error: "Unable to record playback confirmation." }, { status: 500 });
  }
}


