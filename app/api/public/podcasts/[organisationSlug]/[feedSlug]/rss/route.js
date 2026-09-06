import { NextResponse } from "next/server";
import { loadPublicPodcastSeries } from "@/lib/public-podcast";
import { buildPodcastRss } from "@/lib/podcast-core.mjs";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { organisationSlug, feedSlug } = await params;
  const publication = await loadPublicPodcastSeries(String(organisationSlug || "").toLowerCase(), String(feedSlug || "").toLowerCase());
  if (!publication) return NextResponse.json({ error: "This podcast feed is not publicly available." }, { status: 404 });
  const rss = buildPodcastRss({ origin: new URL(request.url).origin, organisationSlug: publication.organisation.slug, series: publication.series, episodes: publication.episodes });
  return new NextResponse(rss, { status: 200, headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
