import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { matchesIsolatedStudioHandoff, matchesIsolatedStudioPriorityHandoff, renderIsolatedStudioHandoffRehearsal } from "../lib/studio-isolated-handoff-rehearsal.mjs";
import { analyzeStudioListenerPcm } from "../lib/studio-listener-audio-sample.mjs";
import { parseStudioQueuePushReply, sendStudioQueuePush, studioQueuePushCommand } from "../lib/studio-encoder-transport.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(binary, args, directory) {
  return spawnSync(binary, args, { cwd: directory, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8" });
}

function encodeTone(directory, name, frequency, duration) {
  const output = path.join(directory, name);
  const encoded = run(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:sample_rate=16000:duration=${duration}`,
    "-codec:a", "libmp3lame", "-b:a", "128k", "-n", output], directory);
  if (encoded.status !== 0) throw new Error("The synthetic handoff tone could not be encoded.");
  return output;
}

async function waitForSocket(socketPath, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("The file-only encoder ended before opening its private socket.");
    if ((await stat(socketPath).catch(() => null))?.isSocket()) return;
    await sleep(100);
  }
  throw new Error("The file-only encoder did not open its private socket.");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const ended = new Promise((resolve) => child.once("close", resolve));
  child.kill("SIGTERM");
  await Promise.race([ended, sleep(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

// Only this synthetic, file-output test sends protected/skip commands. The
// production transport deliberately accepts studio_manual.push only.
function sendTestFixtureCommand(socketPath, command, parseReply) {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socketPath);
    let settled = false;
    let response = "";
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      connection.destroy();
      if (error) reject(error); else resolve(value);
    };
    connection.setTimeout(3000, () => finish(new Error("The isolated fixture command timed out.")));
    connection.on("connect", () => connection.write(command));
    connection.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 1024) return finish(new Error("The isolated fixture response was too large."));
      if (/(?:^|\n)END\r?\n?$/.test(response)) {
        try { finish(null, parseReply(response)); }
        catch (error) { finish(error); }
      }
    });
    connection.on("error", (error) => finish(error));
    connection.on("end", () => {
      if (!settled) finish(new Error("The isolated fixture command closed without an acknowledgement."));
    });
  });
}

function pushProtectedTestTone(socketPath, protectedPath) {
  return sendTestFixtureCommand(socketPath, `studio_protected.push ${protectedPath}\n`, parseStudioQueuePushReply);
}

function skipInterruptedManualTestTone(socketPath) {
  return sendTestFixtureCommand(socketPath, "studio_manual.skip\n", (reply) => {
    const lines = String(reply).replaceAll("\r", "").trim().split("\n");
    if (lines.at(-1) !== "END" || lines.length < 2 ||
        lines.slice(0, -1).some((line) => /error|unknown|invalid/i.test(line))) {
      throw new Error("The isolated Manual skip was not acknowledged.");
    }
    return { acknowledged: true, listenerVerified: false };
  });
}

// Runs only in the test derivative of the encoder image. The only Liquidsoap
// destination is a private local MP3 file; this cannot reach a stream server.
async function runFileOnlyScenario(priority) {
  const directory = `/tmp/ruvanas-studio-handoff-${randomBytes(6).toString("hex")}`;
  await mkdir(directory, { mode: 0o700 });
  try {
    const autodjPath = encodeTone(directory, "autodj.mp3", 440, 8);
    const manualPath = encodeTone(directory, "manual.mp3", 660, priority ? 8 : 4);
    const protectedPath = priority ? encodeTone(directory, "protected.mp3", 880, 3) : null;
    const playlistPath = path.join(directory, "autodj.m3u");
    const outputPath = path.join(directory, "file-sample.mp3");
    const socketPath = path.join(directory, "control.sock");
    const scriptPath = path.join(directory, "handoff.liq");
    const bundle = renderIsolatedStudioHandoffRehearsal({
      privateDirectory: directory, autodjPath, manualPath, protectedPath, playlistPath, outputPath, socketPath
    });
    await writeFile(playlistPath, bundle.playlistText, { flag: "wx", mode: 0o600 });
    await writeFile(scriptPath, bundle.liquidsoapText, { flag: "wx", mode: 0o600 });
    const checked = run("liquidsoap", ["--check", scriptPath], directory);
    if (checked.status !== 0) return { passed: false, stage: "FILE_ONLY_GRAPH_CHECK_FAILED",
      diagnostic: String(checked.stderr || checked.stdout || "").slice(-1000),
      sourceCommandAllowed: false, listenerVerified: false };

    const child = spawn("liquidsoap", [scriptPath], { cwd: directory, stdio: "ignore" });
    let manualAck;
    let protectedAck;
    let manualSkipAck;
    try {
      await waitForSocket(socketPath, child);
      await sleep(2000); // Hear AutoDJ before the Manual request is added.
      manualAck = await sendStudioQueuePush(socketPath, studioQueuePushCommand(manualPath, directory));
      if (priority) {
        await sleep(3000); // Hear Manual before protected programming interrupts it.
        protectedAck = await pushProtectedTestTone(socketPath, protectedPath);
        manualSkipAck = await skipInterruptedManualTestTone(socketPath);
        await sleep(14_000); // Check protected audio and automatic return to AutoDJ.
      } else {
        await sleep(9500); // Allow Manual to finish and AutoDJ to return.
      }
    } finally {
      await stopChild(child);
    }
    const output = await stat(outputPath).catch(() => null);
    if (!output?.isFile() || output.size < 20_000 || output.size > 3_000_000) {
      return { passed: false, stage: "FILE_ONLY_OUTPUT_MISSING_OR_OVERSIZED",
        queueAcknowledged: Boolean(manualAck), protectedQueueAcknowledged: Boolean(protectedAck),
        manualSkipAcknowledged: Boolean(manualSkipAck),
        sourceCommandAllowed: false, listenerVerified: false };
    }
    const pcmPath = path.join(directory, "file-sample.s16le");
    const decoded = run(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "mp3",
      "-i", outputPath, "-t", "30", "-ar", "16000", "-ac", "1", "-f", "s16le", "-n", pcmPath], directory);
    if (decoded.status !== 0) throw new Error("The local handoff file could not be decoded.");
    const labels = analyzeStudioListenerPcm(await readFile(pcmPath)).oneSecondWindows;
    const matched = priority ? matchesIsolatedStudioPriorityHandoff(labels) : matchesIsolatedStudioHandoff(labels);
    const passed = matched && manualAck?.listenerVerified === false &&
      (!priority || protectedAck?.listenerVerified === false && manualSkipAck?.acknowledged === true);
    return { passed, stage: passed ? priority ? "FILE_ONLY_PROTECTED_PRIORITY" : "FILE_ONLY_AUTODJ_MANUAL_AUTODJ" : "FILE_ONLY_HANDOFF_MISMATCH",
      oneSecondWindows: labels, queueAcknowledged: Boolean(manualAck), protectedQueueAcknowledged: Boolean(protectedAck),
      manualSkipAcknowledged: Boolean(manualSkipAck),
      sourceCommandAllowed: false, listenerVerified: false };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runIsolatedStudioHandoffRehearsal() {
  if (process.platform !== "linux" || !ffmpegPath) {
    throw new Error("The isolated handoff check requires the Linux test image.");
  }
  const version = run("liquidsoap", ["--version"], "/tmp");
  if (version.status !== 0 || !String(version.stdout).includes("Liquidsoap 2.1.3")) {
    throw new Error("The isolated handoff check requires encoder Liquidsoap 2.1.3.");
  }
  const baseline = await runFileOnlyScenario(false);
  if (!baseline.passed) return { passed: false, baseline, sourceCommandAllowed: false, listenerVerified: false };
  const protectedPriority = await runFileOnlyScenario(true);
  return { passed: protectedPriority.passed, baseline, protectedPriority,
    sourceCommandAllowed: false, listenerVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("This isolated check accepts no external paths or stream settings.");
    const result = await runIsolatedStudioHandoffRehearsal();
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 2;
  } catch {
    console.error("The file-only Studio handoff could not be verified. No live source was contacted.");
    process.exitCode = 1;
  }
}
