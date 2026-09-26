import { prisma } from "@/lib/prisma";
import { normalizeEditorState, waveformUsesProFeatures } from "@/lib/waveform-editor.mjs";
import { normalizeVoiceCleanup } from "@/lib/voice-cleanup.mjs";
import { normalizeStudioEffects, normalizeStudioMastering } from "@/lib/studio-effects-mastering.mjs";

export const studioWaveformEditorInclude = {
  takes: { where: { status: { not: "ARCHIVED" }, trashedAt: null }, orderBy: { createdAt: "desc" }, select: {
    id: true, durationMs: true, status: true, waveformStatus: true, waveformPeaks: true, waveformGeneratedAt: true,
    mediaAsset: { select: { id: true, name: true, originalName: true, mimeType: true, durationSeconds: true } }
  } },
  tracks: { orderBy: { order: "asc" }, include: { clips: { orderBy: { timelineStartMs: "asc" } } } },
  markers: { orderBy: { positionMs: "asc" } },
  renders: { orderBy: { createdAt: "desc" }, take: 10, include: { outputMediaAsset: { select: { id: true, name: true, durationSeconds: true } } } }
};

export async function findStudioWaveformProject(projectId, organisationId) {
  return prisma.audioProject.findFirst({ where: { id: projectId, organisationId, status: { not: "ARCHIVED" } }, include: studioWaveformEditorInclude });
}

export function serializeStudioWaveformProject(project, entitlements, { restrictedMediaPath = null } = {}) {
  return {
    id: project.id, title: project.title, currentVersion: project.currentVersion, status: project.status,
    studioLevel: entitlements.studioLevel, studioProEnabled: entitlements.studioProEnabled,
    restrictedReadOnly: !entitlements.studioProEnabled && waveformUsesProFeatures({ clips: project.tracks.flatMap((track) => track.clips), markers: project.markers }),
    takes: project.takes, state: {
      clips: project.tracks.flatMap((track) => track.clips.map((clip) => ({
        clientId: clip.id, kind: clip.kind, mediaAssetId: clip.mediaAssetId, sourceStartMs: clip.sourceStartMs,
        sourceEndMs: clip.sourceEndMs, timelineStartMs: clip.timelineStartMs, gainDb: clip.gainDb,
        fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs, fadeInCurve: clip.fadeInCurve,
        fadeOutCurve: clip.fadeOutCurve, locked: clip.locked
      }))),
      markers: project.markers.map((marker) => ({ clientId: marker.id, positionMs: marker.positionMs, type: marker.type, label: marker.label })),
      normalize: project.editDecision?.normalize !== false, targetLufs: project.editDecision?.targetLufs ?? -16,
      noiseCleanup: project.editDecision?.noiseCleanup === true,
      voiceCleanup: normalizeVoiceCleanup(project.editDecision?.voiceCleanup, project.editDecision?.noiseCleanup === true),
      effects: normalizeStudioEffects(project.editDecision?.effects),
      mastering: normalizeStudioMastering(project.editDecision?.mastering, project.editDecision || {})
    },
    renders: project.renders.map((render) => ({
      id: render.id, status: render.status, preset: render.preset, loudnessLufs: render.loudnessLufs,
      resultJson: render.resultJson, errorMessage: render.errorMessage, createdAt: render.createdAt,
      streamUrl: render.outputMediaAsset ? restrictedMediaPath ? `${restrictedMediaPath}/${render.outputMediaAsset.id}` : `/api/media/${render.outputMediaAsset.id}/stream` : null
    }))
  };
}

export async function saveStudioWaveformSnapshot(tx, { project, userId, state, reason, allowedSourceIds = null }) {
  const clean = normalizeEditorState(state);
  const sourceIds = [...new Set(clean.clips.filter((clip) => clip.kind === "SOURCE").map((clip) => clip.mediaAssetId))];
  if (allowedSourceIds && sourceIds.some((id) => !allowedSourceIds.has(id))) throw new Error("Only recordings from this supervised project may be edited.");
  const owned = sourceIds.length ? await tx.mediaAsset.count({ where: { id: { in: sourceIds }, organisationId: project.organisationId, status: { in: ["READY", "PROCESSING"] }, audioTakes: { none: { trashedAt: { not: null } } } } }) : 0;
  if (owned !== sourceIds.length) throw new Error("One or more clip sources are unavailable to this organisation.");

  await tx.audioTrack.deleteMany({ where: { projectId: project.id } });
  await tx.audioMarker.deleteMany({ where: { projectId: project.id } });
  const track = await tx.audioTrack.create({ data: { projectId: project.id, name: "Programme timeline", kind: "MIXED", order: 0 } });
  if (clean.clips.length) await tx.audioClip.createMany({ data: clean.clips.map((clip) => ({
    trackId: track.id, kind: clip.kind, mediaAssetId: clip.mediaAssetId,
    sourceStartMs: clip.sourceStartMs, sourceEndMs: clip.sourceEndMs, timelineStartMs: clip.timelineStartMs,
    gainDb: clip.gainDb, fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs,
    fadeInCurve: clip.fadeInCurve, fadeOutCurve: clip.fadeOutCurve, locked: clip.locked
  })) });
  if (clean.markers.length) await tx.audioMarker.createMany({ data: clean.markers.map((marker) => ({
    projectId: project.id, positionMs: marker.positionMs, type: marker.type, label: marker.label, createdByUserId: userId
  })) });
  const nextVersion = project.currentVersion + 1;
  const snapshot = { editor: clean, title: project.title, editDecision: { ...project.editDecision, normalize: clean.mastering.enabled, targetLufs: clean.mastering.targetLufs, noiseCleanup: clean.noiseCleanup, voiceCleanup: clean.voiceCleanup, effects: clean.effects, mastering: clean.mastering } };
  const version = await tx.audioProjectVersion.create({ data: { projectId: project.id, version: nextVersion, state: snapshot, reason, createdByUserId: userId } });
  await tx.audioProject.update({ where: { id: project.id }, data: { currentVersion: nextVersion, editDecision: snapshot.editDecision, status: "READY" } });
  return { clean, version };
}
