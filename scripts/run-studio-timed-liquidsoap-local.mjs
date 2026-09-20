import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { analyzeTimedRehearsalPcm } from "../lib/studio-timed-rehearsal-analysis.mjs";
import { verifySelfOwnedTimedSurrogate } from "./verify-studio-timed-surrogate.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(binary, args, cwd, timeout) {
  return spawnSync(binary, args, { cwd, timeout, windowsHide: true, maxBuffer: 1024 * 1024, encoding: "utf8" });
}

// One-off synthetic file-output rehearsal for the official Windows 2.1.3
// executable. It never constructs a network/source output or uses user audio.
export async function runSelfOwnedLiquidsoapRehearsal(packDirectory, executable) {
  if (process.platform !== "win32" || typeof packDirectory !== "string" || !path.isAbsolute(packDirectory) ||
      path.resolve(packDirectory) !== packDirectory || !/^[A-Za-z]:\\[A-Za-z0-9_.\\-]+$/.test(packDirectory) ||
      typeof executable !== "string" || !path.isAbsolute(executable) ||
      path.basename(executable).toLowerCase() !== "liquidsoap.exe" || !ffmpegPath) {
    throw new Error("Use a fresh safe-path synthetic pack and a local Liquidsoap executable on Windows.");
  }
  const version = run(executable, ["--version"], packDirectory, 15_000);
  if (version.status !== 0 || !version.stdout?.includes("Liquidsoap 2.1.3")) {
    throw new Error("The isolated rehearsal requires Liquidsoap 2.1.3.");
  }
  const surrogate = await verifySelfOwnedTimedSurrogate(packDirectory);
  if (!surrogate.matches) throw new Error("The self-owned surrogate preflight failed.");
  const manifest = JSON.parse(await readFile(path.join(packDirectory, "manifest.json"), "utf8"));
  const originalPlaylist = await readFile(path.join(packDirectory, "frozen.m3u"), "utf8");
  const originalScript = await readFile(path.join(packDirectory, "rehearsal.liq"), "utf8");
  const localPrefix = packDirectory.replaceAll("\\", "/");
  const targetPrefix = manifest.targetDirectory;
  const playlist = originalPlaylist.replaceAll(targetPrefix, localPrefix);
  const script = originalScript.replaceAll(targetPrefix, localPrefix)
    .replace(`${localPrefix}/frozen.m3u`, `${localPrefix}/frozen-windows.m3u`);
  if (playlist === originalPlaylist || script === originalScript ||
      !script.includes("output.file(") || /output\.(?:shoutcast|icecast|harbor)|https?:\/\//i.test(script)) {
    throw new Error("The local file-only template could not be materialized safely.");
  }
  const playlistPath = path.join(packDirectory, "frozen-windows.m3u");
  const scriptPath = path.join(packDirectory, "rehearsal-windows.liq");
  await writeFile(playlistPath, playlist, { flag: "wx", mode: 0o600 });
  await writeFile(scriptPath, script, { flag: "wx", mode: 0o600 });
  const mp3Check = run(executable, ["--check", scriptPath], packDirectory, 30_000);
  const mp3Diagnostic = String(mp3Check.stderr || mp3Check.stdout || "");
  // The official Windows 2.1.3 bundle does not include an MP3 encoder. Keep
  // the production template untouched and use a file-only WAV output solely
  // to test playlist/crossfade behaviour on this disposable synthetic pack.
  if (mp3Check.status !== 0 && !mp3Diagnostic.includes("Unsupported format: %mp3(bitrate=128)")) {
    return { passed: false, stage: "LIQUIDSOAP_MP3_CHECK_FAILED", exitStatus: mp3Check.status,
      diagnostic: mp3Diagnostic.slice(-2000), mp3TemplateVerified: false,
      sourceCommandAllowed: false, listenerVerified: false };
  }
  const wavOnly = mp3Check.status !== 0;
  const rehearsalPath = wavOnly ? path.join(packDirectory, "rehearsal-windows-wav.liq") : scriptPath;
  const outputAudio = path.join(packDirectory, wavOnly ? "liquidsoap-windows-sample.wav" : "listener-sample.mp3");
  if (wavOnly) {
    const wavScript = script.replace("%mp3(bitrate=128)", "%wav")
      .replace(`${localPrefix}/listener-sample.mp3`, `${localPrefix}/liquidsoap-windows-sample.wav`);
    if (wavScript === script || !wavScript.includes("%wav")) throw new Error("The WAV-only local adaptation failed.");
    await writeFile(rehearsalPath, wavScript, { flag: "wx", mode: 0o600 });
  }
  const check = wavOnly ? run(executable, ["--check", rehearsalPath], packDirectory, 30_000) : mp3Check;
  if (check.status !== 0) return { passed: false, stage: "LIQUIDSOAP_CHECK_FAILED",
    exitStatus: check.status, diagnostic: String(check.stderr || check.stdout || "").slice(-2000),
    formatAdaptation: wavOnly ? "MP3_TO_WAV_WINDOWS_TEST_ONLY" : "NONE",
    mp3TemplateVerified: false, sourceCommandAllowed: false, listenerVerified: false };
  const rendered = run(executable, [rehearsalPath], packDirectory, 30_000);
  const renderLog = String(rendered.stderr || rendered.stdout || "");
  // Liquidsoap's control process remains alive after this finite playlist
  // exhausts. A timeout is acceptable only if its output explicitly stopped
  // for no more tracks and a nonempty file was finalized before termination.
  const outputStat = await stat(outputAudio).catch(() => null);
  const finishedFiniteFile = rendered.error?.code === "ETIMEDOUT" &&
    renderLog.includes("Source failed (no more tracks) stopping output") &&
    (outputStat?.size ?? 0) > 100_000;
  if (rendered.status !== 0 && !finishedFiniteFile) return { passed: false, stage: "LIQUIDSOAP_RENDER_FAILED",
    exitStatus: rendered.status, diagnostic: renderLog.slice(-2000),
    formatAdaptation: wavOnly ? "MP3_TO_WAV_WINDOWS_TEST_ONLY" : "NONE",
    mp3TemplateVerified: false, sourceCommandAllowed: false, listenerVerified: false };
  const outputPcm = path.join(packDirectory, "liquidsoap-sample.s16le");
  const decoded = run(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error",
    "-protocol_whitelist", "file,pipe", "-f", wavOnly ? "wav" : "mp3", "-i", outputAudio,
    "-ar", "16000", "-ac", "1", "-f", "s16le", "-n", outputPcm], packDirectory, 15_000);
  if (decoded.status !== 0) throw new Error("The local Liquidsoap file could not be decoded.");
  const pcm = await readFile(outputPcm);
  const analysis = analyzeTimedRehearsalPcm(pcm, {
    expectedOrder: manifest.expectedOrder, toneHzByTrackId: new Map(Object.entries(manifest.toneHzByTrackId))
  });
  return { passed: analysis.matches, stage: analysis.matches ? "LOCAL_LIQUIDSOAP_FILE_MATCH" : "LOCAL_LIQUIDSOAP_FILE_MISMATCH",
    analysis, outputAudio, outputPcm, outputAudioSha256: digest(await readFile(outputAudio)),
    outputPcmSha256: digest(pcm), liquidsoapVersion: "2.1.3",
    formatAdaptation: wavOnly ? "MP3_TO_WAV_WINDOWS_TEST_ONLY" : "NONE",
    mp3TemplateVerified: !wavOnly,
    templateAdaptation: wavOnly ? "PATHS_AND_TEST_ONLY_WAV_FORMAT" : "PATHS_ONLY",
    finiteOutputStopped: finishedFiniteFile || rendered.status === 0,
    sourceCommandAllowed: false, listenerVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Pack directory and binary are required.");
    const result = await runSelfOwnedLiquidsoapRehearsal(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 2;
  } catch {
    console.error("Unable to run the isolated self-owned Liquidsoap file rehearsal.");
    process.exitCode = 1;
  }
}
