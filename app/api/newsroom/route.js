import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveNewsroom } from "@/lib/newsroom-access";
import { GENERAL_STATION_MANAGEMENT_WHERE } from "@/lib/general-station-boundary.mjs";
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "@/lib/studio-general-asset-boundary.mjs";
import { lockVisibleNewsroomStory } from "@/lib/newsroom-write-boundary.mjs";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import {
  NEWSROOM_POLICY_VERSION,
  NEWSROOM_PRODUCTS,
  ONLINE_NEWS_TYPES,
  canEditNewsStory,
  normalizeNewsSources,
  newsroomSourceFingerprint,
  transitionNewsStory
} from "@/lib/newsroom.mjs";
import { getRequestId } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable()
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE"),
    stationId: z.string().cuid(),
    channelId: z.string().cuid().optional().nullable(),
    title: z.string().trim().min(3).max(180),
    type: z.enum(ONLINE_NEWS_TYPES),
    pitch: z.string().trim().min(10).max(2000),
    deadline: z.string().datetime().optional().nullable()
  }),
  z.object({
    action: z.literal("SAVE"),
    storyId: z.string().cuid(),
    script: z.string().trim().max(30000).optional().nullable(),
    factCheckNotes: z.string().trim().max(10000).optional().nullable(),
    sources: z.array(sourceSchema).max(50).default([]),
    audioProjectId: z.string().cuid().optional().nullable(),
    interviewMediaAssetId: z.string().cuid().optional().nullable(),
    interviewConsentConfirmed: z.boolean().default(false)
  }),
  z.object({ action: z.literal("ASSIGN"), storyId: z.string().cuid(), assigneeUserId: z.string().cuid() }),
  z.object({ action: z.enum(["START_SCRIPT", "FACT_CHECK", "START_AUDIO", "SUBMIT", "APPROVE", "REQUEST_CHANGES", "PUBLISH", "ARCHIVE"]), storyId: z.string().cuid(), notes: z.string().trim().max(4000).optional().nullable() })
]);

const storyInclude = {
  station: { select: { id: true, name: true, slug: true, status: true } },
  channel: { select: { id: true, name: true, slug: true, status: true } },
  audioProject: { select: { id: true, title: true, type: true, status: true, currentVersion: true } },
  interviewMediaAsset: { select: { id: true, name: true, originalName: true, durationSeconds: true, status: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  publishedBy: { select: { id: true, name: true, email: true } },
  revisions: { orderBy: { revision: "desc" }, take: 10, select: { id: true, revision: true, createdAt: true, createdBy: { select: { id: true, name: true } } } },
  decisions: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, action: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: { id: true, name: true } } } }
};

// The Online newsroom has historically accepted ordinary stations from any
// product family. Keep those targets, but never expose Inside stations or
// legacy stations that contain a Corrections-rights channel.
const onlineStationWhere = GENERAL_STATION_MANAGEMENT_WHERE;
const onlineChannelWhere = {
  OR: [{ musicRightsUse: null }, { musicRightsUse: { not: "CORRECTIONS_RADIO" } }],
  station: { is: onlineStationWhere }
};

function visibleOnlineStoryWhere(organisationId) {
  const ordinaryMedia = { organisationId, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE };
  return {
    AND: [
      { OR: [{ stationId: null }, { station: { is: onlineStationWhere } }] },
      { OR: [{ channelId: null }, { channel: { is: onlineChannelWhere } }] },
      { OR: [{ audioProjectId: null }, { audioProject: { is: GENERAL_STUDIO_AUDIO_PROJECT_WHERE } }] },
      { OR: [{ interviewMediaAssetId: null }, { interviewMediaAsset: { is: ordinaryMedia } }] },
      // A later edit must not make an earlier private revision visible again.
      // The same predicate also blocks review and publication transitions.
      { revisions: { none: { OR: [
        { audioProjectId: { not: null }, audioProject: { isNot: GENERAL_STUDIO_AUDIO_PROJECT_WHERE } },
        { interviewMediaAssetId: { not: null }, interviewMediaAsset: { isNot: ordinaryMedia } }
      ] } } }
    ]
  };
}

function onlineEntitlementRequired(access) {
  return access.entitlements.onlineRadioEnabled
    ? null
    : NextResponse.json({ error: "Online Radio is not enabled for this organisation." }, { status: 403 });
}

function managerRequired(access) {
  return isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)
    ? null
    : NextResponse.json({ error: "An organisation owner or manager must complete this newsroom action." }, { status: 403 });
}

function storyReadiness(story) {
  const sources = Array.isArray(story.sourcesJson) ? story.sourcesJson : [];
  return {
    hasScript: Boolean(String(story.script || "").trim()),
    hasFactCheck: Boolean(String(story.factCheckNotes || "").trim()),
    hasSources: sources.length > 0,
    hasProductionAsset: Boolean(
      (story.audioProject && new Set(["READY", "SUBMITTED"]).has(story.audioProject.status)) ||
      (story.interviewMediaAsset && story.interviewMediaAsset.status === "READY")
    )
  };
}

async function onlineStory(organisationId, storyId) {
  return prisma.schoolNewsStory.findFirst({
    where: { id: storyId, organisationId, product: NEWSROOM_PRODUCTS.ONLINE_RADIO, ...visibleOnlineStoryWhere(organisationId) },
    include: storyInclude
  });
}

export async function GET() {
  const access = await requireActiveNewsroom(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const denied = onlineEntitlementRequired(access); if (denied) return denied;
  const organisationId = access.organisation.id;
  const [stories, stations, channels, studioProjects, interviewAssets, members] = await Promise.all([
    prisma.schoolNewsStory.findMany({ where: { organisationId, product: NEWSROOM_PRODUCTS.ONLINE_RADIO, status: { not: "ARCHIVED" }, ...visibleOnlineStoryWhere(organisationId) }, orderBy: [{ deadline: "asc" }, { updatedAt: "desc" }], take: 200, include: storyInclude }),
    prisma.station.findMany({ where: { organisationId, status: { not: "CANCELLED" }, ...onlineStationWhere }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, status: true } }),
    prisma.channel.findMany({ where: { organisationId, stationId: { not: null }, status: { not: "ARCHIVED" }, ...onlineChannelWhere }, orderBy: { name: "asc" }, select: { id: true, stationId: true, name: true, slug: true, status: true } }),
    prisma.audioProject.findMany({ where: { organisationId, status: { not: "ARCHIVED" }, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, type: true, status: true, currentVersion: true } }),
    prisma.mediaAsset.findMany({ where: { organisationId, status: "READY", mimeType: { startsWith: "audio/" }, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, originalName: true, durationSeconds: true } }),
    prisma.organisationMember.findMany({ where: { organisationId, role: { in: ORGANISATION_CONTENT_ROLES } }, orderBy: { createdAt: "asc" }, take: 100, select: { role: true, user: { select: { id: true, name: true, email: true } } } })
  ]);
  return NextResponse.json({
    organisation: { id: organisationId, name: access.organisation.name },
    stories,
    stations,
    channels,
    studioProjects,
    interviewAssets,
    members: members.map((entry) => ({ ...entry.user, role: entry.role })),
    templates: ONLINE_NEWS_TYPES,
    permissions: { role: access.membership.role, canReview: isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES) },
    policy: { version: NEWSROOM_POLICY_VERSION, liveScheduleChangesAllowed: false, publicWebPublishingIncluded: false }
  });
}

export async function POST(request) {
  const access = await requireActiveNewsroom(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const denied = onlineEntitlementRequired(access); if (denied) return denied;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the newsroom details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;
  const requestId = getRequestId(request);

  try {
    let result;
    if (data.action === "CREATE") {
      const [station, channel] = await Promise.all([
        prisma.station.findFirst({ where: { id: data.stationId, organisationId, status: { not: "CANCELLED" }, ...onlineStationWhere }, select: { id: true } }),
        data.channelId ? prisma.channel.findFirst({ where: { id: data.channelId, stationId: data.stationId, organisationId, status: { not: "ARCHIVED" }, ...onlineChannelWhere }, select: { id: true } }) : null
      ]);
      if (!station || (data.channelId && !channel)) return NextResponse.json({ error: "Choose a station and optional channel owned by this organisation." }, { status: 404 });
      result = await prisma.$transaction(async (tx) => {
        const story = await tx.schoolNewsStory.create({ data: { organisationId, product: NEWSROOM_PRODUCTS.ONLINE_RADIO, stationId: station.id, channelId: channel?.id || null, title: data.title, type: data.type, pitch: data.pitch, deadline: data.deadline ? new Date(data.deadline) : null, createdByUserId: access.user.id } });
        await tx.newsStoryDecision.create({ data: { organisationId, storyId: story.id, action: "CREATE", fromStatus: story.status, toStatus: story.status, actorUserId: access.user.id } });
        await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "ONLINE_NEWS_CREATE", entityType: "NewsStory", entityId: story.id, details: { stationId: station.id, channelId: channel?.id || null, type: story.type, product: NEWSROOM_PRODUCTS.ONLINE_RADIO, policyVersion: NEWSROOM_POLICY_VERSION, requestId } } });
        return story;
      });
    } else {
      const story = await onlineStory(organisationId, data.storyId);
      if (!story) return NextResponse.json({ error: "The newsroom story was not found." }, { status: 404 });

      if (data.action === "SAVE") {
        if (!canEditNewsStory({ role: access.membership.role, userId: access.user.id, assignedToUserId: story.assignedToUserId })) return NextResponse.json({ error: "This story is assigned to another editor." }, { status: 403 });
        if (new Set(["IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]).has(story.status)) return NextResponse.json({ error: "Return the story to scripting before changing reviewed content." }, { status: 409 });
        const sources = normalizeNewsSources(data.sources);
        const [audioProject, interviewAsset] = await Promise.all([
          data.audioProjectId ? prisma.audioProject.findFirst({ where: { id: data.audioProjectId, organisationId, status: { not: "ARCHIVED" }, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE }, select: { id: true } }) : null,
          data.interviewMediaAssetId ? prisma.mediaAsset.findFirst({ where: { id: data.interviewMediaAssetId, organisationId, status: "READY", mimeType: { startsWith: "audio/" }, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE }, select: { id: true } }) : null
        ]);
        if ((data.audioProjectId && !audioProject) || (data.interviewMediaAssetId && !interviewAsset)) return NextResponse.json({ error: "Choose production audio owned by this organisation." }, { status: 404 });
        result = await prisma.$transaction(async (tx) => {
          const current = await lockVisibleNewsroomStory(tx, { organisationId, storyId: story.id, product: NEWSROOM_PRODUCTS.ONLINE_RADIO,
            visibleWhere: visibleOnlineStoryWhere(organisationId), include: storyInclude,
            additionalProjectId: data.audioProjectId, additionalMediaAssetId: data.interviewMediaAssetId });
          if (!current) throw new Error("The newsroom story or production audio is no longer available. Refresh and try again.");
          if (!canEditNewsStory({ role: access.membership.role, userId: access.user.id, assignedToUserId: current.assignedToUserId })) throw new Error("This story is assigned to another editor.");
          if (new Set(["IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]).has(current.status)) throw new Error("Return the story to scripting before changing reviewed content.");
          const [currentProject, currentAsset] = await Promise.all([
            data.audioProjectId ? tx.audioProject.findFirst({ where: { id: data.audioProjectId, organisationId, status: { not: "ARCHIVED" }, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE }, select: { id: true } }) : null,
            data.interviewMediaAssetId ? tx.mediaAsset.findFirst({ where: { id: data.interviewMediaAssetId, organisationId, status: "READY", mimeType: { startsWith: "audio/" }, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE }, select: { id: true } }) : null
          ]);
          if ((data.audioProjectId && !currentProject) || (data.interviewMediaAssetId && !currentAsset)) throw new Error("Choose production audio owned by this organisation.");
          const latest = await tx.newsStoryRevision.findFirst({ where: { storyId: current.id }, orderBy: { revision: "desc" }, select: { revision: true } });
          const updated = await tx.schoolNewsStory.update({ where: { id: current.id }, data: { script: data.script || null, factCheckNotes: data.factCheckNotes || null, sourcesJson: sources, audioProjectId: currentProject?.id || null, interviewMediaAssetId: currentAsset?.id || null, interviewConsentConfirmed: data.interviewConsentConfirmed } });
          const revision = (latest?.revision || 0) + 1;
          await tx.newsStoryRevision.create({ data: { organisationId, storyId: current.id, revision, script: updated.script, factCheckNotes: updated.factCheckNotes, sourcesJson: sources, audioProjectId: updated.audioProjectId, interviewMediaAssetId: updated.interviewMediaAssetId, createdByUserId: access.user.id } });
          await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "ONLINE_NEWS_SAVE", entityType: "NewsStory", entityId: current.id, details: { revision, sourceCount: sources.length, sourceFingerprint: newsroomSourceFingerprint(sources), audioProjectId: updated.audioProjectId, policyVersion: NEWSROOM_POLICY_VERSION, requestId } } });
          return updated;
        }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
      } else if (data.action === "ASSIGN") {
        const denied = managerRequired(access); if (denied) return denied;
        const assignee = await prisma.organisationMember.findFirst({ where: { organisationId, userId: data.assigneeUserId, role: { in: ORGANISATION_CONTENT_ROLES } }, select: { userId: true } });
        if (!assignee) return NextResponse.json({ error: "Choose an active newsroom editor in this organisation." }, { status: 404 });
        result = await prisma.$transaction(async (tx) => {
          const current = await lockVisibleNewsroomStory(tx, { organisationId, storyId: story.id, product: NEWSROOM_PRODUCTS.ONLINE_RADIO,
            visibleWhere: visibleOnlineStoryWhere(organisationId), include: storyInclude });
          if (!current) throw new Error("The newsroom story is no longer available. Refresh and try again.");
          const transition = transitionNewsStory({ currentStatus: current.status, action: "ASSIGN", product: NEWSROOM_PRODUCTS.ONLINE_RADIO });
          const updated = await tx.schoolNewsStory.update({ where: { id: current.id }, data: { status: transition.status, assignedToUserId: assignee.userId } });
          await tx.newsStoryDecision.create({ data: { organisationId, storyId: current.id, action: "ASSIGN", fromStatus: current.status, toStatus: transition.status, actorUserId: access.user.id } });
          await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "ONLINE_NEWS_ASSIGN", entityType: "NewsStory", entityId: current.id, details: { assigneeUserId: assignee.userId, policyVersion: NEWSROOM_POLICY_VERSION, requestId } } });
          return updated;
        }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
      } else {
        const managerActions = new Set(["APPROVE", "REQUEST_CHANGES", "PUBLISH", "ARCHIVE"]);
        if (managerActions.has(data.action)) { const denied = managerRequired(access); if (denied) return denied; }
        else if (!canEditNewsStory({ role: access.membership.role, userId: access.user.id, assignedToUserId: story.assignedToUserId })) return NextResponse.json({ error: "This story is assigned to another editor." }, { status: 403 });
        result = await prisma.$transaction(async (tx) => {
          const current = await lockVisibleNewsroomStory(tx, { organisationId, storyId: story.id, product: NEWSROOM_PRODUCTS.ONLINE_RADIO,
            visibleWhere: visibleOnlineStoryWhere(organisationId), include: storyInclude });
          if (!current) throw new Error("The newsroom story or production audio is no longer available. Refresh and try again.");
          if (!managerActions.has(data.action) && !canEditNewsStory({ role: access.membership.role, userId: access.user.id, assignedToUserId: current.assignedToUserId })) throw new Error("This story is assigned to another editor.");
          const readiness = storyReadiness(current);
          const transition = transitionNewsStory({ currentStatus: current.status, action: data.action, product: NEWSROOM_PRODUCTS.ONLINE_RADIO, notes: data.notes, interviewConsentConfirmed: current.interviewConsentConfirmed, hasInterviewAsset: Boolean(current.interviewMediaAssetId), ...readiness });
          const updates = { status: transition.status };
          if (new Set(["APPROVE", "REQUEST_CHANGES"]).has(data.action)) updates.reviewedByUserId = access.user.id;
          if (data.action === "PUBLISH") { updates.publishedByUserId = access.user.id; updates.publishedAt = new Date(); }
          if (transition.notes) updates.editorialFeedbackJson = { notes: transition.notes, byUserId: access.user.id, at: new Date().toISOString() };
          const updated = await tx.schoolNewsStory.update({ where: { id: current.id }, data: updates });
          await tx.newsStoryDecision.create({ data: { organisationId, storyId: current.id, action: data.action, fromStatus: current.status, toStatus: transition.status, note: transition.notes, actorUserId: access.user.id } });
          await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `ONLINE_NEWS_${data.action}`, entityType: "NewsStory", entityId: current.id, details: { fromStatus: current.status, toStatus: transition.status, sourceFingerprint: newsroomSourceFingerprint(Array.isArray(current.sourcesJson) ? current.sourcesJson : []), liveScheduleChanged: false, publicWebPublished: false, policyVersion: NEWSROOM_POLICY_VERSION, requestId } } });
          return updated;
        }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
      }
    }
    return NextResponse.json({ result, notice: data.action === "PUBLISH" ? "Story released by the newsroom. Live programming and public web pages were not changed." : "Newsroom action completed." }, { status: data.action === "CREATE" ? 201 : 200 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This newsroom revision was updated elsewhere. Refresh and try again." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The newsroom action could not be completed." }, { status: 409 });
  }
}
