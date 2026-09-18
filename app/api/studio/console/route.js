import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveStudio } from "@/lib/studio-access";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { compileProgrammeScheduleHorizon, localMinuteToUtc } from "@/lib/advanced-scheduler.mjs";
import { deriveStudioDailyLog, normalizeStudioConsoleLayout, STUDIO_CART_BEHAVIOURS, STUDIO_MIX_POINT_TYPES, validateStudioMixPoints } from "@/lib/studio-console.mjs";
import { studioManualOutputAvailability } from "@/lib/studio-playout.mjs";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  action: z.enum(["SAVE_LAYOUT", "CREATE_BANK", "ADD_CART", "REMOVE_CART", "SAVE_MIX_POINT", "CREATE_NOTE", "ACK_NOTE"]),
  channelId: z.string().cuid().optional(), contextKey: z.string().max(100).optional(),
  preset: z.string().max(30).optional(), panels: z.array(z.string()).max(20).optional(), sizes: z.record(z.number()).optional(),
  bankId: z.string().cuid().optional(), cartId: z.string().cuid().optional(), mediaAssetId: z.string().cuid().optional(),
  name: z.string().trim().min(2).max(100).optional(), label: z.string().trim().min(1).max(80).optional(),
  shortcut: z.string().trim().max(20).optional().nullable(), behaviour: z.enum(STUDIO_CART_BEHAVIOURS).optional(),
  pointType: z.enum(STUDIO_MIX_POINT_TYPES).optional(), positionMs: z.number().int().min(0).optional(),
  playoutSessionId: z.string().cuid().optional(), programmeScheduleId: z.string().cuid().optional(),
  title: z.string().trim().min(2).max(120).optional(), body: z.string().trim().min(2).max(800).optional(),
  alertAt: z.string().datetime().optional().nullable(), noteId: z.string().cuid().optional()
});

const fail = (message, status = 400) => NextResponse.json({ error: message }, { status });

async function context(request) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return { error: fail(access.error, access.status) };
  if (!access.entitlements.studioProEnabled) return { error: fail("Studio Pro is required for Broadcast Console controls.", 403) };
  const channelId = new URL(request.url).searchParams.get("channelId");
  return { access, channelId };
}

function productChannelFilter(productFamily) {
  return { OR: [{ stationId: null }, { station: { is: { productFamily } } }] };
}

async function ownedChannel(organisationId, channelId, productFamily) {
  if (!channelId) return null;
  return prisma.channel.findFirst({ where: { id: channelId, organisationId, status: "ACTIVE", ...productChannelFilter(productFamily) }, select: { id: true, name: true } });
}

function localDayBounds(date, timezone) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf());
  if (!valid) throw new Error("Choose a valid Daily Log date.");
  const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return { start: localMinuteToUtc(date, 0, timezone), end: localMinuteToUtc(next, 0, timezone) };
}

async function dailyLog(organisationId, channelId, productFamily, requestedDate) {
  const schedule = await prisma.programmeSchedule.findFirst({
    where: { organisationId, channelId },
    include: { versions: { where: { status: "PUBLISHED", isActive: true }, orderBy: { version: "desc" }, take: 1,
      include: { items: { include: { musicMode: { select: { id: true, name: true, status: true } }, radioClock: { select: { id: true, name: true, status: true, publishedVersion: true, items: { orderBy: { position: "asc" }, select: { id: true, label: true, type: true, offsetSeconds: true, durationSeconds: true } } } }, schoolRundown: { select: { id: true, status: true, episode: { select: { title: true } } } } } } } } }
  });
  const timezone = schedule?.timezone || "UTC";
  const date = requestedDate || new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { start, end } = localDayBounds(date, timezone);
  const [generated, campaigns, live, manual, proof] = await Promise.all([
    prisma.generatedPlaylist.findMany({ where: { organisationId, targetId: channelId, status: "PUBLISHED", scheduledDate: new Date(`${date}T00:00:00Z`) }, include: { versions: { where: { publishedAt: { not: null } }, orderBy: { version: "desc" }, take: 1, include: { items: { orderBy: { position: "asc" }, include: { track: { select: { title: true, artist: true } } } } } } }, take: 20 }),
    prisma.playoutIntent.findMany({ where: { organisationId, channelId, plannedStart: { gte: start, lt: end } }, include: { campaign: { select: { name: true } } }, take: 200 }),
    prisma.liveStudioSession.findMany({ where: { organisationId, channelId, scheduledStart: { lt: end }, scheduledEnd: { gt: start } }, select: { id: true, title: true, status: true, scheduledStart: true, scheduledEnd: true }, take: 100 }),
    prisma.studioPlayoutSession.findMany({ where: { organisationId, channelId, productFamily, status: { in: ["ACTIVE", "FALLBACK"] } }, include: { items: { where: { area: "LIVE" }, orderBy: { position: "asc" } } }, take: 1 }),
    prisma.proofOfPlayEvent.findMany({ where: { organisationId, channelId, occurredAt: { gte: start, lt: end }, eventType: { in: ["STARTED", "COMPLETED"] } }, select: { id: true, scheduleItemId: true, mediaAssetId: true, trackTitle: true, eventType: true, occurredAt: true }, orderBy: { occurredAt: "asc" }, take: 300 })
  ]);
  const scheduled = [];
  if (schedule?.versions?.[0]) {
    const projection = compileProgrammeScheduleHorizon(schedule.versions[0], { timezone, startsAt: start, days: 1 });
    for (const occurrence of projection.occurrences) {
      scheduled.push({ id: occurrence.itemId, sourceType: occurrence.sourceType, sourceId: occurrence.sourceId, label: occurrence.label, startsAt: occurrence.startsAt, durationMs: occurrence.endsAt - occurrence.startsAt, hardEvent: true });
      const clock = schedule.versions[0].items.find((item) => item.id === occurrence.itemId)?.radioClock;
      if (clock?.publishedVersion) for (const item of clock.items) {
        scheduled.push({ id: `clock:${occurrence.itemId}:${item.id}`, sourceType: `RADIO_CLOCK_${item.type}`, sourceId: item.id, label: item.label, startsAt: new Date(occurrence.startsAt.getTime() + item.offsetSeconds * 1000), durationMs: item.durationSeconds * 1000, locked: true });
      }
    }
  }
  const generatedItems = generated.flatMap((playlist) => (playlist.versions.find((version) => version.version === playlist.publishedVersion)?.items || []).map((item) => ({ id: item.id, sourceType: "TIMED_PLAYLIST", sourceId: playlist.id, label: `${item.track.artist} — ${item.track.title}`, startsAt: new Date(start.getTime() + playlist.startMinute * 60_000 + item.startOffsetSeconds * 1000), durationMs: item.durationSeconds * 1000, locked: true })));
  const campaignItems = campaigns.map((item) => ({ id: item.id, sourceType: "CAMPAIGN", label: item.campaign?.name || "Scheduled campaign", startsAt: item.plannedStart, durationMs: Math.max(0, item.expiresAt - item.plannedStart), hardEvent: true }));
  const liveItems = live.map((item) => ({ id: item.id, sourceType: "LIVE_SESSION", label: item.title, startsAt: item.scheduledStart, durationMs: item.scheduledEnd - item.scheduledStart, hardEvent: true }));
  const manualItems = manual.flatMap((session) => session.items.filter((item) => item.estimatedStartAt).map((item) => ({ id: item.id, sourceType: "MANUAL_QUEUE", label: item.title, startsAt: item.estimatedStartAt, durationMs: item.durationMs, locked: item.locked })));
  return { date, timezone, ...deriveStudioDailyLog({ scheduled, generated: generatedItems, campaigns: campaignItems, live: liveItems, manual: manualItems, proof, dayStart: start, dayEnd: end }) };
}

export async function GET(request) {
  const { access, error, channelId } = await context(request);
  if (error) return error;
  const organisationId = access.organisation.id;
  const channels = await prisma.channel.findMany({ where: { organisationId, status: "ACTIVE", ...productChannelFilter(access.entitlements.planProductFamily) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const channel = channels.find((candidate) => candidate.id === channelId) || channels[0] || null;
  if (channelId && !channels.some((candidate) => candidate.id === channelId)) return fail("Choose a channel owned by this organisation.", 404);
  if (!channel) return NextResponse.json({ channels, channel: null, notice: "Create a channel before opening Broadcast Console." });
  const [preference, sessions, banks, notes, clocks, sources, browserLive] = await Promise.all([
    prisma.studioConsolePreference.findUnique({ where: { organisationId_userId_contextKey: { organisationId, userId: access.user.id, contextKey: channel.id } } }),
    prisma.studioPlayoutSession.findMany({ where: { organisationId, channelId: channel.id, productFamily: access.entitlements.planProductFamily, status: { in: ["ACTIVE", "FALLBACK"] } }, include: { items: { orderBy: [{ area: "asc" }, { position: "asc" }] } }, orderBy: { updatedAt: "desc" }, take: 1 }),
    prisma.studioCartBank.findMany({ where: { organisationId, productFamily: access.entitlements.planProductFamily, OR: [{ channelId: channel.id }, { channelId: null }] }, include: { carts: { orderBy: { position: "asc" } } }, orderBy: { name: "asc" }, take: 30 }),
    prisma.studioPresenterNote.findMany({ where: { organisationId, channelId: channel.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.radioClock.findMany({ where: { organisationId, status: "PUBLISHED" }, select: { id: true, name: true, durationSeconds: true, publishedVersion: true }, orderBy: { name: "asc" }, take: 100 }),
    prisma.externalLiveSource.findMany({ where: { organisationId, channelId: channel.id }, select: { id: true, name: true, status: true, healthStatus: true }, take: 30 }),
    prisma.liveStudioSession.findMany({ where: { organisationId, channelId: channel.id, status: { in: ["READY", "ON_AIR"] } }, select: { id: true, title: true, status: true, mixerStateJson: true, lastHeartbeatAt: true }, take: 2 })
  ]);
  const broadcast = sessions.length ? await prisma.studioBroadcastSession.findMany({ where: { organisationId, status: "ACTIVE", playoutSessionId: { in: sessions.map((item) => item.id) } }, select: { id: true, status: true, destinations: { select: { state: true, lastSafeError: true, destination: { select: { id: true, name: true, type: true, listenerCount: true, listenerTelemetryAt: true } } } } }, take: 2 }) : [];
  const mediaIds = [...new Set([...banks.flatMap((bank) => bank.carts.map((cart) => cart.mediaAssetId)), ...(sessions[0]?.items || []).map((item) => item.mediaAssetId)])];
  const [media, cartChoices] = await Promise.all([
    prisma.mediaAsset.findMany({ where: { id: { in: mediaIds }, organisationId, status: "READY" }, select: { id: true, name: true, durationSeconds: true } }),
    prisma.mediaAsset.findMany({ where: { organisationId, status: "READY", mediaType: { in: ["COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"] } }, select: { id: true, name: true, mediaType: true }, orderBy: { createdAt: "desc" }, take: 100 })
  ]);
  const assets = new Map(media.map((asset) => [asset.id, asset]));
  try {
    const log = await dailyLog(organisationId, channel.id, access.entitlements.planProductFamily, new URL(request.url).searchParams.get("date"));
    const mixPoints = await prisma.studioMixPoint.findMany({ where: { organisationId, mediaAssetId: { in: mediaIds } }, take: 200 });
    return NextResponse.json({ channels, channel, productFamily: access.entitlements.planProductFamily, manualOutput: studioManualOutputAvailability(), layout: normalizeStudioConsoleLayout(preference || {}), session: sessions[0] || null, banks: banks.map((bank) => ({ ...bank, carts: bank.carts.map((cart) => ({ ...cart, media: assets.get(cart.mediaAssetId) || null, ready: assets.has(cart.mediaAssetId) })) })), cartChoices, markerChoices: media, notes, clocks, sources, browserLive, broadcast, mixPoints, dailyLog: log, rightsNotice: "Only authorised protected media may enter programme output; this Console does not grant catalogue rights." });
  } catch (cause) { return fail(cause instanceof Error ? cause.message : "The Daily Log is unavailable.", 400); }
}

export async function POST(request) {
  const { access, error } = await context(request);
  if (error) return error;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("The Broadcast Console request is invalid.");
  const input = parsed.data;
  const organisationId = access.organisation.id;
  const channel = await ownedChannel(organisationId, input.channelId, access.entitlements.planProductFamily);
  if (!channel) return fail("Choose an active channel owned by this organisation.");
  try {
    if (input.action === "SAVE_LAYOUT") {
      const layout = normalizeStudioConsoleLayout(input);
      const preference = await prisma.studioConsolePreference.upsert({ where: { organisationId_userId_contextKey: { organisationId, userId: access.user.id, contextKey: channel.id } }, create: { organisationId, userId: access.user.id, contextKey: channel.id, ...layout }, update: layout });
      return NextResponse.json({ layout: normalizeStudioConsoleLayout(preference) });
    }
    if (input.action === "CREATE_BANK") {
      if (!input.name) return fail("Enter a cart bank name.");
      const bank = await prisma.studioCartBank.create({ data: { organisationId, channelId: channel.id, productFamily: access.entitlements.planProductFamily, name: input.name, createdByUserId: access.user.id } });
      await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "STUDIO_CART_BANK_CREATED", entityType: "StudioCartBank", entityId: bank.id, details: { channelId: channel.id } } });
      return NextResponse.json({ bank }, { status: 201 });
    }
    if (input.action === "ADD_CART") {
      if (!input.bankId || !input.mediaAssetId) return fail("Choose a cart bank and media file.");
      const [bank, asset] = await Promise.all([prisma.studioCartBank.findFirst({ where: { id: input.bankId, organisationId, productFamily: access.entitlements.planProductFamily, OR: [{ channelId: channel.id }, { channelId: null }] } }), prisma.mediaAsset.findFirst({ where: { id: input.mediaAssetId, organisationId, status: "READY", mediaType: { in: ["COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"] } }, select: { id: true, name: true } })]);
      if (!bank || !asset) return fail("Choose a cart bank and ready organisation-owned media.");
      const last = await prisma.studioCart.findFirst({ where: { bankId: bank.id }, orderBy: { position: "desc" }, select: { position: true } });
      const position = (last?.position ?? -1) + 1;
      const cart = await prisma.studioCart.create({ data: { bankId: bank.id, organisationId, mediaAssetId: asset.id, label: input.label || asset.name, shortcut: input.shortcut || null, behaviour: input.behaviour || "PLAY_ONCE", position } });
      await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "STUDIO_CART_ADDED", entityType: "StudioCart", entityId: cart.id, details: { bankId: bank.id, mediaAssetId: asset.id } } });
      return NextResponse.json({ cart }, { status: 201 });
    }
    if (input.action === "REMOVE_CART") {
      const cart = await prisma.studioCart.findFirst({ where: { id: input.cartId, organisationId, bank: { productFamily: access.entitlements.planProductFamily, OR: [{ channelId: channel.id }, { channelId: null }] } } });
      if (!cart) return fail("The cart was not found.", 404);
      await prisma.studioCart.delete({ where: { id: cart.id } });
      await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "STUDIO_CART_REMOVED", entityType: "StudioCart", entityId: cart.id, details: { bankId: cart.bankId } } });
      return NextResponse.json({ removed: true });
    }
    if (input.action === "SAVE_MIX_POINT") {
      const asset = await prisma.mediaAsset.findFirst({ where: { id: input.mediaAssetId, organisationId, status: "READY" }, select: { id: true, durationSeconds: true } });
      if (!asset || !input.pointType || input.positionMs == null) return fail("Choose ready organisation-owned media and a mix point.");
      const existing = await prisma.studioMixPoint.findMany({ where: { organisationId, mediaAssetId: asset.id } });
      const points = [...existing.filter((point) => point.type !== input.pointType), { type: input.pointType, positionMs: input.positionMs }];
      const assessment = validateStudioMixPoints(points, Math.round(Number(asset.durationSeconds || 0) * 1000));
      if (!assessment.valid) return fail(`Mix point not saved: ${assessment.reason}.`);
      const point = await prisma.studioMixPoint.upsert({ where: { organisationId_mediaAssetId_type: { organisationId, mediaAssetId: asset.id, type: input.pointType } }, create: { organisationId, mediaAssetId: asset.id, type: input.pointType, positionMs: input.positionMs, provenance: "MANUAL", updatedByUserId: access.user.id }, update: { positionMs: input.positionMs, provenance: "MANUAL", updatedByUserId: access.user.id, version: { increment: 1 } } });
      await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "STUDIO_MIX_POINT_SAVED", entityType: "MediaAsset", entityId: asset.id, details: { type: point.type, positionMs: point.positionMs, version: point.version } } });
      return NextResponse.json({ point });
    }
    if (input.action === "CREATE_NOTE") {
      if (!input.title || !input.body) return fail("Enter a note title and text.");
      if (input.playoutSessionId && !await prisma.studioPlayoutSession.findFirst({ where: { id: input.playoutSessionId, organisationId, channelId: channel.id, productFamily: access.entitlements.planProductFamily }, select: { id: true } })) return fail("The live session was not found.");
      const note = await prisma.studioPresenterNote.create({ data: { organisationId, channelId: channel.id, playoutSessionId: input.playoutSessionId || null, title: input.title, body: input.body, alertAt: input.alertAt ? new Date(input.alertAt) : null, createdByUserId: access.user.id } });
      await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "STUDIO_PRESENTER_NOTE_CREATED", entityType: "StudioPresenterNote", entityId: note.id, details: { channelId: channel.id } } });
      return NextResponse.json({ note }, { status: 201 });
    }
    if (input.action === "ACK_NOTE") {
      const note = await prisma.studioPresenterNote.findFirst({ where: { id: input.noteId, organisationId, channelId: channel.id } });
      if (!note) return fail("The note was not found.", 404);
      const updated = await prisma.studioPresenterNote.update({ where: { id: note.id }, data: { acknowledgedAt: new Date(), acknowledgedByUserId: access.user.id } });
      await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "STUDIO_PRESENTER_NOTE_ACKNOWLEDGED", entityType: "StudioPresenterNote", entityId: note.id, details: { channelId: channel.id } } });
      return NextResponse.json({ note: updated });
    }
    return fail("Unsupported Console command.");
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "The Console request failed safely.", 409);
  }
}
