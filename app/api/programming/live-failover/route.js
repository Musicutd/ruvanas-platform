import { NextResponse } from "next/server";
import { contextForExternalLive } from "@/lib/external-live-access";
import { listExternalLiveSources } from "@/lib/external-live-service";
import { changeLiveFailoverPolicy, listLiveFailoverPolicies, saveLiveFailoverPolicy } from "@/lib/live-failover-service";
import { parseLiveFailoverAction, parseLiveFailoverPolicyInput } from "@/lib/live-failover.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { membership } = access.context;
    const [policies, sources] = await Promise.all([
      listLiveFailoverPolicies(membership.organisationId),
      listExternalLiveSources(membership.organisationId)
    ]);
    return NextResponse.json({ ok: true, canManage: ["OWNER", "MANAGER"].includes(membership.role), policies, sources });
  } catch (error) {
    console.error("Live failover list error:", error);
    return NextResponse.json({ error: "Unable to load live failover." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForExternalLive();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!["OWNER", "MANAGER"].includes(membership.role)) return NextResponse.json({ error: "Only owners and managers can change live failover." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const policy = body.action
      ? await changeLiveFailoverPolicy({ organisationId: membership.organisationId, actorUserId: user.id, input: parseLiveFailoverAction(body) })
      : await saveLiveFailoverPolicy({ organisationId: membership.organisationId, actorUserId: user.id, input: parseLiveFailoverPolicyInput(body) });
    if (!policy) return NextResponse.json({ error: "Live failover policy not found." }, { status: 404 });
    return NextResponse.json({ ok: true, policy });
  } catch (error) {
    console.error("Live failover change error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to change live failover." }, { status: 400 });
  }
}
