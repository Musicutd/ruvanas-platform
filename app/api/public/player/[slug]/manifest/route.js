import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildPublicPlayerResponse, loadPublicPlayerStation, publicPlayerTarget, releasePublicPlayerSession } from "@/lib/public-player-service";
import { PUBLIC_LISTENER_SESSION_HEADER } from "@/lib/public-player.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function listenerSession(request) {
  return request.headers.get(PUBLIC_LISTENER_SESSION_HEADER);
}

export async function GET(request, { params }) {
  try {
    const instant = new Date();
    const station = await loadPublicPlayerStation(prisma, String(params.slug || ""));
    if (!station) return NextResponse.json({ error: "This public station is unavailable." }, { status: 404 });
    const target = publicPlayerTarget(station, instant);
    if (!target) return NextResponse.json({ error: "This station does not yet have an active public channel." }, { status: 409 });
    const result = await buildPublicPlayerResponse(prisma, { station, target, sessionId: listenerSession(request), instant });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code, listenerCapacity: { active: result.activeCount, limit: result.limit } }, {
      status: result.status,
      headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" } : { "Cache-Control": "no-store" }
    });
    return NextResponse.json(result.manifest, { headers: { "Cache-Control": "private, no-store", ETag: `"${result.manifest.version}"` } });
  } catch (error) {
    console.error("Public player manifest failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The public player could not load this station." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request, { params }) {
  try {
    const station = await prisma.station.findUnique({ where: { slug: String(params.slug || "") }, select: { id: true } });
    if (station) await releasePublicPlayerSession(prisma, { station, sessionId: listenerSession(request) });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
