import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMultitrackRenderGraph, buildRenderGraph } from "../lib/audio-worker.mjs";
import {
  applyStudioEffectPreset,
  applyStudioMasteringPreset,
  buildStudioEffectsFilters,
  buildStudioMasteringFilters,
  evaluateStudioMasteringQuality,
  normalizeStudioEffects,
  normalizeStudioMastering
} from "../lib/studio-effects-mastering.mjs";

test("Studio D provides bounded curated effects and delivery presets", () => {
  const promo = applyStudioEffectPreset("PROMO_VOICE");
  assert.equal(promo.preset, "PROMO_VOICE");
  assert.match(buildStudioEffectsFilters(promo).join(","), /acompressor/);
  assert.match(buildStudioEffectsFilters(promo).join(","), /aecho/);
  assert.match(buildStudioEffectsFilters(promo).join(","), /alimiter/);
  assert.deepEqual(buildStudioEffectsFilters(applyStudioEffectPreset("NONE")), []);
  assert.equal(normalizeStudioEffects({ enabled: true, compression: 999, reverb: 999 }).compression, 100);
  assert.equal(normalizeStudioEffects({ enabled: true, compression: 999, reverb: 999 }).reverb, 30);

  const school = applyStudioMasteringPreset("SCHOOL_PROGRAMME");
  assert.equal(school.targetLufs, -18);
  assert.match(buildStudioMasteringFilters(school).join(","), /loudnorm=I=-18:TP=-1\.5:LRA=14/);
  assert.equal(normalizeStudioMastering({ targetLufs: -100, truePeakDbfs: 5 }).targetLufs, -24);
  assert.equal(normalizeStudioMastering({ targetLufs: -100, truePeakDbfs: 5 }).truePeakDbfs, -0.5);
});

test("Studio D reports READY only when loudness, True Peak and range meet the selected target", () => {
  const target = applyStudioMasteringPreset("PODCAST");
  assert.deepEqual(evaluateStudioMasteringQuality({ integratedLufs: -16.2, truePeakDbfs: -1.8, loudnessRangeLu: 6 }, target), { status: "READY", findings: [] });
  const warning = evaluateStudioMasteringQuality({ integratedLufs: -12, truePeakDbfs: -0.4, loudnessRangeLu: 16 }, target);
  assert.equal(warning.status, "NEEDS_ATTENTION");
  assert.equal(warning.findings.length, 3);
  assert.equal(evaluateStudioMasteringQuality({}, target).findings.length, 3);
});

test("Studio D adds effects before mastering in waveform and multitrack render graphs", () => {
  const clip = { kind: "SOURCE", mediaAssetId: "asset", sourceStartMs: 0, sourceEndMs: 4_000, timelineStartMs: 0 };
  const waveform = buildRenderGraph([clip], { effects: applyStudioEffectPreset("TELEPHONE_VOICE"), mastering: applyStudioMasteringPreset("ONLINE_RADIO") });
  assert.ok(waveform.filterComplex.indexOf("highpass=f=300") < waveform.filterComplex.indexOf("loudnorm=I=-16"));

  const multitrack = buildMultitrackRenderGraph({ tracks: [{ clientId: "voice", name: "Voice", kind: "VOICE", preset: "BROADCAST_VOICE", clips: [clip] }], master: { ...applyStudioMasteringPreset("RETAIL_PROMO"), normalize: true } });
  assert.match(multitrack.filterComplex, /equalizer=f=3800/);
  assert.match(multitrack.filterComplex, /loudnorm=I=-14:TP=-1:LRA=10/);
});

test("Studio D UI keeps effects and mastering in a separate, previewable workspace", async () => {
  const waveformSource = await readFile(new URL("../app/dashboard/school-radio/WaveformEditorClient.js", import.meta.url), "utf8");
  const routeSource = await readFile(new URL("../app/api/school-radio/audio-lab/projects/[projectId]/editor/route.js", import.meta.url), "utf8");
  assert.match(waveformSource, /Effects & master/);
  assert.match(waveformSource, /Create mastered preview/);
  assert.match(waveformSource, /True Peak ceiling/);
  assert.match(routeSource, /QUEUE_MASTER_PREVIEW/);
  assert.match(routeSource, /STUDIO_MASTER_PREVIEW_QUEUED/);
});
