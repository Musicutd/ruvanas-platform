import { NextResponse } from "next/server";
import { loadPublicStationWebsiteBySlug } from "@/lib/station-website-service";
import { buildStationWebManifest } from "@/lib/pwa-mobile.mjs";

export async function GET(_request, { params }) {
  try {
    const website = await loadPublicStationWebsiteBySlug(String(params.slug || "").toLowerCase());
    if (!website) return NextResponse.json({ error: "This station app is not available." }, { status: 404 });
    return NextResponse.json(buildStationWebManifest(website), { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=300, stale-while-revalidate=900" } });
  } catch (error) {
    console.error("Station app manifest failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The station app manifest could not be loaded." }, { status: 500 });
  }
}
