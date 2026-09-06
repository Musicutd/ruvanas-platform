import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { isPlayerListenerTokenActive } from "@/lib/player-listener-lease.mjs";
import { decryptSecret } from "@/lib/crypto";
import { externalLiveAuthorizationHeaders } from "@/lib/external-live.mjs";
import { protectedLiveResponse } from "@/lib/protected-live-response";

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
    const source = await prisma.externalLiveSource.findFirst({ where: { id: sourceId, organisationId: player.organisationId, channelId: playoutDecision.channelId, status: { in: ["ACTIVE", "READY"] }, healthStatus: "HEALTHY" } });
    if (!source) return NextResponse.json({ error: "The live source is no longer available." }, { status: 409 });
    return protectedLiveResponse(request, {
      streamUrl: source.streamUrl,
      authorizationHeaders: externalLiveAuthorizationHeaders(source, decryptSecret),
      userAgent: "Ruvanas-Live-Relay/1.0"
    });
  } catch (error) {
    console.error("External live relay failed:", error);
    return NextResponse.json({ error: "The live source could not be played." }, { status: 502 });
  }
}
