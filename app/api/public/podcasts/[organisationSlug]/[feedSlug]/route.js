import { NextResponse } from "next/server";
import { loadPublicPodcastSeries } from "@/lib/public-podcast";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { organisationSlug, feedSlug } = await params;
  const publication = await loadPublicPodcastSeries(String(organisationSlug || "").toLowerCase(), String(feedSlug || "").toLowerCase());
  if (!publication) return NextResponse.json({ error: "This podcast feed is not publicly available." }, { status: 404 });
  return NextResponse.json({ organisation: publication.organisation, series: publication.series, episodes: publication.publicEpisodes });
}
