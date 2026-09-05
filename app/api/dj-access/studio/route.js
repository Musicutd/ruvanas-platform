import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentDjAccessSession } from "@/lib/dj-access-auth";
import { browserLiveProviderConfigured, parseBrowserStudioAction } from "@/lib/browser-live-studio.mjs";
import { changeBrowserStudioSession, listPresenterBrowserStudioSessions, prepareBrowserStudioSession, reconnectBrowserStudioPublisher } from "@/lib/browser-live-studio-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function presenterAccess() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign in with the presenter account to open Browser Live Studio." }, { status: 401 }) };
  const grant = await getCurrentDjAccessSession({ userId: user.id, requiredCapability: "START_BROWSER_STUDIO", markUsed: true });
  if (!grant) return { response: NextResponse.json({ error: "Active Browser Live Studio access is required." }, { status: 403 }) };
  return { user, grant };
}

export async function GET(request) {
  try {
    const access = await presenterAccess();
    if (access.response) return access.response;
    const sessions = await listPresenterBrowserStudioSessions({ organisationId: access.grant.organisationId, grantId: access.grant.grantId });
    const selectedId = new URL(request.url).searchParams.get("sessionId");
    let publish = null;
    if (selectedId) {
      const reconnect = await reconnectBrowserStudioPublisher({ organisationId: access.grant.organisationId, sessionId: selectedId, grantId: access.grant.grantId });
      publish = reconnect?.publish || null;
    }
    return NextResponse.json({ ok: true, grant: { grantId: access.grant.grantId, label: access.grant.label, channel: access.grant.channel, capabilities: access.grant.capabilities, endsAt: access.grant.endsAt }, sessions, publish, providerConfigured: browserLiveProviderConfigured(), protocol: "WHIP/WebRTC", heartbeatSeconds: 15 });
  } catch (error) {
    console.error("Browser Live Studio presenter list error:", error);
    return NextResponse.json({ error: "Unable to load the private Browser Live Studio." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await presenterAccess();
    if (access.response) return access.response;
    const input = parseBrowserStudioAction(await request.json().catch(() => ({})));
    if (input.action === "CREATE") return NextResponse.json({ error: "An organisation owner or manager must schedule the studio session." }, { status: 403 });
    const result = input.action === "PREPARE"
      ? await prepareBrowserStudioSession({ organisationId: access.grant.organisationId, sessionId: input.sessionId, actorUserId: access.user.id, grantId: access.grant.grantId, expectedVersion: input.expectedVersion })
      : { session: await changeBrowserStudioSession({ organisationId: access.grant.organisationId, actorUserId: access.user.id, grantId: access.grant.grantId, ...input }) };
    if (!result?.session) return NextResponse.json({ error: "The Browser Live Studio session was not found for this presenter and channel." }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Browser Live Studio presenter action error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "The Browser Live Studio action failed." }, { status: 400 });
  }
}
