import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createTestRadioShuffleSelector, createTestRadioContinuousMp3Parser, testRadioContinuousDecodeArguments,
  testRadioContinuousEncoderArguments, runTestRadioContinuousPlayout } from "../lib/test-radio-continuous-playout.mjs";

const require = createRequire(import.meta.url), ffmpegPath = require("ffmpeg-static");
const syntheticFrame = () => { const bytes = Buffer.alloc(384); bytes.set([255, 251, 148, 0]); return bytes; };
function registry() {
  const values = new Set(); let peak = 0;
  return { values, get peak() { return peak; }, registerResource: value => {
    values.add(value); peak = Math.max(peak, values.size); return () => values.delete(value);
  }, close: () => Promise.all([...values].map(value => value.close())) };
}
function wav(frequency, seconds) {
  const frames = Math.round(seconds * 48_000), pcm = Buffer.alloc(frames * 4), header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  for (let n = 0; n < frames; n++) {
    const value = Math.round(12000 * Math.sin(2 * Math.PI * frequency * n / 48000));
    pcm.writeInt16LE(value, n * 4); pcm.writeInt16LE(value, n * 4 + 2);
  }
  return Buffer.concat([header, pcm]);
}
async function fixture(seconds = 2, frequencies = [220, 660, 440, 880]) {
  const root = await realpath(tmpdir()), directory = await mkdtemp(path.join(root, "ruvanas-continuous-test-"));
  const tracks = [];
  for (const [index, frequency] of frequencies.entries()) {
    const filePath = path.join(directory, `${index}.wav`); await writeFile(filePath, wav(frequency, seconds));
    tracks.push({ id: `track-${index}`, mediaAssetId: `asset-${index}`, filePath, durationSeconds: seconds });
  }
  return { tracks, directory, cleanup: async () => {
    assert.equal(path.dirname(await realpath(directory)), root);
    assert.ok(path.basename(directory).startsWith("ruvanas-continuous-test-"));
    await rm(directory, { recursive: true, force: false });
  } };
}
function trackSource(tracks, { disposeDelay = 0 } = {}) {
  let index = 0, active = 0, peak = 0, disposed = 0;
  return {
    get active() { return active; }, get peak() { return peak; }, get disposed() { return disposed; },
    nextTrack: async ({ signal }) => {
      signal.throwIfAborted();
      if (index === tracks.length) return null;
      active++; peak = Math.max(peak, active); let released = false;
      return { ...tracks[index++], dispose: async () => {
        if (disposeDelay) await new Promise(resolve => setTimeout(resolve, disposeDelay));
        assert.equal(released, false); released = true; active--; disposed++;
      } };
    }
  };
}
function codecSpawn(stats, { realtime = false } = {}) {
  return (binary, args, options) => {
    if (args.includes("libmp3lame")) { stats.encoders++; assert.ok(args.includes("-re")); }
    else stats.decoders++;
    return spawn(binary, realtime ? args : args.filter(arg => arg !== "-re"), options);
  };
}
function energyAt(pcm, second, frequency) {
  let re = 0, im = 0; const count = 2400, start = Math.floor(second * 48000);
  for (let n = 0; n < count; n++) {
    const value = pcm.readInt16LE((start + n) * 4), phase = 2 * Math.PI * frequency * n / 48000;
    re += value * Math.cos(phase); im += value * Math.sin(phase);
  }
  return Math.hypot(re, im) / count;
}

test("full-track local-only arguments, persistent encoder, and bounded frame parser", () => {
  const decode = testRadioContinuousDecodeArguments(path.resolve("song.mp3"), 187.4);
  assert.equal(decode[decode.indexOf("-t") + 1], "189.4"); assert.ok(decode.includes("file,pipe"));
  const encode = testRadioContinuousEncoderArguments();
  assert.ok(encode.includes("-re")); assert.ok(!encode.includes("-t")); assert.ok(!encode.includes("-stream_loop"));
  assert.equal(encode[encode.indexOf("-i") + 1], "pipe:0"); assert.equal(encode.at(-1), "pipe:1");
  for (const file of ["relative.mp3", "https://example.test/audio.mp3", "\\\\host\\share\\song.mp3", path.resolve("song.m3u")]) {
    assert.throws(() => testRadioContinuousDecodeArguments(file, 180));
  }
  for (const seconds of [NaN, Infinity, 0, -1, 3601]) assert.throws(() => testRadioContinuousDecodeArguments(path.resolve("song.wav"), seconds));
  const parser = createTestRadioContinuousMp3Parser();
  const data = Buffer.concat(Array.from({ length: 5000 }, syntheticFrame)); let frames = 0;
  for (let offset = 0; offset < data.length; offset += 997) {
    frames += parser.push(data.subarray(offset, offset + 997)).length; assert.ok(parser.bufferedBytes < 385);
  }
  assert.equal(frames, 5000); assert.equal(parser.finish(), 5000); // Not limited to a 90-second test.
  assert.throws(() => createTestRadioContinuousMp3Parser().push(Buffer.from("ID3bad")));
  assert.throws(() => createTestRadioContinuousMp3Parser().push(Buffer.alloc(256 * 1024 + 1)));
});

test("shuffle bag uses only currently approved tracks and avoids immediate bag-boundary repeats", () => {
  const select = createTestRadioShuffleSelector({ random: () => 0.5 });
  const tracks = ["a", "b", "c"].map(id => ({ id })), chosen = [];
  for (let count = 0; count < 12; count++) chosen.push(select(tracks).id);
  for (let offset = 0; offset < 12; offset += 3) assert.equal(new Set(chosen.slice(offset, offset + 3)).size, 3);
  assert.ok(chosen.every((id, index) => index === 0 || id !== chosen[index - 1]));
  for (let count = 0; count < 5; count++) assert.equal(select([{ id: "remaining" }]).id, "remaining");
  assert.equal(select([]), null);
  assert.throws(() => select([{ id: "duplicate" }, { id: "duplicate" }]));
  assert.throws(() => createTestRadioShuffleSelector({ random: () => 1 })(tracks));
});

test("real codec plays four complete songs through one source and encoder with two prepared files maximum", { timeout: 30_000 }, async () => {
  const data = await fixture(2), resources = registry(), stop = new AbortController(), source = trackSource(data.tracks);
  const stats = { encoders: 0, decoders: 0 }, output = [], events = [];
  try {
    const result = await runTestRadioContinuousPlayout({ ffmpegPath, signal: stop.signal, registerResource: resources.registerResource,
      nextTrack: source.nextTrack, connection: { authenticated: true, write: async bytes => { output.push(Buffer.from(bytes)); } },
      emit: event => { events.push(event); return true; } }, { spawnProcess: codecSpawn(stats, { realtime: true }) });
    assert.equal(result.stopConfirmed, true); assert.equal(result.completed, true);
    assert.equal(result.tracksStarted, 4); assert.equal(result.tracksEnded, 4);
    assert.equal(stats.encoders, 1); assert.equal(stats.decoders, 4); assert.equal(resources.values.size, 0);
    assert.ok(resources.peak <= 3); assert.equal(source.peak, 2); assert.equal(source.active, 0); assert.equal(source.disposed, 4);
    assert.deepEqual(events.filter(event => event.type === "TRACK_AUDIO_STARTED").map(event => event.trackId), data.tracks.map(track => track.id));
    assert.ok(events.filter(event => event.type === "TRACK_AUDIO_STARTED").every(event => event.audioBytesSent > 0));
    const bytes = Buffer.concat(output); assert.equal(bytes.length, result.totalAudioBytesSent);
    const decoded = spawnSync(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
      "-f", "mp3", "-i", "pipe:0", "-f", "s16le", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
    { input: bytes, encoding: null, maxBuffer: 8 * 1024 * 1024, timeout: 10_000, windowsHide: true,
      env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {} });
    assert.equal(decoded.status, 0);
    const frequencies = [220, 660, 440, 880];
    for (const [second, expected] of [[0.4, 220], [1.8, 220], [2.1, 660], [3.8, 660], [4.1, 440], [5.8, 440], [6.1, 880], [7.8, 880]]) {
      assert.ok(energyAt(decoded.stdout, second, expected) > 4000, `${second}: expected ${expected} Hz`);
      assert.ok(frequencies.filter(value => value !== expected).every(value => energyAt(decoded.stdout, second, value) < 200));
    }
    // No decoded silence around joins, apart from normal initial/final codec delay.
    for (const boundary of [2, 4, 6]) for (let offset = -0.06; offset <= 0.08; offset += 0.01) {
      let energy = 0; const start = Math.floor((boundary + offset) * 48_000);
      for (let n = 0; n < 480; n++) energy += decoded.stdout.readInt16LE((start + n) * 4) ** 2;
      assert.ok(Math.sqrt(energy / 480) > 3000);
    }
  } finally { stop.abort(); await resources.close(); await data.cleanup(); }
});

test("manual stop and rights/lease revocation kill every child and stop accepted audio immediately", { timeout: 20_000 }, async () => {
  const data = await fixture(2);
  try {
    for (const code of ["MANUAL_STOP", "RIGHTS_REVOKED", "LEASE_LOST"]) {
      const resources = registry(), stop = new AbortController(), source = trackSource(data.tracks); let writes = 0;
      await assert.rejects(runTestRadioContinuousPlayout({ ffmpegPath, signal: stop.signal, registerResource: resources.registerResource,
        nextTrack: source.nextTrack, connection: { authenticated: true, write: async () => {
          writes++; if (writes === 10) stop.abort(Object.assign(new Error(code), { code }));
        } }, emit: () => true }, { spawnProcess: codecSpawn({ encoders: 0, decoders: 0 }) }), error => {
        assert.equal(error.code, code); assert.equal(error.stopConfirmed, true); return true;
      });
      assert.equal(writes, 10); assert.equal(resources.values.size, 0); assert.equal(source.active, 0);
    }
  } finally { await data.cleanup(); }
});

test("full 105-second audio run is not clipped to the former 30/90-second diagnostic limits", { timeout: 30_000 }, async () => {
  const data = await fixture(35, [220, 660, 440]), resources = registry(), source = trackSource(data.tracks);
  const stats = { encoders: 0, decoders: 0 }; let bytes = 0;
  try {
    const result = await runTestRadioContinuousPlayout({ ffmpegPath, signal: new AbortController().signal,
      registerResource: resources.registerResource, nextTrack: source.nextTrack,
      connection: { authenticated: true, write: async chunk => { bytes += chunk.length; } }, emit: () => true },
    { spawnProcess: codecSpawn(stats) });
    assert.equal(result.tracksStarted, 3); assert.equal(result.tracksEnded, 3); assert.equal(result.stopConfirmed, true);
    assert.equal(stats.encoders, 1); assert.equal(stats.decoders, 3);
    assert.ok(bytes >= 105 * 16_000 && bytes < 106 * 16_000);
    assert.equal(source.active, 0); assert.equal(source.peak, 2); assert.equal(resources.values.size, 0);
  } finally { await resources.close(); await data.cleanup(); }
});

test("two real tracks repeat through five boundaries on the same connection, then finish and clean up", { timeout: 25_000 }, async () => {
  const data = await fixture(2, [220, 660]), resources = registry(), stats = { encoders: 0, decoders: 0 };
  const sequence = [0, 1, 0, 1, 0, 1], activeIds = new Set(), starts = [], ends = [], output = [];
  let cursor = 0, peakFiles = 0, disposed = 0, writes = 0;
  const connection = { authenticated: true, write: async bytes => { writes++; output.push(Buffer.from(bytes)); } };
  try {
    const result = await runTestRadioContinuousPlayout({ ffmpegPath, signal: new AbortController().signal,
      registerResource: resources.registerResource, connection,
      nextTrack: async ({ signal }) => {
        signal.throwIfAborted();
        if (cursor === sequence.length) return null;
        const track = data.tracks[sequence[cursor++]];
        assert.equal(activeIds.has(track.id), false, "previous descriptor disposed before repeating the ID");
        activeIds.add(track.id); peakFiles = Math.max(peakFiles, activeIds.size);
        let released = false;
        return { ...track, dispose: async () => {
          assert.equal(released, false); released = true;
          assert.equal(activeIds.delete(track.id), true); disposed++;
        } };
      },
      emit: event => {
        if (event.type === "TRACK_AUDIO_STARTED") starts.push(event.trackId);
        if (event.type === "TRACK_ENDED") ends.push(event.trackId);
        return true;
      }
    }, { spawnProcess: codecSpawn(stats, { realtime: true }) });
    const expected = sequence.map(index => data.tracks[index].id);
    assert.deepEqual(starts, expected); assert.deepEqual(ends, expected);
    assert.equal(result.tracksStarted, 6); assert.equal(result.tracksEnded, 6);
    assert.equal(result.completed, true); assert.equal(result.stopConfirmed, true);
    assert.equal(stats.encoders, 1); assert.equal(stats.decoders, 6);
    assert.ok(resources.peak <= 3); assert.equal(resources.values.size, 0);
    assert.equal(peakFiles, 2); assert.equal(activeIds.size, 0); assert.equal(disposed, 6);
    assert.ok(writes > 12 * 40);
    const bytes = Buffer.concat(output); assert.equal(bytes.length, result.totalAudioBytesSent);
    const decoded = spawnSync(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
      "-f", "mp3", "-i", "pipe:0", "-f", "s16le", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
    { input: bytes, encoding: null, maxBuffer: 8 * 1024 * 1024, timeout: 10_000, windowsHide: true,
      env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {} });
    assert.equal(decoded.status, 0);
    for (let index = 0; index < sequence.length; index++) {
      const expectedFrequency = sequence[index] ? 660 : 220;
      assert.ok(energyAt(decoded.stdout, index * 2 + 0.4, expectedFrequency) > 4000);
      assert.ok(energyAt(decoded.stdout, index * 2 + 1.8, expectedFrequency) > 4000);
    }
  } finally { await resources.close(); await data.cleanup(); }
});

test("source write failure and audit refusal fail closed without reconnecting or leaking prepared files", { timeout: 20_000 }, async () => {
  const data = await fixture(2);
  try {
    for (const kind of ["source", "audit", "async-audit"]) {
      const resources = registry(), source = trackSource(data.tracks), stats = { encoders: 0, decoders: 0 }; let writes = 0;
      await assert.rejects(runTestRadioContinuousPlayout({ ffmpegPath, signal: new AbortController().signal, registerResource: resources.registerResource,
        nextTrack: source.nextTrack, connection: { authenticated: true, write: async () => {
          writes++; if (kind === "source") throw Object.assign(new Error("source"), { code: "SOURCE_DISCONNECTED" });
        } }, emit: () => kind === "async-audit" ? Promise.resolve(true) : false }, { spawnProcess: codecSpawn(stats) }), error => {
        assert.equal(error.code, kind === "source" ? "SOURCE_DISCONNECTED" : "CONTINUOUS_EVENT_FAILED");
        assert.equal(error.stopConfirmed, true); return true;
      });
      assert.equal(writes, 1); assert.equal(stats.encoders, 1); assert.equal(resources.values.size, 0); assert.equal(source.active, 0);
    }
  } finally { await data.cleanup(); }
});

test("corrupt or falsely sized audio cannot run forever and cleanup is confirmed", { timeout: 20_000 }, async () => {
  const data = await fixture(1);
  try {
    for (const kind of ["corrupt", "duration"]) {
      const filePath = path.join(data.directory, `${kind}.wav`);
      await writeFile(filePath, kind === "corrupt" ? "not audio" : wav(220, 2));
      const tracks = [{ id: kind, mediaAssetId: kind, filePath, durationSeconds: 0.5 }], source = trackSource(tracks), resources = registry();
      await assert.rejects(runTestRadioContinuousPlayout({ ffmpegPath, signal: new AbortController().signal, registerResource: resources.registerResource,
        nextTrack: source.nextTrack, connection: { authenticated: true, write: async () => {} }, emit: () => true },
      { spawnProcess: codecSpawn({ encoders: 0, decoders: 0 }) }), error => {
        assert.ok(["CONTINUOUS_DECODE_FAILED", "CONTINUOUS_DURATION_MISMATCH"].includes(error.code));
        assert.equal(error.stopConfirmed, true); return true;
      });
      assert.equal(resources.values.size, 0); assert.equal(source.active, 0);
    }
  } finally { await data.cleanup(); }
});

test("shutdown waits for aborted preparation cleanup and does not claim an uncooperative callback stopped", { timeout: 15_000 }, async () => {
  const data = await fixture(1);
  try {
    for (const delay of [30, 3400]) {
      const stop = new AbortController(), resources = registry(); let calls = 0, disposed = 0, release;
      const nextTrack = async ({ signal }) => {
        calls++;
        if (calls === 2) {
          await new Promise(resolve => {
            release = resolve;
            signal.addEventListener("abort", () => setTimeout(resolve, delay), { once: true });
            stop.abort(Object.assign(new Error("stop"), { code: "MANUAL_STOP" }));
          });
        }
        return { ...data.tracks[calls - 1], dispose: async () => { disposed++; } };
      };
      await assert.rejects(runTestRadioContinuousPlayout({ ffmpegPath, signal: stop.signal,
        registerResource: resources.registerResource, nextTrack,
        connection: { authenticated: true, write: async () => assert.fail("not started") }, emit: () => true }), error => {
        assert.equal(error.code, "MANUAL_STOP"); assert.equal(error.stopConfirmed, delay < 3000); return true;
      });
      release?.(); await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(disposed, 2); assert.equal(resources.values.size, 0);
    }
  } finally { await data.cleanup(); }
});

test("slow disposal happens during the following song and does not insert a PCM pause at the join", { timeout: 20_000 }, async () => {
  const data = await fixture(2), source = trackSource(data.tracks.slice(0, 3), { disposeDelay: 100 }), resources = registry();
  const stats = { encoders: 0, decoders: 0 }, starts = [], writes = [];
  try {
    await runTestRadioContinuousPlayout({ ffmpegPath, signal: new AbortController().signal, registerResource: resources.registerResource,
      nextTrack: source.nextTrack, connection: { authenticated: true, write: async () => { writes.push(performance.now()); } },
      emit: event => { if (event.type === "TRACK_AUDIO_STARTED") starts.push(performance.now()); return true; } },
    { spawnProcess: codecSpawn(stats, { realtime: true }) });
    assert.equal(starts.length, 3); assert.equal(source.active, 0); assert.equal(stats.encoders, 1);
    const gaps = writes.slice(1).map((time, index) => time - writes[index]);
    assert.ok(Math.max(...gaps) < 250, `largest write gap ${Math.max(...gaps)}`);
  } finally { await resources.close(); await data.cleanup(); }
});

test("pure engine contains no cloud, secret, database or schedule authority", async () => {
  const source = await readFile(new URL("../lib/test-radio-continuous-playout.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:net|node:dns|\bfetch\(|@aws-sdk|@prisma|decryptSecret|R2_SECRET|SOURCE_PASSWORD|process\.env\.(?!SystemRoot)/);
});
