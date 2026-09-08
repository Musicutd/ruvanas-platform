import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildMultitrackRenderGraph, buildRenderGraph } from "../lib/audio-worker.mjs";
import { MAX_CLIPS_PER_TRACK, MAX_MULTITRACK_TRACKS, normalizeMultitrackState } from "../lib/multitrack-studio.mjs";
import { inspectStudioBrowserSupport, studioBrowserSupportMessage } from "../lib/studio-browser-support.mjs";
import { STUDIO_MASTERING_PRESETS, evaluateStudioMasteringQuality } from "../lib/studio-effects-mastering.mjs";

function recorderFor(types) {
  class Recorder {}
  Recorder.isTypeSupported = (type) => types.includes(type);
  return Recorder;
}

function browserProfile(types, { webkit = false } = {}) {
  const AudioContextClass = class AudioContext {};
  return {
    mediaDevices: { getUserMedia() {}, enumerateDevices() {} },
    MediaRecorderClass: recorderFor(types),
    AudioContextClass: webkit ? class WebkitAudioContext {} : AudioContextClass,
    indexedDb: { open() {} }
  };
}

function maximumProject() {
  return {
    mode: "ADVANCED",
    tracks: Array.from({ length: MAX_MULTITRACK_TRACKS }, (_, trackIndex) => ({
      clientId: `track-${trackIndex}`,
      name: `Acceptance track ${trackIndex + 1}`,
      kind: trackIndex === 0 ? "VOICE" : trackIndex === 1 ? "MUSIC" : "EFFECT",
      preset: trackIndex === 0 ? "SPEECH_CLEANUP" : "NONE",
      clips: Array.from({ length: MAX_CLIPS_PER_TRACK }, (_, clipIndex) => ({
        clientId: `clip-${trackIndex}-${clipIndex}`,
        mediaAssetId: `asset-${trackIndex}-${clipIndex}`,
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        timelineStartMs: clipIndex * 1_000,
        fadeInMs: 0,
        fadeOutMs: 0
      }))
    })),
    ducking: { enabled: true, musicReductionDb: -12, attackMs: 120, releaseMs: 700 },
    master: STUDIO_MASTERING_PRESETS.ONLINE_RADIO
  };
}

test("Studio G accepts current Chrome, Edge, Firefox and Safari recording capabilities", () => {
  const profiles = [
    browserProfile(["audio/webm;codecs=opus"]),
    browserProfile(["audio/webm;codecs=opus"]),
    browserProfile(["audio/ogg;codecs=opus"]),
    browserProfile(["audio/mp4"], { webkit: true })
  ];
  for (const profile of profiles) {
    const support = inspectStudioBrowserSupport(profile);
    assert.equal(support.ready, true);
    assert.ok(support.preferredMimeType);
    assert.equal(studioBrowserSupportMessage(support), "Studio recording is supported in this browser.");
  }
});

test("Studio G gives an understandable result when browser recording is unavailable", () => {
  const support = inspectStudioBrowserSupport({ mediaDevices: {}, MediaRecorderClass: null, AudioContextClass: null, indexedDb: null });
  assert.equal(support.ready, false);
  assert.deepEqual(support.missing, ["microphone capture", "audio recording", "live audio monitoring"]);
  assert.match(studioBrowserSupportMessage(support), /current version of Chrome, Edge, Firefox or Safari/);
});

test("Studio G render plans are deterministic for waveform and multitrack projects", () => {
  const clips = [
    { clientId: "voice", kind: "SOURCE", mediaAssetId: "voice-asset", sourceStartMs: 0, sourceEndMs: 30_000, timelineStartMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 500 },
    { clientId: "music", kind: "SOURCE", mediaAssetId: "music-asset", sourceStartMs: 1_000, sourceEndMs: 31_000, timelineStartMs: 30_000, gainDb: -8, fadeInMs: 500, fadeOutMs: 1_000 }
  ];
  const settings = { voiceCleanup: { enabled: true, amount: 55 }, mastering: STUDIO_MASTERING_PRESETS.PODCAST };
  assert.deepEqual(buildRenderGraph(clips, settings), buildRenderGraph([...clips].reverse(), settings));

  const project = maximumProject();
  const first = buildMultitrackRenderGraph(project);
  const second = buildMultitrackRenderGraph(structuredClone(project));
  assert.equal(createHash("sha256").update(JSON.stringify(first)).digest("hex"), createHash("sha256").update(JSON.stringify(second)).digest("hex"));
});

test("Studio G keeps the documented maximum project bounded and renderable", () => {
  const state = normalizeMultitrackState(maximumProject());
  assert.equal(state.tracks.length, MAX_MULTITRACK_TRACKS);
  assert.equal(state.tracks.every((track) => track.clips.length === MAX_CLIPS_PER_TRACK), true);
  const graph = buildMultitrackRenderGraph(state);
  assert.equal(graph.inputs.length, MAX_MULTITRACK_TRACKS * MAX_CLIPS_PER_TRACK);
  assert.match(graph.filterComplex, /sidechaincompress/);
  assert.match(graph.filterComplex, /loudnorm=I=-16:TP=-1:LRA=12/);
});

test("Studio G validates the mastering targets and rejects out-of-range audio", () => {
  for (const preset of Object.values(STUDIO_MASTERING_PRESETS).filter((item) => item.enabled)) {
    assert.equal(evaluateStudioMasteringQuality({ integratedLufs: preset.targetLufs, truePeakDbfs: preset.truePeakDbfs, loudnessRangeLu: preset.maxLoudnessRangeLu }, preset).status, "READY");
    assert.equal(evaluateStudioMasteringQuality({ integratedLufs: preset.targetLufs + 3, truePeakDbfs: preset.truePeakDbfs + 1, loudnessRangeLu: preset.maxLoudnessRangeLu + 3 }, preset).status, "NEEDS_ATTENTION");
  }
});

test("Studio G keeps source, approval, permission, tenant and product gates in place", async () => {
  const [audioLab, upload, multitrack, destinations, studioClient] = await Promise.all([
    readFile(new URL("../app/api/school-radio/audio-lab/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/audio-lab/uploads/[uploadId]/complete/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/multitrack/projects/[projectId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/studio-destinations/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/StudioWorkspaceClient.js", import.meta.url), "utf8")
  ]);
  for (const route of [audioLab, upload, multitrack, destinations]) {
    assert.match(route, /requireActiveSchoolRadio/);
    assert.match(route, /organisationId/);
  }
  assert.match(upload, /immutableSource: true/);
  assert.match(multitrack, /invalidateApprovedAudioOutputs/);
  assert.match(multitrack, /currentVersion \+ 1/);
  assert.match(destinations, /assertStudioRenderReady/);
  assert.match(destinations, /definition\.entitlement/);
  assert.match(destinations, /billingMutation: false/);
  assert.match(destinations, /publicPublication: false/);
  assert.match(studioClient, /BEGINNER/);
  assert.match(studioClient, /localStorage/);
});
