import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { invalidatedRundownData, orderedPositions, transitionSchoolRundown, validateShowItem } from "@/lib/show-builder.mjs";
import { validateSchoolBroadcastSlot } from "@/lib/school-radio.mjs";

export const dynamic = "force-dynamic";

const itemFields = {
  type: z.enum(["MUSIC_TRACK", "JINGLE", "VOICE_TRACK", "INTERVIEW", "ANNOUNCEMENT", "SCRIPT_NOTE", "HARD_TIME", "FLEXIBLE_MARKER"]),
  label: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(2000).optional().nullable(),
  sourceMediaAssetId: z.string().cuid().optional().nullable(),
  sourceTrackId: z.string().cuid().optional().nullable(),
  sourcePromoVersionId: z.string().cuid().optional().nullable(),
  sourceAnnouncementId: z.string().cuid().optional().nullable(),
  sourceTakeId: z.string().cuid().optional().nullable(),
  estimatedDurationMs: z.number().int().min(1000).max(12 * 60 * 60 * 1000).optional().nullable(),
  introCueMs: z.number().int().min(0).max(60 * 60 * 1000).default(0),
  outroCueMs: z.number().int().min(0).max(60 * 60 * 1000).default(0),
  transitionPreset: z.enum(["CLEAN", "CROSSFADE", "DUCK_VOICE", "HARD_START"]).default("CLEAN"),
  cueOffsetMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional().nullable()
};

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_RUNDOWN"), episodeId: z.string().cuid() }),
  z.object({ action: z.literal("CREATE_VOICE_PROJECT"), rundownId: z.string().cuid(), title: z.string().trim().min(2).max(160) }),
  z.object({ action: z.literal("ADD_ITEM"), rundownId: z.string().cuid(), ...itemFields }),
  z.object({ action: z.literal("UPDATE_ITEM"), rundownId: z.string().cuid(), itemId: z.string().cuid(), ...itemFields }),
  z.object({ action: z.literal("REMOVE_ITEM"), rundownId: z.string().cuid(), itemId: z.string().cuid() }),
  z.object({ action: z.literal("MOVE_ITEM"), rundownId: z.string().cuid(), itemId: z.string().cuid(), direction: z.enum(["UP", "DOWN"]) }),
  z.object({ action: z.literal("SUBMIT"), rundownId: z.string().cuid() }),
  z.object({ action: z.literal("REVIEW"), rundownId: z.string().cuid(), decision: z.enum(["APPROVE", "REQUEST_CHANGES", "REJECT"]), notes: z.string().trim().max(2000).optional().nullable() }),
  z.object({ action: z.literal("SCHEDULE"), rundownId: z.string().cuid(), locationId: z.string().cuid().optional().nullable(), zoneId: z.string().cuid().optional().nullable(), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }) })
]);

const mediaSelect = { id: true, name: true, originalName: true, mimeType: true, durationSeconds: true, status: true };
const itemInclude = {
  sourceMediaAsset: { select: mediaSelect },
  sourceTrack: { select: { id: true, title: true, artist: true, mediaAsset: { select: mediaSelect } } },
  sourcePromoVersion: { select: { id: true, version: true, durationSeconds: true, mediaAsset: { select: mediaSelect }, promoAsset: { select: { name: true } } } },
  sourceAnnouncement: { select: { id: true, title: true, promoVersion: { select: { id: true, durationSeconds: true, mediaAsset: { select: mediaSelect } } } } },
  sourceTake: { select: { id: true, durationMs: true, promoVersionId: true, mediaAsset: { select: mediaSelect }, project: { select: { id: true, title: true } } } }
};
const rundownInclude = {
  episode: { select: { id: true, title: true, status: true, programmeId: true, programme: { select: { title: true } } } },
  createdBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  items: { orderBy: { position: "asc" }, include: itemInclude },
  _count: { select: { items: true } }
};

async function loadData(access) {
  const organisationId = access.organisation.id;
  const rightsDate = new Date(); rightsDate.setUTCHours(0, 0, 0, 0);
  const [episodes, tracks, jingles, announcements, takes, interviews, locations] = await Promise.all([
    prisma.schoolEpisode.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, programmeId: true, programme: { select: { title: true } }, rundown: { include: rundownInclude } } }),
    prisma.track.findMany({ where: { status: "READY", OR: [{ licenceExpiresAt: null }, { licenceExpiresAt: { gte: rightsDate } }], mediaAsset: { organisationId: null, libraryType: "RUVANAS_CATALOGUE", status: "READY" } }, orderBy: [{ artist: "asc" }, { title: "asc" }], take: 250, select: { id: true, title: true, artist: true, mediaAsset: { select: mediaSelect } } }),
    prisma.promoVersion.findMany({ where: { status: "APPROVED", promoAsset: { organisationId, status: "ACTIVE", mediaType: "JINGLE" }, mediaAsset: { organisationId, status: "READY" } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, version: true, durationSeconds: true, promoAsset: { select: { name: true, mediaType: true } }, mediaAsset: { select: mediaSelect } } }),
    prisma.schoolAnnouncement.findMany({ where: { organisationId, status: "APPROVED" }, orderBy: { title: "asc" }, select: { id: true, title: true, promoVersion: { select: { id: true, durationSeconds: true, mediaAsset: { select: mediaSelect } } } } }),
    prisma.audioTake.findMany({ where: { organisationId, status: "READY", project: { episodeId: { not: null }, status: { not: "ARCHIVED" } } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, durationMs: true, promoVersionId: true, project: { select: { id: true, title: true, episodeId: true } }, mediaAsset: { select: mediaSelect } } }),
    prisma.mediaAsset.findMany({ where: { organisationId, status: "READY", mediaType: { in: ["ANNOUNCEMENT", "VOICEOVER"] }, audioTakes: { none: {} }, promoVersions: { none: {} } }, orderBy: { createdAt: "desc" }, take: 100, select: mediaSelect }),
    prisma.location.findMany({ where: { organisationId, status: { not: "CLOSED" } }, orderBy: { name: "asc" }, select: { id: true, name: true, timezone: true, zones: { where: { status: { not: "OFFLINE" } }, orderBy: { name: "asc" }, select: { id: true, name: true } } } })
  ]);
  return { episodes, catalogue: { tracks, jingles, announcements, takes, interviews }, locations, role: access.membership.role, canManage: isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES) };
}

async function findRundown(id, organisationId, tx = prisma) {
  return tx.schoolRundown.findFirst({ where: { id, organisationId, status: { not: "ARCHIVED" } }, include: rundownInclude });
}

async function validatedItemData(values, rundown, organisationId, tx) {
  validateShowItem(values);
  const data = {
    type: values.type, label: values.label.trim(), notes: values.notes || null,
    sourceMediaAssetId: null, sourceTrackId: null, sourcePromoVersionId: null, sourceAnnouncementId: null, sourceTakeId: null,
    estimatedDurationMs: values.estimatedDurationMs || null, introCueMs: values.introCueMs || 0, outroCueMs: values.outroCueMs || 0,
    transitionPreset: values.transitionPreset || "CLEAN", cueOffsetMs: values.cueOffsetMs ?? null
  };
  if (values.type === "MUSIC_TRACK") {
    const rightsDate = new Date(); rightsDate.setUTCHours(0, 0, 0, 0);
    const source = await tx.track.findFirst({ where: { id: values.sourceTrackId, status: "READY", OR: [{ licenceExpiresAt: null }, { licenceExpiresAt: { gte: rightsDate } }], mediaAsset: { organisationId: null, libraryType: "RUVANAS_CATALOGUE", status: "READY" } }, select: { id: true, mediaAssetId: true, mediaAsset: { select: { durationSeconds: true } } } });
    if (!source) throw new Error("Choose an approved Ruvanas catalogue track.");
    Object.assign(data, { sourceTrackId: source.id, estimatedDurationMs: data.estimatedDurationMs || (source.mediaAsset.durationSeconds ? source.mediaAsset.durationSeconds * 1000 : null) });
  } else if (values.type === "JINGLE") {
    const source = await tx.promoVersion.findFirst({ where: { id: values.sourcePromoVersionId, status: "APPROVED", promoAsset: { organisationId, status: "ACTIVE" }, mediaAsset: { organisationId, status: "READY" } }, select: { id: true, durationSeconds: true, mediaAsset: { select: { durationSeconds: true } } } });
    if (!source) throw new Error("Choose an approved school jingle or ID.");
    Object.assign(data, { sourcePromoVersionId: source.id, estimatedDurationMs: data.estimatedDurationMs || ((source.durationSeconds || source.mediaAsset.durationSeconds) ? (source.durationSeconds || source.mediaAsset.durationSeconds) * 1000 : null) });
  } else if (values.type === "VOICE_TRACK") {
    const source = await tx.audioTake.findFirst({ where: { id: values.sourceTakeId, organisationId, status: "READY", project: { episodeId: rundown.episodeId } }, select: { id: true, durationMs: true } });
    if (!source) throw new Error("Choose a ready voice take recorded for this episode.");
    Object.assign(data, { sourceTakeId: source.id, estimatedDurationMs: data.estimatedDurationMs || source.durationMs });
  } else if (values.type === "INTERVIEW") {
    const source = await tx.mediaAsset.findFirst({ where: { id: values.sourceMediaAssetId, organisationId, status: "READY" }, select: { id: true, durationSeconds: true } });
    if (!source) throw new Error("Choose an available interview or feature recording.");
    Object.assign(data, { sourceMediaAssetId: source.id, estimatedDurationMs: data.estimatedDurationMs || (source.durationSeconds ? source.durationSeconds * 1000 : null) });
  } else if (values.type === "ANNOUNCEMENT") {
    const source = await tx.schoolAnnouncement.findFirst({ where: { id: values.sourceAnnouncementId, organisationId, status: "APPROVED" }, select: { id: true, promoVersion: { select: { durationSeconds: true, mediaAsset: { select: { durationSeconds: true } } } } } });
    if (!source) throw new Error("Choose an approved school announcement.");
    Object.assign(data, { sourceAnnouncementId: source.id, estimatedDurationMs: data.estimatedDurationMs || ((source.promoVersion.durationSeconds || source.promoVersion.mediaAsset.durationSeconds) ? (source.promoVersion.durationSeconds || source.promoVersion.mediaAsset.durationSeconds) * 1000 : null) });
  }
  return data;
}

async function invalidateForEdit(tx, rundown) {
  if (rundown.status === "APPROVED") {
    await tx.schoolEpisode.updateMany({ where: { id: rundown.episodeId, organisationId: rundown.organisationId, status: "APPROVED" }, data: { status: "CHANGES_REQUESTED", approvedAt: null } });
  }
  await tx.schoolRundown.update({ where: { id: rundown.id }, data: invalidatedRundownData(rundown) });
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json(await loadData(access));
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The Show Builder request is incomplete or invalid." }, { status: 400 });
  const input = parsed.data;
  const organisationId = access.organisation.id;
  try {
    if (input.action === "CREATE_RUNDOWN") {
      const episode = await prisma.schoolEpisode.findFirst({ where: { id: input.episodeId, organisationId, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } }, select: { id: true } });
      if (!episode) throw new Error("Choose a draft or returned episode from this school.");
      const rundown = await prisma.$transaction(async (tx) => {
        const created = await tx.schoolRundown.create({ data: { organisationId, episodeId: episode.id, createdByUserId: access.user.id }, include: rundownInclude });
        await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "SCHOOL_RUNDOWN_CREATED", entityType: "SchoolRundown", entityId: created.id, details: { episodeId: episode.id, revision: 1 } } });
        return created;
      });
      return NextResponse.json({ rundown }, { status: 201 });
    }

    const rundown = await findRundown(input.rundownId, organisationId);
    if (!rundown) return NextResponse.json({ error: "The episode rundown was not found." }, { status: 404 });
    if (["SUBMIT", "ADD_ITEM", "UPDATE_ITEM", "REMOVE_ITEM", "MOVE_ITEM"].includes(input.action) && rundown.status === "IN_REVIEW") throw new Error("This rundown is awaiting staff review.");

    if (input.action === "CREATE_VOICE_PROJECT") {
      const editDecision = { trimStartMs: 0, trimEndMs: null, fadeInMs: 0, fadeOutMs: 0, normalize: true, targetLufs: -16, noiseCleanup: false };
      const project = await prisma.$transaction(async (tx) => {
        const created = await tx.audioProject.create({ data: { organisationId, programmeId: rundown.episode.programmeId, episodeId: rundown.episodeId, title: input.title, type: "VOICE_TRACK", editDecision, createdByUserId: access.user.id } });
        await tx.audioProjectVersion.create({ data: { projectId: created.id, version: 1, state: { title: created.title, type: "VOICE_TRACK", editDecision }, reason: "Voice-track project created", createdByUserId: access.user.id } });
        await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "VOICE_TRACK_PROJECT_CREATED", entityType: "AudioProject", entityId: created.id, details: { episodeId: rundown.episodeId, rundownId: rundown.id } } });
        return created;
      });
      return NextResponse.json({ project }, { status: 201 });
    }

    if (input.action === "ADD_ITEM" || input.action === "UPDATE_ITEM") {
      await prisma.$transaction(async (tx) => {
        const data = await validatedItemData(input, rundown, organisationId, tx);
        await invalidateForEdit(tx, rundown);
        if (input.action === "ADD_ITEM") await tx.schoolRundownItem.create({ data: { rundownId: rundown.id, position: rundown.items.length, ...data } });
        else {
          const item = rundown.items.find((candidate) => candidate.id === input.itemId);
          if (!item) throw new Error("The rundown item was not found.");
          await tx.schoolRundownItem.update({ where: { id: item.id }, data });
        }
      });
    } else if (input.action === "REMOVE_ITEM") {
      await prisma.$transaction(async (tx) => {
        const item = rundown.items.find((candidate) => candidate.id === input.itemId);
        if (!item) throw new Error("The rundown item was not found.");
        await invalidateForEdit(tx, rundown);
        await tx.schoolRundownItem.delete({ where: { id: item.id } });
        const remaining = rundown.items.filter((candidate) => candidate.id !== item.id).sort((left, right) => left.position - right.position);
        await tx.schoolRundownItem.updateMany({ where: { rundownId: rundown.id }, data: { position: { increment: 10000 } } });
        for (const [position, candidate] of remaining.entries()) await tx.schoolRundownItem.update({ where: { id: candidate.id }, data: { position } });
      });
    } else if (input.action === "MOVE_ITEM") {
      await prisma.$transaction(async (tx) => {
        const positions = orderedPositions(rundown.items, input.itemId, input.direction);
        await invalidateForEdit(tx, rundown);
        await tx.schoolRundownItem.updateMany({ where: { rundownId: rundown.id }, data: { position: { increment: 10000 } } });
        for (const item of positions) await tx.schoolRundownItem.update({ where: { id: item.id }, data: { position: item.position } });
      });
    } else if (input.action === "SUBMIT") {
      const transition = transitionSchoolRundown({ currentStatus: rundown.status, action: "SUBMIT", items: rundown.items });
      await prisma.$transaction([
        prisma.schoolRundown.update({ where: { id: rundown.id }, data: transition }),
        prisma.schoolEpisode.update({ where: { id: rundown.episodeId }, data: { status: "IN_REVIEW", submittedAt: new Date(), approvedAt: null } }),
        prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "SCHOOL_RUNDOWN_SUBMITTED", entityType: "SchoolRundown", entityId: rundown.id, details: { episodeId: rundown.episodeId, revision: rundown.revision, itemCount: rundown.items.length } } })
      ]);
    } else if (input.action === "REVIEW") {
      if (!isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)) return NextResponse.json({ error: "A school manager must review this rundown." }, { status: 403 });
      const transition = transitionSchoolRundown({ currentStatus: rundown.status, action: input.decision, notes: input.notes, items: rundown.items });
      const status = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "REJECTED";
      await prisma.$transaction([
        prisma.schoolRundown.update({ where: { id: rundown.id }, data: { ...transition, reviewedByUserId: access.user.id, ...(input.decision === "APPROVE" ? { approvedRevision: rundown.revision } : {}) } }),
        prisma.schoolEpisode.update({ where: { id: rundown.episodeId }, data: { status, approvedAt: input.decision === "APPROVE" ? new Date() : null } }),
        prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `SCHOOL_RUNDOWN_${input.decision}`, entityType: "SchoolRundown", entityId: rundown.id, details: { episodeId: rundown.episodeId, revision: rundown.revision, notes: input.notes || null } } })
      ]);
    } else if (input.action === "SCHEDULE") {
      if (!isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)) return NextResponse.json({ error: "A school manager must schedule this episode." }, { status: 403 });
      if (rundown.status !== "APPROVED" || rundown.approvedRevision !== rundown.revision || rundown.episode.status !== "APPROVED") throw new Error("Approve the current rundown revision before scheduling it.");
      const slotInput = validateSchoolBroadcastSlot(input);
      if (slotInput.startsAt < new Date(Date.now() - 5 * 60 * 1000)) throw new Error("Schedule the episode for the present or future.");
      const [location, zone, overlap] = await Promise.all([
        slotInput.locationId ? prisma.location.findFirst({ where: { id: slotInput.locationId, organisationId, status: { not: "CLOSED" } }, select: { id: true } }) : null,
        slotInput.zoneId ? prisma.zone.findFirst({ where: { id: slotInput.zoneId, location: { organisationId }, status: { not: "OFFLINE" } }, select: { id: true } }) : null,
        prisma.schoolBroadcastSlot.findFirst({ where: { organisationId, status: "APPROVED", ...(slotInput.locationId ? { locationId: slotInput.locationId } : { zoneId: slotInput.zoneId }), startsAt: { lt: slotInput.endsAt }, endsAt: { gt: slotInput.startsAt } }, select: { id: true } })
      ]);
      if ((slotInput.locationId && !location) || (slotInput.zoneId && !zone)) throw new Error("The selected school location or zone is unavailable.");
      if (overlap) throw new Error("That target already has an approved School Radio slot during this time.");
      const slot = await prisma.$transaction(async (tx) => {
        const created = await tx.schoolBroadcastSlot.create({ data: { organisationId, episodeId: rundown.episodeId, ...slotInput, approvedByUserId: access.user.id } });
        await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: "SCHOOL_EPISODE_SLOT_APPROVED", entityType: "SchoolBroadcastSlot", entityId: created.id, details: { episodeId: rundown.episodeId, rundownId: rundown.id, revision: rundown.revision } } });
        return created;
      });
      return NextResponse.json({ slot }, { status: 201 });
    }
    const updated = await findRundown(rundown.id, organisationId);
    return NextResponse.json({ rundown: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The Show Builder action could not be completed." }, { status: 409 });
  }
}

