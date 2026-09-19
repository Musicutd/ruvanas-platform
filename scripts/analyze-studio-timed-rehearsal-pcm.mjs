import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeTimedRehearsalPcm } from "../lib/studio-timed-rehearsal-analysis.mjs";

try {
  const [samplePath, manifestPath] = process.argv.slice(2);
  if (process.argv.length !== 4 || !path.isAbsolute(samplePath) || !path.isAbsolute(manifestPath) ||
      path.extname(samplePath).toLowerCase() !== ".s16le" || path.extname(manifestPath).toLowerCase() !== ".json" ||
      path.resolve(samplePath) === path.resolve(manifestPath)) {
    throw new Error("Give separate absolute paths to a decoded test sample and manifest.");
  }
  const [sampleInfo, manifestInfo] = await Promise.all([stat(samplePath), stat(manifestPath)]);
  if (!sampleInfo.isFile() || sampleInfo.size > 120 * 16_000 * 2 ||
      !manifestInfo.isFile() || manifestInfo.size > 16_384) {
    throw new Error("The local rehearsal inputs are invalid or too large.");
  }
  const [pcm, manifestBytes] = await Promise.all([readFile(samplePath), readFile(manifestPath)]);
  if (pcm.length > 120 * 16_000 * 2 || manifestBytes.length > 16_384) {
    throw new Error("The local rehearsal inputs changed while being read.");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest?.format !== "RUVANAS_SELF_OWNED_TEST_TONES_V1" ||
      !manifest.toneHzByTrackId || typeof manifest.toneHzByTrackId !== "object" ||
      Array.isArray(manifest.toneHzByTrackId)) {
    throw new Error("The self-owned test-tone manifest is invalid.");
  }
  const analysis = analyzeTimedRehearsalPcm(pcm, {
    expectedOrder: manifest.expectedOrder,
    toneHzByTrackId: new Map(Object.entries(manifest.toneHzByTrackId))
  });
  console.log(JSON.stringify({ ...analysis,
    pcmSha256: createHash("sha256").update(pcm).digest("hex"),
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex") }));
  if (!analysis.matches) process.exitCode = 2;
} catch {
  // Do not echo a path, decoder error or manifest content into CI logs.
  console.error("Unable to analyse the local timed rehearsal. Check its manifest and 16 kHz mono s16le sample.");
  process.exitCode = 1;
}
