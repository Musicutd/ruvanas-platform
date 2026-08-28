import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderGraph, parseLoudnessReport, reducePcmPeaks } from "../lib/audio-worker.mjs";

test("audio worker builds an authoritative source-and-silence render graph", () => {
  const graph = buildRenderGraph([
    { kind: "SOURCE", mediaAssetId: "asset", sourceStartMs: 1_000, sourceEndMs: 4_000, timelineStartMs: 0, gainDb: -2, fadeInMs: 200, fadeOutMs: 300 },
    { kind: "SILENCE", sourceStartMs: 0, sourceEndMs: 1_000, timelineStartMs: 3_000 }
  ], { normalize: true, targetLufs: -16, noiseCleanup: true });
  assert.equal(graph.inputs.length, 1);
  assert.match(graph.filterComplex, /atrim=start=1\.000:end=4\.000/);
  assert.match(graph.filterComplex, /anullsrc/);
  assert.match(graph.filterComplex, /afftdn/);
  assert.match(graph.filterComplex, /loudnorm=I=-16/);
});

test("audio worker reduces PCM safely and parses loudness", () => {
  const pcm = Buffer.alloc(400);
  pcm.writeInt16LE(16_384, 0); pcm.writeInt16LE(-32_768, 200);
  const peaks = reducePcmPeaks(pcm, 10);
  assert.equal(peaks.length, 10);
  assert.equal(Math.max(...peaks), 1);
  assert.deepEqual(parseLoudnessReport("I: -16.2 LUFS\nLRA: 4.5 LU\nPeak: -1.2 dBFS"), { integratedLufs: -16.2, truePeakDbfs: -1.2, loudnessRangeLu: 4.5 });
});

