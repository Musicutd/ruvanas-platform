import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canAnalyseTimedFileOutput, isIsolatedTimedTarget } from "../scripts/run-studio-timed-liquidsoap-linux.mjs";

test("Linux MP3 rehearsal accepts only the generated private /tmp target shape", () => {
  assert.equal(isIsolatedTimedTarget("/tmp/ruvanas-timed-self-owned-012345abcdef"), true);
  for (const value of ["/tmp/ruvanas-timed-self-owned-012345abcdef/../other",
    "/tmp/ruvanas-timed-self-owned-012345abcdeg", "/tmp/ruvanas-timed-self-owned-012345abcdef/extra",
    "/app/ruvanas-timed-self-owned-012345abcdef", "C:\\tmp\\ruvanas-timed-self-owned-012345abcdef", null]) {
    assert.equal(isIsolatedTimedTarget(value), false, String(value));
  }
});

test("only a bounded local output may proceed to exact decoded-audio analysis", () => {
  const file = (size) => ({ isFile: () => true, size });
  assert.equal(canAnalyseTimedFileOutput({ status: 0 }, file(100_000)), true);
  assert.equal(canAnalyseTimedFileOutput({ status: null, error: { code: "ETIMEDOUT" } }, file(100_000)), true);
  assert.equal(canAnalyseTimedFileOutput({ status: 1 }, file(100_000)), false);
  assert.equal(canAnalyseTimedFileOutput({ status: null, error: { code: "ENOENT" } }, file(100_000)), false);
  assert.equal(canAnalyseTimedFileOutput({ status: null, error: { code: "ETIMEDOUT" } }, file(10)), false);
  assert.equal(canAnalyseTimedFileOutput({ status: null, error: { code: "ETIMEDOUT" } }, file(3_000_000)), false);
  assert.equal(canAnalyseTimedFileOutput({ status: null, error: { code: "ETIMEDOUT" } }, null), false);
});

test("Linux MP3 rehearsal rejects caller paths and stays separate from the live worker", async () => {
  const command = fileURLToPath(new URL("../scripts/run-studio-timed-liquidsoap-linux.mjs", import.meta.url));
  const invalid = spawnSync(process.execPath, [command, "a-stream-or-path"], {
    encoding: "utf8", timeout: 10_000
  });
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr, /a-stream-or-path/);
  const [rehearsal, worker] = await Promise.all([
    readFile(command, "utf8"),
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(rehearsal, /S3Client|PrismaClient|DATABASE_URL|sourcePasswordEncrypted|output\.shoutcast|output\.icecast/);
  assert.doesNotMatch(worker, /run-studio-timed-liquidsoap-linux|runSelfOwnedLinuxMp3Rehearsal/);
});

test("CI runs the synthetic MP3 check only in a test derivative of the encoder image", async () => {
  const [testImage, productionImage, workflow] = await Promise.all([
    readFile(new URL("../Dockerfile.studio-timed-mp3-test", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile.online-radio-worker", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  ]);
  assert.match(testImage, /FROM ruvanas-online-radio-encoder:ci/);
  assert.match(testImage, /RUN node scripts\/run-studio-timed-liquidsoap-linux\.mjs/);
  assert.doesNotMatch(testImage, /ENV |CMD |ENTRYPOINT |EXPOSE /);
  assert.doesNotMatch(productionImage, /run-studio-timed-liquidsoap-linux/);
  assert.match(workflow, /Verify isolated timed-playlist MP3 file output/);
  assert.match(workflow, /docker build --file Dockerfile\.studio-timed-mp3-test/);
});
