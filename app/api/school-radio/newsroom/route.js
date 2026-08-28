import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { transitionNewsStory } from "@/lib/school-podcast-live.mjs";

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
    prisma.schoolNewsStory.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, orderBy: [{ deadline: "asc" }, { updatedAt: "desc" }], take: 200, include }),
    prisma.schoolProgramme.findMany({ where: { organisationId, status: "ACTIVE" }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.schoolEpisode.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, programmeId: true } }),
    prisma.mediaAsset.findMany({ where: { organisationId, status: "READY", mimeType: { startsWith: "audio/" } }, orderBy: { createdAt: "desc" }, take: 150, select: { id: true, name: true, originalName: true, durationSeconds: true } })
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
      if (data.programmeId && !await prisma.schoolProgramme.findFirst({ where: { id: data.programmeId, organisationId, status: "ACTIVE" }, select: { id: true } })) throw new Error("Choose an active programme from this school.");
      if (data.episodeId && !await prisma.schoolEpisode.findFirst({ where: { id: data.episodeId, organisationId }, select: { id: true } })) throw new Error("Choose an episode from this school.");
      result = await prisma.schoolNewsStory.create({ data: { organisationId, programmeId: data.programmeId || null, episodeId: data.episodeId || null, title: data.title, type: data.type, pitch: data.pitch || null, deadline: data.deadline ? new Date(data.deadline) : null, createdByUserId: access.user.id } });
    } else {
      const story = await prisma.schoolNewsStory.findFirst({ where: { id: data.storyId, organisationId } });
      if (!story) return NextResponse.json({ error: "The newsroom story was not found." }, { status: 404 });
      if (data.action === "SAVE") {
        if (data.interviewMediaAssetId && !await prisma.mediaAsset.findFirst({ where: { id: data.interviewMediaAssetId, organisationId, status: "READY", mimeType: { startsWith: "audio/" } }, select: { id: true } })) throw new Error("Choose an available interview recording from this school.");
        result = await prisma.schoolNewsStory.update({ where: { id: story.id }, data: { script: data.script || null, factCheckNotes: data.factCheckNotes || null, sourcesJson: data.sources, interviewMediaAssetId: data.interviewMediaAssetId || null, interviewConsentConfirmed: data.interviewConsentConfirmed } });
      } else {
        const managerActions = new Set(["ASSIGN", "APPROVE", "REQUEST_CHANGES", "PUBLISH", "ARCHIVE"]);
        if (managerActions.has(data.action) && !isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)) return NextResponse.json({ error: "An organisation owner or manager must complete this editorial action." }, { status: 403 });
        const transition = transitionNewsStory({ currentStatus: story.status, action: data.action, notes: data.notes, interviewConsentConfirmed: story.interviewConsentConfirmed, hasInterviewAsset: Boolean(story.interviewMediaAssetId) });
        const updates = { status: transition.status };
        if (data.action === "ASSIGN") updates.assignedToUserId = access.user.id;
        if (new Set(["APPROVE", "REQUEST_CHANGES", "PUBLISH"]).has(data.action)) updates.reviewedByUserId = access.user.id;
        if (transition.notes) updates.editorialFeedbackJson = { notes: transition.notes, byUserId: access.user.id, at: new Date().toISOString() };
        result = await prisma.schoolNewsStory.update({ where: { id: story.id }, data: updates });
      }
    }
    await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `SCHOOL_NEWS_${data.action}`, entityType: "SchoolNewsStory", entityId: result.id, details: { status: result.status } } });
    return NextResponse.json({ result }, { status: data.action === "CREATE" ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The newsroom action could not be completed." }, { status: 409 });
  }
}

