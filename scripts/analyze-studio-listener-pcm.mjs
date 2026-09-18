import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeStudioListenerPcm } from "../lib/studio-listener-audio-sample.mjs";

try {
  const file = process.argv[2];
  if (process.argv.length !== 3 || !file || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== ".s16le") {
    throw new Error("Give one absolute path to a local .s16le listener recording.");
  }
  const info = await stat(file);
  if (!info.isFile() || info.size > 120 * 16_000 * 2) throw new Error("The listener recording is invalid or too large.");
  console.log(JSON.stringify(analyzeStudioListenerPcm(await readFile(file))));
} catch {
  // The file path or decoder error could contain private details; do not echo it.
  console.error("Unable to analyse the local listener recording. Check its PCM format and 2–120 second length.");
  process.exitCode = 1;
}
