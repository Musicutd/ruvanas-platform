import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { normalizeMultitrackState } from "@/lib/multitrack-studio.mjs";

export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE"), state: z.record(z.unknown()), reason: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("QUEUE_RENDER"), state: z.record(z.unknown()), preset: z.enum(["SCHOOL_RADIO_MP3", "SPEECH_MP3", "WAV_MASTER"]) }),
  z.object({ action: z.literal("APPROVE_OUTPUT"), renderId: z.string().cuid() })
]);

const include = {
  tracks: { orderBy: { order: "asc" }, include: { clips: { orderBy: { timelineStartMs: "asc" } } } },
  renders: { orderBy: { createdAt: "desc" }, take: 12, include: { outputMediaAsset: { select: { id: true, name: true, durationSeconds: true } }, outputPromoVersion: { select: { id: true, version: true, status: true, qcStatus: true, promoAssetId: true } } } }
};

async function findProject(projectId, organisationId) {
  return prisma.audioProject.findFirst({ where: { id: projectId, organisationId, type: "MULTITRACK", status: { not: "ARCHIVED" } }, include });
}

function serialize(project, canApprove) {
  return {
    id: project.id, title: project.title, status: project.status, currentVersion: project.currentVersion,
    programmeId: project.programmeId, episodeId: project.episodeId, studentGroupId: project.studentGroupId, canApprove,
    state: {
      mode: project.editDecision?.multitrack?.mode || "BEGINNER",
      ducking: project.editDecision?.multitrack?.ducking || { enabled: true, musicReductionDb: -12, attackMs: 120, releaseMs: 700 },
      master: project.editDecision?.multitrack?.master || { normalize: true, targetLufs: -16, limiter: true },
      tracks: project.tracks.map((track) => ({
        clientId: track.id, name: track.name, kind: track.kind, order: track.order, gainDb: track.gainDb, pan: track.pan,
        muted: track.muted, solo: track.solo, armed: track.armed, locked: track.locked,
        preset: track.effectChainJson?.preset || "NONE", automation: track.effectChainJson?.automation || [],
        clips: track.clips.map((clip) => ({ clientId: clip.id, kind: clip.kind, mediaAssetId: clip.mediaAssetId, sourceStartMs: clip.sourceStartMs, sourceEndMs: clip.sourceEndMs, timelineStartMs: clip.timelineStartMs, gainDb: clip.gainDb, fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs, fadeInCurve: clip.fadeInCurve, fadeOutCurve: clip.fadeOutCurve, locked: clip.locked }))
      }))
    },
    renders: project.renders.map((render) => ({ id: render.id, status: render.status, preset: render.preset, loudnessLufs: render.loudnessLufs, resultJson: render.resultJson, errorMessage: render.errorMessage, createdAt: render.createdAt, outputVersion: render.outputPromoVersion, streamUrl: render.outputMediaAsset ? `/api/media/${render.outputMediaAsset.id}/stream` : null }))
  };
}

async function validateSources(tx, organisationId, sourceIds) {
  if (!sourceIds.length) return;
  const assets = await tx.mediaAsset.findMany({ where: { id: { in: sourceIds }, status: "READY", OR: [{ organisationId }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }] }, include: { track: { select: { status: true, licenceExpiresAt: true } } } });
  const now = Date.now();
  const valid = assets.filter((asset) => asset.organisationId === organisationId || (asset.track?.status === "READY" && (!asset.track.licenceExpiresAt || asset.track.licenceExpiresAt.getTime() >= now)));
  if (new Set(valid.map((asset) => asset.id)).size !== sourceIds.length) throw new Error("One or more multitrack sources are unavailable or no longer licensed.");
}

async function invalidateApprovedOutputs(tx, projectId) {
  const approved = await tx.audioRender.findMany({ where: { projectId, outputPromoVersion: { is: { status: "APPROVED" } } }, select: { outputPromoVersionId: true, outputPromoVersion: { select: { promoAssetId: true } } } });
  const versionIds = approved.map((item) => item.outputPromoVersionId).filter(Boolean);
  if (!versionIds.length) return 0;
  await tx.promoVersion.updateMany({ where: { id: { in: versionIds } }, data: { status: "SUPERSEDED" } });
  await tx.promoAsset.updateMany({ where: { currentApprovedVersionId: { in: versionIds } }, data: { currentApprovedVersionId: null } });
  return versionIds.length;
}

async function saveSnapshot(tx, { project, userId, state, reason }) {
  const clean = normalizeMultitrackState(state);
  if (!clean.tracks.some((track) => track.clips.length)) throw new Error("Add at least one audio clip before saving the multitrack project.");
  const sourceIds = [...new Set(clean.tracks.flatMap((track) => track.clips.map((clip) => clip.mediaAssetId)))];
  await validateSources(tx, project.organisationId, sourceIds);
  const invalidatedApprovals = await invalidateApprovedOutputs(tx, project.id);
  await tx.audioTrack.deleteMany({ where: { projectId: project.id } });
  for (const track of clean.tracks) {
    await tx.audioTrack.create({ data: { projectId: project.id, kind: track.kind, name: track.name, order: track.order, gainDb: track.gainDb, pan: track.pan, muted: track.muted, solo: track.solo, armed: track.armed, locked: track.locked, effectChainJson: { preset: track.preset, automation: track.automation }, clips: { create: track.clips.map((clip) => ({ kind: clip.kind, mediaAssetId: clip.mediaAssetId, sourceStartMs: clip.sourceStartMs, sourceEndMs: clip.sourceEndMs, timelineStartMs: clip.timelineStartMs, gainDb: clip.gainDb, fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs, fadeInCurve: clip.fadeInCurve, fadeOutCurve: clip.fadeOutCurve, locked: clip.locked })) } } });
  }
  const nextVersion = project.currentVersion + 1;
  const editDecision = { ...project.editDecision, multitrack: { mode: clean.mode, ducking: clean.ducking, master: clean.master } };
  const version = await tx.audioProjectVersion.create({ data: { projectId: project.id, version: nextVersion, state: { title: project.title, multitrack: clean }, reason, createdByUserId: userId } });
  await tx.audioProject.update({ where: { id: project.id }, data: { currentVersion: nextVersion, editDecision, status: "READY" } });
  return { clean, version, invalidatedApprovals };
}

export async function GET(_request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const project = await findProject((await params).projectId, access.organisation.id);
  if (!project) return NextResponse.json({ error: "The multitrack project was not found." }, { status: 404 });
  return NextResponse.json(serialize(project, isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)));
}

export async function POST(request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The multitrack studio request is invalid." }, { status: 400 });
  const projectId = (await params).projectId;
  const project = await prisma.audioProject.findFirst({ where: { id: projectId, organisationId: access.organisation.id, type: "MULTITRACK", status: { not: "ARCHIVED" } } });
  if (!project) return NextResponse.json({ error: "The multitrack project was not found." }, { status: 404 });
  try {
    if (parsed.data.action === "APPROVE_OUTPUT") {
      if (!isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)) return NextResponse.json({ error: "An owner or manager must approve the final studio output." }, { status: 403 });
      const render = await prisma.audioRender.findFirst({ where: { id: parsed.data.renderId, projectId, organisationId: access.organisation.id, status: "SUCCEEDED", outputPromoVersionId: { not: null } }, include: { outputPromoVersion: { include: { processingJobs: { select: { status: true } } } } } });
      if (!render?.outputPromoVersion) return NextResponse.json({ error: "The completed output version was not found." }, { status: 404 });
      if (render.outputPromoVersion.status !== "IN_REVIEW" || render.outputPromoVersion.qcStatus !== "PASSED" || render.outputPromoVersion.processingJobs.some((job) => job.status === "FAILED")) throw new Error("The final output must pass audio validation before approval.");
      await prisma.$transaction(async (tx) => {
        await tx.promoVersion.updateMany({ where: { promoAssetId: render.outputPromoVersion.promoAssetId, status: "APPROVED", id: { not: render.outputPromoVersion.id } }, data: { status: "SUPERSEDED" } });
        await tx.promoVersion.update({ where: { id: render.outputPromoVersion.id }, data: { status: "APPROVED", reviewedById: access.user.id, reviewedAt: new Date(), qcNotes: "Approved from Multitrack Studio after server render and loudness validation." } });
        await tx.promoAsset.update({ where: { id: render.outputPromoVersion.promoAssetId }, data: { currentApprovedVersionId: render.outputPromoVersion.id } });
        await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "MULTITRACK_OUTPUT_APPROVED", entityType: "AudioRender", entityId: render.id, details: { projectId, version: render.outputPromoVersion.version } } });
      });
    } else {
      const saved = await prisma.$transaction((tx) => saveSnapshot(tx, { project, userId: access.user.id, state: parsed.data.state, reason: parsed.data.action === "QUEUE_RENDER" ? "Multitrack final render requested" : parsed.data.reason || "Multitrack autosave" }));
      if (parsed.data.action === "QUEUE_RENDER") {
        await prisma.$transaction([
          prisma.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: parsed.data.preset } }),
          prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "MULTITRACK_RENDER_QUEUED", entityType: "AudioProject", entityId: projectId, details: { version: saved.version.version, preset: parsed.data.preset, invalidatedApprovals: saved.invalidatedApprovals } } })
        ]);
      }
    }
    const updated = await findProject(projectId, access.organisation.id);
    return NextResponse.json(serialize(updated, isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The multitrack project could not be saved." }, { status: 409 });
  }
}
