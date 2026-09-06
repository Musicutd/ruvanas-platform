import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizePublicPlayback } from "@/lib/public-player-service";
import { protectedLiveResponse } from "@/lib/protected-live-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const access = await authorizePublicPlayback(prisma, { slug: String(params.slug || ""), token: request.nextUrl.searchParams.get("listener") });
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!access.station.streamConfig?.streamUrl) return NextResponse.json({ error: "The station stream is unavailable." }, { status: 404 });
    return protectedLiveResponse(request, { streamUrl: access.station.streamConfig.streamUrl, userAgent: "Ruvanas-Public-Player/1.0" });
  } catch (error) {
    console.error("Public station relay failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The station stream could not be played." }, { status: 502 });
  }
}
