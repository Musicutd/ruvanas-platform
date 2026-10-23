// Test-only persistent PCM -> MP3 encoder. No database, storage, DNS, sockets,
// provider credentials, environment flags, or implicit source connection.
import { spawn } from "node:child_process";
import path from "node:path";
import { lstat } from "node:fs/promises";
import { buildCatalogueTestPlayoutPlan, catalogueTestPlayoutSegmentForFrame } from "./catalogue-test-playout-plan.mjs";

const fail = code => Object.assign(new Error(code), { code });
const MAX_PCM_BYTES = 64 * 1024 * 1024;
const preparedAudio = new WeakMap();
const demuxers = { mp3: "mp3", wav: "wav", ogg: "ogg", m4a: "mov" };

function localFile(value) {
  return typeof value === "string" && path.isAbsolute(value) && !/^[\\/]{2}/.test(value) &&
    !/[\0\r\n]/.test(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}
function operations({ ffmpegPath, signal, registerResource }, spawnProcess) {
  if (!localFile(ffmpegPath) || typeof signal?.throwIfAborted !== "function" ||
      typeof registerResource !== "function" || typeof spawnProcess !== "function") throw fail("TEST_PLAYOUT_OPTIONS_INVALID");
  signal.throwIfAborted();
}
function childOptions(stdin) {
  return { stdio: [stdin, "pipe", "ignore"], shell: false, windowsHide: true,
    env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {} };
}
function watch(child, signal, registerResource) {
  let ended = false, failed = false, unregister;
  child.on("error", () => { failed = true; });
  const exit = new Promise(resolve => child.once("close", code => {
    ended = true; signal.removeEventListener("abort", kill); unregister?.();
    resolve(failed ? -1 : code);
  }));
  const kill = () => { if (!ended) { try { child.kill("SIGKILL"); } catch { failed = true; } } };
  const resource = { forceClose: kill, close: async () => { kill(); await exit; } };
  try { unregister = registerResource(resource); }
  catch (error) { kill(); throw error; }
  signal.addEventListener("abort", kill, { once: true });
  if (signal.aborted) kill();
  return { exit, kill };
}

export function catalogueTestPcmDecodeArguments(filePath) {
  const demuxer = demuxers[path.extname(filePath || "").slice(1).toLowerCase()];
  if (!localFile(filePath) || !demuxer) throw fail("TEST_PLAYOUT_FILE_INVALID");
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-f", demuxer,
    "-i", filePath, "-t", "30", "-vn", "-sn", "-dn", "-map", "0:a:0", "-map_metadata", "-1",
    "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"];
}
export function catalogueTestPersistentEncoderArguments() {
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-re",
    "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0", "-t", "90", "-vn", "-sn", "-dn",
    "-map", "0:a:0", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "128k",
    "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1"];
}

export async function prepareCatalogueTestPlayout(options, { spawnProcess = spawn } = {}) {
  const { session, files, ffmpegPath, signal, registerResource } = options || {};
  const plan = buildCatalogueTestPlayoutPlan(session);
  operations(options, spawnProcess);
  if (!(files instanceof Map)) throw fail("TEST_PLAYOUT_FILE_INVALID");
  const paths = [];
  for (const segment of plan.segments) {
    const filePath = files.get(segment.trackId);
    catalogueTestPcmDecodeArguments(filePath);
    const info = await lstat(filePath).catch(() => null);
    signal.throwIfAborted();
    if (!info?.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 50 * 1024 * 1024) throw fail("TEST_PLAYOUT_FILE_INVALID");
    paths.push(filePath);
  }
  const pcm = [];
  let totalBytes = 0;
  for (const [index, segment] of plan.segments.entries()) {
    signal.throwIfAborted();
    const requiredBytes = segment.frameCount * plan.channels * 2;
    if (totalBytes + requiredBytes > MAX_PCM_BYTES) throw fail("TEST_PLAYOUT_PCM_LIMIT");
    const child = spawnProcess(ffmpegPath, catalogueTestPcmDecodeArguments(paths[index]), childOptions("ignore"));
    const guard = watch(child, signal, registerResource);
    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of child.stdout) {
        signal.throwIfAborted(); bytes += chunk.length;
        if (bytes > requiredBytes) throw fail("TEST_PLAYOUT_PCM_LIMIT");
        chunks.push(chunk);
      }
      const code = await guard.exit;
      signal.throwIfAborted();
      if (code !== 0 || bytes !== requiredBytes) throw fail("TEST_PLAYOUT_DECODE_FAILED");
      pcm.push(Buffer.concat(chunks, bytes)); totalBytes += bytes;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally { guard.kill(); await guard.exit; }
  }
  const result = Object.freeze({ plan, decodedBytes: totalBytes,
    dispose: () => { preparedAudio.delete(result); pcm.length = 0; } });
  preparedAudio.set(result, pcm);
  return result;
}

export function createCatalogueTestMp3FrameParser() {
  let pending = Buffer.alloc(0), frameIndex = 0;
  return {
    push(chunk) {
      if (!Buffer.isBuffer(chunk) || chunk.length > 16 * 1024 * 1024) throw fail("TEST_PLAYOUT_MP3_INVALID");
      pending = Buffer.concat([pending, chunk]);
      const frames = [];
      while (pending.length >= 4) {
        const [a, b, c, d] = pending;
        if (a !== 255 || (b & 224) !== 224 || ((b >> 3) & 3) !== 3 || ((b >> 1) & 3) !== 1 ||
            (c >> 4) !== 9 || ((c >> 2) & 3) !== 1 || (d >> 6) === 3) throw fail("TEST_PLAYOUT_MP3_INVALID");
        const length = 384 + ((c >> 1) & 1);
        if (pending.length < length) break;
        if (frameIndex >= 3752) throw fail("TEST_PLAYOUT_MP3_LIMIT");
        frames.push({ bytes: pending.subarray(0, length), startFrame: frameIndex++ * 1152 });
        pending = pending.subarray(length);
      }
      return frames;
    },
    finish() {
      if (pending.length || frameIndex < 3750 || frameIndex > 3752) throw fail("TEST_PLAYOUT_MP3_INCOMPLETE");
      return frameIndex;
    }
  };
}

function writeInput(stream, chunk, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const error = () => { cleanup(); reject(fail("TEST_PLAYOUT_ENCODER_FAILED")); };
    const cleanup = () => { signal.removeEventListener("abort", abort); stream.off("error", error); stream.off("close", error); };
    signal.addEventListener("abort", abort, { once: true }); stream.once("error", error); stream.once("close", error);
    stream.write(chunk, err => { cleanup(); err ? reject(fail("TEST_PLAYOUT_ENCODER_FAILED")) : resolve(); });
    if (signal.aborted) abort();
  });
}

export async function sendCatalogueTestPlayout(options, { spawnProcess = spawn } = {}) {
  const { prepared, connection, ffmpegPath, signal, registerResource, emit } = options || {};
  operations(options, spawnProcess);
  const pcm = preparedAudio.get(prepared);
  if (!pcm || pcm.length !== 3 || connection?.authenticated !== true || typeof connection.write !== "function" || typeof emit !== "function") {
    throw fail("TEST_PLAYOUT_NOT_PREPARED");
  }
  // A prepared diagnostic is single-use; a failed/ambiguous send is not retried.
  preparedAudio.delete(prepared);
  const { plan } = prepared;
  const child = spawnProcess(ffmpegPath, catalogueTestPersistentEncoderArguments(), childOptions("pipe"));
  const guard = watch(child, signal, registerResource);
  child.stdin.on("error", () => { /* handled by the owned writer or child exit */ });
  let inputError = null;
  const input = (async () => {
    for (const buffer of pcm) for (let offset = 0; offset < buffer.length; offset += 16_384) {
      await writeInput(child.stdin, buffer.subarray(offset, Math.min(offset + 16_384, buffer.length)), signal);
    }
    child.stdin.end();
  })().catch(error => { inputError = error; guard.kill(); });
  const parser = createCatalogueTestMp3FrameParser();
  const perSegment = [0, 0, 0];
  let current = 0, total = 0, ended = 0;
  const observation = async (type, segment, completed) => {
    if (!await emit({ type, segmentIndex: segment.index, trackId: segment.trackId, mediaAssetId: segment.mediaAssetId,
      phase: segment.phase, audioBytesSent: perSegment[segment.index], totalAudioBytesSent: total,
      ...(completed === undefined ? {} : { completed }), attribution: "ENCODER_FRAME_DIAGNOSTIC" })) throw fail("TEST_PLAYOUT_EVENT_FAILED");
  };
  try {
    for await (const chunk of child.stdout) {
      for (const frame of parser.push(chunk)) {
        signal.throwIfAborted();
        const segment = catalogueTestPlayoutSegmentForFrame(plan, frame.startFrame);
        if (segment.index !== current) {
          await observation("SEGMENT_ENDED", plan.segments[current], true); ended++;
          current = segment.index;
        }
        await connection.write(frame.bytes);
        total += frame.bytes.length; perSegment[current] += frame.bytes.length;
        if (total > 16 * 1024 * 1024) throw fail("TEST_PLAYOUT_AUDIO_LIMIT");
        await observation("AUDIO_SENT", segment);
      }
    }
    await input;
    const code = await guard.exit;
    signal.throwIfAborted();
    if (inputError || code !== 0) throw fail("TEST_PLAYOUT_ENCODER_FAILED");
    parser.finish();
    if (current !== 2 || perSegment.some(bytes => bytes <= 0)) throw fail("TEST_PLAYOUT_MP3_INCOMPLETE");
    await observation("SEGMENT_ENDED", plan.segments[current], true); ended++;
    return { audioBytesSent: total, segmentsEnded: ended, perSegmentAudioBytes: perSegment, completed: true,
      attribution: "ENCODER_FRAME_DIAGNOSTIC" };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  } finally { guard.kill(); }
}
