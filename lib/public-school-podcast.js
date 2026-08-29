import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { redactPublicPodcastEpisode, validateControlledSchoolPublication } from "@/lib/school-publication.mjs";
import { recordPublicEpisodeListings } from "@/lib/school-publication-operations-service";

const podcastInclude = {
  series: { select: { title: true, organisationId: true } },
  transcript: { select: { status: true, segmentsJson: true } },
  episode: {
    include: {
      programme: { select: { title: true } },
      contributors: { select: { contributorId: true, contributor: { select: { organisationId: true } } } },
      submissions: {
        where: { status: "SUBMITTED", promoVersion: { status: "APPROVED", mediaAsset: { status: "READY" } } },
        orderBy: { revision: "desc" }, take: 1,
        include: { promoVersion: { include: { mediaAsset: true } } }
      }
    }
  }
};

async function publicOrganisation(slug) {
  const organisation = await prisma.organisation.findUnique({
    where: { slug },
    include: {
      subscription: { include: { plan: true, billingContract: true } },
      schoolProfile: true,
      schoolSafeguardingReadiness: { select: { status: true } }
    }
  });
  if (!organisation) return null;
  const entitled = resolveEntitlements(organisation.subscription).schoolPublicPublishingEnabled;
  if (!entitled || organisation.schoolProfile?.publishingPolicy !== "PUBLIC" || organisation.schoolSafeguardingReadiness?.status !== "APPROVED") return null;
  return organisation;
}

async function validatedPodcast(organisation, podcast) {
  if (
    podcast.organisationId !== organisation.id ||
    podcast.series.organisationId !== organisation.id ||
    podcast.episode.organisationId !== organisation.id ||
    podcast.episode.contributors.some((entry) => entry.contributor.organisationId !== organisation.id)
  ) return false;
  const approvedSubmission = podcast.episode.submissions.find((submission) =>
    submission.organisationId === organisation.id &&
    submission.promoVersion?.mediaAsset?.organisationId === organisation.id
  );
  const contributorIds = podcast.episode.contributors.map((entry) => entry.contributorId);
  const consentRecords = contributorIds.length ? await prisma.consentRecord.findMany({
    where: { organisationId: organisation.id, contributorId: { in: contributorIds }, OR: [{ episodeId: podcast.episodeId }, { episodeId: null }] },
    orderBy: { createdAt: "desc" }
  }) : [];
  try {
    validateControlledSchoolPublication({
      entitlementEnabled: true,
      profilePolicy: organisation.schoolProfile.publishingPolicy,
      safeguardingStatus: organisation.schoolSafeguardingReadiness.status,
      episodeStatus: podcast.episode.status,
      hasApprovedAudio: Boolean(approvedSubmission),
      transcriptStatus: podcast.transcript?.status,
      contributorIds,
      consentRecords
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadPublicSchoolPage(slug) {
  const organisation = await publicOrganisation(slug);
  if (!organisation) return null;
  const podcasts = await prisma.schoolPodcastEpisode.findMany({
    where: { organisationId: organisation.id, status: "PUBLISHED", publicationScope: "PUBLIC" },
    orderBy: { publishedAt: "desc" }, take: 100, include: podcastInclude
  });
  const visible = [];
  for (const podcast of podcasts) {
    if (await validatedPodcast(organisation, podcast)) {
      visible.push({ ...redactPublicPodcastEpisode(podcast), audioPath: `/api/public/school-radio/${organisation.slug}/episodes/${podcast.id}/audio` });
    }
  }
  try {
    await recordPublicEpisodeListings({ organisationId: organisation.id, podcastEpisodeIds: visible.map((episode) => episode.id) });
  } catch (error) {
    console.error("Public school podcast listing evidence could not be recorded:", error);
  }
  return { school: { name: organisation.schoolProfile.displayName || organisation.name, slug: organisation.slug }, episodes: visible };
}

export async function loadPublicSchoolPodcastAudio(slug, podcastEpisodeId) {
  const organisation = await publicOrganisation(slug);
  if (!organisation) return null;
  const podcast = await prisma.schoolPodcastEpisode.findFirst({
    where: { id: podcastEpisodeId, organisationId: organisation.id, status: "PUBLISHED", publicationScope: "PUBLIC" },
    include: podcastInclude
  });
  if (!podcast || !(await validatedPodcast(organisation, podcast))) return null;
  const asset = podcast.episode.submissions.find((submission) =>
    submission.organisationId === organisation.id &&
    submission.promoVersion?.mediaAsset?.organisationId === organisation.id
  )?.promoVersion?.mediaAsset;
  return asset?.status === "READY" ? { asset, organisationId: organisation.id, podcastEpisodeId: podcast.id } : null;
}
