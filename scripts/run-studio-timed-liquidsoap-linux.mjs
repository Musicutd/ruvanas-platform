import { spawnSync } from "node:child_process";
import { COPYFILE_EXCL } from "node:constants";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { analyzeTimedRehearsalPcm } from "../lib/studio-timed-rehearsal-analysis.mjs";
import { prepareSelfOwnedTimedRehearsal } from "./prepare-studio-timed-rehearsal.mjs";
import { verifySelfOwnedTimedSurrogate } from "./verify-studio-timed-surrogate.mjs";

const TARGET_PATTERN = /^\/tmp\/ruvanas-timed-self-owned-[a-f0-9]{12}$/;
const FIXTURE_FILES = ["tone-a.mp3", "tone-b.mp3", "frozen.m3u", "rehearsal.liq", "manifest.json"];

export function isIsolatedTimedTarget(value) {
  return typeof value === "string" && TARGET_PATTERN.test(value) && path.posix.normalize(value) === value;
}

function run(binary, args, cwd, timeout) {
  return spawnSync(binary, args, { cwd, timeout, maxBuffer: 1024 * 1024, encoding: "utf8" });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Offline Debian/Linux MP3 acceptance only. It creates synthetic test tones,
// never reads subscriber media or credentials, and never opens a source socket.
export async function runSelfOwnedLinuxMp3Rehearsal() {
  if (process.platform !== "linux" || tmpdir() !== "/tmp" || !ffmpegPath) {
    throw new Error("This file-only MP3 check requires an isolated Linux runtime with local FFmpeg.");
  }
  const version = run("liquidsoap", ["--version"], "/tmp", 15_000);
  if (version.status !== 0 || !String(version.stdout).includes("Liquidsoap 2.1.3")) {
    throw new Error("This check requires the encoder image's Liquidsoap 2.1.3.");
  }
  const parent = await mkdtemp(path.join(tmpdir(), "ruvanas-timed-test-"));
  const pack = path.join(parent, "pack");
  await prepareSelfOwnedTimedRehearsal(pack);
  const preflight = await verifySelfOwnedTimedSurrogate(pack);
  if (!preflight.matches) throw new Error("Synthetic fixture preflight failed.");
  const manifest = JSON.parse(await readFile(path.join(pack, "manifest.json"), "utf8"));
  if (!isIsolatedTimedTarget(manifest.targetDirectory)) throw new Error("The fixture target is not an isolated /tmp path.");
  const target = manifest.targetDirectory;
  // Exclusive creation refuses an existing directory or symlink; no customer
  // paths are accepted and no existing file is overwritten.
  await mkdir(target, { mode: 0o700 });
  for (const name of FIXTURE_FILES) {
    await copyFile(path.join(pack, name), path.join(target, name), COPYFILE_EXCL);
  }
  const script = path.join(target, "rehearsal.liq");
  const check = run("liquidsoap", ["--check", script], target, 30_000);
  if (check.status !== 0) return { passed: false, stage: "LIQUIDSOAP_MP3_CHECK_FAILED",
    diagnostic: String(check.stderr || check.stdout || "").slice(-2000), pack, target,
    mp3TemplateVerified: false, sourceCommandAllowed: false, listenerVerified: false };
  const rendered = run("liquidsoap", [script], target, 30_000);
  const log = String(rendered.stderr || rendered.stdout || "");
  const outputMp3 = path.join(target, "listener-sample.mp3");
  const details = await stat(outputMp3).catch(() => null);
  const finishedFiniteFile = rendered.error?.code === "ETIMEDOUT" &&
    log.includes("Source failed (no more tracks) stopping output") && (details?.size ?? 0) > 20_000;
  if (rendered.status !== 0 && !finishedFiniteFile) return { passed: false, stage: "LIQUIDSOAP_MP3_RENDER_FAILED",
    diagnostic: log.slice(-2000), pack, target, mp3TemplateVerified: false,
    sourceCommandAllowed: false, listenerVerified: false };
  const outputPcm = path.join(target, "listener-sample.s16le");
  const decoded = run(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error",
    "-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", outputMp3,
    "-ar", "16000", "-ac", "1", "-f", "s16le", "-n", outputPcm], target, 15_000);
  if (decoded.status !== 0) throw new Error("The isolated MP3 output could not be decoded.");
  const pcm = await readFile(outputPcm);
  const analysis = analyzeTimedRehearsalPcm(pcm, {
    expectedOrder: manifest.expectedOrder,
    toneHzByTrackId: new Map(Object.entries(manifest.toneHzByTrackId))
  });
  return { passed: analysis.matches,
    stage: analysis.matches ? "LOCAL_LINUX_LIQUIDSOAP_MP3_MATCH" : "LOCAL_LINUX_LIQUIDSOAP_MP3_MISMATCH",
    analysis, pack, target, outputMp3, outputPcm,
    outputMp3Sha256: sha256(await readFile(outputMp3)), outputPcmSha256: sha256(pcm),
    liquidsoapVersion: "2.1.3", mp3TemplateVerified: analysis.matches,
    finiteOutputStopped: finishedFiniteFile || rendered.status === 0,
    sourceCommandAllowed: false, listenerVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("This isolated check accepts no paths or stream settings.");
    const result = await runSelfOwnedLinuxMp3Rehearsal();
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 2;
  } catch {
    console.error("Unable to complete the isolated Linux MP3 rehearsal. No live source was contacted.");
    process.exitCode = 1;
  }
}
