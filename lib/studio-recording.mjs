export const STUDIO_CLIP_WARNING_LEVEL = 0.88;
export const MAX_STUDIO_RECORDING_MS = 12 * 60 * 60 * 1000;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

export function studioMeterState(level) {
  const value = clamp(level, 0, 1);
  return {
    value,
    percent: Math.round(value * 100),
    clipping: value >= STUDIO_CLIP_WARNING_LEVEL,
    tone: value >= STUDIO_CLIP_WARNING_LEVEL ? "CLIPPING" : value >= 0.65 ? "STRONG" : "SAFE"
  };
}

export function timelineEndMs(clips = []) {
  return clips.reduce((end, clip) => Math.max(
    end,
    Math.max(0, Number(clip.timelineStartMs) || 0) + Math.max(0, (Number(clip.sourceEndMs) || 0) - (Number(clip.sourceStartMs) || 0))
  ), 0);
}

export function recordedClipData({ mediaAssetId, durationMs, clips = [] }) {
  const duration = Math.round(clamp(durationMs, 1, MAX_STUDIO_RECORDING_MS));
  if (!mediaAssetId) throw new Error("The protected recording source is required.");
  return {
    kind: "SOURCE",
    mediaAssetId,
    sourceStartMs: 0,
    sourceEndMs: duration,
    timelineStartMs: timelineEndMs(clips),
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    fadeInCurve: "linear",
    fadeOutCurve: "linear",
    locked: false
  };
}
