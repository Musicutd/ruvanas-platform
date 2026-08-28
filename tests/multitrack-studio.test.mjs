import assert from "node:assert/strict";
import test from "node:test";
import { crossfadeDuration, defaultMultitrackState, multitrackDuration, normalizeMultitrackState } from "../lib/multitrack-studio.mjs";

const clip = { clientId: "clip", mediaAssetId: "asset-1", sourceStartMs: 0, sourceEndMs: 10_000, timelineStartMs: 2_000, gainDb: 0, fadeInMs: 1_000, fadeOutMs: 2_000 };

test("multitrack state keeps non-destructive clips and clamps mixer controls", () => {
  const state = normalizeMultitrackState({ mode: "ADVANCED", tracks: [{ name: "Voice", kind: "VOICE", gainDb: 99, pan: -9, preset: "PODCAST_VOICE", automation: [{ timeMs: 500, value: -50 }], clips: [clip] }] });
  assert.equal(state.mode, "ADVANCED");
  assert.equal(state.tracks[0].gainDb, 12);
  assert.equal(state.tracks[0].pan, -1);
  assert.equal(state.tracks[0].automation[0].value, -36);
  assert.equal(state.tracks[0].clips[0].mediaAssetId, "asset-1");
  assert.equal(multitrackDuration(state), 12_000);
});

test("multitrack detects only an overlap covered by both fade handles as a crossfade", () => {
  const next = { ...clip, clientId: "next", timelineStartMs: 9_000, fadeInMs: 1_500 };
  assert.equal(crossfadeDuration(clip, next), 1_500);
  assert.equal(crossfadeDuration(clip, { ...next, timelineStartMs: 12_000 }), 0);
});

test("multitrack starts in a safe beginner layout", () => {
  const state = defaultMultitrackState();
  assert.equal(state.mode, "BEGINNER");
  assert.deepEqual(state.tracks.map((track) => track.kind), ["VOICE", "MUSIC"]);
  assert.equal(state.ducking.enabled, true);
});
