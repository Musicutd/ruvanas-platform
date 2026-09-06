import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizePublicPlayback } from "@/lib/public-player-service";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { decryptSecret } from "@/lib/crypto";
import { externalLiveAuthorizationHeaders } from "@/lib/external-live.mjs";
import { protectedLiveResponse } from "@/lib/protected-live-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const instant = new Date();
    const access = await authorizePublicPlayback(prisma, { slug: String(params.slug || ""), token: request.nextUrl.searchParams.get("listener"), instant });
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const programming = await resolvePlayerProgramming(access.target.player, instant, { persistOperationalEvidence: false, publicAudience: true });
    const sourceId = String(params.sourceId || "");
    if (programming.playoutDecision.sourceType !== "LIVE_SESSION" || programming.playoutDecision.sourceId !== sourceId || programming.resolution.liveSource?.id !== sourceId) return NextResponse.json({ error: "This source is not the station's current public programme." }, { status: 404 });
    const source = await prisma.externalLiveSource.findFirst({ where: { id: sourceId, organisationId: access.station.organisationId, channelId: access.target.channel.id, status: { in: ["ACTIVE", "READY"] }, healthStatus: "HEALTHY" } });
    if (!source) return NextResponse.json({ error: "The live programme is temporarily unavailable." }, { status: 409 });
    return protectedLiveResponse(request, { streamUrl: source.streamUrl, authorizationHeaders: externalLiveAuthorizationHeaders(source, decryptSecret), userAgent: "Ruvanas-Public-Player/1.0" });
  } catch (error) {
    console.error("Public live relay failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The live programme could not be played." }, { status: 502 });
  }
}
