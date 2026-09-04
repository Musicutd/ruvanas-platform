import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForExternalLive } from "@/lib/external-live-access";
import { parseExternalLiveSourceInput } from "@/lib/external-live.mjs";
import { createExternalLiveSource, listExternalLiveSources } from "@/lib/external-live-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { membership } = access.context;
    const organisationId = membership.organisationId;
    const [sources, channels] = await Promise.all([
      listExternalLiveSources(organisationId),
      prisma.channel.findMany({ where: { organisationId, status: "ACTIVE" }, select: { id: true, name: true, station: { select: { name: true } } }, orderBy: { name: "asc" }, take: 100 })
    ]);
    return NextResponse.json({
      ok: true,
      canManage: ["OWNER", "MANAGER"].includes(membership.role),
      sources,
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
