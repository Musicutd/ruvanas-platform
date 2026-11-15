import { execFile } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffprobeStatic from "ffprobe-static";
import { MAX_CATALOGUE_FILE_SIZE_BYTES } from "./catalogue-upload.mjs";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_MAX_OUTPUT_BYTES = 4_096;
const MAX_DURATION_SECONDS = 86_400;
const MAX_ACTIVE_PROBES = 2;
let activeProbes = 0;

export class CatalogueAudioDurationError extends Error {
  constructor(code) {
    super(code);
    this.name = "CatalogueAudioDurationError";
    this.code = code;
  }
}

function fail(code) {
  throw new CatalogueAudioDurationError(code);
}

export function parseCatalogueAudioDurationProbe(output) {
  if (typeof output !== "string" || Buffer.byteLength(output, "utf8") > PROBE_MAX_OUTPUT_BYTES) {
    fail("CATALOGUE_DURATION_PROBE_INVALID");
  }
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    fail("CATALOGUE_DURATION_PROBE_INVALID");
  }
  if (!Array.isArray(result?.streams) ||
      !result.streams.some((stream) => stream?.codec_type === "audio")) {
    fail("CATALOGUE_DURATION_NO_AUDIO");
  }
  const raw = result?.format?.duration;
  if (typeof raw !== "string" || !/^\d+(?:\.\d+)?$/.test(raw)) {
    fail("CATALOGUE_DURATION_UNAVAILABLE");
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_DURATION_SECONDS) {
    fail("CATALOGUE_DURATION_UNAVAILABLE");
  }
  return Math.max(1, Math.round(seconds));
}

async function runFfprobe(filePath) {
  if (typeof ffprobeStatic.path !== "string" || !ffprobeStatic.path) {
    fail("CATALOGUE_DURATION_TOOL_UNAVAILABLE");
  }
  try {
    const { stdout } = await execFileAsync(ffprobeStatic.path, [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-i", filePath,
      "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration", "-of", "json"
    ], {
      encoding: "utf8", windowsHide: true, shell: false,
      timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: PROBE_MAX_OUTPUT_BYTES
    });
    return stdout;
  } catch {
    fail("CATALOGUE_DURATION_PROBE_FAILED");
  }
}

export async function measureCatalogueAudioDuration(buffer, { runProbe = runFfprobe } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_CATALOGUE_FILE_SIZE_BYTES) {
    fail("CATALOGUE_DURATION_BUFFER_INVALID");
  }
  if (typeof runProbe !== "function") fail("CATALOGUE_DURATION_PROBE_INVALID");
  if (activeProbes >= MAX_ACTIVE_PROBES) fail("CATALOGUE_DURATION_BUSY");
  activeProbes += 1;
  let directory;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "ruvanas-catalogue-duration-"));
  } catch {
    activeProbes -= 1;
    fail("CATALOGUE_DURATION_TEMP_FAILED");
  }
  const input = path.join(directory, "source-audio");
  try {
    await writeFile(input, buffer, { flag: "wx", mode: 0o600 });
    const output = await runProbe(input);
    return parseCatalogueAudioDurationProbe(output);
  } catch (error) {
    if (error instanceof CatalogueAudioDurationError) throw error;
    fail("CATALOGUE_DURATION_PROBE_FAILED");
  } finally {
    let cleanupFailed = false;
    try { await unlink(input); } catch (error) { if (error?.code !== "ENOENT") cleanupFailed = true; }
    try { await rmdir(directory); } catch { cleanupFailed = true; }
    activeProbes -= 1;
    if (cleanupFailed) fail("CATALOGUE_DURATION_TEMP_CLEANUP_FAILED");
  }
}
