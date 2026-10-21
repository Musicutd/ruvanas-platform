import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import test from "node:test";
import { cleanNoAudioEnvironment, safeNoAudioCommit, verifyEncoderNoAudio, runEncoderNoAudio } from "../scripts/online-radio-encoder-no-audio.mjs";

const responses = [
  { mode: "CHECK_ONLY", streamingStarted: false, cloudAccessed: false },
  { ok: true, mode: "CHECK", databaseAccessed: false, readOnly: true },
  { passed: true, networkBlocked: true, processStartBlocked: true, liveEntryCalled: false }
];
function fakeSpawner({ hang = false, failAt = -1, outputs = responses } = {}) {
  const calls = [], children = [];
  const spawnProcess = (executable, args, options) => {
    const index = calls.length;
    calls.push({ executable, args, options });
    const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
      kill() { this.killed = true; queueMicrotask(() => this.emit("close", null)); return true; } });
    children.push(child);
    if (!hang) queueMicrotask(() => {
      child.stdout.write(JSON.stringify(outputs[index]));
      child.stderr.write("synthetic-private-error-never-forward");
      child.emit("close", index === failAt ? 1 : 0);
    });
    return child;
  };
  return { spawnProcess, calls, children };
}

test("only PATH and Windows SystemRoot enter checks; commit logs accept complete hexadecimal hashes only", () => {
  const reads = [], environment = new Proxy({ PATH: "synthetic-path", SystemRoot: "synthetic-system" }, {
    get(target, key) { reads.push(key); if (!["PATH", "SystemRoot"].includes(key)) throw new Error("credential access forbidden"); return target[key]; }
  });
  assert.deepEqual(cleanNoAudioEnvironment(environment, "linux"), { PATH: "synthetic-path" });
  assert.deepEqual(cleanNoAudioEnvironment(environment, "win32"), { PATH: "synthetic-path", SystemRoot: "synthetic-system" });
  assert.ok(reads.every(key => ["PATH", "SystemRoot"].includes(key)));
  assert.equal(safeNoAudioCommit("A".repeat(40)), "a".repeat(40));
  assert.equal(safeNoAudioCommit("b".repeat(64)), "b".repeat(64));
  for (const value of ["private-secret", "a".repeat(39), "a".repeat(40) + "\n", null, {}]) assert.equal(safeNoAudioCommit(value), null);
});

test("three bounded clean-environment checks log booleans and never invoke a live entrypoint", async () => {
  const f = fakeSpawner();
  const result = await verifyEncoderNoAudio({ spawnProcess: f.spawnProcess, environment: { PATH: "synthetic", DATABASE_URL: "must-not-copy", R2_SECRET_ACCESS_KEY: "must-not-copy" } });
  assert.deepEqual(result, { dispatcherCheck: true, sourceReportCheck: true, moduleImportsCheck: true, verificationPass: true });
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => Object.keys(call.options.env).join(",") === "PATH" && call.options.shell === false));
  assert.equal(f.calls[0].args.at(-1), "--check"); assert.equal(f.calls[1].args.at(-1), "--check");
  const code = f.calls[2].args.at(-1);
  assert.match(code, /networkBlocked: true/); assert.match(code, /syncBuiltinESMExports/);
  assert.doesNotMatch(code, /runLiveEncoder\s*\(|new PrismaClient|new S3Client|--serve/);
});

test("failed, malformed and unexpected child results cannot produce a verification pass or leak errors", async () => {
  for (const f of [fakeSpawner({ failAt: 1 }), fakeSpawner({ outputs: [{ mode: "EXPLICIT_LIVE" }] })]) {
    const result = await verifyEncoderNoAudio({ spawnProcess: f.spawnProcess, environment: {} });
    assert.equal(result.verificationPass, false); assert.match(result.reasonCode, /^NO_AUDIO_[A-Z_]+$/);
    assert.doesNotMatch(JSON.stringify(result), /private-error/);
  }
  const oversized = fakeSpawner({ outputs: [{ privateText: "x".repeat(20000) }] });
  assert.equal((await verifyEncoderNoAudio({ spawnProcess: oversized.spawnProcess, environment: {} })).reasonCode, "NO_AUDIO_CHECK_OUTPUT_LIMIT");
});

test("a stalled check and shutdown during verification kill the child without waiting indefinitely", async () => {
  const f = fakeSpawner({ hang: true });
  const result = await verifyEncoderNoAudio({ spawnProcess: f.spawnProcess, environment: {}, timeoutMs: 50 });
  assert.equal(result.reasonCode, "NO_AUDIO_CHECK_TIMEOUT"); assert.equal(f.children[0].killed, true);
  const stopped = fakeSpawner({ hang: true }), controller = new AbortController();
  const pending = verifyEncoderNoAudio({ spawnProcess: stopped.spawnProcess, environment: {}, signal: controller.signal });
  controller.abort();
  assert.equal((await pending).reasonCode, "NO_AUDIO_CHECK_ABORTED"); assert.equal(stopped.children[0].killed, true);
  const alreadyAborted = fakeSpawner();
  assert.equal((await verifyEncoderNoAudio({ spawnProcess: alreadyAborted.spawnProcess, environment: {}, signal: controller.signal })).reasonCode, "NO_AUDIO_CHECK_ABORTED");
  assert.equal(alreadyAborted.calls.length, 0);
});

test("after successful checks the helper stays held until explicitly stopped and logs no child messages", async () => {
  const f = fakeSpawner(), logs = [], controller = new AbortController();
  const pending = runEncoderNoAudio({ spawnProcess: f.spawnProcess, environment: { RENDER_GIT_COMMIT: "c".repeat(40), DATABASE_URL: "must-not-print" },
    signal: controller.signal, writeLog: value => { logs.push(value); if (value.event === "no_audio_verification") controller.abort(); } });
  assert.equal((await pending).verificationPass, true);
  assert.deepEqual(logs.map(row => row.event), ["no_audio_verification_started", "no_audio_verification", "no_audio_hold_stopped"]);
  assert.ok(logs.every(row => row.streamingStarted === false && row.databaseAccessed === false && row.cloudAccessed === false));
  assert.ok(logs.every(row => row.deployedCommit === "c".repeat(40)));
  assert.doesNotMatch(JSON.stringify(logs), /must-not-print|private-error/);
});

test("a failed verification remains held rather than restarting, and SIGTERM restores signal handlers", async () => {
  const f = fakeSpawner({ failAt: 0 }), logs = [];
  const before = { term: process.listenerCount("SIGTERM"), interrupt: process.listenerCount("SIGINT") };
  let settled = false;
  const pending = runEncoderNoAudio({ spawnProcess: f.spawnProcess, environment: { RENDER_GIT_COMMIT: "unsafe-not-a-hash" },
    writeLog: value => { logs.push(value); } }).then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(settled, false, "failure must remain idle, without a restart loop or another check");
  assert.equal(f.calls.length, 1); assert.equal(logs.at(-1).verificationPass, false);
  process.emit("SIGTERM");
  assert.equal((await pending).verificationPass, false);
  assert.equal(logs.at(-1).event, "no_audio_hold_stopped");
  assert.ok(logs.every(row => row.deployedCommit === null));
  assert.equal(process.listenerCount("SIGTERM"), before.term); assert.equal(process.listenerCount("SIGINT"), before.interrupt);
});

test("actual helper verifies installed imports without credentials and exits cleanly on SIGTERM", { timeout: 15000 }, async () => {
  const environment = { ...cleanNoAudioEnvironment(), RENDER_GIT_COMMIT: "d".repeat(40), DATABASE_URL: "synthetic-must-not-use",
    SECRET_ENCRYPTION_KEY: "synthetic-must-not-use", R2_ENDPOINT: "synthetic-must-not-use", R2_SECRET_ACCESS_KEY: "synthetic-must-not-use" };
  const child = spawn(process.execPath, ["scripts/online-radio-encoder-no-audio.mjs"], { env: environment,
    windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", verified = false;
  const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 12000);
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.on("data", chunk => {
    stdout += chunk;
    if (!verified && stdout.includes('"event":"no_audio_verification"')) { verified = true; child.kill("SIGTERM"); }
  });
  try {
    const result = await closed;
    const logs = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const verification = logs.find(row => row.event === "no_audio_verification");
    assert.equal(verification?.verificationPass, true, "all installed imports must pass under the no-network/no-process guard");
    assert.equal(verification.dispatcherCheck, true); assert.equal(verification.sourceReportCheck, true); assert.equal(verification.moduleImportsCheck, true);
    // Windows forcibly terminates child processes for SIGTERM; POSIX delivers it to the handler.
    if (process.platform !== "win32") { assert.equal(result.code, 0); assert.ok(logs.some(row => row.event === "no_audio_hold_stopped")); }
    assert.doesNotMatch(stdout + stderr, /synthetic-must-not-use/);
  } finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});
