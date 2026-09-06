import { NextResponse } from "next/server";
import { normalizeStationDomain } from "@/lib/station-website.mjs";
import { loadPublicStationWebsiteByDomain } from "@/lib/station-website-service";

export async function GET(_request, { params }) {
  try {
    const hostname = normalizeStationDomain(decodeURIComponent(String(params.hostname || "")));
    const website = await loadPublicStationWebsiteByDomain(hostname);
    if (!website) return NextResponse.json({ error: "No active station website uses this domain." }, { status: 404 });
    return NextResponse.json({ slug: website.slug }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "No active station website uses this domain." }, { status: 404 });
  }
}
