import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForExternalLive } from "@/lib/external-live-access";
import { parseExternalLiveSourceInput } from "@/lib/external-live.mjs";
import { createExternalLiveSource, listExternalLiveSources } from "@/lib/external-live-service";
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
    const canManage = ["OWNER", "MANAGER"].includes(membership.role);
    return NextResponse.json({
      ok: true,
      canManage,
      djAccess: djSession ? { grantId: djSession.grantId, label: djSession.label, channelId: djSession.channelId, capabilities: djSession.capabilities, endsAt: djSession.endsAt } : null,
      sources: sources.map((source) => ({ ...source, canControl: canManage || Boolean(djSession?.channelId === source.channel?.id && djSession.capabilities.includes("CONTROL_EXTERNAL_LIVE")), canArchive: canManage })),
      channels: channels.map((channel) => ({ id: channel.id, name: channel.station ? `${channel.station.name} / ${channel.name}` : channel.name }))
    });
  } catch (error) {
    console.error("External Live list error:", error);
    return NextResponse.json({ error: "Unable to load External Live sources." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!["OWNER", "MANAGER"].includes(membership.role)) return NextResponse.json({ error: "Only owners and managers can configure an external live source." }, { status: 403 });
    const input = parseExternalLiveSourceInput(await request.json().catch(() => null));
    const source = await createExternalLiveSource({ organisationId: membership.organisationId, actorUserId: user.id, input });
    return NextResponse.json({ ok: true, source }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "A live source with this name already exists on the channel." }, { status: 409 });
    console.error("External Live create error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the External Live source." }, { status: 400 });
  }
}
