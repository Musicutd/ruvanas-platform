import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { analyzeTimedRehearsalPcm } from "../lib/studio-timed-rehearsal-analysis.mjs";
import { renderTimedRehearsalBundle } from "../lib/studio-timed-rehearsal.mjs";
import { selfOwnedTimedFixture } from "./prepare-studio-timed-rehearsal.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function boundedFile(directory, name, limit) {
  const file = path.join(directory, name);
  const details = await lstat(file);
  if (!details.isFile() || details.size < 1 || details.size > limit) throw new Error("Invalid self-owned rehearsal input.");
  const bytes = await readFile(file);
  if (bytes.length !== details.size) throw new Error("The rehearsal input changed while being read.");
  return bytes;
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", ...args],
    { timeout: 30_000, windowsHide: true, maxBuffer: 256 * 1024 });
  if (result.status !== 0) throw new Error("The local surrogate audio renderer failed.");
}

// This checks the staged synthetic fixture with FFmpeg, not Liquidsoap. It
// never invokes the file-only .liq script or opens a network/source output.
export async function verifySelfOwnedTimedSurrogate(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) ||
      path.resolve(directory) !== directory || path.parse(directory).root === directory || !ffmpegPath) {
    throw new Error("Give the absolute directory of a prepared self-owned rehearsal pack.");
  }
  const folder = await lstat(directory);
  if (!folder.isDirectory()) throw new Error("The rehearsal pack directory is invalid.");
  const manifestBytes = await boundedFile(directory, "manifest.json", 16_384);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest?.format !== "RUVANAS_SELF_OWNED_TEST_TONES_V1" || manifest.fixtureOnly !== true ||
      !/^\/tmp\/ruvanas-timed-self-owned-[a-f0-9]{12}$/.test(manifest.targetDirectory) ||
      manifest.sourceCommandAllowed !== false || manifest.listenerVerified !== false) {
    throw new Error("The rehearsal manifest is not a self-owned offline fixture.");
  }
  const { plan, options } = selfOwnedTimedFixture(manifest.targetDirectory);
  const expected = renderTimedRehearsalBundle(plan, options);
  if (JSON.stringify(manifest.expectedOrder) !== JSON.stringify(expected.expectedOrder) ||
      JSON.stringify(manifest.toneHzByTrackId) !== JSON.stringify({ "tone-a": 440, "tone-b": 660 })) {
    throw new Error("The frozen order or tone identities changed.");
  }
  const playlist = await boundedFile(directory, "frozen.m3u", 16_384);
  const script = await boundedFile(directory, "rehearsal.liq", 16_384);
  if (playlist.toString("utf8") !== expected.playlistText || script.toString("utf8") !== expected.liquidsoapText ||
      sha256(playlist) !== manifest.playlistSha256 || sha256(script) !== manifest.scriptSha256) {
    throw new Error("The file-only rehearsal instructions changed.");
  }
  for (const name of ["tone-a.mp3", "tone-b.mp3"]) {
    const audio = await boundedFile(directory, name, 2 * 1024 * 1024);
    if (sha256(audio) !== manifest.audioSha256?.[name]) throw new Error("The self-owned test audio changed.");
  }
  const outputMp3 = path.join(directory, "ffmpeg-surrogate.mp3");
  const outputPcm = path.join(directory, "ffmpeg-surrogate.s16le");
  const first = path.join(directory, "tone-a.mp3");
  const second = path.join(directory, "tone-b.mp3");
  runFfmpeg(["-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", first,
    "-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", second,
    "-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", first, "-filter_complex",
    "[0:a][1:a]acrossfade=d=2:c1=tri:c2=tri[ab];[ab][2:a]acrossfade=d=2:c1=tri:c2=tri[out]",
    "-map", "[out]", "-ar", "16000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "128k", "-n", outputMp3]);
  runFfmpeg(["-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", outputMp3,
    "-ar", "16000", "-ac", "1", "-f", "s16le", "-n", outputPcm]);
  const pcm = await boundedFile(directory, "ffmpeg-surrogate.s16le", 120 * 16_000 * 2);
  const analysis = analyzeTimedRehearsalPcm(pcm, {
    expectedOrder: manifest.expectedOrder, toneHzByTrackId: new Map(Object.entries(manifest.toneHzByTrackId))
  });
  return { ...analysis, outputMp3, outputPcm, outputMp3Sha256: sha256(await boundedFile(directory, "ffmpeg-surrogate.mp3", 2 * 1024 * 1024)),
    outputPcmSha256: sha256(pcm), manifestSha256: sha256(manifestBytes),
    provenance: "LOCAL_FFMPEG_SURROGATE_NOT_LIQUIDSOAP", liquidsoapVerified: false,
    sourceCommandAllowed: false, listenerVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("A prepared pack directory is required.");
    const result = await verifySelfOwnedTimedSurrogate(process.argv[2]);
    console.log(JSON.stringify(result));
    if (!result.matches) process.exitCode = 2;
  } catch {
    console.error("Unable to verify the offline synthetic rehearsal. Check the pack and local FFmpeg toolchain.");
    process.exitCode = 1;
  }
}
