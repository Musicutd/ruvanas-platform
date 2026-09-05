import { NextResponse } from "next/server";
import { contextForExternalLive } from "@/lib/external-live-access";
import { prisma } from "@/lib/prisma";
import { browserLiveProviderConfigured, parseBrowserStudioAction, parseBrowserStudioInput } from "@/lib/browser-live-studio.mjs";
import { changeBrowserStudioSession, createBrowserStudioSession, listBrowserStudioSessions } from "@/lib/browser-live-studio-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const managers = new Set(["OWNER", "MANAGER"]);

export async function GET() {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { membership } = access.context;
    const organisationId = membership.organisationId;
    const canManage = managers.has(membership.role);
    const [sessions, channels, grants] = await Promise.all([
      listBrowserStudioSessions(organisationId),
      prisma.channel.findMany({ where: { organisationId, status: "ACTIVE" }, select: { id: true, name: true, station: { select: { name: true } } }, orderBy: { name: "asc" }, take: 100 }),
      canManage ? prisma.djAccessGrant.findMany({
        where: { organisationId, status: "ACTIVE", endsAt: { gt: new Date() }, capabilities: { has: "START_BROWSER_STUDIO" } },
        include: { channel: { select: { id: true, name: true } }, granteeMembership: { select: { user: { select: { id: true, name: true, email: true } } } } },
        orderBy: { startsAt: "asc" },
        take: 100
      }) : []
    ]);
    return NextResponse.json({
      ok: true,
      canManage,
      providerConfigured: browserLiveProviderConfigured(),
      protocol: "WHIP/WebRTC",
      heartbeatSeconds: 15,
      sessions,
      channels: channels.map((channel) => ({ id: channel.id, name: channel.station ? `${channel.station.name} / ${channel.name}` : channel.name })),
      grants: grants.map((grant) => ({ id: grant.id, channelId: grant.channelId, label: grant.label, presenter: grant.granteeMembership.user, startsAt: grant.startsAt.toISOString(), endsAt: grant.endsAt.toISOString(), canRecord: grant.capabilities.includes("RECORD_LIVE_SESSION") }))
    });
  } catch (error) {
    console.error("Browser Live Studio list error:", error);
    return NextResponse.json({ error: "Unable to load Browser Live Studio." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!managers.has(membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can schedule or stop a Browser Live Studio session." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (!body.action || String(body.action).toUpperCase() === "CREATE") {
      const session = await createBrowserStudioSession({ organisationId: membership.organisationId, actorUserId: user.id, input: parseBrowserStudioInput(body) });
      return NextResponse.json({ ok: true, session }, { status: 201 });
    }
    const input = parseBrowserStudioAction(body);
    if (!["FORCE_FALLBACK", "END"].includes(input.action)) return NextResponse.json({ error: "Presenters control soundcheck and go-live actions from their private studio." }, { status: 403 });
    const session = await changeBrowserStudioSession({ organisationId: membership.organisationId, actorUserId: user.id, ...input });
    if (!session) return NextResponse.json({ error: "The Browser Live Studio session was not found." }, { status: 404 });
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    console.error("Browser Live Studio manager action error:", error);
    const conflict = error?.code === "P2002";
    return NextResponse.json({ error: conflict ? "This channel or presenter already has an open Browser Live Studio session." : error instanceof Error ? error.message : "The Browser Live Studio action failed." }, { status: conflict ? 409 : 400 });
  }
}
