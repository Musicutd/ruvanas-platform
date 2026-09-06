import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { PODCAST_PRODUCTS, publicPodcastEpisode, validateOnlinePodcastPublication } from "@/lib/podcast-core.mjs";

const episodeInclude = {
  mediaAsset: {
    include: {
      promoVersions: {
        where: { status: "APPROVED", qcStatus: "PASSED", approvedForPromo: { isNot: null } },
        include: { approvedForPromo: { select: { organisationId: true, status: true, currentApprovedVersionId: true } } }
      }
    }
  },
  transcript: { select: { status: true, segmentsJson: true } }
};

async function activeOrganisation(slug) {
  const organisation = await prisma.organisation.findUnique({
    where: { slug },
    include: { subscription: { include: { plan: true, billingContract: true } } }
  });
  if (!organisation || !resolveEntitlements(organisation.subscription).serviceEnabled) return null;
  return organisation;
}

function approvedAsset(episode, organisationId) {
  const mediaAsset = episode.mediaAsset;
  if (!mediaAsset || mediaAsset.organisationId !== organisationId || mediaAsset.status !== "READY") return null;
  const approved = mediaAsset.promoVersions.some((version) =>
    version.approvedForPromo?.organisationId === organisationId &&
    version.approvedForPromo.status === "ACTIVE" &&
    version.approvedForPromo.currentApprovedVersionId === version.id
  );
  return approved ? mediaAsset : null;
}

export async function loadPublicPodcastSeries(organisationSlug, feedSlug) {
  const organisation = await activeOrganisation(organisationSlug);
  if (!organisation) return null;
  const series = await prisma.schoolPodcastSeries.findFirst({
    where: {
      organisationId: organisation.id,
      product: PODCAST_PRODUCTS.ONLINE_RADIO,
      feedSlug,
      rssEnabled: true,
      publicationScope: "PUBLIC"
    },
    include: {
      station: { select: { name: true, slug: true, status: true, stationWebsiteEnabled: true } },
      channel: { select: { name: true, slug: true, status: true } },
      episodes: {
        where: { status: "PUBLISHED", publicationScope: "PUBLIC", publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        take: 200,
        include: episodeInclude
      }
    }
  });
  if (!series || !series.station || series.station.status !== "ACTIVE") return null;
  const episodes = [];
  for (const episode of series.episodes) {
    const audio = approvedAsset(episode, organisation.id);
    try {
      validateOnlinePodcastPublication({ series, episode, approvedAudio: audio, transcriptStatus: episode.transcript?.status, stationStatus: series.station.status });
      episodes.push({ ...episode, mediaAsset: audio });
    } catch {
      // Public delivery fails closed when approval or ownership is no longer current.
    }
  }
  return {
    organisation: { name: organisation.name, slug: organisation.slug },
    series: {
      id: series.id,
      title: series.title,
      description: series.description,
      feedSlug: series.feedSlug,
      author: series.author,
      artworkUrl: series.artworkUrl,
      station: series.station,
      channel: series.channel
    },
    episodes,
    publicEpisodes: episodes.map((episode) => publicPodcastEpisode(episode, { organisationSlug: organisation.slug, feedSlug: series.feedSlug }))
  };
}

export async function loadPublicPodcastAudio(organisationSlug, feedSlug, podcastEpisodeId) {
  const publication = await loadPublicPodcastSeries(organisationSlug, feedSlug);
  if (!publication) return null;
  const episode = publication.episodes.find((item) => item.id === podcastEpisodeId);
  return episode?.mediaAsset ? { asset: episode.mediaAsset, organisationId: publication.organisation.slug, podcastEpisodeId } : null;
}
