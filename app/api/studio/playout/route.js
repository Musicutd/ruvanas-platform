import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveStudio } from "@/lib/studio-access";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { fallbackForQueue, normalizePreparedItem, playoutModeTransition, safeEndManualSession, studioQueueReadiness } from "@/lib/studio-playout.mjs";

export const dynamic = "force-dynamic";

const commandSchema = z.object({
  action: z.enum(["CREATE_SESSION", "ADD_PREPARE", "ADD_LIVE", "UPDATE_PREPARE", "SEND_NEXT", "INSERT_QUEUE", "REORDER", "LOCK", "SET_MODE", "START_NEXT", "SKIP", "FADE", "END_SESSION", "CREATE_PACK", "ADD_PACK_ITEM"]),
  sessionId: z.string().cuid().optional(), expectedRevision: z.number().int().min(0).optional(),
  channelId: z.string().cuid().optional(), title: z.string().trim().min(2).max(160).optional(), mode: z.enum(["AUTO", "ASSIST", "MANUAL"]).optional(),
  itemId: z.string().cuid().optional(), mediaAssetId: z.string().cuid().optional(), position: z.number().int().min(0).optional(), locked: z.boolean().optional(),
  artistOrProgramme: z.string().trim().max(160).optional().nullable(), itemType: z.string().trim().max(60).optional(),
  cueInMs: z.number().int().min(0).optional(), cueOutMs: z.number().int().positive().optional().nullable(), fadeInMs: z.number().int().min(0).optional(), fadeOutMs: z.number().int().min(0).optional(), gainDb: z.number().min(-18).max(12).optional(),
  packId: z.string().cuid().optional(), role: z.enum(["INTRO", "OUTRO", "JINGLE", "BED", "PROMO", "PRERECORDED_SEGMENT", "INTERVIEW", "RECURRING_FEATURE"]).optional(), description: z.string().trim().max(1000).optional().nullable()
});

const sessionInclude = { items: { orderBy: [{ area: "asc" }, { position: "asc" }, { createdAt: "asc" }] } };

function requirePro(access) {
  if (!access.entitlements.studioProEnabled) throw Object.assign(new Error("Studio Pro is required for Manual Playout."), { status: 403 });
}

async function workspace(access) {
  const organisationId = access.organisation.id;
  const [sessions, channels, assets, packs] = await Promise.all([
    prisma.studioPlayoutSession.findMany({ where: { organisationId }, include: sessionInclude, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.channel.findMany({ where: { organisationId, status: "ACTIVE" }, include: { autoDjPolicy: { select: { id: true, enabled: true, state: true } }, station: { select: { id: true, name: true } } }, orderBy: { name: "asc" } }),
    prisma.mediaAsset.findMany({ where: { status: "READY", OR: [{ organisationId }, ...(access.entitlements.licensedMusicCatalogueEnabled ? [{ organisationId: null, libraryType: "RUVANAS_CATALOGUE", track: { status: "READY", OR: [{ licenceExpiresAt: null }, { licenceExpiresAt: { gte: new Date() } }] } }] : [])] }, include: { track: { select: { title: true, artist: true, status: true, licenceExpiresAt: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.studioProgrammePack.findMany({ where: { organisationId }, include: { items: { orderBy: { position: "asc" } } }, orderBy: { updatedAt: "desc" } })
  ]);
  return { organisation: { id: organisationId, name: access.organisation.name }, studioLevel: access.entitlements.studioLevel, productFamily: access.entitlements.planProductFamily, sessions, channels, assets: assets.map((asset) => ({ id: asset.id, name: asset.name, mediaType: asset.mediaType, libraryType: asset.libraryType, durationSeconds: asset.durationSeconds, licensed: !asset.organisationId, artist: asset.track?.artist || null, title: asset.track?.title || null })), packs };
}

export async function GET() {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try { requirePro(access); return NextResponse.json(await workspace(access)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 500 }); }
}

async function findSession(tx, access, input) {
  if (!input.sessionId || input.expectedRevision == null) throw new Error("Refresh the playout workspace and try again.");
  const session = await tx.studioPlayoutSession.findFirst({ where: { id: input.sessionId, organisationId: access.organisation.id, status: { in: ["ACTIVE", "FALLBACK"] } }, include: sessionInclude });
  if (!session) throw Object.assign(new Error("The active Manual Playout session was not found."), { status: 404 });
  if (session.revision !== input.expectedRevision) throw Object.assign(new Error("The live playlist changed in another console. Refresh before continuing."), { status: 409 });
  return session;
}

async function recordCommand(tx, access, session, input, idempotencyKey, result) {
  await tx.studioPlayoutCommand.create({ data: { sessionId: session.id, organisationId: access.organisation.id, idempotencyKey, action: input.action, expectedRevision: input.expectedRevision, result, actorUserId: access.user.id } });
}

export async function POST(request) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try { requirePro(access); } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status }); }
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The Manual Playout command is invalid." }, { status: 400 });
  const input = parsed.data;
  const idempotencyKey = String(request.headers.get("idempotency-key") || "").trim().slice(0, 160);
  if (!idempotencyKey) return NextResponse.json({ error: "Manual Playout commands require an Idempotency-Key." }, { status: 400 });
  try {
    const prior = await prisma.studioPlayoutCommand.findUnique({ where: { organisationId_idempotencyKey: { organisationId: access.organisation.id, idempotencyKey } } });
    if (prior) return NextResponse.json({ ...prior.result, repeated: true });
    if (input.action === "CREATE_SESSION") {
      const channel = await prisma.channel.findFirst({ where: { id: input.channelId, organisationId: access.organisation.id, status: "ACTIVE" }, include: { autoDjPolicy: true } });
      if (!channel) throw new Error("Choose an active channel owned by this organisation.");
      if (!channel.autoDjPolicy?.enabled || channel.autoDjPolicy.state !== "ACTIVE") throw new Error("Activate an AutoDJ fallback before creating a Manual Playout session.");
      const existing = await prisma.studioPlayoutSession.findFirst({ where: { organisationId: access.organisation.id, channelId: channel.id, status: { in: ["ACTIVE", "FALLBACK"] } }, include: sessionInclude });
      if (existing) return NextResponse.json({ session: existing, repeated: true });
      const session = await prisma.studioPlayoutSession.create({ data: { organisationId: access.organisation.id, channelId: channel.id, productFamily: access.entitlements.planProductFamily, title: input.title, fallbackAutoDjId: channel.autoDjPolicy.id, createdByUserId: access.user.id }, include: sessionInclude });
      await prisma.$transaction([prisma.studioPlayoutCommand.create({ data: { sessionId: session.id, organisationId: access.organisation.id, idempotencyKey, action: input.action, expectedRevision: 0, result: { sessionId: session.id }, actorUserId: access.user.id } }), prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "STUDIO_PLAYOUT_SESSION_CREATED", entityType: "StudioPlayoutSession", entityId: session.id, details: { channelId: channel.id, fallbackAutoDjId: channel.autoDjPolicy.id } } })]);
      return NextResponse.json({ session }, { status: 201 });
    }
    if (input.action === "CREATE_PACK") {
      const pack = await prisma.studioProgrammePack.create({ data: { organisationId: access.organisation.id, name: input.title, description: input.description || null, productFamily: access.entitlements.planProductFamily, createdByUserId: access.user.id } });
      return NextResponse.json({ pack }, { status: 201 });
    }
    if (input.action === "ADD_PACK_ITEM") {
      const [pack, asset] = await Promise.all([prisma.studioProgrammePack.findFirst({ where: { id: input.packId, organisationId: access.organisation.id } }), prisma.mediaAsset.findFirst({ where: { id: input.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { track: true } })]);
      if (!pack || !asset) throw new Error("Choose an available programme pack and protected media item.");
      const readiness = studioQueueReadiness(asset, access.entitlements); if (!readiness.ready) throw new Error(readiness.reason);
      const position = await prisma.studioProgrammePackItem.count({ where: { packId: pack.id } });
      const item = await prisma.studioProgrammePackItem.create({ data: { packId: pack.id, organisationId: access.organisation.id, mediaAssetId: asset.id, role: input.role, position, label: input.title || asset.name } });
      return NextResponse.json({ item }, { status: 201 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const session = await findSession(tx, access, input);
      let payload = {};
      if (["ADD_PREPARE", "ADD_LIVE"].includes(input.action)) {
        const asset = await tx.mediaAsset.findFirst({ where: { id: input.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { track: true } });
        if (!asset) throw new Error("Choose protected media available to this organisation.");
        const readiness = studioQueueReadiness(asset, access.entitlements);
        const prepared = normalizePreparedItem(input, asset, { studioLevel: access.entitlements.studioLevel, readiness });
        if (input.action === "ADD_LIVE" && !readiness.ready) throw new Error(readiness.reason);
        const area = input.action === "ADD_LIVE" ? "LIVE" : "PREPARE";
        const position = await tx.studioPlayoutItem.count({ where: { sessionId: session.id, area, ...(area === "LIVE" ? { status: "READY" } : {}) } });
        payload.item = await tx.studioPlayoutItem.create({ data: { ...prepared, area, sessionId: session.id, organisationId: access.organisation.id, position, createdByUserId: access.user.id } });
      } else if (input.action === "UPDATE_PREPARE") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "PREPARE");
        if (!item) throw new Error("Choose an item in the private Prepare area.");
        const asset = await tx.mediaAsset.findFirst({ where: { id: item.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { track: true } });
        if (!asset) throw new Error("The protected source is no longer available.");
        const readiness = studioQueueReadiness(asset, access.entitlements);
        const prepared = normalizePreparedItem({ ...item, ...input }, asset, { studioLevel: access.entitlements.studioLevel, readiness });
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: prepared });
      } else if (input.action === "SEND_NEXT") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "PREPARE");
        if (!item || !item.rightsReady) throw new Error(item?.readinessReason || "Prepare a rights-ready item first.");
        await tx.studioPlayoutItem.updateMany({ where: { sessionId: session.id, area: "LIVE", status: "READY" }, data: { position: { increment: 1 } } });
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: { area: "LIVE", position: 0 } });
      } else if (input.action === "INSERT_QUEUE") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "PREPARE");
        if (!item || !item.rightsReady) throw new Error(item?.readinessReason || "Prepare a rights-ready item first.");
        const position = await tx.studioPlayoutItem.count({ where: { sessionId: session.id, area: "LIVE", status: "READY" } });
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: { area: "LIVE", position } });
      } else if (input.action === "REORDER") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "LIVE" && candidate.status === "READY");
        if (!item || item.locked) throw new Error("Only unlocked future playlist items can be reordered.");
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: { position: input.position } });
      } else if (input.action === "LOCK") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "LIVE" && candidate.status === "READY");
        if (!item) throw new Error("Choose a future playlist item.");
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: { locked: input.locked !== false } });
      } else if (input.action === "SET_MODE") {
        payload.session = await tx.studioPlayoutSession.update({ where: { id: session.id }, data: playoutModeTransition(session, input.mode, { hasFallback: Boolean(session.fallbackAutoDjId) }) });
      } else if (["START_NEXT", "SKIP", "FADE"].includes(input.action)) {
        const now = new Date();
        const priorityIntent = await tx.playoutIntent.findFirst({ where: { organisationId: access.organisation.id, channelId: session.channelId, plannedStart: { lte: now }, expiresAt: { gt: now } }, select: { id: true, campaignId: true, schoolBroadcastSlotId: true } });
        if (priorityIntent) {
          payload.session = await tx.studioPlayoutSession.update({ where: { id: session.id }, data: { mode: "AUTO", status: "FALLBACK", outputHealth: "SCHEDULED_PRIORITY", endedReason: "A scheduled or campaign item has priority; the manual queue is preserved." } });
        } else {
        const onAir = session.items.find((item) => item.status === "ON_AIR");
        if (onAir) await tx.studioPlayoutItem.update({ where: { id: onAir.id }, data: { area: "PLAYED", status: input.action === "SKIP" ? "SKIPPED" : "PLAYED", endedAt: new Date() } });
        const next = session.items.filter((item) => item.area === "LIVE" && item.status === "READY").sort((a, b) => a.position - b.position)[0];
        if (next) { payload.item = await tx.studioPlayoutItem.update({ where: { id: next.id }, data: { status: "ON_AIR", startedAt: new Date() } }); await tx.studioPlayoutSession.update({ where: { id: session.id }, data: { currentItemId: next.id, outputHealth: "PROGRAMME_OUTPUT" } }); }
        else { const fallback = fallbackForQueue({ ...session, mode: "MANUAL" }, []); payload.session = await tx.studioPlayoutSession.update({ where: { id: session.id }, data: { ...fallback, currentItemId: null } }); }
        }
      } else if (input.action === "END_SESSION") {
        payload.session = await tx.studioPlayoutSession.update({ where: { id: session.id }, data: { ...safeEndManualSession(session), endedAt: new Date() } });
      }
      const updated = await tx.studioPlayoutSession.update({ where: { id: session.id }, data: { revision: { increment: 1 }, lastCommandAt: new Date() }, include: sessionInclude });
      payload.session = updated;
      await recordCommand(tx, access, session, input, idempotencyKey, { sessionId: updated.id, revision: updated.revision });
      await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: `STUDIO_PLAYOUT_${input.action}`, entityType: "StudioPlayoutSession", entityId: session.id, details: { revision: updated.revision, itemId: input.itemId || payload.item?.id || null } } });
      return payload;
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The Manual Playout command failed safely." }, { status: error?.status || 409 });
  }
}
