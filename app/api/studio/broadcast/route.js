import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveStudio } from "@/lib/studio-access";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { assertDestinationCapacity, broadcastMetadata, safeStudioDestination } from "@/lib/studio-broadcast.mjs";
import {
  assertGeneralStudioBroadcastSession, assertGeneralStudioDestination, assertGeneralStudioPlayoutSession,
  assertGeneralStudioStation, generalStudioDestinationAllowed,
  generalStudioStationIds, GENERAL_STUDIO_STATION_WHERE
} from "@/lib/studio-general-output-boundary.mjs";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  action: z.enum(["QUICK_CONNECT", "CREATE_EXTERNAL", "SET_ENABLED", "START_BROADCAST", "STOP_BROADCAST", "SET_METADATA", "RESET_METADATA"]),
  stationId: z.string().cuid().optional(), destinationId: z.string().cuid().optional(), destinationIds: z.array(z.string().cuid()).max(10).optional(),
  playoutSessionId: z.string().cuid().optional(), sessionId: z.string().cuid().optional(), expectedRevision: z.number().int().min(0).optional(),
  name: z.string().trim().min(2).max(120).optional(), type: z.enum(["ICECAST", "SHOUTCAST"]).optional(), host: z.string().trim().max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(), mountOrService: z.string().trim().max(160).optional(), codec: z.enum(["MP3", "AAC"]).optional(), bitrateKbps: z.number().int().optional(),
  credential: z.string().min(1).max(2000).optional(), enabled: z.boolean().optional(), primaryGroup: z.string().trim().max(80).optional().nullable(), isBackup: z.boolean().optional(), metadata: z.string().trim().min(1).max(300).optional()
});

const sessionInclude = { destinations: { include: { destination: true } } };
const SESSION_PAGE_SIZE = 50;
const VISIBLE_SESSION_LIMIT = 20;

function requirePro(access) {
  if (access.entitlements.planProductFamily === "CORRECTIONS") throw Object.assign(new Error("Use supervised Ruvanas Inside Studio for Corrections work."), { status: 403 });
  if (!access.entitlements.studioProEnabled) throw Object.assign(new Error("Studio Pro is required for Live Broadcast & Distribution."), { status: 403 });
}

async function recordBroadcastCommand(access, input, idempotencyKey, result, sessionId = null) {
  await prisma.studioBroadcastCommand.create({ data: { organisationId: access.organisation.id, sessionId, idempotencyKey, action: input.action, expectedRevision: input.expectedRevision ?? null, result, actorUserId: access.user.id } });
}

async function getWorkspace(access) {
  const organisationId = access.organisation.id;
  const [destinations, playoutSessions, stations] = await Promise.all([
    prisma.studioBroadcastDestination.findMany({ where: { organisationId }, orderBy: { updatedAt: "desc" } }),
    prisma.studioPlayoutSession.findMany({ where: { organisationId, status: { in: ["ACTIVE", "FALLBACK"] } }, include: { items: { where: { status: "ON_AIR" } } }, orderBy: { updatedAt: "desc" } }),
    prisma.station.findMany({ where: { organisationId, status: "ACTIVE", streamConfig: { isNot: null }, ...GENERAL_STUDIO_STATION_WHERE }, include: { streamConfig: { select: { id: true, serverType: true, outputCodec: true, bitrateKbps: true, sourceConnectionStatus: true } } }, orderBy: { name: "asc" } })
  ]);
  const checkedPlayouts = new Map();
  const safePlayoutIds = new Set();
  function playoutAllowed(id) {
    if (!id) return Promise.resolve(false);
    if (!checkedPlayouts.has(id)) checkedPlayouts.set(id, (async () => {
      try { await assertGeneralStudioPlayoutSession(prisma, organisationId, id); safePlayoutIds.add(id); return true; }
      catch (error) { if (error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") return false; throw error; }
    })());
    return checkedPlayouts.get(id);
  }
  await Promise.all(playoutSessions.map(({ id }) => playoutAllowed(id)));
  const safeStationIds = await generalStudioStationIds(prisma, organisationId, destinations.map(({ stationId }) => stationId));
  const visibleDestinations = destinations.filter((destination) => generalStudioDestinationAllowed(destination, safeStationIds));
  const safeDestinationIds = new Set(visibleDestinations.map(({ id }) => id));
  const visibleSessions = [];
  let cursor;
  while (visibleSessions.length < VISIBLE_SESSION_LIMIT) {
    const page = await prisma.studioBroadcastSession.findMany({
      where: { organisationId }, include: sessionInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: SESSION_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (!page.length) break;
    const allowed = await Promise.all(page.map(async (session) =>
      session.destinations.every((link) => safeDestinationIds.has(link.destinationId)) && await playoutAllowed(session.playoutSessionId)
        ? session : null
    ));
    visibleSessions.push(...allowed.filter(Boolean).slice(0, VISIBLE_SESSION_LIMIT - visibleSessions.length));
    if (page.length < SESSION_PAGE_SIZE) break;
    cursor = page.at(-1).id;
  }
  return { studioLevel: access.entitlements.studioLevel, externalDestinationLimit: access.entitlements.studioExternalDestinationLimit, providerConfigured: Boolean(process.env.STUDIO_BROADCAST_PROVIDER_URL && process.env.STUDIO_BROADCAST_PROVIDER_TOKEN), destinations: visibleDestinations.map(safeStudioDestination), sessions: visibleSessions.map((session) => ({ ...session, destinations: session.destinations.map((link) => ({ ...link, destination: safeStudioDestination(link.destination) })) })), playoutSessions: playoutSessions.filter(({ id }) => safePlayoutIds.has(id)), stations };
}

export async function GET() {
  const access = await requireActiveStudio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try { requirePro(access); return NextResponse.json(await getWorkspace(access)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 500 }); }
}

export async function POST(request) {
  const access = await requireActiveStudio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try { requirePro(access); } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status }); }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The Studio Broadcast request is invalid." }, { status: 400 });
  const input = parsed.data;
  if (input.action === "CREATE_EXTERNAL" || input.action === "SET_ENABLED") {
    return NextResponse.json({ error: "Only Ruvanas Super Admin can configure streaming destinations." }, { status: 403 });
  }
  const idempotencyKey = String(request.headers.get("idempotency-key") || "").trim().slice(0, 160);
  if (!idempotencyKey) return NextResponse.json({ error: "Studio Broadcast commands require an Idempotency-Key." }, { status: 400 });
  try {
    if (input.action === "QUICK_CONNECT" && input.stationId) await assertGeneralStudioStation(prisma, access.organisation.id, input.stationId);
    if (input.action === "START_BROADCAST") {
      if (input.playoutSessionId) await assertGeneralStudioPlayoutSession(prisma, access.organisation.id, input.playoutSessionId);
      const requested = await prisma.studioBroadcastDestination.findMany({ where: { id: { in: input.destinationIds || [] }, organisationId: access.organisation.id } });
      for (const destination of requested) await assertGeneralStudioDestination(prisma, access.organisation.id, destination);
    }
    if (input.action !== "STOP_BROADCAST" && input.sessionId) await assertGeneralStudioBroadcastSession(prisma, access.organisation.id, input.sessionId);
    const prior = await prisma.studioBroadcastCommand.findUnique({ where: { organisationId_idempotencyKey: { organisationId: access.organisation.id, idempotencyKey } } });
    if (prior) {
      if (prior.action !== input.action) throw Object.assign(new Error("This Idempotency-Key was used for another Studio command."), { status: 409 });
      if (input.action !== "STOP_BROADCAST") {
        if (prior.sessionId) await assertGeneralStudioBroadcastSession(prisma, access.organisation.id, prior.sessionId);
        if (prior.result?.destinationId) {
          const destination = await prisma.studioBroadcastDestination.findFirst({ where: { id: prior.result.destinationId, organisationId: access.organisation.id } });
          await assertGeneralStudioDestination(prisma, access.organisation.id, destination);
        }
      }
      return NextResponse.json({ repeated: true, command: prior.result });
    }
    if (input.action === "QUICK_CONNECT") {
      const station = await prisma.station.findFirst({ where: { id: input.stationId, organisationId: access.organisation.id, status: "ACTIVE", streamConfig: { isNot: null }, ...GENERAL_STUDIO_STATION_WHERE }, include: { streamConfig: true } });
      if (!station?.streamConfig) throw new Error("Choose an active Ruvanas station with a managed stream.");
      const existing = await prisma.studioBroadcastDestination.findUnique({ where: { organisationId_name: { organisationId: access.organisation.id, name: `Ruvanas · ${station.name}` } } });
      if (existing) await assertGeneralStudioDestination(prisma, access.organisation.id, existing);
      const destination = await prisma.studioBroadcastDestination.upsert({ where: { organisationId_name: { organisationId: access.organisation.id, name: `Ruvanas · ${station.name}` } }, create: { organisationId: access.organisation.id, stationId: station.id, name: `Ruvanas · ${station.name}`, type: "RUVANAS_MANAGED", codec: station.streamConfig.outputCodec, bitrateKbps: station.streamConfig.bitrateKbps, enabled: true, connectionState: station.streamConfig.sourceConnectionStatus === "CONNECTED" ? "CONNECTED" : "STANDBY", createdByUserId: access.user.id }, update: { stationId: station.id, codec: station.streamConfig.outputCodec, bitrateKbps: station.streamConfig.bitrateKbps, enabled: true } });
      await recordBroadcastCommand(access, input, idempotencyKey, { destinationId: destination.id });
      return NextResponse.json({ destination: safeStudioDestination(destination) }, { status: 201 });
    }
    if (input.action === "START_BROADCAST") {
      const playout = await prisma.studioPlayoutSession.findFirst({ where: { id: input.playoutSessionId, organisationId: access.organisation.id, status: { in: ["ACTIVE", "FALLBACK"] } }, include: { items: { where: { status: "ON_AIR" } } } });
      if (!playout) throw new Error("Choose an active server-side playout session.");
      await assertGeneralStudioPlayoutSession(prisma, access.organisation.id, playout.id);
      const destinations = await prisma.studioBroadcastDestination.findMany({ where: { id: { in: input.destinationIds || [] }, organisationId: access.organisation.id, enabled: true } });
      if (destinations.length !== (input.destinationIds || []).length || !destinations.length) throw new Error("Choose enabled destinations owned by this organisation.");
      for (const destination of destinations) await assertGeneralStudioDestination(prisma, access.organisation.id, destination);
      const external = destinations.filter((destination) => destination.type !== "RUVANAS_MANAGED");
      const activeExternalLinks = await prisma.studioBroadcastSessionDestination.count({ where: { session: { organisationId: access.organisation.id, status: "ACTIVE" }, destination: { type: { in: ["ICECAST", "SHOUTCAST"] } } } });
      assertDestinationCapacity({ tierNumber: access.entitlements.planTierNumber, customLimit: access.entitlements.studioExternalDestinationLimit, activeCount: activeExternalLinks, requestedCount: external.length });
      const automaticMetadata = broadcastMetadata({ currentItem: playout.items[0] });
      const session = await prisma.studioBroadcastSession.create({ data: { organisationId: access.organisation.id, playoutSessionId: playout.id, automaticMetadata, createdByUserId: access.user.id, destinations: { create: destinations.map((destination) => ({ destinationId: destination.id, state: destination.type === "RUVANAS_MANAGED" && destination.connectionState === "CONNECTED" ? "CONNECTED" : "STANDBY" })) } }, include: sessionInclude });
      await prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "STUDIO_BROADCAST_STARTED", entityType: "StudioBroadcastSession", entityId: session.id, details: { playoutSessionId: playout.id, destinationIds: destinations.map((item) => item.id), browserAuthoritative: false } } });
      await recordBroadcastCommand(access, input, idempotencyKey, { sessionId: session.id }, session.id);
      return NextResponse.json({ session }, { status: 201 });
    }
    const session = await prisma.studioBroadcastSession.findFirst({ where: { id: input.sessionId, organisationId: access.organisation.id, status: "ACTIVE" }, include: sessionInclude });
    if (!session) throw Object.assign(new Error("The active Studio Broadcast session was not found."), { status: 404 });
    if (session.revision !== input.expectedRevision) throw Object.assign(new Error("The broadcast session changed in another console. Refresh before continuing."), { status: 409 });
    if (input.action !== "STOP_BROADCAST") await assertGeneralStudioBroadcastSession(prisma, access.organisation.id, session.id);
    let protectedStop = false;
    if (input.action === "STOP_BROADCAST") {
      try { await assertGeneralStudioBroadcastSession(prisma, access.organisation.id, session.id); }
      catch (error) { if (error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") protectedStop = true; else throw error; }
    }
    let data = {};
    if (input.action === "STOP_BROADCAST") data = { status: "ENDED", endedAt: new Date(), endedReason: "Operator ended Studio Broadcast safely." };
    if (input.action === "SET_METADATA") {
      const playout = await prisma.studioPlayoutSession.findFirst({ where: { id: session.playoutSessionId, organisationId: access.organisation.id }, select: { currentItemId: true } });
      data = { metadataOverride: input.metadata, metadataOverrideItemId: playout?.currentItemId || null, automaticMetadata: null };
    }
    if (input.action === "RESET_METADATA") data = { metadataOverride: null, metadataOverrideItemId: null, automaticMetadata: null };
    const updated = await prisma.studioBroadcastSession.update({ where: { id: session.id }, data: { ...data, revision: { increment: 1 } }, include: sessionInclude });
    await prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: `STUDIO_BROADCAST_${input.action}`, entityType: "StudioBroadcastSession", entityId: session.id, details: { revision: updated.revision } } });
    await recordBroadcastCommand(access, input, idempotencyKey, { sessionId: updated.id, revision: updated.revision }, updated.id);
    return NextResponse.json(protectedStop ? { stopped: true, sessionId: updated.id, revision: updated.revision } : { session: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The broadcast command failed safely." }, { status: error?.status || 409 });
  }
}
