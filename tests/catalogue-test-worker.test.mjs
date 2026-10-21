import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { catalogueTestWorkerMode, runCatalogueTestOnce, holdCatalogueTestWorker } from "../scripts/catalogue-test-worker.mjs";

test("diagnostic worker defaults to no streaming or database clients", () => {
  for (const args of [[], ["--check"]]) assert.equal(catalogueTestWorkerMode(args), "CHECK_ONLY");
  const result = spawnSync(process.execPath, ["scripts/catalogue-test-worker.mjs", "--check"], { cwd: new URL("..", import.meta.url), encoding: "utf8",
    env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {} });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).streamingStarted, false);
});
test("serve mode requires exact two opt-ins and rejects mixed flags", () => {
  const env = { RUVANAS_CATALOGUE_TEST_ALLOW_LIVE: "true", RUVANAS_CATALOGUE_TEST_STATION_ID: "cmvcnbwi20008hr23sd76psi8" };
  assert.equal(catalogueTestWorkerMode(["--serve-tests"], env), "SERVE_EXPLICIT_OWNER_TESTS");
  for (const args of [["--live"], ["--serve-tests", "--check"], ["--station", "other"]]) assert.throws(() => catalogueTestWorkerMode(args, env));
  assert.throws(() => catalogueTestWorkerMode(["--serve-tests"], {}));
  assert.throws(() => catalogueTestWorkerMode(["--serve-tests"], { ...env, RUVANAS_CATALOGUE_TEST_STATION_ID: "other" }));
});
test("default web startup never adds the catalogue test worker", async () => {
  const startup = await readFile(new URL("../scripts/start-production.mjs", import.meta.url), "utf8");
  assert.equal(startup.includes("catalogue-test-worker"), false);
  const docker = await readFile(new URL("../Dockerfile.catalogue-test-worker", import.meta.url), "utf8");
  assert.match(docker, /CMD \["node", "scripts\/catalogue-test-worker.mjs", "--check"\]/);
});

const SELECTED = "cselectedtest00000000000001", STATION = "cmvcnbwi20008hr23sd76psi8";
const COMPLETED = { status: "COMPLETED", code: "CATALOGUE_TEST_COMPLETED", stopConfirmed: true };
function onceFixture(overrides = {}) {
  let instant = Date.parse("2026-10-21T12:00:00Z"), monotonic = 0;
  const row = { authorized: true, id: SELECTED, stationId: STATION, status: "PREPARED", stopRequestedAt: null,
    expiresAt: new Date(instant + 600000), deadlineAt: new Date(instant + 300000) };
  const calls = { loaded: [], leases: [], runs: [], waits: [] }, controller = new AbortController();
  const options = { sessionId: SELECTED, signal: controller.signal, now: () => new Date(instant), monotonicNow: () => monotonic,
    loadSelected: async ({ sessionId }) => { calls.loaded.push(sessionId); return { ...row }; },
    renewLease: async ({ sessionId }) => { calls.leases.push(sessionId); return true; },
    runSelected: async id => { calls.runs.push(id); return COMPLETED; },
    wait: async milliseconds => { calls.waits.push(milliseconds); instant += milliseconds; monotonic += milliseconds; }, ...overrides };
  return { row, calls, controller, options, advance: milliseconds => { instant += milliseconds; monotonic += milliseconds; } };
}

test("once mode requires the exact station/live gates and a single opaque session selector", () => {
  const env = { RUVANAS_CATALOGUE_TEST_ALLOW_LIVE: "true", RUVANAS_CATALOGUE_TEST_STATION_ID: STATION, RUVANAS_CATALOGUE_TEST_SESSION_ID: SELECTED };
  assert.equal(catalogueTestWorkerMode(["--serve-test-once"], env), "SERVE_ONE_EXPLICIT_OWNER_TEST");
  assert.equal(catalogueTestWorkerMode(["--check"], env), "CHECK_ONLY");
  for (const value of [undefined, "", "../another-test", "https://secret.invalid", "cshort", "c" + "x".repeat(41)]) {
    assert.throws(() => catalogueTestWorkerMode(["--serve-test-once"], { ...env, RUVANAS_CATALOGUE_TEST_SESSION_ID: value }), { code: "TEST_WORKER_SESSION_REQUIRED" });
  }
  assert.throws(() => catalogueTestWorkerMode(["--serve-test-once"], { ...env, RUVANAS_CATALOGUE_TEST_ALLOW_LIVE: "TRUE" }));
  assert.throws(() => catalogueTestWorkerMode(["--serve-test-once", "--serve-tests"], env));
  assert.throws(() => catalogueTestWorkerMode(["--serve-test-once"], { ...env, RUVANAS_CATALOGUE_TEST_STATION_ID: "other" }));
});

test("a selected prepared session waits only for its own explicit arming and runs exactly once", async () => {
  const f = onceFixture();
  f.options.wait = async milliseconds => { f.calls.waits.push(milliseconds); f.advance(milliseconds); f.row.status = "ARMED"; };
  const result = await runCatalogueTestOnce(f.options);
  assert.equal(result, COMPLETED);
  assert.deepEqual(f.calls.loaded, [SELECTED, SELECTED]); assert.deepEqual(f.calls.runs, [SELECTED]);
  assert.ok(f.calls.leases.every(id => id === SELECTED)); assert.equal(f.calls.waits.length, 1);
});

test("running, terminal, expired, stopped, missing and foreign selected rows never claim or resume audio", async () => {
  for (const patch of [{ status: "RUNNING" }, { status: "COMPLETE" }, { status: "STOPPED" }, { status: "FAILED" }, { status: "EXPIRED" },
    { expiresAt: new Date("2026-10-21T12:00:00Z") }, { status: "ARMED", deadlineAt: new Date("2026-10-21T12:00:00Z") },
    { stopRequestedAt: new Date() }, { id: "cforeignsession000000000001" }, { stationId: "cforeignstation000000000001" }, { authorized: false }]) {
    const f = onceFixture(); Object.assign(f.row, patch);
    const result = await runCatalogueTestOnce(f.options);
    assert.notEqual(result.status, "COMPLETED"); assert.equal(result.stopConfirmed, true);
    assert.deepEqual(f.calls.loaded, [SELECTED]); assert.equal(f.calls.leases.length, 0); assert.equal(f.calls.runs.length, 0);
  }
  const missing = onceFixture({ loadSelected: async () => null });
  assert.equal((await runCatalogueTestOnce(missing.options)).code, "TEST_WORKER_SESSION_MISMATCH");
});

test("the prepared wait is bounded by its stored expiry and the original monotonic authorization ceiling", async () => {
  for (const expiry of [4500, 900000]) {
    const f = onceFixture(); f.row.expiresAt = new Date(Date.parse("2026-10-21T12:00:00Z") + expiry);
    const result = await runCatalogueTestOnce(f.options);
    assert.equal(result.code, "TEST_REQUEST_EXPIRED"); assert.equal(f.calls.runs.length, 0);
    assert.equal(f.calls.waits.reduce((sum, value) => sum + value, 0), Math.min(expiry, 600000));
  }
});

test("lease loss, owner denial and cancellation fail closed without switching IDs or retrying", async () => {
  const denied = onceFixture({ loadSelected: async () => { throw Object.assign(new Error("private-owner-detail"), { code: "TEST_OWNER_SESSION_REQUIRED" }); } });
  assert.equal((await runCatalogueTestOnce(denied.options)).code, "TEST_OWNER_SESSION_REQUIRED"); assert.equal(denied.calls.runs.length, 0);
  const lost = onceFixture({ renewLease: async () => false }); lost.row.status = "ARMED";
  assert.equal((await runCatalogueTestOnce(lost.options)).code, "TEST_WORKER_LEASE_BUSY"); assert.equal(lost.calls.runs.length, 0);
  const cancelled = onceFixture(); cancelled.controller.abort();
  assert.equal((await runCatalogueTestOnce(cancelled.options)).code, "TEST_WORKER_STOPPED"); assert.equal(cancelled.calls.loaded.length, 0);
  const uncertain = onceFixture({ runSelected: async () => { throw new Error("unconfirmed private resource"); } }); uncertain.row.status = "ARMED";
  const result = await runCatalogueTestOnce(uncertain.options);
  assert.equal(result.stopConfirmed, false); assert.equal(result.code, "CATALOGUE_TEST_STOP_UNCONFIRMED");
  assert.equal(uncertain.calls.loaded.length, 1); assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("expiry while renewing the selected worker lease still cannot reach the audio runner", async () => {
  const f = onceFixture(); f.row.status = "ARMED";
  f.options.renewLease = async () => { f.advance(300001); return true; };
  const result = await runCatalogueTestOnce(f.options);
  assert.equal(result.code, "TEST_REQUEST_EXPIRED"); assert.equal(f.calls.runs.length, 0);
});

test("a cancelled or timed-out selected lookup is never adopted later for playback", { timeout: 5000 }, async () => {
  for (const cancel of [true, false]) {
    const f = onceFixture(); f.row.status = "ARMED";
    let complete;
    f.options.loadSelected = ({ sessionId }) => { f.calls.loaded.push(sessionId); return new Promise(resolve => { complete = resolve; }); };
    const pending = runCatalogueTestOnce(f.options);
    await new Promise(resolve => setImmediate(resolve));
    if (cancel) f.controller.abort();
    const result = await pending;
    assert.equal(result.code, cancel ? "TEST_WORKER_STOPPED" : "TEST_WORKER_ONCE_LOOKUP_TIMEOUT");
    complete({ ...f.row }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls.loaded, [SELECTED]); assert.equal(f.calls.leases.length, 0); assert.equal(f.calls.runs.length, 0);
  }
});

test("completion enters a genuinely inert hold and has no more selected reads or audio attempts", async () => {
  for (const rowStatus of ["ARMED", "COMPLETE", "RUNNING", "EXPIRED"]) {
    const f = onceFixture(); f.row.status = rowStatus;
    const result = await runCatalogueTestOnce(f.options);
    assert.equal(result.status, rowStatus === "ARMED" ? "COMPLETED" : "REFUSED");
    const before = structuredClone(f.calls);
    let settled = false;
    const held = holdCatalogueTestWorker(f.controller.signal).then(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(settled, false); assert.deepEqual(f.calls, before);
    f.controller.abort(); await held;
    assert.equal(settled, true); assert.deepEqual(f.calls, before);
  }
});

test("the actual one-shot branch never uses arbitrary ARMED selection or expires other rows and cleans before holding", async () => {
  const source = (await readFile(new URL("../scripts/catalogue-test-worker.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const branch = source.slice(source.indexOf("if (once) {\n      onceResult"), source.indexOf("} else while (!stop.signal.aborted"));
  assert.match(branch, /runCatalogueTestOnce\(\{ sessionId: selectedSessionId/);
  assert.match(branch, /where: \{ id: selectedSessionId, stationId: LIMITS.stationId, status: "ARMED" \}/);
  assert.doesNotMatch(branch, /findFirst|deadlineAt: \{ lte|session\.id/);
  assert.ok(source.indexOf("storage.destroy(); await db.$disconnect();") < source.indexOf("await holdCatalogueTestWorker(stop.signal)"));
  assert.ok(source.indexOf("await holdCatalogueTestWorker(stop.signal)") < source.indexOf('process.removeListener("SIGINT", onStop)'));
});
