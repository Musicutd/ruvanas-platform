import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { analyzeTimedRehearsalPcm } from "../lib/studio-timed-rehearsal-analysis.mjs";

const require = createRequire(import.meta.url);
const rate = 16_000;
const order = [
  { position: 0, trackId: "a", startOffsetSeconds: 0, endOffsetSeconds: 6 },
  { position: 1, trackId: "b", startOffsetSeconds: 4, endOffsetSeconds: 11 },
  { position: 2, trackId: "a", startOffsetSeconds: 9, endOffsetSeconds: 15 }
];
const tones = new Map([["a", 440], ["b", 660]]);

function fixture({ crossfade = true, reverse = false, silent = false, frequencyOverride } = {}) {
  const pcm = Buffer.alloc(rate * 15 * 2);
  const items = [
    { trackId: "a", start: 0, end: crossfade ? 6 : 4 },
    { trackId: reverse ? "a" : "b", start: 4, end: crossfade ? 11 : 9 },
    { trackId: reverse ? "b" : "a", start: 9, end: 15 }
  ];
  for (let sample = 0; sample < rate * 15; sample += 1) {
    const at = sample / rate;
    let value = 0;
    if (!silent) {
      for (const [index, item] of items.entries()) {
        if (at < item.start || at >= item.end) continue;
        const fadeIn = crossfade && index ? Math.min(1, (at - item.start) / 2) : 1;
        const fadeOut = crossfade && index < items.length - 1 ? Math.min(1, (item.end - at) / 2) : 1;
        value += 8_000 * Math.min(fadeIn, fadeOut) *
          Math.sin(2 * Math.PI * (frequencyOverride ?? tones.get(item.trackId)) * at);
      }
    }
    pcm.writeInt16LE(Math.round(value), sample * 2);
  }
  return pcm;
}

test("decoded self-owned tones confirm A-B-A repeat and both overlap transitions", () => {
  const result = analyzeTimedRehearsalPcm(fixture(), { expectedOrder: order, toneHzByTrackId: tones });
  assert.equal(result.matches, true, JSON.stringify(result));
  assert.equal(result.reason, "LOCAL_SEQUENCE_MATCH_ONLY");
  assert.deepEqual(result.observedStarts.map((item) => item.trackId), ["a", "b", "a"]);
  assert.deepEqual(result.overlaps.map((item) => item.detected), [true, true]);
  assert.equal(result.listenerVerified, false);
  assert.equal(result.interpretation, "LOCAL_FILE_SAMPLE_ONLY");
});

test("wrong order, hard cuts, silence and unrelated audio cannot pass", () => {
  const options = { expectedOrder: order, toneHzByTrackId: tones };
  assert.equal(analyzeTimedRehearsalPcm(fixture({ reverse: true }), options).reason, "ORDER_OR_BOUNDARY_MISMATCH");
  assert.equal(analyzeTimedRehearsalPcm(fixture({ crossfade: false }), options).reason, "CROSSFADE_NOT_DETECTED");
  assert.equal(analyzeTimedRehearsalPcm(fixture({ silent: true }), options).matches, false);
  assert.equal(analyzeTimedRehearsalPcm(fixture({ frequencyOverride: 1000 }), options).matches, false);
  assert.equal(analyzeTimedRehearsalPcm(Buffer.concat([fixture(), Buffer.alloc(rate * 2 * 2)]), options).reason, "DURATION_MISMATCH");
});

test("rejects malformed or unbounded recordings and test-tone maps", () => {
  const options = { expectedOrder: order, toneHzByTrackId: tones };
  assert.throws(() => analyzeTimedRehearsalPcm(Buffer.alloc(1), options));
  assert.throws(() => analyzeTimedRehearsalPcm(Buffer.alloc(rate * 121 * 2), options));
  assert.throws(() => analyzeTimedRehearsalPcm(fixture(), { ...options, expectedOrder: order.slice().reverse() }));
  assert.throws(() => analyzeTimedRehearsalPcm(fixture(), { ...options, toneHzByTrackId: new Map([["a", 440], ["b", 440]]) }));
});

test("an MP3 encode/decode round-trip remains local sample evidence only", { timeout: 30_000 }, async (context) => {
  let ffmpeg;
  try { ffmpeg = require("ffmpeg-static"); } catch { context.skip("ffmpeg-static is unavailable"); return; }
  if (!ffmpeg || !existsSync(ffmpeg)) { context.skip("ffmpeg-static binary is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "ruvanas-tone-rehearsal-"));
  try {
    const source = join(directory, "input.s16le");
    const encoded = join(directory, "sample.mp3");
    const decoded = join(directory, "decoded.s16le");
    await writeFile(source, fixture());
    const encode = spawnSync(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", source, "-codec:a", "libmp3lame", "-b:a", "128k", encoded], { timeout: 15_000 });
    assert.equal(encode.status, 0, encode.error?.message ?? encode.stderr?.toString());
    const decode = spawnSync(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", encoded, "-ar", "16000", "-ac", "1", "-f", "s16le", decoded], { timeout: 15_000 });
    assert.equal(decode.status, 0, decode.error?.message ?? decode.stderr?.toString());
    const result = analyzeTimedRehearsalPcm(await readFile(decoded), { expectedOrder: order, toneHzByTrackId: tones });
    assert.equal(result.matches, true, JSON.stringify(result));
    assert.equal(result.listenerVerified, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline rehearsal command records hashes and fails closed on mismatched audio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ruvanas-tone-analysis-"));
  const command = fileURLToPath(new URL("../scripts/analyze-studio-timed-rehearsal-pcm.mjs", import.meta.url));
  const sample = join(directory, "sample.s16le");
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.stringify({ format: "RUVANAS_SELF_OWNED_TEST_TONES_V1", expectedOrder: order,
    toneHzByTrackId: Object.fromEntries(tones) });
  try {
    await Promise.all([writeFile(sample, fixture()), writeFile(manifestPath, manifest)]);
    const accepted = spawnSync(process.execPath, [command, sample, manifestPath], { encoding: "utf8", timeout: 10_000 });
    assert.equal(accepted.status, 0, accepted.stderr);
    const acceptedResult = JSON.parse(accepted.stdout);
    assert.equal(acceptedResult.matches, true);
    assert.equal(acceptedResult.listenerVerified, false);
    assert.match(acceptedResult.pcmSha256, /^[a-f0-9]{64}$/);
    assert.match(acceptedResult.manifestSha256, /^[a-f0-9]{64}$/);

    await writeFile(sample, fixture({ crossfade: false }));
    const mismatch = spawnSync(process.execPath, [command, sample, manifestPath], { encoding: "utf8", timeout: 10_000 });
    assert.equal(mismatch.status, 2);
    assert.equal(JSON.parse(mismatch.stdout).reason, "CROSSFADE_NOT_DETECTED");

    await writeFile(manifestPath, "not-json-private-content");
    const invalid = spawnSync(process.execPath, [command, sample, manifestPath], { encoding: "utf8", timeout: 10_000 });
    assert.equal(invalid.status, 1);
    assert.doesNotMatch(invalid.stderr, /not-json-private-content|ruvanas-tone-analysis-/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
