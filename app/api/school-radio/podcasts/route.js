import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { normalizePodcastChapters, normalizeTranscriptSegments, validatePodcastPublication } from "@/lib/school-podcast-live.mjs";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_SERIES"), title: z.string().trim().min(2).max(160), description: z.string().trim().max(1500).optional().nullable(), programmeId: z.string().cuid().optional().nullable() }),
  z.object({ action: z.literal("CREATE_EPISODE"), seriesId: z.string().cuid(), episodeId: z.string().cuid(), accessibleDescription: z.string().trim().max(2000).optional().nullable() }),
  z.object({ action: z.literal("SAVE_EDITOR"), podcastEpisodeId: z.string().cuid(), languageCode: z.string().trim().min(2).max(12), transcriptSegments: z.array(z.record(z.unknown())).max(500), chapters: z.array(z.record(z.unknown())).max(100), accessibleDescription: z.string().trim().max(2000).optional().nullable(), submitTranscript: z.boolean().default(false) }),
  z.object({ action: z.enum(["PUBLISH", "UNPUBLISH"]), podcastEpisodeId: z.string().cuid(), publicationScope: z.enum(["INTERNAL_ONLY", "PUBLIC"]).default("INTERNAL_ONLY") })
]);

const include = {
  programme: { select: { id: true, title: true } },
  episodes: {
    orderBy: { createdAt: "desc" },
    include: {
      episode: { select: { id: true, title: true, summary: true, status: true } },
      transcript: true,
      createdBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } }
    }
  }
};

function managerRequired(access) {
  return isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)
    ? null
    : NextResponse.json({ error: "An organisation owner or manager must publish or unpublish podcasts." }, { status: 403 });
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const [series, programmes, eligibleEpisodes] = await Promise.all([
    prisma.schoolPodcastSeries.findMany({ where: { organisationId }, orderBy: { updatedAt: "desc" }, include }),
    prisma.schoolProgramme.findMany({ where: { organisationId, status: "ACTIVE" }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.schoolEpisode.findMany({
      where: { organisationId, status: "APPROVED", podcastEpisode: null, submissions: { some: { status: "SUBMITTED", promoVersion: { status: "APPROVED" } } } },
      orderBy: { approvedAt: "desc" },
      select: { id: true, title: true, summary: true, programmeId: true }
    })
  ]);
  return NextResponse.json({
    series, programmes, eligibleEpisodes,
    permissions: { canPublish: isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES), publicPublishingEnabled: false },
    safety: { defaultScope: "INTERNAL_ONLY", rssEnabled: false, publicPublishingRequiresSeparateCapability: true }
  });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the podcast editor details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;
  try {
    let result;
    if (data.action === "CREATE_SERIES") {
      if (data.programmeId) {
        const programme = await prisma.schoolProgramme.findFirst({ where: { id: data.programmeId, organisationId, status: "ACTIVE" }, select: { id: true } });
        if (!programme) return NextResponse.json({ error: "Choose an active programme from this school." }, { status: 404 });
      }
      result = await prisma.schoolPodcastSeries.create({ data: { organisationId, programmeId: data.programmeId || null, title: data.title, description: data.description || null, publicationScope: "INTERNAL_ONLY", rssEnabled: false, createdByUserId: access.user.id } });
    } else if (data.action === "CREATE_EPISODE") {
      const [series, episode] = await Promise.all([
        prisma.schoolPodcastSeries.findFirst({ where: { id: data.seriesId, organisationId }, select: { id: true } }),
        prisma.schoolEpisode.findFirst({ where: { id: data.episodeId, organisationId, status: "APPROVED", podcastEpisode: null, submissions: { some: { status: "SUBMITTED", promoVersion: { status: "APPROVED" } } } }, select: { id: true } })
      ]);
      if (!series || !episode) return NextResponse.json({ error: "Choose an approved, unpublished school episode and a valid series." }, { status: 404 });
      result = await prisma.schoolPodcastEpisode.create({ data: { organisationId, seriesId: series.id, episodeId: episode.id, publicationScope: "INTERNAL_ONLY", accessibleDescription: data.accessibleDescription || null, createdByUserId: access.user.id } });
    } else if (data.action === "SAVE_EDITOR") {
      const podcast = await prisma.schoolPodcastEpisode.findFirst({ where: { id: data.podcastEpisodeId, organisationId }, include: { transcript: true } });
      if (!podcast) return NextResponse.json({ error: "The podcast episode was not found." }, { status: 404 });
      const transcriptSegments = normalizeTranscriptSegments(data.transcriptSegments);
      const chapters = normalizePodcastChapters(data.chapters);
      result = await prisma.$transaction(async (tx) => {
        const updated = await tx.schoolPodcastEpisode.update({ where: { id: podcast.id }, data: { accessibleDescription: data.accessibleDescription || null, chaptersJson: chapters, status: podcast.status === "PUBLISHED" ? "UNPUBLISHED" : podcast.status, unpublishedAt: podcast.status === "PUBLISHED" ? new Date() : podcast.unpublishedAt } });
        await tx.transcript.upsert({ where: { podcastEpisodeId: podcast.id }, create: { organisationId, podcastEpisodeId: podcast.id, episodeId: podcast.episodeId, languageCode: data.languageCode, segmentsJson: transcriptSegments, status: data.submitTranscript ? "NEEDS_REVIEW" : "DRAFT", source: "MANUAL" }, update: { languageCode: data.languageCode, segmentsJson: transcriptSegments, status: data.submitTranscript ? "NEEDS_REVIEW" : "DRAFT", source: "MANUAL" } });
        return updated;
      });
    } else {
      const denied = managerRequired(access);
      if (denied) return denied;
      const podcast = await prisma.schoolPodcastEpisode.findFirst({
        where: { id: data.podcastEpisodeId, organisationId },
        include: { transcript: true, episode: { include: { contributors: true, submissions: { where: { status: "SUBMITTED", promoVersion: { status: "APPROVED" } }, take: 1 } } } }
      });
      if (!podcast) return NextResponse.json({ error: "The podcast episode was not found." }, { status: 404 });
      if (data.action === "PUBLISH") {
        const contributorConsents = await prisma.consentRecord.findMany({ where: { organisationId, contributorId: { in: podcast.episode.contributors.map((entry) => entry.contributorId) }, OR: [{ episodeId: podcast.episodeId }, { episodeId: null }], status: "GRANTED" }, orderBy: { createdAt: "desc" } });
        validatePodcastPublication({ publicationScope: data.publicationScope, episodeStatus: podcast.episode.status, hasApprovedAudio: podcast.episode.submissions.length > 0, transcriptStatus: podcast.transcript?.status || null, publicPublishingEnabled: false, contributorConsents });
        result = await prisma.$transaction(async (tx) => {
          if (podcast.transcript?.status === "NEEDS_REVIEW") await tx.transcript.update({ where: { id: podcast.transcript.id }, data: { status: "APPROVED" } });
          return tx.schoolPodcastEpisode.update({ where: { id: podcast.id }, data: { status: "PUBLISHED", publicationScope: data.publicationScope, reviewedByUserId: access.user.id, publishedAt: new Date(), unpublishedAt: null } });
        });
      } else {
        result = await prisma.schoolPodcastEpisode.update({ where: { id: podcast.id }, data: { status: "UNPUBLISHED", reviewedByUserId: access.user.id, unpublishedAt: new Date() } });
      }
    }
    await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `SCHOOL_PODCAST_${data.action}`, entityType: data.action === "CREATE_SERIES" ? "SchoolPodcastSeries" : "SchoolPodcastEpisode", entityId: result.id, details: { publicPublishingEnabled: false } } });
    return NextResponse.json({ result }, { status: new Set(["CREATE_SERIES", "CREATE_EPISODE"]).has(data.action) ? 201 : 200 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That podcast series or episode already exists." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The podcast action could not be completed." }, { status: 409 });
  }
}

