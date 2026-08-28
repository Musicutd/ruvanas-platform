import { clipDuration, MAX_PROJECT_MS } from "./waveform-editor.mjs";

export const MAX_MULTITRACK_TRACKS = 16;
export const MAX_CLIPS_PER_TRACK = 100;
export const MAX_AUTOMATION_POINTS = 100;

export const TRACK_KINDS = Object.freeze(["VOICE", "MUSIC", "EFFECT", "MIXED"]);
export const EFFECT_PRESETS = Object.freeze(["NONE", "SPEECH_CLEANUP", "PODCAST_VOICE", "RADIO_VOICE"]);
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

export function normalizeMultitrackState(value = {}) {
  const tracks = (Array.isArray(value.tracks) ? value.tracks : []).slice(0, MAX_MULTITRACK_TRACKS).map((track, trackIndex) => ({
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
      normalize: value?.master?.normalize !== false,
      targetLufs: [-24, -23, -18, -16, -14].includes(Number(value?.master?.targetLufs)) ? Number(value.master.targetLufs) : -16,
      limiter: value?.master?.limiter !== false
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

export function defaultMultitrackState() {
  return normalizeMultitrackState({
    mode: "BEGINNER",
    tracks: [
      { clientId: "voice-1", name: "Voice", kind: "VOICE", preset: "SPEECH_CLEANUP", clips: [] },
      { clientId: "music-1", name: "Music bed", kind: "MUSIC", clips: [] }
    ],
    ducking: { enabled: true, musicReductionDb: -12, attackMs: 120, releaseMs: 700 },
    master: { normalize: true, targetLufs: -16, limiter: true }
  });
}
