import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { encoderCommandMode, runEncoderCommand } from "../scripts/online-radio-encoder-worker.mjs";
test("default/check cannot import the live implementation or use hostile stored credentials", async () => {
  assert.equal(encoderCommandMode([]), "CHECK_ONLY"); assert.equal(encoderCommandMode(["--check"]), "CHECK_ONLY");
  assert.deepEqual(await runEncoderCommand([], {}), { service: "ONLINE_RADIO_ENCODER", mode: "CHECK_ONLY", streamingStarted: false, cloudAccessed: false });
  const result = spawnSync(process.execPath, ["scripts/online-radio-encoder-worker.mjs", "--check"], {
    encoding: "utf8", windowsHide: true, timeout: 3000,
    env: { ...process.env, DATABASE_URL: "do-not-read", SECRET_ENCRYPTION_KEY: "must-not-be-printed", RUVANAS_AUTODJ_ALLOW_LIVE: "true" }
  });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).cloudAccessed, false);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-be-printed|do-not-read/);
});
test("live mode requires an explicit serve argument and strict runtime approval", () => {
  for (const value of [undefined, false, "false", "TRUE", "1", 1]) assert.throws(() => encoderCommandMode(["--serve"], { RUVANAS_AUTODJ_ALLOW_LIVE: value }));
  assert.equal(encoderCommandMode(["--serve"], { RUVANAS_AUTODJ_ALLOW_LIVE: "true" }), "EXPLICIT_LIVE");
  assert.equal(encoderCommandMode(["--hold"], { RUVANAS_AUTODJ_ALLOW_LIVE: "true" }), "HELD_OFF_AIR");
  for (const args of [["--serve", "--check"], ["--unknown"], [null]]) assert.throws(() => encoderCommandMode(args, {}));
});
test("the live module performs no work before its exported entry function", async () => {
  const source = await readFile(new URL("../scripts/online-radio-encoder-live.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf("export async function runLiveEncoder()") < source.indexOf("new PrismaClient()"));
  assert.ok(source.indexOf("LIVE_OUTPUT_NOT_APPROVED") < source.indexOf("new PrismaClient()"));
  assert.match(source, /RUVANAS_AUTODJ_MANUAL_CATALOGUE_OUTPUT === "true"/);
});
