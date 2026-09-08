import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRenderGraph } from "../lib/audio-worker.mjs";
import { applyVoiceCleanupPreset, buildVoiceCleanupFilters, normalizeVoiceCleanup, voiceCleanupLabel } from "../lib/voice-cleanup.mjs";
import { normalizeEditorState } from "../lib/waveform-editor.mjs";

const clip = { kind: "SOURCE", mediaAssetId: "asset-1", sourceStartMs: 0, sourceEndMs: 10_000, timelineStartMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 };

test("Studio C provides bounded, plain-language repair presets", () => {
  assert.equal(voiceCleanupLabel(applyVoiceCleanupPreset("GENTLE")), "Gentle repair");
  assert.equal(voiceCleanupLabel(applyVoiceCleanupPreset("CLEAN_DIALOGUE")), "Clean dialogue");
  assert.equal(voiceCleanupLabel(applyVoiceCleanupPreset("BROADCAST")), "Broadcast voice");
  assert.deepEqual(normalizeVoiceCleanup({ enabled: true, noiseReduction: 400, rumbleHz: -20, humHz: 55, deEss: 140, voiceEq: "UNSAFE", speechLeveling: -5, limiter: true }), {
    enabled: true, preset: "CUSTOM", noiseReduction: 100, rumbleHz: 0, humHz: 0,
    deEss: 100, voiceEq: "NEUTRAL", speechLeveling: 0, limiter: true
  });
});

test("Studio C builds deterministic cleanup and a real bypass comparison", () => {
  const cleanup = applyVoiceCleanupPreset("BROADCAST");
  const filters = buildVoiceCleanupFilters(cleanup);
  assert.match(filters.join(","), /highpass=f=90/);
  assert.match(filters.join(","), /afftdn/);
  assert.match(filters.join(","), /deesser/);
  assert.match(filters.join(","), /acompressor/);
  assert.match(filters.join(","), /alimiter/);
  assert.deepEqual(buildVoiceCleanupFilters(cleanup, { bypass: true }), []);

  const after = buildRenderGraph([clip], { normalize: false, voiceCleanup: cleanup });
  const before = buildRenderGraph([clip], { normalize: false, voiceCleanup: cleanup, voiceCleanupBypass: true });
  assert.match(after.filterComplex, /afftdn/);
  assert.doesNotMatch(before.filterComplex, /afftdn|deesser|acompressor|alimiter/);
});

test("Studio C keeps cleanup inside the non-destructive editor snapshot", () => {
  const state = normalizeEditorState({ clips: [clip], noiseCleanup: true });
  assert.equal(state.voiceCleanup.enabled, true);
  assert.equal(state.voiceCleanup.preset, "GENTLE");
  assert.equal(state.clips[0].mediaAssetId, "asset-1");
});

test("Studio C comparisons use the protected worker without entering publishing", async () => {
  const [client, route, worker] = await Promise.all([
    readFile(new URL("../app/dashboard/school-radio/WaveformEditorClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/audio-lab/projects/[projectId]/editor/route.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/audio-worker.mjs", import.meta.url), "utf8")
  ]);
  assert.match(client, /Repair common voice problems safely/);
  assert.match(client, /role="tab"/);
  assert.match(client, /<strong>Edit audio<\/strong>/);
  assert.match(client, /<strong>Clean voice<\/strong>/);
  assert.match(client, /Create Before\/After preview/);
  assert.match(client, /Gentle repair/);
  assert.match(route, /QUEUE_CLEANUP_PREVIEW/);
  assert.match(route, /VOICE_CLEANUP_PREVIEW_QUEUED/);
  assert.match(worker, /voiceCleanupBypass/);
  assert.match(worker, /!studioPreview && \(existingPromo \|\| multitrack\)/);
});
