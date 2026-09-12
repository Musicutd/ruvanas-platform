import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActivePodcast } from "@/lib/podcast-access";
import {
  PODCAST_PRODUCTS,
  normalizePodcastChapters,
  normalizeTranscriptSegments,
  podcastSlug,
  validatePodcastPublication
} from "@/lib/podcast-core.mjs";

export const dynamic = "force-dynamic";

const PRODUCT_MAP = Object.freeze({ ONLINE: PODCAST_PRODUCTS.ONLINE_RADIO, HEALTH: PODCAST_PRODUCTS.HEALTH_RADIO, FAITH: PODCAST_PRODUCTS.FAITH_RADIO });
function requestedProduct(request) {
  const key = String(new URL(request.url).searchParams.get("product") || "ONLINE").toUpperCase();
  return { key, podcast: PRODUCT_MAP[key] || null };
}

const editorFields = {
  title: z.string().trim().min(2).max(180),
  summary: z.string().trim().max(4000).optional().nullable(),
  accessibleDescription: z.string().trim().max(4000).optional().nullable(),
  languageCode: z.string().trim().min(2).max(12).default("en"),
  explicit: z.boolean().default(false),
  seasonNumber: z.number().int().min(1).max(999).optional().nullable(),
  episodeNumber: z.number().int().min(1).max(99999).optional().nullable(),
  transcriptSegments: z.array(z.record(z.unknown())).max(500).default([]),
  chapters: z.array(z.record(z.unknown())).max(100).default([]),
  submitTranscript: z.boolean().default(false)
};

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE_SERIES"),
    stationId: z.string().cuid(),
    channelId: z.string().cuid().optional().nullable(),
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional().nullable(),
    feedSlug: z.string().trim().min(2).max(80).optional().nullable(),
    author: z.string().trim().max(160).optional().nullable(),
    artworkUrl: z.string().url().max(2000).optional().nullable()
  }),
  z.object({
    action: z.literal("CREATE_EPISODE"),
    seriesId: z.string().cuid(),
    mediaAssetId: z.string().cuid(),
    ...editorFields
  }),
  z.object({
    action: z.literal("SAVE_EDITOR"),
    podcastEpisodeId: z.string().cuid(),
    ...editorFields
  }),
  z.object({ action: z.literal("APPROVE_TRANSCRIPT"), podcastEpisodeId: z.string().cuid() }),
  z.object({ action: z.literal("PUBLISH"), podcastEpisodeId: z.string().cuid() }),
  z.object({ action: z.literal("UNPUBLISH"), podcastEpisodeId: z.string().cuid(), reason: z.string().trim().min(8).max(1000) })
]);

const seriesInclude = {
  station: { select: { id: true, name: true, slug: true, status: true, audiencePolicy: true } },
  channel: { select: { id: true, name: true, slug: true, status: true } },
  episodes: {
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    include: {
      mediaAsset: { select: { id: true, name: true, originalName: true, mimeType: true, sizeBytes: true, durationSeconds: true, status: true } },
      transcript: true,
      createdBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } }
    }
  }
};

function serializeSeries(series) {
  return {
    ...series,
    episodes: series.episodes.map((episode) => ({
      ...episode,
      mediaAsset: episode.mediaAsset ? { ...episode.mediaAsset, sizeBytes: episode.mediaAsset.sizeBytes.toString() } : null
    }))
  };
}

function managerRequired(access) {
  return isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)
    ? null
    : NextResponse.json({ error: "An organisation owner or manager must approve transcripts or change public podcast availability." }, { status: 403 });
}

async function approvedAudio(organisationId, mediaAssetId) {
  const version = await prisma.promoVersion.findFirst({
    where: {
      mediaAssetId,
      status: "APPROVED",
      qcStatus: "PASSED",
      approvedForPromo: { organisationId, status: "ACTIVE" },
      mediaAsset: { organisationId, status: "READY" }
    },
    include: { mediaAsset: true, approvedForPromo: { select: { id: true, name: true } } }
  });
  return version?.mediaAsset || null;
}

export async function GET(request) {
  const product = requestedProduct(request);
  if (!product.podcast) return NextResponse.json({ error: "Choose Online, Health or Faith podcasts." }, { status: 400 });
  const access = await requireActivePodcast(ORGANISATION_CONTENT_ROLES, product.key);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const [series, stations, channels, approvedAssets] = await Promise.all([
    prisma.schoolPodcastSeries.findMany({
      where: { organisationId, product: product.podcast },
      orderBy: { updatedAt: "desc" },
      include: seriesInclude
    }),
    prisma.station.findMany({ where: { organisationId, status: { not: "CANCELLED" }, ...(product.key === "ONLINE" ? { OR: [{ productFamily: "ONLINE" }, { productFamily: null }] } : { productFamily: product.key }) }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, status: true } }),
    prisma.channel.findMany({ where: { organisationId, status: { not: "ARCHIVED" }, station: product.key === "ONLINE" ? { OR: [{ productFamily: "ONLINE" }, { productFamily: null }] } : { productFamily: product.key } }, orderBy: { name: "asc" }, select: { id: true, stationId: true, name: true, slug: true, status: true } }),
    prisma.promoAsset.findMany({
      where: { organisationId, status: "ACTIVE", currentApprovedVersionId: { not: null } },
      orderBy: { name: "asc" },
      include: { currentApprovedVersion: { include: { mediaAsset: true } } }
    })
  ]);
  return NextResponse.json({
    organisation: { id: access.organisation.id, name: access.organisation.name, slug: access.organisation.slug },
    series: series.map(serializeSeries),
    stations,
    channels,
    approvedAudio: approvedAssets.flatMap((asset) => {
      const version = asset.currentApprovedVersion;
      if (!version || version.status !== "APPROVED" || version.qcStatus !== "PASSED" || version.mediaAsset.status !== "READY" || version.mediaAsset.organisationId !== organisationId) return [];
      return [{ id: version.mediaAsset.id, name: asset.name, mediaType: asset.mediaType, durationSeconds: version.durationSeconds ?? version.mediaAsset.durationSeconds }];
    }),
    permissions: { canPublish: isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES), role: access.membership.role }
  });
}

export async function POST(request) {
  const product = requestedProduct(request);
  if (!product.podcast) return NextResponse.json({ error: "Choose Online, Health or Faith podcasts." }, { status: 400 });
  const access = await requireActivePodcast(ORGANISATION_CONTENT_ROLES, product.key);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the podcast details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;

  try {
    let result;
    if (data.action === "CREATE_SERIES") {
      const [station, channel] = await Promise.all([
        prisma.station.findFirst({ where: { id: data.stationId, organisationId, status: { not: "CANCELLED" }, ...(product.key === "ONLINE" ? { OR: [{ productFamily: "ONLINE" }, { productFamily: null }] } : { productFamily: product.key }) }, select: { id: true } }),
        data.channelId ? prisma.channel.findFirst({ where: { id: data.channelId, organisationId, stationId: data.stationId, status: { not: "ARCHIVED" } }, select: { id: true } }) : null
      ]);
      if (!station || (data.channelId && !channel)) return NextResponse.json({ error: "Choose a station and optional channel from this organisation." }, { status: 404 });
      const baseSlug = podcastSlug(data.feedSlug || data.title);
      const conflict = await prisma.schoolPodcastSeries.findFirst({ where: { organisationId, feedSlug: baseSlug }, select: { id: true } });
      const feedSlug = conflict ? `${baseSlug}-${Math.random().toString(36).slice(2, 7)}` : baseSlug;
      result = await prisma.schoolPodcastSeries.create({ data: {
        organisationId,
        product: product.podcast,
        stationId: station.id,
        channelId: channel?.id || null,
        title: data.title,
        description: data.description || null,
        feedSlug,
        author: data.author || access.organisation.name,
        artworkUrl: data.artworkUrl || null,
        publicationScope: "INTERNAL_ONLY",
        rssEnabled: false,
        createdByUserId: access.user.id
      } });
    } else if (data.action === "CREATE_EPISODE") {
      const [series, audio] = await Promise.all([
        prisma.schoolPodcastSeries.findFirst({ where: { id: data.seriesId, organisationId, product: product.podcast }, select: { id: true } }),
        approvedAudio(organisationId, data.mediaAssetId)
      ]);
      if (!series || !audio) return NextResponse.json({ error: "Choose a valid series and audio approved for this organisation." }, { status: 404 });
      const chapters = normalizePodcastChapters(data.chapters);
      const segments = normalizeTranscriptSegments(data.transcriptSegments);
      if (data.submitTranscript && !segments.length) return NextResponse.json({ error: "Add transcript text before submitting it for approval." }, { status: 400 });
      result = await prisma.$transaction(async (tx) => {
        const episode = await tx.schoolPodcastEpisode.create({ data: {
          organisationId,
          seriesId: series.id,
          mediaAssetId: audio.id,
          title: data.title,
          summary: data.summary || null,
          slug: `${podcastSlug(data.title, "episode")}-${Math.random().toString(36).slice(2, 7)}`,
          explicit: data.explicit,
          seasonNumber: data.seasonNumber || null,
          episodeNumber: data.episodeNumber || null,
          accessibleDescription: data.accessibleDescription || null,
          chaptersJson: chapters,
          publicationScope: "INTERNAL_ONLY",
          createdByUserId: access.user.id
        } });
        if (segments.length) await tx.transcript.create({ data: { organisationId, podcastEpisodeId: episode.id, mediaAssetId: audio.id, languageCode: data.languageCode, segmentsJson: segments, status: data.submitTranscript ? "NEEDS_REVIEW" : "DRAFT", source: "MANUAL" } });
        return episode;
      });
    } else if (data.action === "SAVE_EDITOR") {
      const podcast = await prisma.schoolPodcastEpisode.findFirst({ where: { id: data.podcastEpisodeId, organisationId, series: { product: product.podcast } }, include: { transcript: true } });
      if (!podcast) return NextResponse.json({ error: "The podcast episode was not found." }, { status: 404 });
      const chapters = normalizePodcastChapters(data.chapters);
      const segments = normalizeTranscriptSegments(data.transcriptSegments);
      if (data.submitTranscript && !segments.length) return NextResponse.json({ error: "Add transcript text before submitting it for approval." }, { status: 400 });
      result = await prisma.$transaction(async (tx) => {
        const updated = await tx.schoolPodcastEpisode.update({ where: { id: podcast.id }, data: {
          title: data.title,
          summary: data.summary || null,
          explicit: data.explicit,
          seasonNumber: data.seasonNumber || null,
          episodeNumber: data.episodeNumber || null,
          accessibleDescription: data.accessibleDescription || null,
          chaptersJson: chapters,
          status: podcast.status === "PUBLISHED" ? "UNPUBLISHED" : podcast.status,
          unpublishedAt: podcast.status === "PUBLISHED" ? new Date() : podcast.unpublishedAt,
          unpublishReason: podcast.status === "PUBLISHED" ? "Published content changed and requires a fresh review." : podcast.unpublishReason
        } });
        if (segments.length) await tx.transcript.upsert({
          where: { podcastEpisodeId: podcast.id },
          create: { organisationId, podcastEpisodeId: podcast.id, mediaAssetId: podcast.mediaAssetId, languageCode: data.languageCode, segmentsJson: segments, status: data.submitTranscript ? "NEEDS_REVIEW" : "DRAFT", source: "MANUAL" },
          update: { languageCode: data.languageCode, segmentsJson: segments, status: data.submitTranscript ? "NEEDS_REVIEW" : "DRAFT", source: "MANUAL" }
        });
        else if (podcast.transcript) await tx.transcript.delete({ where: { id: podcast.transcript.id } });
        return updated;
      });
    } else if (data.action === "APPROVE_TRANSCRIPT") {
      const denied = managerRequired(access); if (denied) return denied;
      const podcast = await prisma.schoolPodcastEpisode.findFirst({ where: { id: data.podcastEpisodeId, organisationId, series: { product: product.podcast } }, include: { transcript: true } });
      if (!podcast) return NextResponse.json({ error: "The podcast episode was not found." }, { status: 404 });
      if (podcast.transcript?.status !== "NEEDS_REVIEW") return NextResponse.json({ error: "Only a submitted transcript can be approved." }, { status: 409 });
      result = await prisma.transcript.update({ where: { id: podcast.transcript.id }, data: { status: "APPROVED" } });
    } else {
      const denied = managerRequired(access); if (denied) return denied;
      const podcast = await prisma.schoolPodcastEpisode.findFirst({
        where: { id: data.podcastEpisodeId, organisationId, series: { product: product.podcast } },
        include: { series: { include: { station: { select: { status: true } } } }, mediaAsset: true, transcript: true }
      });
      if (!podcast) return NextResponse.json({ error: "The podcast episode was not found." }, { status: 404 });
      if (data.action === "PUBLISH") {
        if (product.key !== "ONLINE" && podcast.series.station?.audiencePolicy !== "PUBLIC") return NextResponse.json({ error: "Change this channel to Public before creating a public podcast and RSS feed. Internal and restricted audio stays private." }, { status: 409 });
        const audio = await approvedAudio(organisationId, podcast.mediaAssetId);
        validatePodcastPublication({ series: podcast.series, episode: podcast, approvedAudio: audio, transcriptStatus: podcast.transcript?.status, stationStatus: podcast.series.station?.status });
        result = await prisma.$transaction(async (tx) => {
          const updated = await tx.schoolPodcastEpisode.update({ where: { id: podcast.id }, data: { status: "PUBLISHED", publicationScope: "PUBLIC", reviewedByUserId: access.user.id, publishedAt: new Date(), unpublishedAt: null, unpublishReason: null } });
          await tx.schoolPodcastSeries.update({ where: { id: podcast.seriesId }, data: { publicationScope: "PUBLIC", rssEnabled: true } });
          return updated;
        });
      } else {
        result = await prisma.schoolPodcastEpisode.update({ where: { id: podcast.id }, data: { status: "UNPUBLISHED", reviewedByUserId: access.user.id, unpublishedAt: new Date(), unpublishReason: data.reason } });
      }
    }
    await prisma.auditLog.create({ data: {
      organisationId,
      actorUserId: access.user.id,
      action: `${product.key}_PODCAST_${data.action}`,
      entityType: data.action === "CREATE_SERIES" ? "PodcastSeries" : data.action === "APPROVE_TRANSCRIPT" ? "Transcript" : "PodcastEpisode",
      entityId: result.id,
      details: { product: product.podcast }
    } });
    return NextResponse.json({ result }, { status: new Set(["CREATE_SERIES", "CREATE_EPISODE"]).has(data.action) ? 201 : 200 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That series or episode address is already in use." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The podcast action could not be completed." }, { status: 409 });
  }
}
