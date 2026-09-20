import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

export async function POST(_request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can prepare this channel." }, { status: 403 });
  const { stationId } = await params;
  const station = await prisma.station.findUnique({
    where: { id: String(stationId || "") },
    include: { streamConfig: { select: { streamUrl: true } }, organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } } }
  });
  if (!station) return NextResponse.json({ error: "Station not found." }, { status: 404 });
  if (station.productFamily !== "ONLINE" || !["PENDING_SETUP", "DRAFT", "ACTIVE"].includes(station.status)) return NextResponse.json({ error: "Only an Online Radio station awaiting setup can prepare a channel." }, { status: 409 });
  if (!station.streamConfig?.streamUrl) return NextResponse.json({ error: "Save the station stream first." }, { status: 409 });
  const entitlements = resolveEntitlements(station.organisation.subscription);
  if (!entitlements.onlineRadioEnabled) return NextResponse.json({ error: "This organisation does not have active Online Radio access." }, { status: 403 });
  try {
    const result = await runSerializableTransaction(prisma, async (tx) => {
      const active = await tx.channel.findFirst({ where: { organisationId: station.organisationId, stationId: station.id, status: "ACTIVE" } });
      if (active) return active;
      const activeCount = await tx.channel.count({ where: { organisationId: station.organisationId, status: "ACTIVE" } });
      if (activeCount >= entitlements.streamLimit) throw Object.assign(new Error("The plan's active-channel limit has been reached."), { code: "CHANNEL_LIMIT_REACHED" });
      const draft = await tx.channel.findFirst({ where: { organisationId: station.organisationId, stationId: station.id }, orderBy: { createdAt: "asc" } });
      const channel = draft
        ? await tx.channel.update({ where: { id: draft.id }, data: { status: "ACTIVE", musicRightsUse: "ONLINE_RADIO" } })
        : await tx.channel.create({ data: { organisationId: station.organisationId, stationId: station.id, name: station.name, slug: `online-${station.slug}`, status: "ACTIVE", musicRightsUse: "ONLINE_RADIO" } });
      await tx.auditLog.create({ data: { organisationId: station.organisationId, actorUserId: access.user.id, action: "ONLINE_RADIO_CHANNEL_PREPARED", entityType: "Channel", entityId: channel.id, details: { stationId: station.id, stationStatus: station.status, priorStatus: draft?.status || null } } });
      return channel;
    });
    return NextResponse.json({ success: true, channelId: result.id, stationStatus: station.status });
  } catch (error) {
    if (error?.code === "CHANNEL_LIMIT_REACHED") return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Online Radio channel preparation failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The Online Radio channel could not be prepared." }, { status: 500 });
  }
}
