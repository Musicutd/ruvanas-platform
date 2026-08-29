import { prisma } from "@/lib/prisma";
import {
  normaliseSchoolPublicationFilters,
  schoolPublicationDayBucket,
  schoolPublicationRetentionPreview
} from "@/lib/school-publication-operations.mjs";

function safeCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function safeBytes(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? BigInt(number) : 0n;
}

export async function recordPublicEpisodeListings({ organisationId, podcastEpisodeIds = [], occurredAt = new Date() }) {
  const ids = [...new Set(podcastEpisodeIds.filter(Boolean))].slice(0, 100);
  if (!organisationId || !ids.length) return;
  const bucketStart = schoolPublicationDayBucket(occurredAt);
  await prisma.$transaction(ids.map((podcastEpisodeId) => prisma.schoolPublicationDailyAggregate.upsert({
    where: { organisationId_podcastEpisodeId_bucketStart: { organisationId, podcastEpisodeId, bucketStart } },
    create: { organisationId, podcastEpisodeId, bucketStart, metadataListingCount: 1 },
    update: { metadataListingCount: { increment: 1 } }
  })));
}

export async function recordPublicAudioDelivery({ organisationId, podcastEpisodeId, bytesOffered, rangeRequest, occurredAt = new Date() }) {
  if (!organisationId || !podcastEpisodeId) return;
  const bucketStart = schoolPublicationDayBucket(occurredAt);
  const audioBytesOffered = safeBytes(bytesOffered);
  await prisma.schoolPublicationDailyAggregate.upsert({
    where: { organisationId_podcastEpisodeId_bucketStart: { organisationId, podcastEpisodeId, bucketStart } },
    create: {
      organisationId,
      podcastEpisodeId,
      bucketStart,
      audioRequestCount: 1,
      audioBytesOffered,
      fullAudioRequestCount: rangeRequest ? 0 : 1,
      rangeAudioRequestCount: rangeRequest ? 1 : 0
    },
    update: {
      audioRequestCount: { increment: 1 },
      audioBytesOffered: { increment: audioBytesOffered },
      ...(rangeRequest ? { rangeAudioRequestCount: { increment: 1 } } : { fullAudioRequestCount: { increment: 1 } })
    }
  });
}

export async function loadSchoolPublicationOperations(organisationId, input = {}) {
  const filters = normaliseSchoolPublicationFilters(input);
  const [rows, readiness, currentPublicEpisodes, decisionGroups] = await Promise.all([
    prisma.schoolPublicationDailyAggregate.findMany({
      where: { organisationId, bucketStart: { gte: filters.fromInstant, lt: filters.until } },
      orderBy: [{ bucketStart: "asc" }, { podcastEpisode: { episode: { title: "asc" } } }],
      include: { podcastEpisode: { select: { episode: { select: { title: true } }, series: { select: { title: true } } } } }
    }),
    prisma.schoolSafeguardingReadiness.findUnique({
      where: { organisationId },
      select: { status: true, rawRecordingRetentionDays: true, consentEvidenceRetentionDays: true, updatedAt: true }
    }),
    prisma.schoolPodcastEpisode.count({ where: { organisationId, status: "PUBLISHED", publicationScope: "PUBLIC" } }),
    prisma.schoolPublicationDecision.groupBy({
      by: ["decision"],
      where: { organisationId, createdAt: { gte: filters.fromInstant, lt: filters.until } },
      _count: { _all: true }
    })
  ]);

  const summary = {
    metadataListingCount: 0,
    audioRequestCount: 0,
    audioBytesOffered: 0n,
    fullAudioRequestCount: 0,
    rangeAudioRequestCount: 0,
    currentPublicEpisodes,
    publishedDecisionCount: 0,
    unpublishedDecisionCount: 0,
    autoWithdrawnDecisionCount: 0
  };
  for (const row of rows) {
    summary.metadataListingCount += safeCount(row.metadataListingCount);
    summary.audioRequestCount += safeCount(row.audioRequestCount);
    summary.audioBytesOffered += BigInt(row.audioBytesOffered || 0);
    summary.fullAudioRequestCount += safeCount(row.fullAudioRequestCount);
    summary.rangeAudioRequestCount += safeCount(row.rangeAudioRequestCount);
  }
  for (const group of decisionGroups) {
    const count = group._count?._all || 0;
    if (group.decision === "PUBLISHED") summary.publishedDecisionCount = count;
    if (group.decision === "UNPUBLISHED") summary.unpublishedDecisionCount = count;
    if (group.decision === "AUTO_WITHDRAWN") summary.autoWithdrawnDecisionCount = count;
  }

  const episodesById = new Map();
  for (const row of rows) {
    const episode = episodesById.get(row.podcastEpisodeId) || {
      id: row.podcastEpisodeId,
      title: row.podcastEpisode.episode.title,
      series: row.podcastEpisode.series.title,
      totals: { metadataListingCount: 0, audioRequestCount: 0, audioBytesOffered: 0n, fullAudioRequestCount: 0, rangeAudioRequestCount: 0 },
      days: []
    };
    const day = {
      date: row.bucketStart.toISOString().slice(0, 10),
      metadataListingCount: safeCount(row.metadataListingCount),
      audioRequestCount: safeCount(row.audioRequestCount),
      audioBytesOffered: String(row.audioBytesOffered || 0),
      fullAudioRequestCount: safeCount(row.fullAudioRequestCount),
      rangeAudioRequestCount: safeCount(row.rangeAudioRequestCount)
    };
    episode.days.push(day);
    episode.totals.metadataListingCount += day.metadataListingCount;
    episode.totals.audioRequestCount += day.audioRequestCount;
    episode.totals.audioBytesOffered += BigInt(day.audioBytesOffered);
    episode.totals.fullAudioRequestCount += day.fullAudioRequestCount;
    episode.totals.rangeAudioRequestCount += day.rangeAudioRequestCount;
    episodesById.set(row.podcastEpisodeId, episode);
  }

  const serialiseTotals = (totals) => ({ ...totals, audioBytesOffered: String(totals.audioBytesOffered) });
  return {
    filters: { from: filters.from, to: filters.to, days: filters.days },
    summary: serialiseTotals(summary),
    episodes: [...episodesById.values()].map((episode) => ({ ...episode, totals: serialiseTotals(episode.totals) })),
    retention: schoolPublicationRetentionPreview(readiness || {}),
    readinessUpdatedAt: readiness?.updatedAt?.toISOString() || null
  };
}
