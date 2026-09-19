import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { renderTimedRehearsalBundle } from "../lib/studio-timed-rehearsal.mjs";

const RATE = 16_000;
const FIXTURE = [
  { trackId: "tone-a", mediaAssetId: "self-owned-tone-a", frequencyHz: 440, durationSeconds: 6, name: "tone-a.mp3" },
  { trackId: "tone-b", mediaAssetId: "self-owned-tone-b", frequencyHz: 660, durationSeconds: 7, name: "tone-b.mp3" }
];

export function selfOwnedTimedFixture(linuxDirectory) {
  const mediaByAssetId = new Map(FIXTURE.map((tone) => [tone.mediaAssetId, `${linuxDirectory}/${tone.name}`]));
  const plan = {
    ready: true, reason: "FROZEN_SEQUENCE_PLANNED_NOT_ON_AIR", commandIssued: false, listenerVerified: false,
    items: [
      { position: 0, trackId: "tone-a", mediaAssetId: "self-owned-tone-a", startOffsetSeconds: 0, endOffsetSeconds: 6 },
      { position: 1, trackId: "tone-b", mediaAssetId: "self-owned-tone-b", startOffsetSeconds: 4, endOffsetSeconds: 11 },
      { position: 2, trackId: "tone-a", mediaAssetId: "self-owned-tone-a", startOffsetSeconds: 9, endOffsetSeconds: 15 }
    ]
  };
  return { plan, options: { privateDirectory: linuxDirectory, mediaByAssetId,
    playlistPath: `${linuxDirectory}/frozen.m3u`, outputPath: `${linuxDirectory}/listener-sample.mp3` } };
}

function tonePcm({ frequencyHz, durationSeconds }) {
  const samples = RATE * durationSeconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / (RATE * 0.02), (samples - index - 1) / (RATE * 0.02));
    pcm.writeInt16LE(Math.round(10_000 * Math.max(0, fade) *
      Math.sin(2 * Math.PI * frequencyHz * index / RATE)), index * 2);
  }
  return pcm;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encodeTone(outputPath, tone) {
  const result = spawnSync(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error",
    "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", "pipe:0",
    "-codec:a", "libmp3lame", "-b:a", "128k", "-n", outputPath],
  { input: tonePcm(tone), timeout: 15_000, windowsHide: true });
  if (result.status !== 0) throw new Error("Unable to encode the self-owned test tone.");
}

// This stages synthetic audio and a file-output-only script. It never reads
// a subscriber library, database, storage credential or Centova endpoint.
export async function prepareSelfOwnedTimedRehearsal(outputDirectory) {
  if (typeof outputDirectory !== "string" || !path.isAbsolute(outputDirectory) ||
      path.resolve(outputDirectory) !== outputDirectory || path.parse(outputDirectory).root === outputDirectory) {
    throw new Error("Give an absolute path to a new local rehearsal directory.");
  }
  if (!ffmpegPath) throw new Error("The local FFmpeg test-tone encoder is unavailable.");
  await mkdir(outputDirectory, { mode: 0o700 }); // Existing directories are never reused or overwritten.
  const linuxDirectory = `/tmp/ruvanas-timed-self-owned-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const audioSha256 = {};
  for (const tone of FIXTURE) {
    const localPath = path.join(outputDirectory, tone.name);
    encodeTone(localPath, tone);
    audioSha256[tone.name] = sha256(await readFile(localPath));
  }
  const { plan, options } = selfOwnedTimedFixture(linuxDirectory);
  const bundle = renderTimedRehearsalBundle(plan, options);
  await writeFile(path.join(outputDirectory, "frozen.m3u"), bundle.playlistText, { flag: "wx", mode: 0o600 });
  await writeFile(path.join(outputDirectory, "rehearsal.liq"), bundle.liquidsoapText, { flag: "wx", mode: 0o600 });
  const manifest = {
    format: "RUVANAS_SELF_OWNED_TEST_TONES_V1", fixtureOnly: true,
    targetDirectory: linuxDirectory, expectedOrder: bundle.expectedOrder,
    toneHzByTrackId: Object.fromEntries(FIXTURE.map((tone) => [tone.trackId, tone.frequencyHz])),
    audioSha256, playlistSha256: sha256(bundle.playlistText), scriptSha256: sha256(bundle.liquidsoapText),
    sourceCommandAllowed: false, listenerVerified: false
  };
  await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { prepared: true, outputDirectory, targetDirectory: linuxDirectory,
    files: ["tone-a.mp3", "tone-b.mp3", "frozen.m3u", "rehearsal.liq", "manifest.json"],
    sourceCommandAllowed: false, listenerVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("A new output directory is required.");
    console.log(JSON.stringify(await prepareSelfOwnedTimedRehearsal(process.argv[2])));
  } catch {
    console.error("Unable to prepare the isolated self-owned-tone rehearsal. Use a new absolute directory and a working local FFmpeg binary.");
    process.exitCode = 1;
  }
}
