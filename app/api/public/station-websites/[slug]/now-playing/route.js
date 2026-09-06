import { NextResponse } from "next/server";
import { loadPublicStationNowPlaying } from "@/lib/station-website-service";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const result = await loadPublicStationNowPlaying(String(params.slug || "").toLowerCase());
    if (!result) return NextResponse.json({ error: "Now-playing information is not available." }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=20" } });
  } catch (error) {
    console.error("Public now-playing failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "Now-playing information is temporarily unavailable." }, { status: 503, headers: { "Retry-After": "15" } });
  }
}
