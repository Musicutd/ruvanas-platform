import { clipDuration, MAX_PROJECT_MS } from "./waveform-editor.mjs";
import { normalizeStudioEffects, normalizeStudioMastering } from "./studio-effects-mastering.mjs";

export const MAX_MULTITRACK_TRACKS = 16;
export const BASIC_MULTITRACK_TRACKS = 8;
export const MAX_CLIPS_PER_TRACK = 100;
export const MAX_AUTOMATION_POINTS = 100;
export const MAX_CROSSFADE_MS = 10_000;

export const TRACK_KINDS = Object.freeze(["VOICE", "MUSIC", "EFFECT", "MIXED"]);
export const EFFECT_PRESETS = Object.freeze(["NONE", "SPEECH_CLEANUP", "PODCAST_VOICE", "RADIO_VOICE", "BROADCAST_VOICE", "PROMO_VOICE", "TELEPHONE_VOICE", "WARM_VOICE", "CLEAN_INTERVIEW"]);
export const AUTOMATION_PARAMETERS = Object.freeze(["GAIN"]);

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const identifier = (value, fallback) => String(value || fallback).trim().slice(0, 80);

function normalizeClip(value, trackIndex, clipIndex) {
  const sourceStartMs = Math.round(clamp(value?.sourceStartMs, 0, MAX_PROJECT_MS - 1));
  const sourceEndMs = Math.round(clamp(value?.sourceEndMs, sourceStartMs + 1, MAX_PROJECT_MS));
  const duration = sourceEndMs - sourceStartMs;
  const mediaAssetId = String(value?.mediaAssetId || "").trim();
  if (!mediaAssetId) throw new Error(`Track ${trackIndex + 1}, clip ${clipIndex + 1} is missing its protected source.`);
  return {
    clientId: identifier(value?.clientId, `track-${trackIndex + 1}-clip-${clipIndex + 1}`),
    kind: "SOURCE",
    mediaAssetId,
    sourceStartMs,
    sourceEndMs,
    timelineStartMs: Math.round(clamp(value?.timelineStartMs, 0, MAX_PROJECT_MS - duration)),
    gainDb: clamp(value?.gainDb, -36, 18),
    fadeInMs: Math.round(clamp(value?.fadeInMs, 0, duration)),
    fadeOutMs: Math.round(clamp(value?.fadeOutMs, 0, duration)),
    fadeInCurve: ["linear", "log", "exp"].includes(value?.fadeInCurve) ? value.fadeInCurve : "linear",
    fadeOutCurve: ["linear", "log", "exp"].includes(value?.fadeOutCurve) ? value.fadeOutCurve : "linear",
    locked: value?.locked === true
  };
}

function normalizeAutomation(value, trackIndex) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_AUTOMATION_POINTS).map((point, pointIndex) => ({
    clientId: identifier(point?.clientId, `track-${trackIndex + 1}-automation-${pointIndex + 1}`),
    parameter: AUTOMATION_PARAMETERS.includes(point?.parameter) ? point.parameter : "GAIN",
    timeMs: Math.round(clamp(point?.timeMs, 0, MAX_PROJECT_MS)),
    value: clamp(point?.value, -36, 18)
  })).sort((left, right) => left.timeMs - right.timeMs);
}

export function studioMultitrackTrackLimit(entitlements = {}) {
  const planCode = String(entitlements?.planCode || "").trim().toUpperCase();
  return planCode === "SCHOOL_ACADEMY" || planCode === "SCHOOL_ENTERPRISE" || Number(entitlements?.stationLimit) >= 10
    ? MAX_MULTITRACK_TRACKS
    : BASIC_MULTITRACK_TRACKS;
}

function requestedTrackLimit(options = {}) {
  return Math.round(clamp(options.maxTracks ?? MAX_MULTITRACK_TRACKS, 1, MAX_MULTITRACK_TRACKS));
}

export function normalizeMultitrackState(value = {}, options = {}) {
  const tracks = (Array.isArray(value.tracks) ? value.tracks : []).slice(0, requestedTrackLimit(options)).map((track, trackIndex) => ({
    clientId: identifier(track?.clientId, `track-${trackIndex + 1}`),
    name: String(track?.name || `Track ${trackIndex + 1}`).trim().slice(0, 120) || `Track ${trackIndex + 1}`,
    kind: TRACK_KINDS.includes(track?.kind) ? track.kind : "VOICE",
    order: trackIndex,
    gainDb: clamp(track?.gainDb, -36, 12),
    pan: clamp(track?.pan, -1, 1),
    muted: track?.muted === true,
    solo: track?.solo === true,
    armed: track?.armed === true,
    locked: track?.locked === true,
    preset: EFFECT_PRESETS.includes(track?.preset) ? track.preset : "NONE",
    automation: normalizeAutomation(track?.automation, trackIndex),
    clips: (Array.isArray(track?.clips) ? track.clips : []).slice(0, MAX_CLIPS_PER_TRACK).map((clip, clipIndex) => normalizeClip(clip, trackIndex, clipIndex)).sort((left, right) => left.timelineStartMs - right.timelineStartMs)
  }));
  const mastering = normalizeStudioMastering(value?.master?.mastering || value?.master, value?.master || {});
  const effects = normalizeStudioEffects(value?.master?.effects);
  return {
    mode: value.mode === "ADVANCED" ? "ADVANCED" : "BEGINNER",
    tracks,
    ducking: {
      enabled: value?.ducking?.enabled === true,
      musicReductionDb: clamp(value?.ducking?.musicReductionDb ?? -12, -30, -3),
      attackMs: Math.round(clamp(value?.ducking?.attackMs ?? 120, 20, 2000)),
      releaseMs: Math.round(clamp(value?.ducking?.releaseMs ?? 700, 50, 5000))
    },
    master: {
      normalize: mastering.enabled,
      targetLufs: mastering.targetLufs,
      limiter: mastering.limiter,
      preset: mastering.preset,
      truePeakDbfs: mastering.truePeakDbfs,
      maxLoudnessRangeLu: mastering.maxLoudnessRangeLu,
      effects
    }
  };
}

export function multitrackDuration(state) {
  return Math.max(0, ...state.tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStartMs + clipDuration(clip))));
}

export function crossfadeDuration(left, right) {
  const overlap = (Number(left.timelineStartMs) + clipDuration(left)) - Number(right.timelineStartMs);
  return Math.max(0, Math.min(overlap, Number(left.fadeOutMs) || 0, Number(right.fadeInMs) || 0));
}

export function moveMultitrackClip(value, { fromTrackId, toTrackId, clipId, timelineStartMs }, options = {}) {
  const state = normalizeMultitrackState(value, options);
  const source = state.tracks.find((track) => track.clientId === fromTrackId);
  const destination = state.tracks.find((track) => track.clientId === toTrackId);
  const clip = source?.clips.find((item) => item.clientId === clipId);
  if (!source || !destination || !clip) throw new Error("Choose an existing clip and destination track.");
  if (source.locked || destination.locked || clip.locked) throw new Error("Unlock the clip and both tracks before moving it.");
  if (source.clientId !== destination.clientId && destination.clips.length >= MAX_CLIPS_PER_TRACK) throw new Error("The destination track has reached its clip limit.");

  const moved = {
    ...clip,
    timelineStartMs: Math.round(clamp(timelineStartMs, 0, MAX_PROJECT_MS - clipDuration(clip)))
  };
  return {
    ...state,
    tracks: state.tracks.map((track) => {
      const without = track.clientId === source.clientId ? track.clips.filter((item) => item.clientId !== clip.clientId) : track.clips;
      return track.clientId === destination.clientId
        ? { ...track, clips: [...without, moved].sort((left, right) => left.timelineStartMs - right.timelineStartMs) }
        : { ...track, clips: without };
    })
  };
}

export function applyMultitrackCrossfade(value, { trackId, leftClipId, rightClipId, durationMs }, options = {}) {
  const state = normalizeMultitrackState(value, options);
  const track = state.tracks.find((item) => item.clientId === trackId);
  const left = track?.clips.find((item) => item.clientId === leftClipId);
  const right = track?.clips.find((item) => item.clientId === rightClipId);
  if (!track || !left || !right || left.clientId === right.clientId) throw new Error("Choose two different clips on the same track.");
  if (track.locked || left.locked || right.locked) throw new Error("Unlock the track and both clips before creating a crossfade.");
  const maximum = Math.min(MAX_CROSSFADE_MS, clipDuration(left), clipDuration(right));
  const duration = Math.round(clamp(durationMs, 0, maximum));
  const nextStart = left.timelineStartMs + clipDuration(left) - duration;
  return {
    ...state,
    tracks: state.tracks.map((item) => item.clientId !== track.clientId ? item : {
      ...item,
      clips: item.clips.map((clip) => {
        if (clip.clientId === left.clientId) return { ...clip, fadeOutMs: duration, fadeOutCurve: "log" };
        if (clip.clientId === right.clientId) return { ...clip, timelineStartMs: nextStart, fadeInMs: duration, fadeInCurve: "exp" };
        return clip;
      }).sort((first, second) => first.timelineStartMs - second.timelineStartMs)
    })
  };
}

export function defaultMultitrackState() {
  return normalizeMultitrackState({
    mode: "BEGINNER",
    tracks: [
      { clientId: "voice-1", name: "Voice", kind: "VOICE", preset: "SPEECH_CLEANUP", clips: [] },
      { clientId: "music-1", name: "Music bed", kind: "MUSIC", clips: [] }
    ],
    ducking: { enabled: true, musicReductionDb: -12, attackMs: 120, releaseMs: 700 },
    master: { normalize: true, preset: "PODCAST", targetLufs: -16, truePeakDbfs: -1.5, maxLoudnessRangeLu: 12, limiter: true }
  });
}
