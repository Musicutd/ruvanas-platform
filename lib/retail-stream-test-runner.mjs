import { spawn } from "node:child_process";

const MAX_TEST_MS = 300000, KILL_GRACE_MS = 15000;
export function retailTimedTestPlan(args, now = Date.now()) {
  const invalid = reason => ({ serve: false, reason, deadlineAt: null, remainingMs: 0 });
  if (!Number.isFinite(now) || !Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string") return invalid("INVALID_DEADLINE");
  const match = /^--test-until=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/.exec(args[0]);
  const deadline = match ? Date.parse(match[1]) : NaN;
  if (!Number.isFinite(deadline) || new Date(deadline).toISOString() !== match[1]) return invalid("INVALID_DEADLINE");
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return { ...invalid("DEADLINE_EXPIRED"), deadlineAt: match[1] };
  if (remainingMs > MAX_TEST_MS) return { ...invalid("DEADLINE_TOO_FAR"), deadlineAt: match[1] };
  return { serve: true, reason: null, deadlineAt: match[1], remainingMs };
}

// The parent does no database/storage/audio work. A separate process group
// permits deadline enforcement even if the serving child's event loop stalls.
export function spawnRetailTestChild({ scriptPath, execPath = process.execPath, env = process.env,
  platform = process.platform, spawnImpl = spawn, kill = process.kill.bind(process) }) {
  const grouped = platform !== "win32";
  const child = spawnImpl(execPath, [scriptPath, "--serve"], { env, shell: false, windowsHide: true,
    detached: grouped, stdio: "inherit" });
  let spawnFailed = false;
  const closed = new Promise(resolve => {
    child.once("error", () => { spawnFailed = true; });
    child.once("close", (code, signal) => resolve({ code, signal, spawnFailed }));
  });
  function terminate(signal) {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return spawnFailed;
    try { if (grouped) kill(-child.pid, signal); else child.kill(signal); return true; }
    catch (error) { return error?.code === "ESRCH"; }
  }
  return { closed, terminate, cleanup: () => grouped ? terminate("SIGKILL") : true };
}

export async function runRetailTimedTest({ args, spawnWorker, standby, signal, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  const plan = retailTimedTestPlan(args, now());
  const report = (event, details = {}) => log({ service: "RETAIL_SHARED_AUDIO", mode: "TIMED_TEST", event,
    nodeVersion: process.version, platform: process.platform, ...details });
  if (!plan.serve || signal?.aborted) {
    report("test_standby", { reason: signal?.aborted ? "SHUTDOWN_REQUESTED" : plan.reason,
      deadlineAt: plan.deadlineAt, streamingStarted: false });
    await standby(); return { served: false, reason: plan.reason || "SHUTDOWN_REQUESTED" };
  }
  let child, deadlineTimer, killTimer, stopping = false;
  const stop = reason => {
    if (stopping || !child) return;
    stopping = true;
    report("test_stopping", { reason, deadlineAt: plan.deadlineAt });
    // Arm the hard deadline before touching the child. Killing its group also
    // closes a decoder left behind by a failed serving process.
    killTimer = setTimer(() => {
      report("test_force_stop", { deadlineAt: plan.deadlineAt }); child.terminate("SIGKILL");
    }, KILL_GRACE_MS);
    child.terminate("SIGTERM");
  };
  const shutdown = () => stop("SHUTDOWN_REQUESTED");
  let result, cleanupConfirmed = true;
  try {
    // Check again immediately before spawn; preparation must not extend time.
    const fresh = retailTimedTestPlan(args, now());
    if (!fresh.serve) { report("test_standby", { reason: fresh.reason, deadlineAt: plan.deadlineAt, streamingStarted: false }); }
    else {
      child = spawnWorker();
      deadlineTimer = setTimer(() => stop("DEADLINE_REACHED"), Math.min(fresh.remainingMs, Math.max(0, Date.parse(plan.deadlineAt) - now())));
      signal?.addEventListener("abort", shutdown, { once: true });
      if (signal?.aborted) shutdown();
      report("test_worker_started", { deadlineAt: plan.deadlineAt, maximumRuntimeMs: fresh.remainingMs });
      result = await child.closed;
    }
  } catch {
    report("test_runtime_failed", { deadlineAt: plan.deadlineAt });
  } finally {
    clearTimer(deadlineTimer); clearTimer(killTimer);
    signal?.removeEventListener("abort", shutdown);
    if (child) cleanupConfirmed = child.cleanup() === true;
  }
  report("test_child_closed", { deadlineAt: plan.deadlineAt, cleanupConfirmed,
    exitCode: Number.isInteger(result?.code) ? result.code : null, spawnFailed: result?.spawnFailed === true });
  // Never spawn again in this invocation. On container restart an elapsed
  // absolute deadline also goes directly to standby.
  await standby();
  return { served: Boolean(child), cleanupConfirmed, deadlineAt: plan.deadlineAt };
}
