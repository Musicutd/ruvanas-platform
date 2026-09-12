import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { requireActiveStudio } from "@/lib/studio-access";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { assertDestinationCapacity, broadcastMetadata, safeStudioDestination, validateStudioDestination } from "@/lib/studio-broadcast.mjs";

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

function requirePro(access) {
  if (!access.entitlements.studioProEnabled) throw Object.assign(new Error("Studio Pro is required for Live Broadcast & Distribution."), { status: 403 });
}

async function recordBroadcastCommand(access, input, idempotencyKey, result, sessionId = null) {
  await prisma.studioBroadcastCommand.create({ data: { organisationId: access.organisation.id, sessionId, idempotencyKey, action: input.action, expectedRevision: input.expectedRevision ?? null, result, actorUserId: access.user.id } });
}

async function getWorkspace(access) {
  const organisationId = access.organisation.id;
  const [destinations, sessions, playoutSessions, stations] = await Promise.all([
    prisma.studioBroadcastDestination.findMany({ where: { organisationId }, orderBy: { updatedAt: "desc" } }),
    prisma.studioBroadcastSession.findMany({ where: { organisationId }, include: sessionInclude, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.studioPlayoutSession.findMany({ where: { organisationId, status: { in: ["ACTIVE", "FALLBACK"] } }, include: { items: { where: { status: "ON_AIR" } } }, orderBy: { updatedAt: "desc" } }),
    prisma.station.findMany({ where: { organisationId, status: "ACTIVE", streamConfig: { isNot: null } }, include: { streamConfig: { select: { id: true, serverType: true, outputCodec: true, bitrateKbps: true, sourceConnectionStatus: true } } }, orderBy: { name: "asc" } })
  ]);
  return { studioLevel: access.entitlements.studioLevel, externalDestinationLimit: access.entitlements.studioExternalDestinationLimit, providerConfigured: Boolean(process.env.STUDIO_BROADCAST_PROVIDER_URL && process.env.STUDIO_BROADCAST_PROVIDER_TOKEN), destinations: destinations.map(safeStudioDestination), sessions: sessions.map((session) => ({ ...session, destinations: session.destinations.map((link) => ({ ...link, destination: safeStudioDestination(link.destination) })) })), playoutSessions, stations };
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
  const idempotencyKey = String(request.headers.get("idempotency-key") || "").trim().slice(0, 160);
  if (!idempotencyKey) return NextResponse.json({ error: "Studio Broadcast commands require an Idempotency-Key." }, { status: 400 });
  try {
    const prior = await prisma.studioBroadcastCommand.findUnique({ where: { organisationId_idempotencyKey: { organisationId: access.organisation.id, idempotencyKey } } });
    if (prior) return NextResponse.json({ repeated: true, command: prior.result });
    if (input.action === "QUICK_CONNECT") {
      const station = await prisma.station.findFirst({ where: { id: input.stationId, organisationId: access.organisation.id, status: "ACTIVE", streamConfig: { isNot: null } }, include: { streamConfig: true } });
      if (!station?.streamConfig) throw new Error("Choose an active Ruvanas station with a managed stream.");
      const destination = await prisma.studioBroadcastDestination.upsert({ where: { organisationId_name: { organisationId: access.organisation.id, name: `Ruvanas · ${station.name}` } }, create: { organisationId: access.organisation.id, stationId: station.id, name: `Ruvanas · ${station.name}`, type: "RUVANAS_MANAGED", codec: station.streamConfig.outputCodec, bitrateKbps: station.streamConfig.bitrateKbps, enabled: true, connectionState: station.streamConfig.sourceConnectionStatus === "CONNECTED" ? "CONNECTED" : "STANDBY", createdByUserId: access.user.id }, update: { stationId: station.id, codec: station.streamConfig.outputCodec, bitrateKbps: station.streamConfig.bitrateKbps, enabled: true } });
      await recordBroadcastCommand(access, input, idempotencyKey, { destinationId: destination.id });
      return NextResponse.json({ destination: safeStudioDestination(destination) }, { status: 201 });
    }
    if (input.action === "CREATE_EXTERNAL") {
      const clean = validateStudioDestination(input);
      const destination = await prisma.studioBroadcastDestination.create({ data: { organisationId: access.organisation.id, name: input.name, type: clean.type, host: input.host, port: input.port, mountOrService: input.mountOrService, codec: clean.codec, bitrateKbps: clean.bitrateKbps, credentialEncrypted: encryptSecret(input.credential), enabled: true, primaryGroup: input.primaryGroup || null, isBackup: input.isBackup === true, createdByUserId: access.user.id } });
      await prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "STUDIO_BROADCAST_DESTINATION_CREATED", entityType: "StudioBroadcastDestination", entityId: destination.id, details: { type: destination.type, codec: destination.codec, bitrateKbps: destination.bitrateKbps, credentialStored: true } } });
      await recordBroadcastCommand(access, input, idempotencyKey, { destinationId: destination.id });
      return NextResponse.json({ destination: safeStudioDestination(destination), notice: "Credential encrypted and stored. It cannot be displayed again." }, { status: 201 });
    }
    if (input.action === "SET_ENABLED") {
      const destination = await prisma.studioBroadcastDestination.findFirst({ where: { id: input.destinationId, organisationId: access.organisation.id } });
      if (!destination) throw Object.assign(new Error("The destination was not found."), { status: 404 });
      const updated = await prisma.studioBroadcastDestination.update({ where: { id: destination.id }, data: { enabled: input.enabled, connectionState: input.enabled ? "STANDBY" : "DISABLED" } });
      await recordBroadcastCommand(access, input, idempotencyKey, { destinationId: updated.id, enabled: updated.enabled });
      return NextResponse.json({ destination: safeStudioDestination(updated) });
    }
    if (input.action === "START_BROADCAST") {
      const playout = await prisma.studioPlayoutSession.findFirst({ where: { id: input.playoutSessionId, organisationId: access.organisation.id, status: { in: ["ACTIVE", "FALLBACK"] } }, include: { items: { where: { status: "ON_AIR" } } } });
      if (!playout) throw new Error("Choose an active server-side playout session.");
      const destinations = await prisma.studioBroadcastDestination.findMany({ where: { id: { in: input.destinationIds || [] }, organisationId: access.organisation.id, enabled: true } });
      if (destinations.length !== (input.destinationIds || []).length || !destinations.length) throw new Error("Choose enabled destinations owned by this organisation.");
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
    return NextResponse.json({ session: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The broadcast command failed safely." }, { status: error?.status || 409 });
  }
}
