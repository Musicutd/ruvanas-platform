import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForExternalLive } from "@/lib/external-live-access";
import { listExternalLiveSources } from "@/lib/external-live-service";
import { getCurrentDjAccessSession } from "@/lib/dj-access-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { membership } = access.context;
    const organisationId = membership.organisationId;
    const [sources, channels, djSession] = await Promise.all([
      listExternalLiveSources(organisationId),
      prisma.channel.findMany({ where: { organisationId, status: "ACTIVE" }, select: { id: true, name: true, station: { select: { name: true } } }, orderBy: { name: "asc" }, take: 100 }),
      getCurrentDjAccessSession({ userId: access.context.user.id, organisationId, requiredCapability: "VIEW_CHANNEL" })
    ]);
    const canControl = ["OWNER", "MANAGER"].includes(membership.role);
    return NextResponse.json({
      ok: true,
      canManage: false,
      djAccess: djSession ? { grantId: djSession.grantId, label: djSession.label, channelId: djSession.channelId, capabilities: djSession.capabilities, endsAt: djSession.endsAt } : null,
      sources: sources.map((source) => ({ ...source, canControl: canControl || Boolean(djSession?.channelId === source.channel?.id && djSession.capabilities.includes("CONTROL_EXTERNAL_LIVE")), canArchive: false })),
      channels: channels.map((channel) => ({ id: channel.id, name: channel.station ? `${channel.station.name} / ${channel.name}` : channel.name }))
    });
  } catch (error) {
    console.error("External Live list error:", error);
    return NextResponse.json({ error: "Unable to load External Live sources." }, { status: 500 });
  }
}

export async function POST() {
  const access = await contextForExternalLive();
  if (access.response) return access.response;
  return NextResponse.json({ error: "Only Ruvanas Super Admin can enter external streaming source details." }, { status: 403 });
}
