export const MAX_EDITOR_CLIPS = 200;
export const MAX_EDITOR_MARKERS = 100;
export const MAX_PROJECT_MS = 12 * 60 * 60 * 1000;
export const MAX_HISTORY = 50;

export const MARKER_TYPES = Object.freeze([
  "INTRO", "INTERVIEW", "AD_PSA", "CHAPTER", "EDIT_NOTE", "TEACHER_FEEDBACK"
]);

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

export function clipDuration(clip) {
  return Math.max(0, Number(clip.sourceEndMs) - Number(clip.sourceStartMs));
}

export function timelineDuration(clips) {
  return Math.max(0, ...clips.map((clip) => Number(clip.timelineStartMs) + clipDuration(clip)));
}

export function reflowClips(clips) {
  let cursor = 0;
  return [...clips]
    .sort((left, right) => left.timelineStartMs - right.timelineStartMs)
    .map((clip) => {
      const next = { ...clip, timelineStartMs: cursor };
      cursor += clipDuration(next);
      return next;
    });
}

export function normalizeEditorState(value = {}) {
  const clips = Array.isArray(value.clips) ? value.clips.slice(0, MAX_EDITOR_CLIPS) : [];
  const cleanClips = clips.map((clip, index) => {
    const kind = clip.kind === "SILENCE" ? "SILENCE" : "SOURCE";
    const start = Math.round(clamp(clip.sourceStartMs, 0, MAX_PROJECT_MS - 1));
    const end = Math.round(clamp(clip.sourceEndMs, start + 1, MAX_PROJECT_MS));
    const duration = end - start;
    const mediaAssetId = kind === "SOURCE" ? String(clip.mediaAssetId || "") : null;
    if (kind === "SOURCE" && !mediaAssetId) throw new Error(`Clip ${index + 1} is missing its protected source.`);
    return {
      clientId: String(clip.clientId || `clip-${index + 1}`).slice(0, 80),
      kind,
      mediaAssetId,
      sourceStartMs: start,
      sourceEndMs: end,
      timelineStartMs: Math.round(clamp(clip.timelineStartMs, 0, MAX_PROJECT_MS - duration)),
      gainDb: clamp(clip.gainDb, -36, 18),
      fadeInMs: Math.round(clamp(clip.fadeInMs, 0, duration)),
      fadeOutMs: Math.round(clamp(clip.fadeOutMs, 0, duration)),
      fadeInCurve: ["linear", "log", "exp"].includes(clip.fadeInCurve) ? clip.fadeInCurve : "linear",
      fadeOutCurve: ["linear", "log", "exp"].includes(clip.fadeOutCurve) ? clip.fadeOutCurve : "linear",
      locked: clip.locked === true
    };
  });
  const markers = (Array.isArray(value.markers) ? value.markers : []).slice(0, MAX_EDITOR_MARKERS).map((marker, index) => ({
    clientId: String(marker.clientId || `marker-${index + 1}`).slice(0, 80),
    positionMs: Math.round(clamp(marker.positionMs, 0, MAX_PROJECT_MS)),
    type: MARKER_TYPES.includes(marker.type) ? marker.type : "EDIT_NOTE",
    label: String(marker.label || "Marker").trim().slice(0, 120) || "Marker"
  }));
  return {
    clips: cleanClips,
    markers,
    normalize: value.normalize !== false,
    targetLufs: [-24, -23, -18, -16, -14].includes(Number(value.targetLufs)) ? Number(value.targetLufs) : -16,
    noiseCleanup: value.noiseCleanup === true
  };
}

export function splitAt(clips, positionMs, idFactory = () => crypto.randomUUID()) {
  const position = Number(positionMs);
  const output = [];
  for (const clip of clips) {
    const local = position - clip.timelineStartMs;
    const duration = clipDuration(clip);
    if (local <= 0 || local >= duration || clip.locked) {
      output.push(clip);
      continue;
    }
    output.push(
      { ...clip, clientId: idFactory(), sourceEndMs: clip.sourceStartMs + local, fadeOutMs: 0 },
      { ...clip, clientId: idFactory(), sourceStartMs: clip.sourceStartMs + local, timelineStartMs: position, fadeInMs: 0 }
    );
  }
  return output;
}

export function deleteSelection(clips, startMs, endMs, ripple = true, idFactory = () => crypto.randomUUID()) {
  const start = Math.min(Number(startMs), Number(endMs));
  const end = Math.max(Number(startMs), Number(endMs));
  if (!(end > start)) return clips;
  const split = splitAt(splitAt(clips, start, idFactory), end, idFactory);
  const remaining = split.filter((clip) => {
    const clipEnd = clip.timelineStartMs + clipDuration(clip);
    return clip.locked || clipEnd <= start || clip.timelineStartMs >= end;
  });
  if (ripple) return reflowClips(remaining);
  return remaining.map((clip) => clip.timelineStartMs >= end && !clip.locked ? { ...clip, timelineStartMs: clip.timelineStartMs } : clip);
}

export function silenceSelection(clips, startMs, endMs, idFactory = () => crypto.randomUUID()) {
  const start = Math.min(Number(startMs), Number(endMs));
  const end = Math.max(Number(startMs), Number(endMs));
  if (!(end > start)) return clips;
  const without = deleteSelection(clips, start, end, false, idFactory);
  return [...without, {
    clientId: idFactory(), kind: "SILENCE", mediaAssetId: null, sourceStartMs: 0,
    sourceEndMs: end - start, timelineStartMs: start, gainDb: 0, fadeInMs: 0,
    fadeOutMs: 0, fadeInCurve: "linear", fadeOutCurve: "linear", locked: false
  }].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
}

export function trimToSelection(clips, startMs, endMs, idFactory = () => crypto.randomUUID()) {
  const start = Math.min(Number(startMs), Number(endMs));
  const end = Math.max(Number(startMs), Number(endMs));
  const split = splitAt(splitAt(clips, start, idFactory), end, idFactory);
  return reflowClips(split.filter((clip) => clip.timelineStartMs >= start && clip.timelineStartMs + clipDuration(clip) <= end));
}

export function duplicateSelection(clips, startMs, endMs, idFactory = () => crypto.randomUUID()) {
  const selected = trimToSelection(clips, startMs, endMs, idFactory).map((clip) => ({ ...clip, clientId: idFactory() }));
  return reflowClips([...clips, ...selected]);
}

export function adjustSelection(clips, startMs, endMs, changes) {
  const start = Math.min(Number(startMs), Number(endMs));
  const end = Math.max(Number(startMs), Number(endMs));
  return clips.map((clip) => {
    const clipEnd = clip.timelineStartMs + clipDuration(clip);
    if (clip.locked || clipEnd <= start || clip.timelineStartMs >= end) return clip;
    const duration = clipDuration(clip);
    return {
      ...clip,
      ...(changes.gainDb == null ? {} : { gainDb: clamp(changes.gainDb, -36, 18) }),
      ...(changes.fadeInMs == null ? {} : { fadeInMs: Math.round(clamp(changes.fadeInMs, 0, duration)) }),
      ...(changes.fadeOutMs == null ? {} : { fadeOutMs: Math.round(clamp(changes.fadeOutMs, 0, duration)) })
    };
  });
}

export function pushHistory(history, state) {
  return [...history, structuredClone(state)].slice(-MAX_HISTORY);
}

