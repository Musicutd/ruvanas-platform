import { NextResponse } from "next/server";
import { contextForExternalLive } from "@/lib/external-live-access";
import { revokeDjAccessGrant, rotateDjAccessToken } from "@/lib/dj-access-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!["OWNER", "MANAGER"].includes(membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can change DJ access." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim().toUpperCase();
    const grantId = String(params.grantId || "");
    let result;
    if (action === "ROTATE") result = await rotateDjAccessToken({ organisationId: membership.organisationId, grantId, actorUserId: user.id });
    else if (action === "REVOKE") result = { grant: await revokeDjAccessGrant({ organisationId: membership.organisationId, grantId, actorUserId: user.id, reason: String(body.reason || "").trim().slice(0, 500) }) };
    else return NextResponse.json({ error: "Choose ROTATE or REVOKE." }, { status: 400 });
    if (!result?.grant) return NextResponse.json({ error: "The DJ access grant was not found." }, { status: 404 });
    return NextResponse.json({ ok: true, grant: result.grant, ...(result.rawToken ? { accessPath: `/dj/access#token=${result.rawToken}`, tokenNotice: "The previous link stopped working. This replacement is shown once." } : {}) });
  } catch (error) {
    console.error("DJ access action error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update DJ access." }, { status: 400 });
  }
}

