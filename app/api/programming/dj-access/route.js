import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForExternalLive } from "@/lib/external-live-access";
import { parseDjAccessGrantInput } from "@/lib/dj-access.mjs";
import { createDjAccessGrant, listDjAccessGrants } from "@/lib/dj-access-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requireManager(membership) {
  return ["OWNER", "MANAGER"].includes(membership.role) ? null : NextResponse.json({ error: "Only organisation owners and managers can issue DJ access." }, { status: 403 });
}

export async function GET() {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const denied = requireManager(access.context.membership);
    if (denied) return denied;
    const organisationId = access.context.membership.organisationId;
    const [grants, channels, members] = await Promise.all([
      listDjAccessGrants(organisationId),
      prisma.channel.findMany({ where: { organisationId, status: "ACTIVE" }, select: { id: true, name: true, station: { select: { name: true } } }, orderBy: { name: "asc" }, take: 100 }),
      prisma.organisationMember.findMany({ where: { organisationId, role: { in: ["OWNER", "MANAGER", "CONTENT_EDITOR", "VIEWER"] } }, select: { role: true, user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" }, take: 100 })
    ]);
    return NextResponse.json({ ok: true, grants, channels: channels.map((channel) => ({ id: channel.id, name: channel.station ? `${channel.station.name} / ${channel.name}` : channel.name })), members: members.map((member) => ({ id: member.user.id, name: member.user.name || member.user.email, email: member.user.email, role: member.role })) });
  } catch (error) {
    console.error("DJ access list error:", error);
    return NextResponse.json({ error: "Unable to load DJ access." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const denied = requireManager(access.context.membership);
    if (denied) return denied;
    const input = parseDjAccessGrantInput(await request.json().catch(() => null));
    const created = await createDjAccessGrant({ organisationId: access.context.membership.organisationId, actorUserId: access.context.user.id, input });
    return NextResponse.json({ ok: true, grant: created.grant, accessPath: `/dj/access#token=${created.rawToken}`, tokenNotice: "This private link is shown once. Send it only to the named presenter." }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This presenter already has an open grant for the channel." }, { status: 409 });
    console.error("DJ access create error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to issue DJ access." }, { status: 400 });
  }
}

