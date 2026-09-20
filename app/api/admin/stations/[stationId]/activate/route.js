import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { subscriberProductAccess, subscriberProductForStationFamily } from "@/lib/product-access.mjs";
import { probeStationStream } from "@/lib/stream-source-health-service";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

export async function POST(_request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only a Ruvanas Super Admin can activate a station." }, { status: 403 });
  }

  const { stationId } = await params;
  const station = await prisma.station.findUnique({
    where: { id: String(stationId || "") },
    include: {
      streamConfig: true,
      channels: { select: { id: true, status: true } },
      organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } }
    }
  });
  if (!station) return NextResponse.json({ error: "Station not found." }, { status: 404 });
  const onlineChannelMissing = station.productFamily === "ONLINE" && !station.channels.some((channel) => channel.status === "ACTIVE");
  if (station.status === "ACTIVE" && !onlineChannelMissing) return NextResponse.json({ success: true, status: "ACTIVE" });
  if (!["DRAFT", "PENDING_SETUP", "PAUSED", "ACTIVE"].includes(station.status)) {
    return NextResponse.json({ error: "This station cannot be activated from its current status." }, { status: 409 });
  }
  const product = subscriberProductForStationFamily(station.productFamily);
  const entitlements = resolveEntitlements(station.organisation.subscription);
  const decision = subscriberProductAccess(entitlements, product);
  if (!decision.allowed) return NextResponse.json({ error: "The organisation does not have an active service for this station." }, { status: 403 });
  if (!station.streamConfig?.streamUrl) {
    return NextResponse.json({ error: "Save the station's streaming connection first." }, { status: 409 });
  }

  let probe;
  try {
    probe = await probeStationStream(prisma, { ...station.streamConfig, station: { id: station.id, name: station.name, organisationId: station.organisationId } });
  } catch (error) {
    console.error("Station activation probe failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The stream could not be checked. The station remains inactive." }, { status: 503 });
  }
  if (probe.status !== "HEALTHY") {
    const redirectHint = probe.probe?.errorCode === "REDIRECT_NOT_FOLLOWED" ? " The URL redirects instead of returning audio; enter the final direct audio URL." : "";
    return NextResponse.json({ error: `The public stream has not returned healthy audio.${redirectHint} The station remains inactive.` }, { status: 409 });
  }

  try {
    const activated = await runSerializableTransaction(prisma, async (tx) => {
      const current = await tx.stationStreamConfig.findUnique({ where: { stationId: station.id }, select: { streamUrl: true } });
      if (current?.streamUrl !== station.streamConfig.streamUrl) return false;
      if (station.status !== "ACTIVE") {
        const changed = await tx.station.updateMany({ where: { id: station.id, status: { in: ["DRAFT", "PENDING_SETUP", "PAUSED"] } }, data: { status: "ACTIVE" } });
        if (!changed.count) return false;
        await tx.auditLog.create({
          data: {
            organisationId: station.organisationId,
            actorUserId: access.user.id,
            action: "STATION_ACTIVATED_AFTER_STREAM_PROBE",
            entityType: "Station",
            entityId: station.id,
            details: { previousStatus: station.status, probeStatus: probe.status }
          }
        });
      }
      if (station.productFamily === "ONLINE") {
        const active = await tx.channel.findFirst({ where: { stationId: station.id, organisationId: station.organisationId, status: "ACTIVE" }, select: { id: true } });
        if (!active) {
          const activeCount = await tx.channel.count({ where: { organisationId: station.organisationId, status: "ACTIVE" } });
          if (activeCount >= entitlements.streamLimit) {
            const error = new Error("The plan's active-channel limit has been reached.");
            error.code = "CHANNEL_LIMIT_REACHED";
            throw error;
          }
          const draft = await tx.channel.findFirst({ where: { stationId: station.id, organisationId: station.organisationId }, orderBy: { createdAt: "asc" } });
          const channel = draft
            ? await tx.channel.update({ where: { id: draft.id }, data: { status: "ACTIVE", musicRightsUse: "ONLINE_RADIO" } })
            : await tx.channel.create({ data: {
                organisationId: station.organisationId,
                stationId: station.id,
                name: station.name,
                slug: `online-${station.slug}`,
                status: "ACTIVE",
                musicRightsUse: "ONLINE_RADIO"
              } });
          await tx.auditLog.create({ data: {
            organisationId: station.organisationId,
            actorUserId: access.user.id,
            action: "ONLINE_RADIO_CHANNEL_ACTIVATED",
            entityType: "Channel",
            entityId: channel.id,
            details: { stationId: station.id, priorStatus: draft?.status || null }
          } });
        }
      }
      return true;
    });
    if (!activated) return NextResponse.json({ error: "The station or stream changed during verification. Refresh and try again." }, { status: 409 });
    return NextResponse.json({ success: true, status: "ACTIVE" });
  } catch (error) {
    console.error("Station activation failed:", error?.code || error?.name || "UNKNOWN");
    if (error?.code === "CHANNEL_LIMIT_REACHED") return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "The station could not be activated." }, { status: 500 });
  }
}
