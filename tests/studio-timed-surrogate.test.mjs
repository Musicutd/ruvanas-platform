import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSelfOwnedTimedRehearsal } from "../scripts/prepare-studio-timed-rehearsal.mjs";
import { verifySelfOwnedTimedSurrogate } from "../scripts/verify-studio-timed-surrogate.mjs";

test("decoded local surrogate checks actual A-B-A file output without claiming Liquidsoap or listener proof", { timeout: 30_000 }, async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ruvanas-surrogate-test-"));
  const pack = path.join(parent, "pack");
  try {
    await prepareSelfOwnedTimedRehearsal(pack);
    const result = await verifySelfOwnedTimedSurrogate(pack);
    assert.equal(result.matches, true, JSON.stringify(result));
    assert.equal(result.reason, "LOCAL_SEQUENCE_MATCH_ONLY");
    assert.deepEqual(result.observedStarts.map((item) => item.trackId), ["tone-a", "tone-b", "tone-a"]);
    assert.deepEqual(result.overlaps.map((item) => item.detected), [true, true]);
    assert.equal(result.provenance, "LOCAL_FFMPEG_SURROGATE_NOT_LIQUIDSOAP");
    assert.equal(result.liquidsoapVerified, false);
    assert.equal(result.sourceCommandAllowed, false);
    assert.equal(result.listenerVerified, false);
    assert.match(result.outputMp3Sha256, /^[a-f0-9]{64}$/);
    assert.match(result.outputPcmSha256, /^[a-f0-9]{64}$/);
    assert.ok((await readFile(result.outputMp3)).length > 20_000);
    await assert.rejects(() => verifySelfOwnedTimedSurrogate(pack), /surrogate audio renderer failed/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("changed audio or instructions fail before any surrogate output is created", { timeout: 30_000 }, async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ruvanas-surrogate-tamper-test-"));
  try {
    for (const [name, file] of [["audio-pack", "tone-a.mp3"], ["script-pack", "rehearsal.liq"],
      ["playlist-pack", "frozen.m3u"]]) {
      const pack = path.join(parent, name);
      await prepareSelfOwnedTimedRehearsal(pack);
      await writeFile(path.join(pack, file), Buffer.from("changed fixture"));
      await assert.rejects(() => verifySelfOwnedTimedSurrogate(pack));
      await assert.rejects(() => readFile(path.join(pack, "ffmpeg-surrogate.mp3")), { code: "ENOENT" });
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the surrogate command remains offline and refuses a non-pack path", async () => {
  const command = fileURLToPath(new URL("../scripts/verify-studio-timed-surrogate.mjs", import.meta.url));
  const invalid = spawnSync(process.execPath, [command, "not-a-pack"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr, /not-a-pack/);
  const [verifier, worker] = await Promise.all([
    readFile(new URL("../scripts/verify-studio-timed-surrogate.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(verifier, /S3Client|PrismaClient|DATABASE_URL|sourcePasswordEncrypted|output\.shoutcast/);
  assert.doesNotMatch(worker, /verify-studio-timed-surrogate|verifySelfOwnedTimedSurrogate/);
});

test("the surrogate command reports its limited provenance on a fresh pack", { timeout: 30_000 }, async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ruvanas-surrogate-command-test-"));
  const pack = path.join(parent, "pack");
  const command = fileURLToPath(new URL("../scripts/verify-studio-timed-surrogate.mjs", import.meta.url));
  try {
    await prepareSelfOwnedTimedRehearsal(pack);
    const run = spawnSync(process.execPath, [command, pack], { encoding: "utf8", timeout: 15_000 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.matches, true);
    assert.equal(result.provenance, "LOCAL_FFMPEG_SURROGATE_NOT_LIQUIDSOAP");
    assert.equal(result.listenerVerified, false);
    assert.equal(result.liquidsoapVerified, false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
