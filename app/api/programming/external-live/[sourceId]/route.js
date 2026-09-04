import { NextResponse } from "next/server";
import { contextForExternalLive } from "@/lib/external-live-access";
import { activateExternalLiveSource, changeExternalLiveSourceStatus, probeOwnedExternalLiveSource } from "@/lib/external-live-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!["OWNER", "MANAGER"].includes(membership.role)) return NextResponse.json({ error: "Only owners and managers can control an external live source." }, { status: 403 });
    const sourceId = String(params.sourceId || "");
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim().toUpperCase();
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
