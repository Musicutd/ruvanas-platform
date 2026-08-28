import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { normalizeEditorState } from "@/lib/waveform-editor.mjs";

export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("INITIALIZE"), takeId: z.string().cuid() }),
  z.object({ action: z.literal("SAVE"), state: z.record(z.unknown()), reason: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("QUEUE_RENDER"), state: z.record(z.unknown()), preset: z.enum(["SCHOOL_RADIO_MP3", "SPEECH_MP3", "WAV_MASTER"]) })
]);

const editorInclude = {
  takes: {
    where: { status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, durationMs: true, status: true, waveformStatus: true,
      waveformPeaks: true, waveformGeneratedAt: true,
      mediaAsset: { select: { id: true, name: true, originalName: true, mimeType: true, durationSeconds: true } }
    }
  },
  tracks: {
    orderBy: { order: "asc" },
    include: { clips: { orderBy: { timelineStartMs: "asc" } } }
  },
  markers: { orderBy: { positionMs: "asc" } },
  renders: {
    orderBy: { createdAt: "desc" }, take: 10,
    include: { outputMediaAsset: { select: { id: true, name: true, durationSeconds: true } } }
  }
};

async function findProject(projectId, organisationId) {
  return prisma.audioProject.findFirst({
    where: { id: projectId, organisationId, status: { not: "ARCHIVED" } },
    include: editorInclude
  });
}

function serialize(project) {
  return {
    id: project.id,
    title: project.title,
    currentVersion: project.currentVersion,
    status: project.status,
    takes: project.takes,
    state: {
      clips: project.tracks.flatMap((track) => track.clips.map((clip) => ({
        clientId: clip.id, kind: clip.kind, mediaAssetId: clip.mediaAssetId,
        sourceStartMs: clip.sourceStartMs, sourceEndMs: clip.sourceEndMs,
        timelineStartMs: clip.timelineStartMs, gainDb: clip.gainDb,
        fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs,
        fadeInCurve: clip.fadeInCurve, fadeOutCurve: clip.fadeOutCurve, locked: clip.locked
      }))),
      markers: project.markers.map((marker) => ({ clientId: marker.id, positionMs: marker.positionMs, type: marker.type, label: marker.label })),
      normalize: project.editDecision?.normalize !== false,
      targetLufs: project.editDecision?.targetLufs ?? -16,
      noiseCleanup: project.editDecision?.noiseCleanup === true
    },
    renders: project.renders.map((render) => ({
      id: render.id, status: render.status, preset: render.preset, loudnessLufs: render.loudnessLufs,
      resultJson: render.resultJson, errorMessage: render.errorMessage, createdAt: render.createdAt,
      streamUrl: render.outputMediaAsset ? `/api/media/${render.outputMediaAsset.id}/stream` : null
    }))
  };
}

export async function GET(_request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const project = await findProject((await params).projectId, access.organisation.id);
  if (!project) return NextResponse.json({ error: "The AudioLab project was not found." }, { status: 404 });
  return NextResponse.json(serialize(project));
}

async function saveSnapshot(tx, { project, userId, state, reason }) {
  const clean = normalizeEditorState(state);
  const sourceIds = [...new Set(clean.clips.filter((clip) => clip.kind === "SOURCE").map((clip) => clip.mediaAssetId))];
  const owned = sourceIds.length ? await tx.mediaAsset.count({ where: { id: { in: sourceIds }, organisationId: project.organisationId, status: { in: ["READY", "PROCESSING"] } } }) : 0;
  if (owned !== sourceIds.length) throw new Error("One or more clip sources are unavailable to this school.");

  await tx.audioTrack.deleteMany({ where: { projectId: project.id } });
  await tx.audioMarker.deleteMany({ where: { projectId: project.id } });
  const track = await tx.audioTrack.create({ data: { projectId: project.id, name: "Programme timeline", kind: "MIXED", order: 0 } });
  if (clean.clips.length) {
    await tx.audioClip.createMany({ data: clean.clips.map((clip) => ({
      trackId: track.id, kind: clip.kind, mediaAssetId: clip.mediaAssetId,
      sourceStartMs: clip.sourceStartMs, sourceEndMs: clip.sourceEndMs,
      timelineStartMs: clip.timelineStartMs, gainDb: clip.gainDb,
      fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs,
      fadeInCurve: clip.fadeInCurve, fadeOutCurve: clip.fadeOutCurve, locked: clip.locked
    })) });
  }
  if (clean.markers.length) {
    await tx.audioMarker.createMany({ data: clean.markers.map((marker) => ({
      projectId: project.id, positionMs: marker.positionMs, type: marker.type,
      label: marker.label, createdByUserId: userId
    })) });
  }
  const nextVersion = project.currentVersion + 1;
  const snapshot = { editor: clean, title: project.title, editDecision: { ...project.editDecision, normalize: clean.normalize, targetLufs: clean.targetLufs, noiseCleanup: clean.noiseCleanup } };
  const version = await tx.audioProjectVersion.create({ data: { projectId: project.id, version: nextVersion, state: snapshot, reason, createdByUserId: userId } });
  await tx.audioProject.update({ where: { id: project.id }, data: { currentVersion: nextVersion, editDecision: snapshot.editDecision, status: "READY" } });
  return { clean, version };
}

export async function POST(request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The waveform editor request is invalid." }, { status: 400 });
  const projectId = (await params).projectId;
  const project = await prisma.audioProject.findFirst({ where: { id: projectId, organisationId: access.organisation.id, status: { not: "ARCHIVED" } } });
  if (!project) return NextResponse.json({ error: "The AudioLab project was not found." }, { status: 404 });
  try {
    if (parsed.data.action === "INITIALIZE") {
      const take = await prisma.audioTake.findFirst({ where: { id: parsed.data.takeId, projectId, organisationId: access.organisation.id, status: { in: ["READY", "PROCESSING"] } }, include: { mediaAsset: true } });
      if (!take) return NextResponse.json({ error: "Choose an available source take from this project." }, { status: 404 });
      const durationMs = take.durationMs || (take.mediaAsset.durationSeconds ? take.mediaAsset.durationSeconds * 1000 : 0);
      if (!durationMs) return NextResponse.json({ error: "This take is still being analysed. Try again shortly." }, { status: 409 });
      const state = { clips: [{ clientId: `take-${take.id}`, kind: "SOURCE", mediaAssetId: take.mediaAssetId, sourceStartMs: 0, sourceEndMs: durationMs, timelineStartMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 0, fadeInCurve: "linear", fadeOutCurve: "linear", locked: false }], markers: [], normalize: true, targetLufs: -16, noiseCleanup: false };
      await prisma.$transaction((tx) => saveSnapshot(tx, { project, userId: access.user.id, state, reason: "Waveform editor initialized" }));
    } else {
      const saved = await prisma.$transaction((tx) => saveSnapshot(tx, { project, userId: access.user.id, state: parsed.data.state, reason: parsed.data.action === "QUEUE_RENDER" ? "Final render requested" : parsed.data.reason || "Waveform editor save" }));
      if (parsed.data.action === "QUEUE_RENDER") {
        await prisma.audioRender.create({ data: { organisationId: access.organisation.id, projectId, versionId: saved.version.id, requestedByUserId: access.user.id, preset: parsed.data.preset } });
        await prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "AUDIO_RENDER_QUEUED", entityType: "AudioProject", entityId: projectId, details: { version: saved.version.version, preset: parsed.data.preset } } });
      }
    }
    const updated = await findProject(projectId, access.organisation.id);
    return NextResponse.json(serialize(updated));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The waveform project could not be saved." }, { status: 409 });
  }
}

