import { NextResponse } from "next/server";
import { loadPublicSchoolPodcastAudio } from "@/lib/public-school-podcast";
import { deliverProtectedPodcastAudio } from "@/lib/podcast-audio-delivery";
import { recordPublicAudioDelivery } from "@/lib/school-publication-operations-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const { slug, podcastEpisodeId } = await params;
    const publication = await loadPublicSchoolPodcastAudio(String(slug || "").toLowerCase(), String(podcastEpisodeId || ""));
    if (!publication) return NextResponse.json({ error: "This school podcast audio is not publicly available." }, { status: 404 });
    return deliverProtectedPodcastAudio(request, publication.asset, { onDelivery: async ({ bytesOffered, rangeRequest }) => {
      try {
        await recordPublicAudioDelivery({ organisationId: publication.organisationId, podcastEpisodeId: publication.podcastEpisodeId, bytesOffered, rangeRequest });
      } catch (error) {
        console.error("Public school podcast audio evidence could not be recorded:", error);
      }
    } });
  } catch (error) {
    console.error("Public school podcast stream failed:", error);
    return NextResponse.json({ error: "The published audio could not be played." }, { status: 500 });
  }
}
