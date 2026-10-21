// Stopped-mode verification only. Importing this helper performs no work.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.dirname(directory);
const fail = code => Object.assign(new Error(code), { code });
const checks = ["dispatcherCheck", "sourceReportCheck", "moduleImportsCheck"];
const IMPORT_CHECK = `
const blocked = () => { throw new Error("NO_AUDIO_EXTERNAL_ACTION_REFUSED"); };
const net = (await import("node:net")).default;
const tls = (await import("node:tls")).default;
const http = (await import("node:http")).default;
const https = (await import("node:https")).default;
const dns = (await import("node:dns")).default;
const dnsPromises = (await import("node:dns/promises")).default;
const childProcess = (await import("node:child_process")).default;
net.connect = net.createConnection = net.Socket.prototype.connect = blocked;
tls.connect = http.request = http.get = https.request = https.get = blocked;
dns.lookup = dns.resolve = dnsPromises.lookup = dnsPromises.resolve = blocked;
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = blocked;
globalThis.fetch = blocked;
(await import("node:module")).syncBuiltinESMExports();
const modules = ["./scripts/online-radio-encoder-live.mjs", "./lib/online-radio-accounted-runner.mjs",
  "./lib/online-radio-accounted-transport.mjs", "./lib/online-radio-catalogue-policy.mjs",
  "./lib/online-radio-delivery-ledger.mjs", "./lib/online-radio-source-session.mjs"];
for (const name of modules) await import(name);
console.log(JSON.stringify({ passed: true, networkBlocked: true, processStartBlocked: true, liveEntryCalled: false }));
`;

export function cleanNoAudioEnvironment(environment = process.env, platform = process.platform) {
  const result = {};
  if (typeof environment.PATH === "string") result.PATH = environment.PATH;
  if (platform === "win32" && typeof environment.SystemRoot === "string") result.SystemRoot = environment.SystemRoot;
  return Object.freeze(result);
}

export function safeNoAudioCommit(value) {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? value.toLowerCase() : null;
}

function checkChild(args, { spawnProcess, environment, signal, timeoutMs }) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let child, timer, killTimer, settled = false, stopping = false, reason = null, bytes = 0, stdout = "";
    const finish = (value, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer);
      signal.removeEventListener("abort", cancel);
      error ? reject(error) : resolve(value);
    };
    const terminate = code => {
      if (settled || stopping) return;
      stopping = true; reason = code;
      try { child?.kill("SIGKILL"); } catch { /* No child output or raw process errors are exposed. */ }
      if (!settled) killTimer = setTimeout(() => finish(null, fail("NO_AUDIO_CHECK_STOP_UNCONFIRMED")), 2000);
    };
    const cancel = () => terminate("NO_AUDIO_CHECK_ABORTED");
    try {
      child = spawnProcess(process.execPath, args, { cwd: applicationRoot, env: environment,
        shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      if (!child || typeof child.on !== "function" || !child.stdout || !child.stderr || typeof child.kill !== "function") {
        terminate("NO_AUDIO_CHECK_FAILED"); return;
      }
      child.on("error", () => {
        if (child.pid == null) finish(null, fail("NO_AUDIO_CHECK_FAILED"));
        else terminate("NO_AUDIO_CHECK_FAILED");
      });
      child.once("close", code => {
        if (reason || signal.aborted || code !== 0) return finish(null, fail(reason || "NO_AUDIO_CHECK_FAILED"));
        try { finish(JSON.parse(stdout.trim())); } catch { finish(null, fail("NO_AUDIO_CHECK_FAILED")); }
      });
      const capture = (chunk, output) => {
        if (settled || stopping) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > 16384) return terminate("NO_AUDIO_CHECK_OUTPUT_LIMIT");
        if (output) stdout += chunk.toString("utf8");
      };
      child.stdout.on("data", chunk => capture(chunk, true));
      child.stderr.on("data", chunk => capture(chunk, false));
      signal.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => terminate("NO_AUDIO_CHECK_TIMEOUT"), timeoutMs);
      if (signal.aborted) cancel();
    } catch { finish(null, fail("NO_AUDIO_CHECK_FAILED")); }
  });
}

export async function verifyEncoderNoAudio({ spawnProcess = spawn, environment = process.env,
  signal = new AbortController().signal, timeoutMs = 10000 } = {}) {
  if (typeof spawnProcess !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000 ||
      typeof signal?.throwIfAborted !== "function") throw fail("NO_AUDIO_OPTIONS_INVALID");
  const result = { dispatcherCheck: false, sourceReportCheck: false, moduleImportsCheck: false, verificationPass: false };
  const options = { spawnProcess, environment: cleanNoAudioEnvironment(environment), signal, timeoutMs };
  const commands = [[path.join(directory, "online-radio-encoder-worker.mjs"), "--check"],
    [path.join(directory, "online-radio-source-report.mjs"), "--check"], ["--input-type=module", "-e", IMPORT_CHECK]];
  const accepts = [value => value?.mode === "CHECK_ONLY" && value.streamingStarted === false && value.cloudAccessed === false,
    value => value?.ok === true && value.mode === "CHECK" && value.databaseAccessed === false && value.readOnly === true,
    value => value?.passed === true && value.networkBlocked === true && value.processStartBlocked === true && value.liveEntryCalled === false];
  for (let index = 0; index < commands.length; index++) {
    try {
      const value = await checkChild(commands[index], options);
      signal.throwIfAborted();
      if (!accepts[index](value)) throw fail("NO_AUDIO_CHECK_FAILED");
      result[checks[index]] = true;
    } catch (error) {
      return Object.freeze({ ...result, failedCheck: checks[index], reasonCode:
        signal.aborted ? "NO_AUDIO_CHECK_ABORTED" : /^NO_AUDIO_[A-Z_]+$/.test(error?.code || "") ? error.code : "NO_AUDIO_CHECK_FAILED" });
    }
  }
  return Object.freeze({ ...result, verificationPass: true });
}

export async function runEncoderNoAudio({ environment = process.env, spawnProcess = spawn,
  writeLog = value => console.log(JSON.stringify(value)), signal: parentSignal, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort(fail("NO_AUDIO_CHECK_ABORTED"));
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  parentSignal?.addEventListener("abort", stop, { once: true });
  if (parentSignal?.aborted) stop();
  const base = { service: "ONLINE_RADIO_ENCODER", mode: "HELD_OFF_AIR", streamingStarted: false,
    databaseAccessed: false, cloudAccessed: false, deployedCommit: safeNoAudioCommit(environment.RENDER_GIT_COMMIT) };
  try {
    writeLog({ ...base, event: "no_audio_verification_started" });
    const verification = await verifyEncoderNoAudio({ environment, spawnProcess, signal: controller.signal, timeoutMs });
    writeLog({ ...base, event: "no_audio_verification", ...verification });
    if (!controller.signal.aborted) await new Promise(resolve => {
      const timer = setInterval(() => {}, 60000);
      const done = () => { clearInterval(timer); controller.signal.removeEventListener("abort", done); resolve(); };
      controller.signal.addEventListener("abort", done, { once: true });
      if (controller.signal.aborted) done();
    });
    writeLog({ ...base, event: "no_audio_hold_stopped" });
    return verification;
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    parentSignal?.removeEventListener("abort", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runEncoderNoAudio(); }
  catch { console.error(JSON.stringify({ service: "ONLINE_RADIO_ENCODER", event: "no_audio_helper_failed", streamingStarted: false })); process.exitCode = 1; }
}
