import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { NEWSROOM_PRODUCTS, canEditNewsStory, normalizeNewsSources, transitionNewsStory } from "@/lib/newsroom.mjs";
import { GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "@/lib/studio-general-asset-boundary.mjs";
import { generalSchoolNewsStoryWhere, generalSchoolRundownWhere } from "@/lib/school-general-content-boundary.mjs";
import { lockVisibleNewsroomStory, lockVisibleSchoolNewsroomCreateTargets } from "@/lib/newsroom-write-boundary.mjs";

export const dynamic = "force-dynamic";

const sourceSchema = z.object({ label: z.string().trim().min(2).max(200), url: z.string().url().max(1000).optional().nullable(), notes: z.string().trim().max(500).optional().nullable() });
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE"), title: z.string().trim().min(2).max(180), type: z.enum(["NEWS_BULLETIN", "INTERVIEW", "SPORTS_RESULT", "SCHOOL_NOTICE", "FEATURE_STORY"]), pitch: z.string().trim().max(2000).optional().nullable(), deadline: z.string().datetime().optional().nullable(), programmeId: z.string().cuid().optional().nullable(), episodeId: z.string().cuid().optional().nullable() }),
  z.object({ action: z.literal("SAVE"), storyId: z.string().cuid(), script: z.string().trim().max(30000).optional().nullable(), factCheckNotes: z.string().trim().max(10000).optional().nullable(), sources: z.array(sourceSchema).max(50).default([]), interviewMediaAssetId: z.string().cuid().optional().nullable(), interviewConsentConfirmed: z.boolean().default(false) }),
  z.object({ action: z.enum(["ASSIGN", "START_SCRIPT", "FACT_CHECK", "START_AUDIO", "SUBMIT", "APPROVE", "REQUEST_CHANGES", "PUBLISH", "ARCHIVE"]), storyId: z.string().cuid(), notes: z.string().trim().max(4000).optional().nullable() })
]);

const include = {
  programme: { select: { id: true, title: true } },
  episode: { select: { id: true, title: true, status: true } },
  interviewMediaAsset: { select: { id: true, name: true, originalName: true, durationSeconds: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } }
};

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const [stories, programmes, episodes, interviewAssets] = await Promise.all([
    prisma.schoolNewsStory.findMany({ where: { organisationId, product: NEWSROOM_PRODUCTS.SCHOOL_RADIO, status: { not: "ARCHIVED" }, ...generalSchoolNewsStoryWhere(organisationId) }, orderBy: [{ deadline: "asc" }, { updatedAt: "desc" }], take: 200, include }),
    prisma.schoolProgramme.findMany({ where: { organisationId, status: "ACTIVE" }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.schoolEpisode.findMany({ where: { organisationId, status: { not: "ARCHIVED" }, OR: [{ rundown: { is: null } }, { rundown: { is: generalSchoolRundownWhere(organisationId) } }] }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, programmeId: true } }),
    prisma.mediaAsset.findMany({ where: { organisationId, status: "READY", mimeType: { startsWith: "audio/" }, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE }, orderBy: { createdAt: "desc" }, take: 150, select: { id: true, name: true, originalName: true, durationSeconds: true } })
  ]);
  return NextResponse.json({ stories, programmes, episodes, interviewAssets, permissions: { canModerate: isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES) }, templates: ["NEWS_BULLETIN", "INTERVIEW", "SPORTS_RESULT", "SCHOOL_NOTICE", "FEATURE_STORY"] });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the newsroom details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;
  try {
    let result;
    if (data.action === "CREATE") {
      result = await prisma.$transaction(async (tx) => {
        if (!await lockVisibleSchoolNewsroomCreateTargets(tx, {
          organisationId, programmeId: data.programmeId, episodeId: data.episodeId
        })) throw new Error("Choose an active programme and available episode from this school.");
        const story = await tx.schoolNewsStory.create({ data: { organisationId, product: NEWSROOM_PRODUCTS.SCHOOL_RADIO, programmeId: data.programmeId || null, episodeId: data.episodeId || null, title: data.title, type: data.type, pitch: data.pitch || null, deadline: data.deadline ? new Date(data.deadline) : null, createdByUserId: access.user.id } });
        await tx.newsStoryDecision.create({ data: { organisationId, storyId: story.id, action: "CREATE", fromStatus: story.status, toStatus: story.status, actorUserId: access.user.id } });
        await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "SCHOOL_NEWS_CREATE", entityType: "NewsStory", entityId: story.id, details: { status: story.status, product: NEWSROOM_PRODUCTS.SCHOOL_RADIO } } });
        return story;
      }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
    } else {
      const story = await prisma.schoolNewsStory.findFirst({ where: { id: data.storyId, organisationId, product: NEWSROOM_PRODUCTS.SCHOOL_RADIO, ...generalSchoolNewsStoryWhere(organisationId) } });
      if (!story) return NextResponse.json({ error: "The newsroom story was not found." }, { status: 404 });
      if (data.action === "SAVE") {
        if (!canEditNewsStory({ role: access.membership.role, userId: access.user.id, assignedToUserId: story.assignedToUserId })) return NextResponse.json({ error: "This story is assigned to another editor." }, { status: 403 });
        if (new Set(["IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]).has(story.status)) return NextResponse.json({ error: "Return the story to scripting before changing reviewed content." }, { status: 409 });
        if (data.interviewMediaAssetId && !await prisma.mediaAsset.findFirst({ where: { id: data.interviewMediaAssetId, organisationId, status: "READY", mimeType: { startsWith: "audio/" }, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE }, select: { id: true } })) throw new Error("Choose an available interview recording from this school.");
        const sources = normalizeNewsSources(data.sources);
        result = await prisma.$transaction(async (tx) => {
          const current = await lockVisibleNewsroomStory(tx, { organisationId, storyId: story.id, product: NEWSROOM_PRODUCTS.SCHOOL_RADIO,
            visibleWhere: generalSchoolNewsStoryWhere(organisationId), include,
            additionalMediaAssetId: data.interviewMediaAssetId });
          if (!current) throw new Error("The newsroom story or interview recording is no longer available. Refresh and try again.");
          if (!canEditNewsStory({ role: access.membership.role, userId: access.user.id, assignedToUserId: current.assignedToUserId })) throw new Error("This story is assigned to another editor.");
          if (new Set(["IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]).has(current.status)) throw new Error("Return the story to scripting before changing reviewed content.");
          if (data.interviewMediaAssetId && !await tx.mediaAsset.findFirst({ where: { id: data.interviewMediaAssetId, organisationId, status: "READY", mimeType: { startsWith: "audio/" }, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE }, select: { id: true } })) throw new Error("Choose an available interview recording from this school.");
          const latest = await tx.newsStoryRevision.findFirst({ where: { storyId: current.id }, orderBy: { revision: "desc" }, select: { revision: true } });
          const updated = await tx.schoolNewsStory.update({ where: { id: current.id }, data: { script: data.script || null, factCheckNotes: data.factCheckNotes || null, sourcesJson: sources, interviewMediaAssetId: data.interviewMediaAssetId || null, interviewConsentConfirmed: data.interviewConsentConfirmed } });
          await tx.newsStoryRevision.create({ data: { organisationId, storyId: current.id, revision: (latest?.revision || 0) + 1, script: updated.script, factCheckNotes: updated.factCheckNotes, sourcesJson: sources, interviewMediaAssetId: updated.interviewMediaAssetId, createdByUserId: access.user.id } });
          return updated;
        }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
      } else {
        const managerActions = new Set(["ASSIGN", "APPROVE", "REQUEST_CHANGES", "PUBLISH", "ARCHIVE"]);
        if (managerActions.has(data.action) && !isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)) return NextResponse.json({ error: "An organisation owner or manager must complete this editorial action." }, { status: 403 });
        result = await prisma.$transaction(async (tx) => {
          const current = await lockVisibleNewsroomStory(tx, { organisationId, storyId: story.id, product: NEWSROOM_PRODUCTS.SCHOOL_RADIO,
            visibleWhere: generalSchoolNewsStoryWhere(organisationId), include });
          if (!current) throw new Error("The newsroom story or source audio is no longer available. Refresh and try again.");
          if (!managerActions.has(data.action) && !canEditNewsStory({ role: access.membership.role, userId: access.user.id, assignedToUserId: current.assignedToUserId })) throw new Error("This story is assigned to another editor.");
          const transition = transitionNewsStory({ currentStatus: current.status, action: data.action, notes: data.notes, interviewConsentConfirmed: current.interviewConsentConfirmed, hasInterviewAsset: Boolean(current.interviewMediaAssetId) });
          const updates = { status: transition.status };
          if (data.action === "ASSIGN") updates.assignedToUserId = access.user.id;
          if (new Set(["APPROVE", "REQUEST_CHANGES"]).has(data.action)) updates.reviewedByUserId = access.user.id;
          if (data.action === "PUBLISH") { updates.publishedByUserId = access.user.id; updates.publishedAt = new Date(); }
          if (transition.notes) updates.editorialFeedbackJson = { notes: transition.notes, byUserId: access.user.id, at: new Date().toISOString() };
          const updated = await tx.schoolNewsStory.update({ where: { id: current.id }, data: updates });
          await tx.newsStoryDecision.create({ data: { organisationId, storyId: current.id, action: data.action, fromStatus: current.status, toStatus: transition.status, note: transition.notes, actorUserId: access.user.id } });
          return updated;
        }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
      }
    }
    if (data.action !== "CREATE") await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `SCHOOL_NEWS_${data.action}`, entityType: "NewsStory", entityId: result.id, details: { status: result.status, product: NEWSROOM_PRODUCTS.SCHOOL_RADIO } } });
    return NextResponse.json({ result }, { status: data.action === "CREATE" ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The newsroom action could not be completed." }, { status: 409 });
  }
}

