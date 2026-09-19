import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { prepareSelfOwnedTimedRehearsal } from "../scripts/prepare-studio-timed-rehearsal.mjs";

function spectralMagnitude(pcm, frequencyHz) {
  let cosine = 0;
  let sine = 0;
  const samples = 16_000;
  for (let index = 0; index < samples; index += 1) {
    const sample = pcm.readInt16LE((16_000 + index) * 2);
    const angle = 2 * Math.PI * frequencyHz * index / 16_000;
    cosine += sample * Math.cos(angle);
    sine += sample * Math.sin(angle);
  }
  return Math.hypot(cosine, sine);
}

test("one command stages self-owned A-B-A tones and a file-only frozen rehearsal", { timeout: 30_000 }, async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ruvanas-timed-pack-test-"));
  const output = path.join(parent, "new-pack");
  try {
    const prepared = await prepareSelfOwnedTimedRehearsal(output);
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.sourceCommandAllowed, false);
    assert.equal(prepared.listenerVerified, false);
    assert.match(prepared.targetDirectory, /^\/tmp\/ruvanas-timed-self-owned-[a-f0-9]{12}$/);
    const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
    assert.equal(manifest.fixtureOnly, true);
    assert.deepEqual(manifest.expectedOrder.map((item) => item.trackId), ["tone-a", "tone-b", "tone-a"]);
    assert.deepEqual(manifest.expectedOrder.map((item) => item.startOffsetSeconds), [0, 4, 9]);
    const playlist = await readFile(path.join(output, "frozen.m3u"), "utf8");
    assert.deepEqual(playlist.trimEnd().split("\n"), [
      `${prepared.targetDirectory}/tone-a.mp3`, `${prepared.targetDirectory}/tone-b.mp3`,
      `${prepared.targetDirectory}/tone-a.mp3`
    ]);
    const script = await readFile(path.join(output, "rehearsal.liq"), "utf8");
    assert.match(script, /output\.file\(/);
    assert.doesNotMatch(script, /output\.shoutcast|output\.icecast|https?:|password/);
    assert.equal(manifest.playlistSha256, createHash("sha256").update(playlist).digest("hex"));
    assert.equal(manifest.scriptSha256, createHash("sha256").update(script).digest("hex"));
    for (const [name, frequencyHz, otherFrequencyHz, durationSeconds] of [
      ["tone-a.mp3", 440, 660, 6], ["tone-b.mp3", 660, 440, 7]
    ]) {
      const audio = await readFile(path.join(output, name));
      assert.equal(manifest.audioSha256[name], createHash("sha256").update(audio).digest("hex"));
      const decoded = spawnSync(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error",
        "-i", path.join(output, name), "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"],
      { timeout: 15_000, maxBuffer: 1024 * 1024 });
      assert.equal(decoded.status, 0);
      assert.ok(Math.abs(decoded.stdout.length / 32_000 - durationSeconds) < 0.2);
      assert.ok(spectralMagnitude(decoded.stdout, frequencyHz) > 10 * spectralMagnitude(decoded.stdout, otherFrequencyHz));
    }
    await assert.rejects(() => prepareSelfOwnedTimedRehearsal(output), { code: "EEXIST" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the preparation command refuses reuse and never imports the live worker", async () => {
  await assert.rejects(() => prepareSelfOwnedTimedRehearsal("relative-pack"));
  const source = await readFile(new URL("../scripts/prepare-studio-timed-rehearsal.mjs", import.meta.url), "utf8");
  const worker = await readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /S3Client|PrismaClient|output\.shoutcast|DATABASE_URL/);
  assert.doesNotMatch(worker, /prepare-studio-timed-rehearsal|prepareSelfOwnedTimedRehearsal/);
  const command = fileURLToPath(new URL("../scripts/prepare-studio-timed-rehearsal.mjs", import.meta.url));
  const invalid = spawnSync(process.execPath, [command, "relative-pack"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr, /relative-pack/);
});

test("the one-command entry point prepares a fresh pack without starting audio", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ruvanas-timed-command-test-"));
  const output = path.join(parent, "fresh-pack");
  const command = fileURLToPath(new URL("../scripts/prepare-studio-timed-rehearsal.mjs", import.meta.url));
  try {
    const run = spawnSync(process.execPath, [command, output], { encoding: "utf8", timeout: 15_000 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.prepared, true);
    assert.equal(result.sourceCommandAllowed, false);
    assert.equal(result.listenerVerified, false);
    assert.equal(result.outputDirectory, output);
    assert.ok((await readFile(path.join(output, "tone-a.mp3"))).length > 10_000);
    const rerun = spawnSync(process.execPath, [command, output], { encoding: "utf8", timeout: 10_000 });
    assert.equal(rerun.status, 1);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
