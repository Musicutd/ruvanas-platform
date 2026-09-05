import test from "node:test";
import assert from "node:assert/strict";
import { buildMultitrackRenderGraph, buildRenderGraph, parseLoudnessReport, reducePcmPeaks } from "../lib/audio-worker.mjs";

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

test("audio worker builds overlapping multitrack buses with deterministic music ducking", () => {
  const graph = buildMultitrackRenderGraph({
    mode: "ADVANCED",
    tracks: [
      { clientId: "voice", name: "Voice", kind: "VOICE", preset: "SPEECH_CLEANUP", clips: [{ clientId: "v1", mediaAssetId: "voice-asset", sourceStartMs: 0, sourceEndMs: 8_000, timelineStartMs: 2_000, fadeInMs: 100, fadeOutMs: 200 }], automation: [{ timeMs: 3_000, value: -2 }] },
      { clientId: "music", name: "Music", kind: "MUSIC", clips: [{ clientId: "m1", mediaAssetId: "music-asset", sourceStartMs: 0, sourceEndMs: 15_000, timelineStartMs: 0, fadeInMs: 500, fadeOutMs: 800 }] }
    ],
    ducking: { enabled: true, attackMs: 120, releaseMs: 700 },
    master: { normalize: true, targetLufs: -16, limiter: true }
  });
  assert.deepEqual(graph.inputs.map((input) => input.mediaAssetId), ["voice-asset", "music-asset"]);
  assert.match(graph.filterComplex, /adelay=2000\|2000/);
  assert.match(graph.filterComplex, /sidechaincompress/);
  assert.match(graph.filterComplex, /enable='between\(t,3\.000,86400\)'/);
  assert.match(graph.filterComplex, /loudnorm=I=-16/);
});

test("audio worker applies one broadcast master profile instead of the editor master", () => {
  const graph = buildMultitrackRenderGraph({
    mode: "ADVANCED",
    tracks: [{ clientId: "voice", name: "Voice", kind: "VOICE", clips: [{ clientId: "v1", mediaAssetId: "voice-asset", sourceStartMs: 0, sourceEndMs: 8_000, timelineStartMs: 0 }] }],
    master: { normalize: true, targetLufs: -14, limiter: true }
  }, { processingProfile: { name: "Web Radio", codec: "MP3", bitrateKbps: 192, sampleRateHz: 48000, targetLufs: -16, truePeakDbfs: -1.5, maxLoudnessRangeLu: 12, highpassHz: 30, lowpassHz: 18000, compressionThresholdDb: -18, compressionRatio: 2.5, compressionAttackMs: 20, compressionReleaseMs: 250, limiterEnabled: true } });
  assert.match(graph.filterComplex, /highpass=f=30/);
  assert.match(graph.filterComplex, /loudnorm=I=-16:TP=-1\.5:LRA=12/);
  assert.doesNotMatch(graph.filterComplex, /loudnorm=I=-14/);
});
