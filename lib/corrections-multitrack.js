import { normalizeMultitrackState, studioMultitrackTrackLimit } from "@/lib/multitrack-studio.mjs";

export const correctionsMultitrackInclude = {
  tracks: { orderBy: { order: "asc" }, include: { clips: { orderBy: { timelineStartMs: "asc" } } } },
  renders: { orderBy: { createdAt: "desc" }, take: 12, include: { outputMediaAsset: { select: { id: true } }, outputPromoVersion: { select: { id: true, version: true, status: true, qcStatus: true } } } }
};

export function serializeCorrectionsMultitrack(project, entitlements) {
  return {
    id: project.id, title: project.title, status: project.status, currentVersion: project.currentVersion,
    canApprove: false, trackLimit: studioMultitrackTrackLimit(entitlements), studioLevel: entitlements.studioLevel,
    studioProEnabled: entitlements.studioProEnabled, restrictedReadOnly: false,
    state: {
      mode: project.editDecision?.multitrack?.mode || "BEGINNER",
      ducking: project.editDecision?.multitrack?.ducking || { enabled: true, musicReductionDb: -12, attackMs: 120, releaseMs: 700 },
      master: project.editDecision?.multitrack?.master || { normalize: true, targetLufs: -16, limiter: true },
      tracks: project.tracks.map((track) => ({
        clientId: track.id, name: track.name, kind: track.kind, order: track.order, gainDb: track.gainDb, pan: track.pan,
        muted: track.muted, solo: track.solo, armed: track.armed, locked: track.locked,
        preset: track.effectChainJson?.preset || "NONE", automation: track.effectChainJson?.automation || [],
        clips: track.clips.map((clip) => ({ clientId: clip.id, kind: clip.kind, mediaAssetId: clip.mediaAssetId,
          sourceStartMs: clip.sourceStartMs, sourceEndMs: clip.sourceEndMs, timelineStartMs: clip.timelineStartMs,
          gainDb: clip.gainDb, fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs, fadeInCurve: clip.fadeInCurve,
          fadeOutCurve: clip.fadeOutCurve, locked: clip.locked }))
      }))
    },
    renders: project.renders.map((render) => ({ id: render.id, status: render.status, preset: render.preset,
      loudnessLufs: render.loudnessLufs, resultJson: render.resultJson, errorMessage: render.errorMessage,
      createdAt: render.createdAt, outputVersion: render.outputPromoVersion,
      streamUrl: render.outputMediaAsset ? `/api/corrections/contributor/media/${render.outputMediaAsset.id}` : null }))
  };
}

export async function saveCorrectionsMultitrack(tx, { project, state, session, entitlements, reason }) {
  const trackLimit = studioMultitrackTrackLimit(entitlements);
  if (Array.isArray(state?.tracks) && state.tracks.length > trackLimit) throw new Error("The project exceeds its track limit.");
  const clean = normalizeMultitrackState(state, { maxTracks: trackLimit });
  if (!clean.tracks.some((track) => track.clips.length)) throw new Error("Add a recording clip before saving.");
  const sourceIds = [...new Set(clean.tracks.flatMap((track) => track.clips.map((clip) => clip.mediaAssetId)))];
  const takes = await tx.audioTake.findMany({ where: { projectId: project.id, organisationId: session.organisationId,
    trashedAt: null, status: "READY", mediaAsset: { id: { in: sourceIds }, status: "READY" } },
    select: { mediaAssetId: true, durationMs: true, mediaAsset: { select: { durationSeconds: true } } } });
  const sourceMap = new Map(takes.map((take) => [take.mediaAssetId, take]));
  const outsideSource = clean.tracks.some((track) => track.clips.some((clip) => {
    const source = sourceMap.get(clip.mediaAssetId);
    return clip.sourceEndMs > (source?.durationMs || (source?.mediaAsset.durationSeconds || 0) * 1000);
  }));
  if (sourceMap.size !== sourceIds.length || outsideSource) {
    throw new Error("A clip is outside this supervised project's approved recordings.");
  }
  await tx.audioTrack.deleteMany({ where: { projectId: project.id } });
  for (const track of clean.tracks) await tx.audioTrack.create({ data: { projectId: project.id, kind: track.kind, name: track.name,
    order: track.order, gainDb: track.gainDb, pan: track.pan, muted: track.muted, solo: track.solo, armed: track.armed,
    locked: track.locked, effectChainJson: { preset: track.preset, automation: track.automation },
    clips: { create: track.clips.map((clip) => ({ kind: clip.kind, mediaAssetId: clip.mediaAssetId,
      sourceStartMs: clip.sourceStartMs, sourceEndMs: clip.sourceEndMs, timelineStartMs: clip.timelineStartMs,
      gainDb: clip.gainDb, fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs, fadeInCurve: clip.fadeInCurve,
      fadeOutCurve: clip.fadeOutCurve, locked: clip.locked })) } } });
  const version = await tx.audioProjectVersion.create({ data: { projectId: project.id, version: project.currentVersion + 1,
    state: { title: project.title, multitrack: clean }, reason, createdByUserId: session.supervisorUserId } });
  await tx.audioProject.update({ where: { id: project.id }, data: { currentVersion: version.version,
    editDecision: { ...project.editDecision, multitrack: { mode: clean.mode, ducking: clean.ducking, master: clean.master } }, status: "READY" } });
  return version;
}
