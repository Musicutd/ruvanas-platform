import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { catalogueTestWorkerMode, runCatalogueTestOnce, holdCatalogueTestWorker, renewCatalogueTestWorkerLease, catalogueTestPreparationPlan } from "../scripts/catalogue-test-worker.mjs";

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

function addHourGrant(fixture) {
  const issuedAt = fixture.options.now();
  Object.assign(fixture.row, { profileId: "ONE_HOUR", durationSeconds: 3600,
    authorization: { profileId: "ONE_HOUR", maximumSeconds: 3600, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 4_200_000).toISOString() },
    expiresAt: new Date(issuedAt.getTime() + 4_200_000), deadlineAt: new Date(issuedAt.getTime() + 3_600_000) });
}

test("a 70-minute hour-test grant still allows at most ten minutes of pre-arm waiting", async () => {
  const f = onceFixture(); addHourGrant(f);
  assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_REQUEST_EXPIRED");
  assert.equal(f.calls.waits.reduce((total, value) => total + value, 0), 600000);
  assert.equal(f.calls.runs.length, 0);
  const stale = onceFixture(); addHourGrant(stale); stale.advance(590000);
  assert.equal((await runCatalogueTestOnce(stale.options)).code, "TEST_REQUEST_EXPIRED");
  assert.equal(stale.calls.waits.reduce((total, value) => total + value, 0), 10000);
});

test("an armed hour session remains exact-once and an untrusted extended profile never reaches a lease", async () => {
  const f = onceFixture(); addHourGrant(f); f.row.status = "ARMED";
  assert.equal(await runCatalogueTestOnce(f.options), COMPLETED);
  assert.deepEqual(f.calls.runs, [SELECTED]); assert.deepEqual(f.calls.waits, []);
  for (const changes of [{ profileId: "ONE_HOUR" }, { profileId: "UNKNOWN" }, { authorization: null },
    { authorization: { profileId: "ONE_HOUR", maximumSeconds: 300 } }]) {
    const denied = onceFixture(); denied.row.status = "ARMED"; Object.assign(denied.row, changes);
    assert.equal((await runCatalogueTestOnce(denied.options)).code, "TEST_PROFILE_INVALID");
    assert.deepEqual(denied.calls.leases, []); assert.deepEqual(denied.calls.runs, []);
  }
});

function preparationSession(count, bytes, hour = false) {
  return { authorized: true, ...(hour ? { profileId: "ONE_HOUR", authorization: { profileId: "ONE_HOUR", maximumSeconds: 3600 } } : {}),
    tracks: Array.from({ length: count }, (_, index) => ({ id: `track${index}`, mediaAssetId: `asset${index}`,
      track: { mediaAsset: { id: `asset${index}`, libraryType: "RUVANAS_CATALOGUE", organisationId: null,
        storageKey: `catalogue/music/${index.toString(16).padStart(64, "0")}.mp3`, sizeBytes: BigInt(bytes) } } })) };
}

test("worker preparation validates all metadata against fixed profile file/count budgets before storage access", () => {
  const plan = catalogueTestPreparationPlan(preparationSession(40, 6 * 1024 * 1024, true));
  assert.equal(plan.totalBytes, 240 * 1024 * 1024); assert.equal(plan.entries.length, 40);
  assert.equal(plan.profile.maximumUniqueFileBytes, 256 * 1024 * 1024); assert.equal(Object.isFrozen(plan.entries), true);
  assert.throws(() => catalogueTestPreparationPlan(preparationSession(40, 7 * 1024 * 1024, true)), { code: "TEST_CACHE_LIMIT" });
  assert.throws(() => catalogueTestPreparationPlan(preparationSession(41, 1024, true)), { code: "TEST_PLAN_CHANGED" });
  assert.throws(() => catalogueTestPreparationPlan(preparationSession(9, 1024)), { code: "TEST_PLAN_CHANGED" });
  assert.throws(() => catalogueTestPreparationPlan(preparationSession(8, 13 * 1024 * 1024)), { code: "TEST_CACHE_LIMIT" });
  assert.throws(() => catalogueTestPreparationPlan(preparationSession(1, 50 * 1024 * 1024 + 1, true)), { code: "TEST_MEDIA_IDENTITY_INVALID" });
  const forged = preparationSession(40, 1024); forged.testProfile = { maximumItems: 100, maximumUniqueFileBytes: Infinity };
  assert.throws(() => catalogueTestPreparationPlan(forged), { code: "TEST_PLAN_CHANGED" });
});

test("worker preflight counts shared immutable media once and rejects conflicting identities", () => {
  const session = preparationSession(3, 40 * 1024 * 1024);
  const shared = session.tracks[0].track.mediaAsset;
  session.tracks[1].mediaAssetId = shared.id; session.tracks[1].track.mediaAsset = { ...shared };
  assert.equal(catalogueTestPreparationPlan(session).totalBytes, 80 * 1024 * 1024);
  session.tracks[1].track.mediaAsset.sizeBytes += 1n;
  assert.throws(() => catalogueTestPreparationPlan(session), { code: "TEST_MEDIA_IDENTITY_INVALID" });
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

test("owner denial and cancellation fail closed without switching IDs or retrying audio", async () => {
  const denied = onceFixture({ loadSelected: async () => { throw Object.assign(new Error("private-owner-detail"), { code: "TEST_OWNER_SESSION_REQUIRED" }); } });
  assert.equal((await runCatalogueTestOnce(denied.options)).code, "TEST_OWNER_SESSION_REQUIRED"); assert.equal(denied.calls.runs.length, 0);
  const cancelled = onceFixture(); cancelled.controller.abort();
  assert.equal((await runCatalogueTestOnce(cancelled.options)).code, "TEST_WORKER_STOPPED"); assert.equal(cancelled.calls.loaded.length, 0);
  const uncertain = onceFixture({ runSelected: async () => { throw new Error("unconfirmed private resource"); } }); uncertain.row.status = "ARMED";
  const result = await runCatalogueTestOnce(uncertain.options);
  assert.equal(result.stopConfirmed, false); assert.equal(result.code, "CATALOGUE_TEST_STOP_UNCONFIRMED");
  assert.equal(uncertain.calls.loaded.length, 1); assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("a rolling-deploy lease drains before exactly one selected audio attempt", async () => {
  const f = onceFixture(); f.row.status = "ARMED";
  f.options.renewLease = async ({ sessionId }) => { f.calls.leases.push(sessionId); return f.calls.leases.length > 2; };
  assert.equal(await runCatalogueTestOnce(f.options), COMPLETED);
  assert.deepEqual(f.calls.waits, [3000, 3000]);
  assert.deepEqual(f.calls.loaded, [SELECTED, SELECTED, SELECTED]);
  assert.deepEqual(f.calls.leases, [SELECTED, SELECTED, SELECTED]);
  assert.deepEqual(f.calls.runs, [SELECTED]);
});

test("an occupied lease never extends either the prepared expiry or armed deadline", async () => {
  for (const status of ["PREPARED", "ARMED"]) {
    const f = onceFixture({ renewLease: async () => false }); f.row.status = status;
    if (status === "PREPARED") f.row.expiresAt = new Date(f.options.now().getTime() + 4500);
    else f.row.deadlineAt = new Date(f.options.now().getTime() + 4500);
    assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_REQUEST_EXPIRED");
    assert.deepEqual(f.calls.waits, [3000, 1500]); assert.deepEqual(f.calls.runs, []);
  }
});

test("lease retries revalidate authorization and stop immediately on cancellation", async () => {
  for (const change of ["cancel", "revoke", "running", "deadline"]) {
    const f = onceFixture({ renewLease: async () => false }); f.row.status = "ARMED";
    f.options.wait = async milliseconds => {
      f.calls.waits.push(milliseconds); f.advance(milliseconds);
      if (change === "cancel") f.controller.abort();
      if (change === "revoke") f.row.authorized = false;
      if (change === "running") f.row.status = "RUNNING";
      if (change === "deadline") f.row.deadlineAt = f.options.now();
    };
    const result = await runCatalogueTestOnce(f.options);
    assert.equal(result.code, ({ cancel: "TEST_WORKER_STOPPED", revoke: "TEST_WORKER_SESSION_MISMATCH",
      running: "TEST_WORKER_SESSION_NOT_STARTABLE", deadline: "TEST_REQUEST_EXPIRED" })[change]);
    assert.deepEqual(f.calls.runs, []); assert.equal(f.calls.waits.length, 1);
  }
});

test("ambiguous or throwing lease results are not retried", async () => {
  for (const value of [undefined, null, "false", 0]) {
    const f = onceFixture({ renewLease: async () => value }); f.row.status = "ARMED";
    assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_WORKER_LEASE_BUSY");
    assert.deepEqual(f.calls.waits, []); assert.deepEqual(f.calls.runs, []);
  }
  const f = onceFixture({ renewLease: async () => { throw Object.assign(new Error(), { code: "TEST_WORKER_LEASE_LOST" }); } });
  assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_WORKER_LEASE_LOST");
  assert.deepEqual(f.calls.waits, []); assert.deepEqual(f.calls.runs, []);
});

test("cold selected reads and lease acquisition may each take more than one second", { timeout: 10000 }, async () => {
  const f = onceFixture(); f.row.status = "ARMED";
  f.options.loadSelected = async ({ sessionId }) => {
    f.calls.loaded.push(sessionId); await new Promise(resolve => setTimeout(resolve, 1100)); return { ...f.row };
  };
  f.options.renewLease = async ({ sessionId }) => {
    f.calls.leases.push(sessionId); await new Promise(resolve => setTimeout(resolve, 1100)); return true;
  };
  assert.equal(await runCatalogueTestOnce(f.options), COMPLETED);
  assert.deepEqual(f.calls.loaded, [SELECTED]); assert.deepEqual(f.calls.leases, [SELECTED]); assert.deepEqual(f.calls.runs, [SELECTED]);
});

test("prestart lease timeouts are clipped to the selected expiry, armed deadline and original monotonic budget", { timeout: 5000 }, async () => {
  for (const boundary of ["expiry", "armed", "monotonic"]) {
    const f = onceFixture(); let complete, operationSignal;
    if (boundary === "expiry") f.row.expiresAt = new Date(f.options.now().getTime() + 40);
    if (boundary === "armed") { f.row.status = "ARMED"; f.row.deadlineAt = new Date(f.options.now().getTime() + 40); }
    if (boundary === "monotonic") {
      f.row.expiresAt = new Date(f.options.now().getTime() + 900000);
      f.options.loadSelected = async () => { f.advance(599960); return { ...f.row }; };
    }
    f.options.renewLease = ({ signal }) => { operationSignal = signal; return new Promise(resolve => { complete = resolve; }); };
    assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_REQUEST_EXPIRED");
    assert.equal(operationSignal.aborted, true);
    complete(true); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls.runs, []); assert.deepEqual(f.calls.waits, []);
  }
});

test("the first lookup respects the remaining original monotonic budget before any stored deadline is known", { timeout: 5000 }, async () => {
  const f = onceFixture(); let first = true, operationSignal;
  f.options.monotonicNow = () => { if (first) { first = false; return 0; } return 599960; };
  f.options.loadSelected = ({ signal }) => { operationSignal = signal; return new Promise(() => {}); };
  assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_REQUEST_EXPIRED");
  assert.equal(operationSignal.aborted, true); assert.deepEqual(f.calls.leases, []); assert.deepEqual(f.calls.runs, []);
});

test("a lookup after lease contention cannot outwait the previously validated armed deadline", { timeout: 5000 }, async () => {
  const f = onceFixture(); f.row.status = "ARMED"; f.row.deadlineAt = new Date(f.options.now().getTime() + 3040);
  let operationSignal, complete;
  f.options.loadSelected = ({ sessionId, signal }) => {
    f.calls.loaded.push(sessionId);
    if (f.calls.loaded.length === 1) return Promise.resolve({ ...f.row });
    operationSignal = signal; return new Promise(resolve => { complete = resolve; });
  };
  f.options.renewLease = async () => false;
  assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_REQUEST_EXPIRED");
  assert.equal(operationSignal.aborted, true); assert.deepEqual(f.calls.waits, [3000]);
  complete({ ...f.row }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.runs, []);
});

test("a later row cannot extend the expiry or armed deadline already learned for this test", { timeout: 5000 }, async () => {
  for (const boundary of ["expiry", "armed"]) {
    const f = onceFixture(); let operationSignal;
    if (boundary === "expiry") f.row.expiresAt = new Date(f.options.now().getTime() + 3040);
    else { f.row.status = "ARMED"; f.row.deadlineAt = new Date(f.options.now().getTime() + 3040); }
    f.options.wait = async milliseconds => {
      f.calls.waits.push(milliseconds); f.advance(milliseconds);
      f.row.expiresAt = new Date(f.options.now().getTime() + 600000);
      f.row.deadlineAt = new Date(f.options.now().getTime() + 300000);
    };
    f.options.renewLease = ({ sessionId, signal }) => {
      f.calls.leases.push(sessionId);
      if (f.calls.leases.length === 1) return Promise.resolve(false);
      operationSignal = signal; return new Promise(() => {});
    };
    assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_REQUEST_EXPIRED");
    assert.equal(operationSignal.aborted, true); assert.deepEqual(f.calls.waits, [3000]); assert.deepEqual(f.calls.runs, []);
  }
});

const leaseSource = () => ({ providerKey: "CENTOVA_CAST", serverHost: "pollux.shoutca.st", sourcePort: 8282,
  bitrateKbps: 128, sourceUsername: null, centovaUsername: "ruvanastestradio", outboundAutoDjEnabled: false,
  sourcePasswordEncrypted: "synthetic-test-only" });
const leaseOwner = "catalogue-test:0123456789abcdef0123456789abcdef";

test("shutdown during the source read prevents a late lease write", async () => {
  const controller = new AbortController(); let complete; const writes = [];
  const db = { stationStreamConfig: { findUnique: () => new Promise(resolve => { complete = resolve; }),
    updateMany: async input => { writes.push(input); return { count: 1 }; } } };
  const pending = renewCatalogueTestWorkerLease({ db, owner: leaseOwner, signal: controller.signal });
  const rejection = assert.rejects(pending, { name: "AbortError" });
  controller.abort(); complete(leaseSource()); await rejection;
  assert.deepEqual(writes, []);
});

test("a lease write completing after shutdown releases only that exact owner", async () => {
  const controller = new AbortController(); let complete; const writes = [];
  const db = { stationStreamConfig: { findUnique: async () => leaseSource(), updateMany: input => {
    writes.push(input); return writes.length === 1 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ count: 1 });
  } } };
  const pending = renewCatalogueTestWorkerLease({ db, owner: leaseOwner, signal: controller.signal });
  const rejection = assert.rejects(pending, { name: "AbortError" });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); complete({ count: 1 }); await rejection;
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], { where: { stationId: STATION, encoderLeaseOwner: leaseOwner }, data: { encoderLeaseOwner: null, encoderLeaseUntil: null } });
});

test("a timed-out renewal is cancelled before a delayed source read can write", { timeout: 10000 }, async () => {
  const f = onceFixture(); f.row.status = "ARMED"; let complete; const writes = [];
  const db = { stationStreamConfig: { findUnique: () => new Promise(resolve => { complete = resolve; }),
    updateMany: async input => { writes.push(input); return { count: 1 }; } } };
  f.options.renewLease = ({ signal }) => renewCatalogueTestWorkerLease({ db, owner: leaseOwner, signal });
  assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_WORKER_ONCE_LOOKUP_TIMEOUT");
  complete(leaseSource()); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, []); assert.deepEqual(f.calls.runs, []); assert.deepEqual(f.calls.waits, []);
});

test("a timed-out in-flight lease write releases only its owner when it eventually completes", { timeout: 10000 }, async () => {
  const f = onceFixture(); f.row.status = "ARMED"; let complete; const writes = [];
  const db = { stationStreamConfig: { findUnique: async () => leaseSource(), updateMany: input => {
    writes.push(input); return writes.length === 1 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ count: 1 });
  } } };
  f.options.renewLease = ({ signal }) => renewCatalogueTestWorkerLease({ db, owner: leaseOwner, signal });
  assert.equal((await runCatalogueTestOnce(f.options)).code, "TEST_WORKER_ONCE_LOOKUP_TIMEOUT");
  complete({ count: 1 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], { where: { stationId: STATION, encoderLeaseOwner: leaseOwner }, data: { encoderLeaseOwner: null, encoderLeaseUntil: null } });
  assert.deepEqual(f.calls.runs, []); assert.deepEqual(f.calls.waits, []);
});

test("expiry while renewing the selected worker lease still cannot reach the audio runner", async () => {
  const f = onceFixture(); f.row.status = "ARMED";
  f.options.renewLease = async () => { f.advance(300001); return true; };
  const result = await runCatalogueTestOnce(f.options);
  assert.equal(result.code, "TEST_REQUEST_EXPIRED"); assert.equal(f.calls.runs.length, 0);
});

test("a cancelled or timed-out selected lookup is never adopted later for playback", { timeout: 10000 }, async () => {
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
  assert.match(branch, /runSelected: sessionId => \{ onceRunAttempted = true; return runOne\(sessionId\); \}/);
  assert.match(branch, /if \(!stop\.signal\.aborted \|\| onceRunAttempted\) \{/);
  assert.doesNotMatch(branch, /findFirst|deadlineAt: \{ lte|session\.id/);
  assert.ok(source.indexOf("storage.destroy(); await db.$disconnect();") < source.indexOf("await holdCatalogueTestWorker(stop.signal)"));
  assert.ok(source.indexOf("await holdCatalogueTestWorker(stop.signal)") < source.indexOf('process.removeListener("SIGINT", onStop)'));
});
