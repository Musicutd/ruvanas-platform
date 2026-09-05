import { NextResponse } from "next/server";
import { contextForExternalLive } from "@/lib/external-live-access";
import { activateExternalLiveSource, changeExternalLiveSourceStatus, probeOwnedExternalLiveSource } from "@/lib/external-live-service";
import { prisma } from "@/lib/prisma";
import { getCurrentDjAccessSession } from "@/lib/dj-access-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    const sourceId = String(params.sourceId || "");
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim().toUpperCase();
    const manager = ["OWNER", "MANAGER"].includes(membership.role);
    const source = await prisma.externalLiveSource.findFirst({ where: { id: sourceId, organisationId: membership.organisationId }, select: { id: true, channelId: true } });
    if (!source) return NextResponse.json({ error: "The External Live source was not found." }, { status: 404 });
    const djSession = manager || action === "ARCHIVE" ? null : await getCurrentDjAccessSession({ userId: user.id, organisationId: membership.organisationId, channelId: source.channelId, requiredCapability: "CONTROL_EXTERNAL_LIVE", markUsed: true });
    if (!manager && !djSession) return NextResponse.json({ error: action === "ARCHIVE" ? "Only owners and managers can archive a live source." : "This account has no active DJ grant for the channel and action." }, { status: 403 });
    let result;
    if (action === "PROBE") result = await probeOwnedExternalLiveSource({ organisationId: membership.organisationId, sourceId });
    else if (action === "ACTIVATE") result = await activateExternalLiveSource({ organisationId: membership.organisationId, sourceId, actorUserId: user.id });
    else if (["SUSPEND", "ARCHIVE"].includes(action)) result = await changeExternalLiveSourceStatus({ organisationId: membership.organisationId, sourceId, actorUserId: user.id, action });
    else return NextResponse.json({ error: "Choose PROBE, ACTIVATE, SUSPEND or ARCHIVE." }, { status: 400 });
    if (!result) return NextResponse.json({ error: "The External Live source was not found." }, { status: 404 });
    return NextResponse.json({ ok: true, ...(action === "PROBE" ? result : { source: result }) });
  } catch (error) {
    console.error("External Live action error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the External Live source." }, { status: 400 });
  }
}
