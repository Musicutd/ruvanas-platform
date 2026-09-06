import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizePublicPlayback, publicPlaybackAssetAllowed } from "@/lib/public-player-service";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { protectedAudioResponse } from "@/lib/protected-audio-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const instant = new Date();
    const access = await authorizePublicPlayback(prisma, { slug: String(params.slug || ""), token: request.nextUrl.searchParams.get("listener"), instant });
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: { "Cache-Control": "no-store" } });
    const programming = await resolvePlayerProgramming(access.target.player, instant, { persistOperationalEvidence: false, publicAudience: true });
    const mediaAssetId = String(params.mediaAssetId || "");
    if (!publicPlaybackAssetAllowed(programming, mediaAssetId, instant)) return NextResponse.json({ error: "This audio is not in the station's current public programme." }, { status: 404 });
    const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId }, select: { storageKey: true, mimeType: true, sizeBytes: true } });
    return protectedAudioResponse(request, asset);
  } catch (error) {
    console.error("Public player media failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "This programme audio could not be played." }, { status: 500 });
  }
}
