import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentDigitalSignageDevice } from "@/lib/digital-signage-device-auth";
import { verifyDigitalSignageProofToken } from "@/lib/digital-signage-delivery.mjs";

export const runtime = "nodejs";

const MAX_BATCH_SIZE = 100;
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const eventSchema = z.object({
  eventId: z.string().uuid(),
  manifestVersion: z.string().regex(/^[0-9a-f]{24}$/),
  proofToken: z.string().regex(/^[0-9a-f]{64}$/),
  playlistId: z.string().cuid(),
  playlistItemId: z.string().cuid(),
  assetId: z.string().cuid(),
  takeoverId: z.string().cuid().optional().nullable(),
  retailMediaOrderId: z.string().cuid().optional().nullable(),
  eventType: z.enum(["STARTED", "COMPLETED", "FAILED"]),
  occurredAt: z.string().datetime({ offset: true }),
  failureReason: z.string().trim().max(500).optional().nullable()
});

const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(MAX_BATCH_SIZE) });

export async function POST(request) {
  try {
    const device = await getCurrentDigitalSignageDevice();
    if (!device) return NextResponse.json({ error: "This display is not enrolled, disabled, or no longer entitled." }, { status: 401 });
    const parsed = batchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: `Submit between 1 and ${MAX_BATCH_SIZE} valid display events.` }, { status: 400 });
    const events = parsed.data.events;
    const items = await prisma.digitalSignagePlaylistItem.findMany({
      where: {
        id: { in: [...new Set(events.map((event) => event.playlistItemId))] },
        playlist: {
          organisationId: device.organisationId,
          OR: [
            { devices: { some: { deviceId: device.id } } },
            { takeovers: { some: { devices: { some: { deviceId: device.id } } } } }
          ]
        }
      },
      include: {
        asset: { select: { id: true, organisationId: true } },
        playlist: {
          select: {
            id: true,
            organisationId: true,
            retailMediaOrderId: true,
            takeovers: { where: { devices: { some: { deviceId: device.id } } }, select: { id: true } }
          }
        }
      }
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const retailMediaOrderIds = [...new Set(events.map((event) => event.retailMediaOrderId).filter(Boolean))];
    const retailMediaOrders = retailMediaOrderIds.length ? await prisma.retailMediaOrder.findMany({ where: { id: { in: retailMediaOrderIds }, organisationId: device.organisationId }, select: { id: true } }) : [];
    const validRetailMediaOrderIds = new Set(retailMediaOrders.map((order) => order.id));
    const now = new Date();
    for (const event of events) {
      const item = byId.get(event.playlistItemId);
      const occurredAt = new Date(event.occurredAt);
      const age = now.getTime() - occurredAt.getTime();
      const takeoverId = event.takeoverId || null;
      const retailMediaOrderId = event.retailMediaOrderId || null;
      const validTakeover = takeoverId ? item?.playlist.takeovers.some((takeover) => takeover.id === takeoverId) : true;
      const validRetailMediaOrder = retailMediaOrderId ? validRetailMediaOrderIds.has(retailMediaOrderId) : true;
      const valid = item && validTakeover && validRetailMediaOrder && item.playlistId === event.playlistId && item.assetId === event.assetId &&
        item.asset.organisationId === device.organisationId &&
        verifyDigitalSignageProofToken({ deviceId: device.id, manifestVersion: event.manifestVersion, playlistItemId: event.playlistItemId, assetId: event.assetId, takeoverId, retailMediaOrderId }, event.proofToken, process.env.SESSION_SECRET) &&
        age <= MAX_EVENT_AGE_MS && age >= -MAX_CLOCK_SKEW_MS;
      if (!valid) return NextResponse.json({ error: "One or more display events could not be verified." }, { status: 400 });
    }

    const inserted = await prisma.$transaction(async (tx) => {
      const result = await tx.digitalSignageDeliveryProof.createMany({
        data: events.map((event) => ({
          clientEventId: event.eventId,
          organisationId: device.organisationId,
          deviceId: device.id,
          playlistId: event.playlistId,
          playlistItemId: event.playlistItemId,
          assetId: event.assetId,
          takeoverId: event.takeoverId || null,
          retailMediaOrderId: event.retailMediaOrderId || null,
          manifestVersion: event.manifestVersion,
          eventType: event.eventType,
          occurredAt: new Date(event.occurredAt),
          failureReason: event.eventType === "FAILED" ? (event.failureReason || "Display error") : null
        })),
        skipDuplicates: true
      });
      await tx.digitalSignageDevice.update({ where: { id: device.id }, data: { status: "ONLINE", lastHeartbeatAt: now } });
      return result;
    });
    return NextResponse.json({ ok: true, accepted: inserted.count, duplicates: events.length - inserted.count, receivedAt: now.toISOString() });
  } catch (error) {
    console.error("Digital signage proof ingestion error:", error);
    return NextResponse.json({ error: "Unable to record display confirmation." }, { status: 500 });
  }
}
