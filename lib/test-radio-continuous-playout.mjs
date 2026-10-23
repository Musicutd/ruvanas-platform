// Pure local playout: the caller owns approval, downloads, source connection,
// lease checks, accounting and retries. This module never opens a network socket.
import { spawn } from "node:child_process";
import path from "node:path";
import { lstat } from "node:fs/promises";

const SAMPLE_RATE = 48_000, FRAME_BYTES = 4, CHUNK_LIMIT = 256 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024, MAX_TRACK_SECONDS = 3600;
const demuxers = { mp3: "mp3", wav: "wav", ogg: "ogg", m4a: "mov" };
const failure = code => Object.assign(new Error(code), { code });
const localFile = value => typeof value === "string" && path.isAbsolute(value) &&
  !/^[\\/]{2}/.test(value) && !/[\0\r\n]/.test(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);

export function testRadioContinuousDecodeArguments(filePath, durationSeconds) {
  const demuxer = demuxers[path.extname(filePath || "").slice(1).toLowerCase()];
  if (!localFile(filePath) || !demuxer || !Number.isFinite(durationSeconds) || durationSeconds < 0.25 || durationSeconds > MAX_TRACK_SECONDS) {
    throw failure("CONTINUOUS_TRACK_INVALID");
  }
  // Duration is an already verified safety ceiling, not a playlist clip. A normal
  // recording ends naturally; a file exceeding its approved duration fails closed.
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-f", demuxer,
    "-i", filePath, "-t", String(durationSeconds + 2), "-vn", "-sn", "-dn", "-map", "0:a:0", "-map_metadata", "-1",
    "-ac", "2", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"];
}

export function testRadioContinuousEncoderArguments() {
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-re",
    "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0", "-vn", "-sn", "-dn",
    "-map", "0:a:0", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "128k",
    "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1"];
}

// A fresh approved catalogue must be supplied by the caller; this helper grants
// no access. A shuffle bag avoids repeats until the eligible bag is exhausted.
export function createTestRadioShuffleSelector({ random = Math.random } = {}) {
  let remaining = [], lastId = null;
  return tracks => {
    if (!Array.isArray(tracks) || tracks.length > 100_000 || tracks.some(track => !track || typeof track.id !== "string")) {
      throw failure("CONTINUOUS_CATALOGUE_INVALID");
    }
    const byId = new Map(tracks.map(track => [track.id, track]));
    if (byId.size !== tracks.length) throw failure("CONTINUOUS_CATALOGUE_INVALID");
    remaining = remaining.filter(id => byId.has(id));
    if (!remaining.length) {
      remaining = [...byId.keys()];
      for (let index = remaining.length - 1; index > 0; index--) {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw failure("CONTINUOUS_RANDOM_INVALID");
        const other = Math.floor(value * (index + 1));
        [remaining[index], remaining[other]] = [remaining[other], remaining[index]];
      }
      if (remaining.length > 1 && remaining.at(-1) === lastId) [remaining[0], remaining[remaining.length - 1]] = [remaining.at(-1), remaining[0]];
    }
    const selected = remaining.pop();
    if (selected === undefined) return null;
    lastId = selected;
    return byId.get(selected);
  };
}

export function createTestRadioContinuousMp3Parser() {
  let pending = Buffer.alloc(0), frameIndex = 0;
  return {
    push(chunk) {
      if (!Buffer.isBuffer(chunk) || chunk.length > CHUNK_LIMIT) throw failure("CONTINUOUS_MP3_INVALID");
      pending = Buffer.concat([pending, chunk]);
      const frames = [];
      while (pending.length >= 4) {
        const [a, b, c, d] = pending;
        if (a !== 255 || (b & 224) !== 224 || ((b >> 3) & 3) !== 3 || ((b >> 1) & 3) !== 1 ||
            (c >> 4) !== 9 || ((c >> 2) & 3) !== 1 || (d >> 6) === 3) throw failure("CONTINUOUS_MP3_INVALID");
        const length = 384 + ((c >> 1) & 1);
        if (pending.length < length) break;
        if (!Number.isSafeInteger((frameIndex + 1) * 1152)) throw failure("CONTINUOUS_FRAME_LIMIT");
        frames.push({ bytes: pending.subarray(0, length), startFrame: frameIndex++ * 1152 });
        pending = pending.subarray(length);
      }
      return frames;
    },
    finish() {
      if (pending.length || !frameIndex) throw failure("CONTINUOUS_MP3_INCOMPLETE");
      return frameIndex;
    },
    get bufferedBytes() { return pending.length; }
  };
}

function childOptions(stdin) {
  return { stdio: [stdin, "pipe", "ignore"], shell: false, windowsHide: true,
    env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {} };
}
function deadline(promise, signal, milliseconds, code) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(reject, failure(code)), milliseconds);
    const abort = () => finish(reject, signal.reason || failure("CONTINUOUS_STOPPED"));
    const finish = (settle, value) => { clearTimeout(timer); signal.removeEventListener("abort", abort); settle(value); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}

function ownChild(child, signal, registerResource, allChildren) {
  let closed = false, failed = false, unregister;
  child.on("error", () => { failed = true; });
  const exit = new Promise(resolve => child.once("close", code => {
    closed = true; signal.removeEventListener("abort", kill); unregister?.(); allChildren.delete(guard);
    resolve(failed ? -1 : code);
  }));
  const kill = () => { if (!closed) {
    try { child.kill("SIGKILL"); } catch { failed = true; }
    // A warmed decoder intentionally pauses its stdout. Destroy that pipe on
    // stop, otherwise Node can wait forever to emit close after the child exits.
    child.stdin?.destroy(); child.stdout?.destroy();
  } };
  const guard = { child, exit, kill, get closed() { return closed; }, async close() {
    kill();
    if (!closed) await new Promise(resolve => {
      const timer = setTimeout(resolve, 2000);
      exit.then(() => { clearTimeout(timer); resolve(); });
    });
    return closed;
  } };
  allChildren.add(guard);
  try { unregister = registerResource({ forceClose: kill, close: async () => {
    if (!await guard.close()) throw failure("CONTINUOUS_CHILD_STOP_UNCONFIRMED");
  } }); }
  catch (error) { kill(); throw error; }
  signal.addEventListener("abort", kill, { once: true });
  if (signal.aborted) kill();
  return guard;
}

function writePcm(stream, chunk, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason || failure("CONTINUOUS_STOPPED")); };
    const error = () => { cleanup(); reject(failure("CONTINUOUS_ENCODER_FAILED")); };
    const cleanup = () => { signal.removeEventListener("abort", abort); stream.off("error", error); stream.off("close", error); };
    signal.addEventListener("abort", abort, { once: true }); stream.once("error", error); stream.once("close", error);
    stream.write(chunk, err => { cleanup(); err ? reject(failure("CONTINUOUS_ENCODER_FAILED")) : resolve(); });
    if (signal.aborted) abort();
  });
}

/**
 * nextTrack receives {recentTrackIds, signal} and returns a caller-approved local
 * {id,mediaAssetId,filePath,durationSeconds,dispose()} or null (graceful exhaustion).
 * It must obey the abort signal. emit is synchronous and must queue any audit I/O
 * itself; a false result fails closed. External lease/rights revocation aborts
 * signal. The authenticated connection remains caller-owned and is never opened,
 * reconnected, or closed here. Exceptions carry stopConfirmed for child cleanup.
 */
export async function runTestRadioContinuousPlayout(options, { spawnProcess = spawn } = {}) {
  const { ffmpegPath, signal: externalSignal, registerResource, connection, nextTrack, emit } = options || {};
  if (!localFile(ffmpegPath) || typeof externalSignal?.throwIfAborted !== "function" || typeof registerResource !== "function" ||
      connection?.authenticated !== true || typeof connection.write !== "function" || typeof nextTrack !== "function" || typeof emit !== "function") {
    throw failure("CONTINUOUS_OPTIONS_INVALID");
  }
  externalSignal.throwIfAborted();
  const stop = new AbortController(), signal = stop.signal, allChildren = new Set(), ownedTracks = new Set(), pendingRequests = new Set();
  const externalAbort = () => stop.abort(externalSignal.reason || failure("CONTINUOUS_STOPPED"));
  externalSignal.addEventListener("abort", externalAbort, { once: true });
  if (externalSignal.aborted) externalAbort();
  let error = null, encoder, feeder, prefetch, totalFrames = 0, totalAudioBytesSent = 0, tracksStarted = 0, tracksEnded = 0;
  let currentOutput = null, lastProgressBytes = 0;
  const timeline = [], recentTrackIds = [];
  const report = event => {
    const result = emit({ ...event, attribution: "ACCEPTED_ENCODER_FRAMES" });
    if (result?.then) Promise.resolve(result).catch(() => {});
    if (result === false || result?.then) throw failure("CONTINUOUS_EVENT_FAILED");
  };
  const disposeTrack = async item => {
    if (!item || !ownedTracks.has(item)) return;
    if (item.decoder && !await item.decoder.close()) throw failure("CONTINUOUS_CHILD_STOP_UNCONFIRMED");
    await deadline(Promise.resolve().then(() => item.track.dispose()), new AbortController().signal, 3000, "CONTINUOUS_DISPOSE_TIMEOUT");
    ownedTracks.delete(item);
  };
  const prepare = async () => {
    signal.throwIfAborted();
    // Track the actual callback, not only its deadline race. A caller ignoring
    // cancellation cannot make shutdown falsely report all preparation stopped.
    const requested = Promise.resolve().then(() => {
      signal.throwIfAborted(); return nextTrack({ recentTrackIds: [...recentTrackIds], signal });
    }).then(async track => {
      if (!track) return null;
      const item = { track, decoder: null, iterator: null, first: null };
      ownedTracks.add(item);
      if (signal.aborted) await disposeTrack(item);
      return item;
    });
    pendingRequests.add(requested);
    requested.then(() => pendingRequests.delete(requested), () => pendingRequests.delete(requested));
    const item = await deadline(requested, signal, 30_000, "CONTINUOUS_PREPARE_TIMEOUT");
    signal.throwIfAborted();
    if (!item) return null;
    const { track } = item;
    if (ownedTracks.size > 2 || typeof track.id !== "string" || !track.id || typeof track.mediaAssetId !== "string" ||
        !track.mediaAssetId || typeof track.dispose !== "function") throw failure("CONTINUOUS_TRACK_INVALID");
    const args = testRadioContinuousDecodeArguments(track.filePath, track.durationSeconds);
    const info = await lstat(track.filePath).catch(() => null);
    signal.throwIfAborted();
    if (!info?.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_FILE_BYTES) throw failure("CONTINUOUS_FILE_INVALID");
    const child = spawnProcess(ffmpegPath, args, childOptions("ignore"));
    item.decoder = ownChild(child, signal, registerResource, allChildren);
    item.iterator = child.stdout[Symbol.asyncIterator]();
    item.first = await deadline(item.iterator.next(), signal, 10_000, "CONTINUOUS_DECODE_TIMEOUT");
    if (item.first.done || !Buffer.isBuffer(item.first.value) || item.first.value.length < FRAME_BYTES || item.first.value.length > CHUNK_LIMIT) {
      throw failure("CONTINUOUS_DECODE_FAILED");
    }
    recentTrackIds.push(track.id);
    if (recentTrackIds.length > 32) recentTrackIds.shift();
    return item;
  };
  const startPrefetch = previous => {
    const state = { done: false, item: null, error: null, promise: null };
    state.promise = (async () => {
      // Cleanup/download work runs while the already warmed next decoder feeds
      // the encoder, never between the last and first PCM writes of two songs.
      if (previous) await disposeTrack(previous);
      return prepare();
    })().then(item => { state.done = true; state.item = item; }, err => {
      state.done = true; state.error = err;
      // Never continue indefinitely after missing/invalid next-track preparation.
      if (!signal.aborted) stop.abort(err);
    });
    return state;
  };
  try {
    let current = await prepare();
    if (!current) throw failure("CONTINUOUS_CATALOGUE_EMPTY");
    // The next recording is decoded and ready before any source audio is sent.
    prefetch = startPrefetch(); await prefetch.promise;
    signal.throwIfAborted();
    const child = spawnProcess(ffmpegPath, testRadioContinuousEncoderArguments(), childOptions("pipe"));
    encoder = ownChild(child, signal, registerResource, allChildren);
    child.stdin.on("error", () => {});
    let feederError = null;
    feeder = (async () => {
      while (current) {
        signal.throwIfAborted();
        const track = current.track;
        const entry = { trackId: track.id, mediaAssetId: track.mediaAssetId, startFrame: totalFrames, endFrame: Infinity, audioBytesSent: 0 };
        timeline.push(entry);
        if (timeline.length > 8) throw failure("CONTINUOUS_TIMELINE_LIMIT");
        let result = current.first, bytes = 0, remainder = Buffer.alloc(0);
        const ceiling = Math.ceil((track.durationSeconds + 2) * SAMPLE_RATE) * FRAME_BYTES;
        while (!result.done) {
          signal.throwIfAborted();
          const received = result.value;
          if (!Buffer.isBuffer(received) || received.length > CHUNK_LIMIT) throw failure("CONTINUOUS_PCM_INVALID");
          const combined = remainder.length ? Buffer.concat([remainder, received]) : received;
          const alignedLength = combined.length - combined.length % FRAME_BYTES;
          const chunk = combined.subarray(0, alignedLength);
          remainder = combined.subarray(alignedLength);
          bytes += chunk.length;
          if (bytes > ceiling) throw failure("CONTINUOUS_DURATION_MISMATCH");
          // Small writes allow immediate stop and bound the encoder's input lead.
          for (let offset = 0; offset < chunk.length; offset += 16_384) await writePcm(child.stdin, chunk.subarray(offset, offset + 16_384), signal);
          result = await deadline(current.iterator.next(), signal, 10_000, "CONTINUOUS_DECODE_TIMEOUT");
        }
        const code = await deadline(current.decoder.exit, signal, 2000, "CONTINUOUS_DECODE_TIMEOUT");
        signal.throwIfAborted();
        const actualSeconds = bytes / (SAMPLE_RATE * FRAME_BYTES);
        if (code !== 0 || bytes === 0 || remainder.length || Math.abs(actualSeconds - track.durationSeconds) > Math.min(2, Math.max(0.1, track.durationSeconds * 0.01))) {
          throw failure("CONTINUOUS_DURATION_MISMATCH");
        }
        totalFrames += bytes / FRAME_BYTES; entry.endFrame = totalFrames;
        // A late prefetch is a failed run, not silent buffering on a live stream.
        if (!prefetch.done) throw failure("CONTINUOUS_PREFETCH_NOT_READY");
        if (prefetch.error) throw prefetch.error;
        const previous = current;
        current = prefetch.item;
        prefetch = current ? startPrefetch(previous) : null;
        if (!current) await disposeTrack(previous);
      }
      child.stdin.end();
    })().catch(err => { feederError = err; if (!signal.aborted) stop.abort(err); encoder.kill(); });
    const parser = createTestRadioContinuousMp3Parser();
    for await (const chunk of child.stdout) {
      for (const frame of parser.push(chunk)) {
        signal.throwIfAborted();
        while (timeline.length > 1 && frame.startFrame >= timeline[0].endFrame) {
          const ended = timeline.shift();
          if (ended.audioBytesSent > 0) { tracksEnded++; report({ type: "TRACK_ENDED", ...ended, completed: true, totalAudioBytesSent }); }
        }
        const entry = timeline[0];
        if (!entry) throw failure("CONTINUOUS_TIMELINE_INVALID");
        await deadline(Promise.resolve().then(() => { signal.throwIfAborted(); return connection.write(frame.bytes); }), signal, 3000, "CONTINUOUS_SOURCE_WRITE_TIMEOUT");
        signal.throwIfAborted();
        totalAudioBytesSent += frame.bytes.length; entry.audioBytesSent += frame.bytes.length;
        if (entry !== currentOutput) {
          currentOutput = entry; tracksStarted++;
          report({ type: "TRACK_AUDIO_STARTED", trackId: entry.trackId, mediaAssetId: entry.mediaAssetId,
            audioBytesSent: entry.audioBytesSent, totalAudioBytesSent });
        }
        if (totalAudioBytesSent - lastProgressBytes >= 16_000) {
          lastProgressBytes = totalAudioBytesSent;
          report({ type: "AUDIO_PROGRESS", trackId: entry.trackId, mediaAssetId: entry.mediaAssetId,
            audioBytesSent: entry.audioBytesSent, totalAudioBytesSent });
        }
      }
    }
    await feeder;
    signal.throwIfAborted();
    if (feederError || await encoder.exit !== 0) throw feederError || failure("CONTINUOUS_ENCODER_FAILED");
    parser.finish();
    if (timeline.length !== 1 || timeline[0].audioBytesSent <= 0 || !Number.isFinite(timeline[0].endFrame)) throw failure("CONTINUOUS_TIMELINE_INVALID");
    tracksEnded++; report({ type: "TRACK_ENDED", ...timeline[0], completed: true, totalAudioBytesSent });
  } catch (err) { error = externalSignal.aborted ? externalSignal.reason : signal.aborted ? signal.reason : err; }
  finally {
    if (!signal.aborted) stop.abort(error || failure("CONTINUOUS_FINISHED"));
    for (const child of allChildren) child.kill();
    if (feeder) await deadline(feeder, new AbortController().signal, 3000, "CONTINUOUS_STOP_TIMEOUT").catch(err => { error ||= err; });
    if (prefetch) await deadline(prefetch.promise, new AbortController().signal, 3000, "CONTINUOUS_STOP_TIMEOUT").catch(err => { error ||= err; });
    if (pendingRequests.size) await deadline(Promise.allSettled([...pendingRequests]), new AbortController().signal, 3000, "CONTINUOUS_PREPARATION_STOP_UNCONFIRMED").catch(err => { error ||= err; });
    const stopped = await Promise.all([...allChildren].map(child => child.close()));
    if (stopped.every(Boolean)) {
      for (const item of ownedTracks) await disposeTrack(item).catch(err => { error ||= err; });
    } else error ||= failure("CONTINUOUS_CHILD_STOP_UNCONFIRMED");
    externalSignal.removeEventListener("abort", externalAbort);
    if (error) { if (!(error instanceof Error)) error = failure("CONTINUOUS_STOPPED"); error.stopConfirmed = stopped.every(Boolean) && allChildren.size === 0 && ownedTracks.size === 0 && pendingRequests.size === 0; }
  }
  if (error) throw error;
  return { stopConfirmed: true, totalAudioBytesSent, tracksStarted, tracksEnded, completed: true };
}
