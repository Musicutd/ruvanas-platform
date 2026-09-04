import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { isPlayerListenerTokenActive } from "@/lib/player-listener-lease.mjs";
import { decryptSecret } from "@/lib/crypto";
import { externalLiveAuthorizationHeaders } from "@/lib/external-live.mjs";
import { validatePublicStreamEndpoint } from "@/lib/stream-source-health.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED") return NextResponse.json({ error: "This player is not enrolled or has been disabled." }, { status: 401 });
    const listenerActive = await isPlayerListenerTokenActive(prisma, { player, token: request.nextUrl.searchParams.get("listener") });
    if (!listenerActive) return NextResponse.json({ error: "This player does not have an active listener slot." }, { status: 429 });
    const sourceId = String(params.sourceId || "");
    const instant = new Date();
    const { resolution, playoutDecision } = await resolvePlayerProgramming(player, instant);
    if (playoutDecision.sourceType !== "LIVE_SESSION" || playoutDecision.sourceId !== sourceId || resolution.liveSource?.id !== sourceId) {
      return NextResponse.json({ error: "This live source is not in the player's current playout decision." }, { status: 404 });
    }
    const source = await prisma.externalLiveSource.findFirst({ where: { id: sourceId, organisationId: player.organisationId, channelId: playoutDecision.channelId, status: "ACTIVE", healthStatus: "HEALTHY" } });
    if (!source) return NextResponse.json({ error: "The live source is no longer available." }, { status: 409 });
    const url = await validatePublicStreamEndpoint(source.streamUrl);
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Accept: "audio/*,*/*;q=0.1", "User-Agent": "Ruvanas-Live-Relay/1.0", ...externalLiveAuthorizationHeaders(source, decryptSecret) },
      redirect: "manual",
      cache: "no-store",
      signal: request.signal
    });
    if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400) || !upstream.body) return NextResponse.json({ error: "The upstream live source is unavailable." }, { status: 502 });
    const contentType = String(upstream.headers.get("content-type") || "audio/mpeg").slice(0, 160);
    if (!contentType.toLowerCase().startsWith("audio/") && !new Set(["application/ogg", "application/octet-stream"]).has(contentType.toLowerCase().split(";", 1)[0])) {
      await upstream.body.cancel().catch(() => undefined);
      return NextResponse.json({ error: "The upstream endpoint did not return supported live audio." }, { status: 502 });
    }
    return new NextResponse(upstream.body, { headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("External live relay failed:", error);
    return NextResponse.json({ error: "The live source could not be played." }, { status: 502 });
  }
}
