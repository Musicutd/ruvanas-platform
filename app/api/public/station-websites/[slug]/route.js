import { NextResponse } from "next/server";
import { loadPublicStationWebsiteBySlug } from "@/lib/station-website-service";

export async function GET(_request, { params }) {
  try {
    const website = await loadPublicStationWebsiteBySlug(String(params.slug || "").toLowerCase());
    if (!website) return NextResponse.json({ error: "This station website is not available." }, { status: 404 });
    return NextResponse.json({ website }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch (error) {
    console.error("Public station website failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The station website could not be loaded." }, { status: 500 });
  }
}
