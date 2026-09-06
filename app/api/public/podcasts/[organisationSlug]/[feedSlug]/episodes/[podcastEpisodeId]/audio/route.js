import { NextResponse } from "next/server";
import { loadPublicPodcastAudio } from "@/lib/public-podcast";
import { deliverProtectedPodcastAudio } from "@/lib/podcast-audio-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const { organisationSlug, feedSlug, podcastEpisodeId } = await params;
    const publication = await loadPublicPodcastAudio(String(organisationSlug || "").toLowerCase(), String(feedSlug || "").toLowerCase(), String(podcastEpisodeId || ""));
    if (!publication) return NextResponse.json({ error: "This podcast audio is not publicly available." }, { status: 404 });
    return deliverProtectedPodcastAudio(request, publication.asset);
  } catch (error) {
    console.error("Public podcast stream failed:", error);
    return NextResponse.json({ error: "The published audio could not be played." }, { status: 500 });
  }
}
