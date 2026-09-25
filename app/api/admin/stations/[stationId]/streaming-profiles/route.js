import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { encryptSecret } from "@/lib/crypto";
import { parseExternalLiveSourceInput } from "@/lib/external-live.mjs";
import { createExternalLiveSource } from "@/lib/external-live-service";
import { safeStudioDestination, validateStudioDestination } from "@/lib/studio-broadcast.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const destinationSchema = z.object({
  kind: z.literal("STUDIO_DESTINATION"),
  name: z.string().trim().min(2).max(120),
  type: z.enum(["ICECAST", "SHOUTCAST"]),
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  mountOrService: z.string().trim().min(1).max(160),
  codec: z.enum(["MP3", "AAC"]),
  bitrateKbps: z.coerce.number().int(),
  primaryGroup: z.string().trim().max(80).optional(),
  isBackup: z.boolean().optional(),
  credential: z.string().min(1).max(2000)
});

async function stationForSuperAdmin(stationId) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { response: accessDenied(access) };
  if (access.user.role !== "SUPER_ADMIN") {
    return { response: NextResponse.json({ error: "Only Ruvanas Super Admin can configure streaming details." }, { status: 403 }) };
  }
  const station = await prisma.station.findUnique({ where: { id: stationId }, select: { id: true, organisationId: true } });
  if (!station) return { response: NextResponse.json({ error: "Station not found." }, { status: 404 }) };
  return { user: access.user, station };
}

export async function POST(request, { params }) {
  const { stationId } = await params;
  const access = await stationForSuperAdmin(stationId);
  if (access.response) return access.response;
  const body = await request.json().catch(() => null);
  try {
    if (body?.kind === "STUDIO_DESTINATION") {
      const parsed = destinationSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Enter valid destination details and a source credential." }, { status: 400 });
      const input = parsed.data;
      const clean = validateStudioDestination(input);
      const destination = await prisma.$transaction(async (tx) => {
        const saved = await tx.studioBroadcastDestination.create({ data: {
          organisationId: access.station.organisationId,
          stationId: access.station.id,
          name: input.name,
          type: clean.type,
          host: input.host,
          port: input.port,
          mountOrService: input.mountOrService,
          codec: clean.codec,
          bitrateKbps: clean.bitrateKbps,
          credentialEncrypted: encryptSecret(input.credential),
          enabled: true,
          primaryGroup: input.primaryGroup || null,
          isBackup: input.isBackup === true,
          createdByUserId: access.user.id
        } });
        await tx.auditLog.create({ data: {
          organisationId: access.station.organisationId,
          actorUserId: access.user.id,
          action: "STUDIO_BROADCAST_DESTINATION_CREATED",
          entityType: "StudioBroadcastDestination",
          entityId: saved.id,
          details: { stationId: access.station.id, type: saved.type, codec: saved.codec, credentialStored: true }
        } });
        return saved;
      });
      return NextResponse.json({ destination: safeStudioDestination(destination), notice: "Destination saved by Super Admin. The credential cannot be shown again." }, { status: 201 });
    }
    if (body?.kind === "EXTERNAL_LIVE_SOURCE") {
      const input = parseExternalLiveSourceInput(body);
      const channel = await prisma.channel.findFirst({ where: { id: input.channelId, stationId: access.station.id, organisationId: access.station.organisationId, status: "ACTIVE" }, select: { id: true } });
      if (!channel) return NextResponse.json({ error: "Choose an active channel belonging to this station." }, { status: 400 });
      const source = await createExternalLiveSource({ organisationId: access.station.organisationId, actorUserId: access.user.id, input });
      return NextResponse.json({ source, notice: "External live source saved by Super Admin. Test it before taking it live." }, { status: 201 });
    }
    return NextResponse.json({ error: "Choose a supported streaming profile." }, { status: 400 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "A profile with this name already exists for this organisation or channel." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save streaming details." }, { status: 400 });
  }
}

export async function PATCH(request, { params }) {
  const { stationId } = await params;
  const access = await stationForSuperAdmin(stationId);
  if (access.response) return access.response;
  const body = await request.json().catch(() => null);
  if (typeof body?.destinationId !== "string" || typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "Choose a destination and its new state." }, { status: 400 });
  }
  const destination = await prisma.studioBroadcastDestination.findFirst({ where: {
    id: body.destinationId,
    organisationId: access.station.organisationId,
    stationId: access.station.id
  } });
  if (!destination) return NextResponse.json({ error: "Destination not found for this station." }, { status: 404 });
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.studioBroadcastDestination.update({ where: { id: destination.id }, data: {
      enabled: body.enabled,
      connectionState: body.enabled ? "STANDBY" : "DISABLED"
    } });
    await tx.auditLog.create({ data: {
      organisationId: access.station.organisationId,
      actorUserId: access.user.id,
      action: body.enabled ? "STUDIO_BROADCAST_DESTINATION_ENABLED" : "STUDIO_BROADCAST_DESTINATION_DISABLED",
      entityType: "StudioBroadcastDestination",
      entityId: saved.id,
      details: { stationId: access.station.id }
    } });
    return saved;
  });
  return NextResponse.json({ destination: safeStudioDestination(updated) });
}
