import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createStudioShadowScan } from "../lib/studio-shadow-scan.mjs";

const turn = () => new Promise((resolve) => setImmediate(resolve));

test("a slow shadow read never blocks the caller or starts a second read", async () => {
  let resolveRead;
  let calls = 0;
  const reports = [];
  const scan = createStudioShadowScan({
    inspect: () => { calls += 1; return new Promise((resolve) => { resolveRead = resolve; }); },
    report: (state) => reports.push(state)
  });
  assert.equal(scan.start({}), true);
  await turn();
  assert.equal(calls, 1);
  assert.equal(scan.start({}), false);
  resolveRead({ ready: true, reason: "SHADOW_ELIGIBLE_NOT_ON_AIR" });
  await turn();
  assert.deepEqual(reports, [{ ready: true, reason: "SHADOW_ELIGIBLE_NOT_ON_AIR" }]);
  assert.equal(scan.start({}), true);
  await turn();
  resolveRead({ ready: true, reason: "SHADOW_ELIGIBLE_NOT_ON_AIR" });
  await turn();
  assert.equal(reports.length, 1, "unchanged status must not flood worker logs");
  assert.equal(await scan.close(), true);
  assert.equal(scan.start({}), false);
});

test("diagnostic failures are reported once and cannot escape into AutoDJ", async () => {
  const reports = [];
  const scan = createStudioShadowScan({
    inspect: async () => { throw new Error("database unavailable"); },
    report: (state) => reports.push(state)
  });
  assert.equal(scan.start({}), true);
  await turn();
  assert.deepEqual(reports, [{ ready: false, reason: "SHADOW_CHECK_FAILED" }]);
  assert.equal(scan.start({}), true);
  await turn();
  assert.equal(reports.length, 1);
  assert.equal(await scan.close(), true);
});

test("shutdown drains a finished check but bounds a stalled one and suppresses late reports", async () => {
  let resolveRead;
  const reports = [];
  const scan = createStudioShadowScan({
    inspect: () => new Promise((resolve) => { resolveRead = resolve; }),
    report: (state) => reports.push(state)
  });
  scan.start({});
  await turn();
  assert.equal(await scan.close(5), false);
  assert.equal(scan.start({}), false);
  resolveRead({ ready: true, reason: "SHADOW_ELIGIBLE_NOT_ON_AIR" });
  await turn();
  assert.deepEqual(reports, []);
});

test("worker keeps the default-off gate and does not await the shadow inspection", async () => {
  const worker = await readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /RUVANAS_STUDIO_HANDOFF_SHADOW === "1"/);
  assert.match(worker, /shadowScan\.start\(/);
  assert.match(worker, /await shadowScan\.close\(/);
  assert.doesNotMatch(worker, /await inspectStudioOnlineHandoff|pushPreparedStudioAudio/);
});
