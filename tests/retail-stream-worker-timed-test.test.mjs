import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { retailTimedTestPlan, runRetailTimedTest, spawnRetailTestChild } from "../lib/retail-stream-test-runner.mjs";

const NOW = Date.parse("2026-10-25T06:00:00.000Z");
const arg = offset => [`--test-until=${new Date(NOW + offset).toISOString()}`];
function fixture({ offset = 300000, closeOnTerm = true, failSpawn = false, advanceOnSpawn = 0 } = {}) {
  let close, instant = NOW, launches = 0, standbyCalls = 0, cleanupCalls = 0;
  const signals = [], events = [], timers = new Map(), controller = new AbortController();
  const child = { closed: new Promise(resolve => { close = resolve; }),
    terminate(signal) { signals.push(signal); if (signal === "SIGKILL" || closeOnTerm) close({ code: 0, signal }); return true; },
    cleanup() { cleanupCalls++; return true; } };
  const options = { args: arg(offset), now: () => instant, signal: controller.signal,
    spawnWorker() { launches++; instant += advanceOnSpawn; if (failSpawn) throw new Error("synthetic-secret-must-not-log"); return child; },
    standby: async () => { standbyCalls++; }, log: row => events.push(row),
    setTimer(fn, delay) { const id = Symbol(); timers.set(id, { fn, delay }); return id; },
    clearTimer(id) { timers.delete(id); } };
  return { options, child, close, signals, events, timers, controller,
    setTime: value => { instant = value; },
    fire: delay => { const entry = [...timers].find(([, row]) => row.delay === delay); assert.ok(entry, `timer ${delay} exists`); timers.delete(entry[0]); entry[1].fn(); },
    get counts() { return { launches, standbyCalls, cleanupCalls }; } };
}

test("timed test requires one canonical UTC deadline no more than five minutes away", () => {
  assert.equal(retailTimedTestPlan(arg(1), NOW).serve, true);
  assert.equal(retailTimedTestPlan(arg(300000), NOW).remainingMs, 300000);
  assert.equal(retailTimedTestPlan(arg(300001), NOW).reason, "DEADLINE_TOO_FAR");
  for (const offset of [0, -1, -3600000]) assert.equal(retailTimedTestPlan(arg(offset), NOW).reason, "DEADLINE_EXPIRED");
  for (const args of [[], ["--test-until"], ["--test-until=secret"], [...arg(1000), "--serve"], ["--test-until=2026-02-30T06:00:00.000Z"],
    ["--test-until=2026-10-25T08:00:01.000+02:00"], ["--test-until=2026-10-25T06:00:01Z"]]) {
    assert.equal(retailTimedTestPlan(args, NOW).reason, "INVALID_DEADLINE");
  }
});

test("expired, distant and malformed invocations enter standby without spawning a source", async () => {
  for (const args of [arg(-1), arg(300001), ["--test-until=secret"], [...arg(1000), "--serve"]]) {
    const f = fixture(); const result = await runRetailTimedTest({ ...f.options, args });
    assert.equal(result.served, false); assert.deepEqual(f.counts, { launches: 0, standbyCalls: 1, cleanupCalls: 0 });
    assert.equal(f.timers.size, 0); assert.ok(!JSON.stringify(f.events).includes("secret"));
  }
});

test("fixed deadline terminates one child, confirms closure, then stays in standby", async () => {
  const f = fixture(), task = runRetailTimedTest(f.options);
  assert.equal(f.counts.launches, 1); assert.equal(f.counts.standbyCalls, 0);
  f.fire(300000); const result = await task;
  assert.equal(result.served, true); assert.equal(result.cleanupConfirmed, true);
  assert.deepEqual(f.signals, ["SIGTERM"]); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.counts, { launches: 1, standbyCalls: 1, cleanupCalls: 1 });
  assert.deepEqual(f.events.map(row => row.event), ["test_worker_started", "test_stopping", "test_child_closed"]);
});

test("unresponsive serving child is hard killed after fifteen seconds before standby", async () => {
  const f = fixture({ closeOnTerm: false }), task = runRetailTimedTest(f.options);
  f.fire(300000); assert.equal(f.counts.standbyCalls, 0); f.fire(15000); await task;
  assert.deepEqual(f.signals, ["SIGTERM", "SIGKILL"]); assert.equal(f.counts.standbyCalls, 1); assert.equal(f.timers.size, 0);
});

test("child failure and early exit do not restart it; cleanup precedes standby", async () => {
  const f = fixture(), task = runRetailTimedTest(f.options); f.close({ code: 1, signal: null }); await task;
  assert.deepEqual(f.counts, { launches: 1, standbyCalls: 1, cleanupCalls: 1 }); assert.equal(f.timers.size, 0);
  const broken = fixture({ failSpawn: true }); await runRetailTimedTest(broken.options);
  assert.deepEqual(broken.counts, { launches: 1, standbyCalls: 1, cleanupCalls: 0 });
  assert.ok(!JSON.stringify(broken.events).includes("synthetic-secret"));
});

test("shutdown before or during the test cannot leave a serving child alive", async () => {
  const stopped = fixture(); stopped.controller.abort(); await runRetailTimedTest(stopped.options);
  assert.equal(stopped.counts.launches, 0);
  const f = fixture(), task = runRetailTimedTest(f.options); f.controller.abort(); await task;
  assert.deepEqual(f.signals, ["SIGTERM"]); assert.equal(f.timers.size, 0);
  const racing = fixture(); await runRetailTimedTest({ ...racing.options,
    spawnWorker: () => { racing.controller.abort(); return racing.child; } });
  assert.deepEqual(racing.signals, ["SIGTERM"]); assert.equal(racing.timers.size, 0);
});

test("restart after the absolute deadline cannot repeat the test, and clock rollback cannot extend its timer", async () => {
  const f = fixture({ advanceOnSpawn: -3600000 }), task = runRetailTimedTest(f.options);
  assert.deepEqual([...f.timers.values()].map(row => row.delay), [300000]); f.fire(300000); await task;
  const restarted = fixture(); restarted.setTime(NOW + 300001); await runRetailTimedTest(restarted.options);
  assert.equal(restarted.counts.launches, 0); assert.equal(restarted.counts.standbyCalls, 1);
});

test("serving child uses an isolated POSIX group and cleans descendants after child exit", async () => {
  const child = new EventEmitter(); child.pid = 12345;
  const calls = [], kills = [];
  const supervisor = spawnRetailTestChild({ scriptPath: "/app/scripts/retail-stream-worker.mjs", execPath: "/usr/bin/node",
    env: { RUVANAS_RETAIL_PLAYOUT_ENABLED: "true" }, platform: "linux",
    spawnImpl: (...args) => { calls.push(args); return child; }, kill: (...args) => { kills.push(args); } });
  assert.equal(calls[0][2].detached, true); assert.equal(calls[0][2].shell, false);
  assert.deepEqual(calls[0][1], ["/app/scripts/retail-stream-worker.mjs", "--serve"]);
  supervisor.terminate("SIGTERM"); child.emit("close", 0, null); await supervisor.closed; assert.equal(supervisor.cleanup(), true);
  assert.deepEqual(kills, [[-12345, "SIGTERM"], [-12345, "SIGKILL"]]);
});

test("missing process group is already closed; unexpected kill failures are never broadened", async () => {
  for (const code of ["ESRCH", "EPERM"]) {
    const child = new EventEmitter(); child.pid = 34567; let attempts = 0;
    const supervisor = spawnRetailTestChild({ scriptPath: "/app/worker.mjs", platform: "linux", spawnImpl: () => child,
      kill: pid => { attempts++; assert.equal(pid, -34567); throw Object.assign(new Error("synthetic"), { code }); } });
    assert.equal(supervisor.cleanup(), code === "ESRCH"); assert.equal(attempts, 1);
    child.emit("close", 0, null); await supervisor.closed;
  }
});

test("actual timed CLI enters standby after disabled serve exits, without retrying or opening cloud connections", { timeout: 6000 }, async () => {
  const script = fileURLToPath(new URL("../scripts/retail-stream-worker.mjs", import.meta.url));
  const child = spawn(process.execPath, [script, `--test-until=${new Date(Date.now() + 30000).toISOString()}`], {
    env: { ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}), RUVANAS_RETAIL_PLAYOUT_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = once(child, "close");
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("timed CLI did not reach standby")); }, 4000);
      const check = () => { if (stdout.includes("standby_ready")) { cleanup(); resolve(); } };
      const cleanup = () => { clearTimeout(timer); child.stdout.off("data", check); };
      child.stdout.on("data", check); check();
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const rows = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(rows.filter(row => row.event === "test_worker_started").length, 1);
    assert.equal(rows.filter(row => row.event === "test_child_closed").length, 1);
    assert.equal(rows.filter(row => row.event === "standby_ready").length, 1);
    assert.equal(rows.some(row => row.event === "worker_ready"), false);
    assert.match(stderr, /RETAIL_WORKER_NOT_ENABLED/);
  } finally { child.kill("SIGTERM"); await closed; }
});
