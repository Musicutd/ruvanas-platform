import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveStudio } from "@/lib/studio-access";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { assertStudioManualOutputBridge, nextStudioQueuePosition, normalizePreparedItem, planStudioFutureReorder, planStudioFutureReplacement, playoutModeTransition, safeEndManualSession, studioManualOutputAvailability, studioQueueReadiness } from "@/lib/studio-playout.mjs";
import { studioMixDefaults } from "@/lib/studio-console.mjs";

export const dynamic = "force-dynamic";

const commandSchema = z.object({
  action: z.enum(["CREATE_SESSION", "ADD_PREPARE", "ADD_LIVE", "UPDATE_PREPARE", "SEND_NEXT", "INSERT_QUEUE", "REORDER", "REPLACE_FUTURE", "LOCK", "SET_MODE", "START_NEXT", "SKIP", "FADE", "END_SESSION", "CREATE_PACK", "ADD_PACK_ITEM"]),
  sessionId: z.string().cuid().optional(), expectedRevision: z.number().int().min(0).optional(),
  channelId: z.string().cuid().optional(), title: z.string().trim().min(2).max(160).optional(), mode: z.enum(["AUTO", "ASSIST", "MANUAL"]).optional(),
  itemId: z.string().cuid().optional(), replacementItemId: z.string().cuid().optional(), mediaAssetId: z.string().cuid().optional(), position: z.number().int().min(0).optional(), locked: z.boolean().optional(),
  artistOrProgramme: z.string().trim().max(160).optional().nullable(), itemType: z.string().trim().max(60).optional(),
  cueInMs: z.number().int().min(0).optional(), cueOutMs: z.number().int().positive().optional().nullable(), fadeInMs: z.number().int().min(0).optional(), fadeOutMs: z.number().int().min(0).optional(), gainDb: z.number().min(-18).max(12).optional(),
  packId: z.string().cuid().optional(), role: z.enum(["INTRO", "OUTRO", "JINGLE", "BED", "PROMO", "PRERECORDED_SEGMENT", "INTERVIEW", "RECURRING_FEATURE"]).optional(), description: z.string().trim().max(1000).optional().nullable()
});

const sessionInclude = { items: { orderBy: [{ area: "asc" }, { position: "asc" }, { createdAt: "asc" }] } };

function requirePro(access) {
  if (!access.entitlements.studioProEnabled) throw Object.assign(new Error("Studio Pro is required for Manual Playout."), { status: 403 });
}

function productChannelFilter(productFamily) {
  return { OR: [{ stationId: null }, { station: { is: { productFamily } } }] };
}

async function rightsContext(tx, access, channelId) {
  const [policy, configuredGenres] = await Promise.all([
    channelId ? tx.autoDjPolicy.findFirst({ where: { organisationId: access.organisation.id, channelId }, select: { rightsUse: true, territory: true } }) : Promise.resolve(null),
    tx.mediaGenre.findMany({ where: { active: true }, select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 250 })
  ]);
  return {
    organisationId: access.organisation.id,
    productFamily: access.entitlements.planProductFamily,
    licensedMusicCatalogueLevel: access.entitlements.licensedMusicCatalogueLevel,
    rightsUse: policy?.rightsUse || null,
    territory: policy?.territory || null,
    configuredGenres
  };
}

async function workspace(access) {
  const organisationId = access.organisation.id;
  const [sessions, channels, assets, packs] = await Promise.all([
    prisma.studioPlayoutSession.findMany({ where: { organisationId, productFamily: access.entitlements.planProductFamily }, include: sessionInclude, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.channel.findMany({ where: { organisationId, status: "ACTIVE", ...productChannelFilter(access.entitlements.planProductFamily) }, include: { autoDjPolicy: { select: { id: true, enabled: true, state: true } }, station: { select: { id: true, name: true } } }, orderBy: { name: "asc" } }),
    prisma.mediaAsset.findMany({ where: { status: "READY", OR: [{ organisationId }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { genres: { include: { mediaGenre: true } }, track: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.studioProgrammePack.findMany({ where: { organisationId }, include: { items: { orderBy: { position: "asc" } } }, orderBy: { updatedAt: "desc" } })
  ]);
  const options = await rightsContext(prisma, access, sessions.find((session) => session.status === "ACTIVE")?.channelId || channels[0]?.id || null);
  return { organisation: { id: organisationId, name: access.organisation.name }, studioLevel: access.entitlements.studioLevel, productFamily: access.entitlements.planProductFamily, manualOutput: studioManualOutputAvailability(), sessions, channels, assets: assets.filter((asset) => studioQueueReadiness(asset, options).ready).map((asset) => ({ id: asset.id, name: asset.name, mediaType: asset.mediaType, libraryType: asset.libraryType, durationSeconds: asset.durationSeconds, licensed: !asset.organisationId, artist: asset.track?.artist || null, title: asset.track?.title || null })), packs };
}

export async function GET() {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try { requirePro(access); return NextResponse.json(await workspace(access)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 500 }); }
}

async function findSession(tx, access, input) {
  if (!input.sessionId || input.expectedRevision == null) throw new Error("Refresh the playout workspace and try again.");
  const session = await tx.studioPlayoutSession.findFirst({ where: { id: input.sessionId, organisationId: access.organisation.id, productFamily: access.entitlements.planProductFamily, status: { in: ["ACTIVE", "FALLBACK"] } }, include: sessionInclude });
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
  if ((input.action === "SET_MODE" && input.mode === "MANUAL") || ["START_NEXT", "SKIP", "FADE"].includes(input.action)) {
    try { assertStudioManualOutputBridge(); } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 409 }); }
  }
  const idempotencyKey = String(request.headers.get("idempotency-key") || "").trim().slice(0, 160);
  if (!idempotencyKey) return NextResponse.json({ error: "Manual Playout commands require an Idempotency-Key." }, { status: 400 });
  try {
    const prior = await prisma.studioPlayoutCommand.findUnique({ where: { organisationId_idempotencyKey: { organisationId: access.organisation.id, idempotencyKey } } });
    if (prior) return NextResponse.json({ ...prior.result, repeated: true });
    if (input.action === "CREATE_SESSION") {
      const channel = await prisma.channel.findFirst({ where: { id: input.channelId, organisationId: access.organisation.id, status: "ACTIVE", ...productChannelFilter(access.entitlements.planProductFamily) }, include: { autoDjPolicy: true } });
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
      const [pack, asset] = await Promise.all([prisma.studioProgrammePack.findFirst({ where: { id: input.packId, organisationId: access.organisation.id, productFamily: access.entitlements.planProductFamily } }), prisma.mediaAsset.findFirst({ where: { id: input.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { genres: { include: { mediaGenre: true } }, track: true } })]);
      if (!pack || !asset) throw new Error("Choose an available programme pack and protected media item.");
      const readiness = studioQueueReadiness(asset, await rightsContext(prisma, access, null)); if (!readiness.ready) throw new Error(readiness.reason);
      const position = await prisma.studioProgrammePackItem.count({ where: { packId: pack.id } });
      const item = await prisma.studioProgrammePackItem.create({ data: { packId: pack.id, organisationId: access.organisation.id, mediaAssetId: asset.id, role: input.role, position, label: input.title || asset.name } });
      return NextResponse.json({ item }, { status: 201 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const session = await findSession(tx, access, input);
      let payload = {};
      if (["ADD_PREPARE", "ADD_LIVE"].includes(input.action)) {
        const asset = await tx.mediaAsset.findFirst({ where: { id: input.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { genres: { include: { mediaGenre: true } }, track: true } });
        if (!asset) throw new Error("Choose protected media available to this organisation.");
        const readiness = studioQueueReadiness(asset, await rightsContext(tx, access, session.channelId));
        const points = asset.organisationId === access.organisation.id ? await tx.studioMixPoint.findMany({ where: { organisationId: access.organisation.id, mediaAssetId: asset.id }, select: { type: true, positionMs: true } }) : [];
        const prepared = normalizePreparedItem({ ...studioMixDefaults(points, Math.round(Number(asset.durationSeconds || 0) * 1000)), ...input }, asset, { studioLevel: access.entitlements.studioLevel, readiness });
        if (input.action === "ADD_LIVE" && !readiness.ready) throw new Error(readiness.reason);
        const area = input.action === "ADD_LIVE" ? "LIVE" : "PREPARE";
        const position = nextStudioQueuePosition(session.items, area);
        payload.item = await tx.studioPlayoutItem.create({ data: { ...prepared, area, sessionId: session.id, organisationId: access.organisation.id, position, createdByUserId: access.user.id } });
      } else if (input.action === "UPDATE_PREPARE") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "PREPARE");
        if (!item) throw new Error("Choose an item in the private Prepare area.");
        const asset = await tx.mediaAsset.findFirst({ where: { id: item.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { genres: { include: { mediaGenre: true } }, track: true } });
        if (!asset) throw new Error("The protected source is no longer available.");
        const readiness = studioQueueReadiness(asset, await rightsContext(tx, access, session.channelId));
        const prepared = normalizePreparedItem({ ...item, ...input }, asset, { studioLevel: access.entitlements.studioLevel, readiness });
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: prepared });
      } else if (input.action === "SEND_NEXT") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "PREPARE");
        if (!item) throw new Error("Prepare an item first.");
        if (session.items.some((candidate) => candidate.area === "LIVE" && candidate.status === "READY" && candidate.locked)) throw new Error("A future item is locked. Unlock it before inserting another item ahead of it.");
        const asset = await tx.mediaAsset.findFirst({ where: { id: item.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { genres: { include: { mediaGenre: true } }, track: true } });
        const readiness = studioQueueReadiness(asset, await rightsContext(tx, access, session.channelId));
        if (!readiness.ready) throw new Error(readiness.reason);
        await tx.studioPlayoutItem.updateMany({ where: { sessionId: session.id, area: "LIVE", status: "READY" }, data: { position: { increment: 1 } } });
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: { area: "LIVE", position: 0 } });
      } else if (input.action === "INSERT_QUEUE") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "PREPARE");
        if (!item) throw new Error("Prepare an item first.");
        const asset = await tx.mediaAsset.findFirst({ where: { id: item.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { genres: { include: { mediaGenre: true } }, track: true } });
        const readiness = studioQueueReadiness(asset, await rightsContext(tx, access, session.channelId));
        if (!readiness.ready) throw new Error(readiness.reason);
        const position = nextStudioQueuePosition(session.items, "LIVE");
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: { area: "LIVE", position } });
      } else if (input.action === "REORDER") {
        const changes = planStudioFutureReorder(session.items, input.itemId, input.position);
        for (const change of changes) await tx.studioPlayoutItem.update({ where: { id: change.id }, data: { position: change.position } });
        payload.item = await tx.studioPlayoutItem.findUnique({ where: { id: input.itemId } });
      } else if (input.action === "REPLACE_FUTURE") {
        const swap = planStudioFutureReplacement(session.items, input.itemId, input.replacementItemId);
        const prepared = session.items.find((item) => item.id === swap.incoming.id);
        const outgoing = session.items.find((item) => item.id === swap.outgoing.id);
        const outgoingAsset = await tx.mediaAsset.findFirst({ where: { id: outgoing.mediaAssetId, organisationId: access.organisation.id }, select: { mediaType: true } });
        if (outgoingAsset?.mediaType !== "MUSIC") throw new Error("Only ordinary organisation-owned music may be replaced here. Protected programme, promo and catalogue items remain unchanged.");
        const asset = await tx.mediaAsset.findFirst({ where: { id: prepared.mediaAssetId, OR: [{ organisationId: access.organisation.id }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { genres: { include: { mediaGenre: true } }, track: true } });
        const readiness = studioQueueReadiness(asset, await rightsContext(tx, access, session.channelId));
        if (!readiness.ready) throw new Error(readiness.reason);
        await tx.studioPlayoutItem.update({ where: { id: swap.outgoing.id }, data: { area: swap.outgoing.area, position: swap.outgoing.position, estimatedStartAt: null } });
        payload.item = await tx.studioPlayoutItem.update({ where: { id: swap.incoming.id }, data: { area: swap.incoming.area, position: swap.incoming.position, estimatedStartAt: swap.incoming.estimatedStartAt, rightsReady: true, readinessReason: readiness.reason } });
      } else if (input.action === "LOCK") {
        const item = session.items.find((candidate) => candidate.id === input.itemId && candidate.area === "LIVE" && candidate.status === "READY");
        if (!item) throw new Error("Choose a future playlist item.");
        payload.item = await tx.studioPlayoutItem.update({ where: { id: item.id }, data: { locked: input.locked !== false } });
      } else if (input.action === "SET_MODE") {
        payload.session = await tx.studioPlayoutSession.update({ where: { id: session.id }, data: playoutModeTransition(session, input.mode, { hasFallback: Boolean(session.fallbackAutoDjId) }) });
      } else if (input.action === "END_SESSION") {
        payload.session = await tx.studioPlayoutSession.update({ where: { id: session.id }, data: { ...safeEndManualSession(session), endedAt: new Date() } });
      }
      const claimed = await tx.studioPlayoutSession.updateMany({ where: { id: session.id, organisationId: access.organisation.id, revision: session.revision }, data: { revision: { increment: 1 }, lastCommandAt: new Date() } });
      if (claimed.count !== 1) throw Object.assign(new Error("The live playlist changed in another console. Refresh before continuing."), { status: 409 });
      const updated = await tx.studioPlayoutSession.findUnique({ where: { id: session.id }, include: sessionInclude });
      payload.session = updated;
      await recordCommand(tx, access, session, input, idempotencyKey, { sessionId: updated.id, revision: updated.revision });
      await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: `STUDIO_PLAYOUT_${input.action}`, entityType: "StudioPlayoutSession", entityId: session.id, details: { revision: updated.revision, itemId: input.itemId || payload.item?.id || null, replacementItemId: input.replacementItemId || null } } });
      return payload;
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The Manual Playout command failed safely." }, { status: error?.status || 409 });
  }
}
