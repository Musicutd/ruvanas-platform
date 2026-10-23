import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { buildCatalogueTestPlayoutPlan, catalogueTestPlayoutSegmentForFrame } from "../lib/catalogue-test-playout-plan.mjs";
import { catalogueTestPcmDecodeArguments, catalogueTestPersistentEncoderArguments, createCatalogueTestMp3FrameParser,
  prepareCatalogueTestPlayout, sendCatalogueTestPlayout } from "../lib/catalogue-test-playout.mjs";

const mode = "HANDOVER_90_SECONDS";
const session = () => ({ id: "test-session", stationId: "cmvcnbwi20008hr23sd76psi8", authorized: true,
  profileId: "FIVE_MINUTES", durationSeconds: 300, fingerprint: "a".repeat(64), testMode: mode,
  authorization: { profileId: "FIVE_MINUTES", maximumSeconds: 300, testMode: mode },
  plan: { testMode: mode, audioDurationSeconds: 90, targetSeconds: 300 },
  tracks: [0, 1, 2].map(index => ({ id: `track-${index}`, mediaAssetId: `asset-${index}`, durationSeconds: 30 })) });
const frame = () => { const bytes = Buffer.alloc(384); bytes.set([255, 251, 148, 0]); return bytes; };
function registry() {
  const values = new Set();
  return { values, registerResource: value => { values.add(value); return () => values.delete(value); },
    close: () => Promise.all([...values].map(value => value.close())) };
}
async function fixture() {
  const root = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(root, "ruvanas-playout-test-"));
  const files = new Map();
  for (let index = 0; index < 3; index++) {
    const file = path.join(directory, `${index}.wav`); await writeFile(file, "local synthetic fixture"); files.set(`track-${index}`, file);
  }
  return { directory, files, cleanup: async () => {
    assert.equal(path.dirname(await realpath(directory)), root);
    assert.ok(path.basename(directory).startsWith("ruvanas-playout-test-"));
    await rm(directory, { recursive: true, force: false });
  } };
}
function fakeChild(output, { exitCode = 0, stdin = false } = {}) {
  const child = new EventEmitter(); let closed = false;
  child.stdout = Readable.from(output);
  child.stdin = stdin ? new PassThrough() : null;
  child.stdin?.resume();
  const close = code => { if (!closed) { closed = true; child.emit("close", code); } };
  child.kill = () => { child.stdout.destroy(); child.stdin?.destroy(); setImmediate(() => close(1)); return true; };
  child.stdout.once("end", () => setImmediate(() => close(exitCode)));
  return child;
}
const decoder = () => fakeChild([Buffer.alloc(30 * 48_000 * 4, 1)]);

test("only an explicitly signed Test Radio five-minute grant can derive the fixed 90-second diagnostic", () => {
  const plan = buildCatalogueTestPlayoutPlan(session());
  assert.equal(plan.durationSeconds, 90); assert.equal(plan.totalFrames, 4_320_000);
  assert.deepEqual(plan.segments.map(item => item.phase), ["AUTODJ", "SCHEDULED", "AUTODJ_RETURN"]);
  assert.deepEqual(plan.segments.map(item => item.startFrame), [0, 1_440_000, 2_880_000]);
  assert.ok(plan.segments.every(item => item.sourceOffsetFrames === 0));
  for (const change of [{ authorized: false }, { stationId: "other-station" }, { authorization: {} }, { plan: {} },
    { testMode: "STANDARD" }, { profileId: "ONE_HOUR" }, { durationSeconds: 90 }, { fingerprint: "bad" },
    { tracks: session().tracks.slice(0, 2) }, { tracks: [session().tracks[0], session().tracks[0], session().tracks[2]] },
    { tracks: session().tracks.map(track => ({ ...track, durationSeconds: 31 })) },
    { tracks: session().tracks.map(track => ({ ...track, mediaAssetId: "same" })) }]) {
    assert.throws(() => buildCatalogueTestPlayoutPlan({ ...session(), ...change }));
  }
  assert.equal(catalogueTestPlayoutSegmentForFrame(plan, 1_440_000).phase, "SCHEDULED");
  assert.equal(catalogueTestPlayoutSegmentForFrame(plan, 2_880_000).phase, "AUTODJ_RETURN");
  assert.throws(() => catalogueTestPlayoutSegmentForFrame(plan, plan.totalFrames + 2304));
});

test("arguments are bounded local PCM clips and one persistent 128kbps encoder with no network destination", () => {
  const args = catalogueTestPcmDecodeArguments(path.resolve("synthetic.wav"));
  assert.equal(args[args.indexOf("-t") + 1], "30"); assert.ok(args.includes("file,pipe"));
  assert.equal(args.at(-1), "pipe:1"); assert.equal(args[args.indexOf("-ar") + 1], "48000");
  for (const file of ["https://secret.example/music.mp3", "relative.mp3", "\\\\host\\share\\music.mp3", path.resolve("bad.m3u")]) {
    assert.throws(() => catalogueTestPcmDecodeArguments(file));
  }
  const encode = catalogueTestPersistentEncoderArguments();
  assert.ok(encode.includes("-re")); assert.ok(!encode.includes("-stream_loop"));
  assert.equal(encode[encode.indexOf("-i") + 1], "pipe:0"); assert.equal(encode.at(-1), "pipe:1");
});

test("MP3 framing survives arbitrary chunk boundaries and refuses corruption, truncation and extra audio", () => {
  const audio = Buffer.concat(Array.from({ length: 3751 }, frame));
  const parser = createCatalogueTestMp3FrameParser(); const seen = [];
  for (let offset = 0; offset < audio.length; offset += 997) seen.push(...parser.push(audio.subarray(offset, offset + 997)));
  assert.equal(parser.finish(), 3751); assert.equal(seen.length, 3751);
  assert.equal(seen[1250].startFrame, 1_440_000); assert.equal(seen[2500].startFrame, 2_880_000);
  assert.throws(() => createCatalogueTestMp3FrameParser().push(Buffer.from("ID3bad")), { code: "TEST_PLAYOUT_MP3_INVALID" });
  const truncated = createCatalogueTestMp3FrameParser(); truncated.push(audio.subarray(0, audio.length - 1));
  assert.throws(() => truncated.finish(), { code: "TEST_PLAYOUT_MP3_INCOMPLETE" });
  assert.throws(() => createCatalogueTestMp3FrameParser().push(Buffer.concat(Array.from({ length: 3753 }, frame))), { code: "TEST_PLAYOUT_MP3_LIMIT" });
});

test("preparation decodes only three approved prefixes, stays under 64MiB and fails closed on short media", async () => {
  const data = await fixture(); const resources = registry(); const signal = new AbortController().signal;
  let calls = 0;
  try {
    const prepared = await prepareCatalogueTestPlayout({ session: session(), files: data.files, ffmpegPath: process.execPath,
      signal, registerResource: resources.registerResource }, { spawnProcess: () => { calls++; return decoder(); } });
    assert.equal(calls, 3); assert.equal(prepared.decodedBytes, 17_280_000); assert.equal(resources.values.size, 0);
    prepared.dispose();
    await assert.rejects(prepareCatalogueTestPlayout({ session: session(), files: data.files, ffmpegPath: process.execPath,
      signal, registerResource: resources.registerResource }, { spawnProcess: () => fakeChild([Buffer.alloc(4)]) }), { code: "TEST_PLAYOUT_DECODE_FAILED" });
  } finally { await resources.close(); await data.cleanup(); }
});

test("one persistent encoder reports only accepted frame bytes and never reconnects at diagnostic handovers", async () => {
  const data = await fixture(); const resources = registry(); const signal = new AbortController().signal;
  let prepared;
  try {
    prepared = await prepareCatalogueTestPlayout({ session: session(), files: data.files, ffmpegPath: process.execPath,
      signal, registerResource: resources.registerResource }, { spawnProcess: decoder });
    const phases = [], ends = []; let writes = 0, encoders = 0;
    const result = await sendCatalogueTestPlayout({ prepared, connection: { authenticated: true, write: async bytes => { assert.equal(bytes.length, 384); writes++; } },
      ffmpegPath: process.execPath, signal, registerResource: resources.registerResource,
      emit: async event => { if (event.type === "SEGMENT_ENDED") ends.push(event); else if (!phases.includes(event.phase)) phases.push(event.phase); return true; }
    }, { spawnProcess: () => { encoders++; return fakeChild(Array.from({ length: 3751 }, frame), { stdin: true }); } });
    assert.equal(encoders, 1); assert.equal(writes, 3751); assert.equal(result.audioBytesSent, writes * 384);
    assert.deepEqual(phases, ["AUTODJ", "SCHEDULED", "AUTODJ_RETURN"]); assert.equal(ends.length, 3);
    assert.equal(result.perSegmentAudioBytes.reduce((a, b) => a + b, 0), result.audioBytesSent);
    assert.ok(ends.every(event => event.completed && event.audioBytesSent > 0 && event.attribution === "ENCODER_FRAME_DIAGNOSTIC"));
    await assert.rejects(sendCatalogueTestPlayout({ prepared, connection: { authenticated: true, write: async () => {} },
      ffmpegPath: process.execPath, signal, registerResource: resources.registerResource, emit: async () => true },
    { spawnProcess: () => { throw new Error("must not start twice"); } }), { code: "TEST_PLAYOUT_NOT_PREPARED" });
  } finally { await resources.close(); prepared?.dispose(); await data.cleanup(); }
});

test("deadline cancellation stops the persistent child and prevents further source writes", async () => {
  const data = await fixture(); const resources = registry(); const stop = new AbortController(); let prepared;
  try {
    prepared = await prepareCatalogueTestPlayout({ session: session(), files: data.files, ffmpegPath: process.execPath,
      signal: stop.signal, registerResource: resources.registerResource }, { spawnProcess: decoder });
    let writes = 0;
    await assert.rejects(sendCatalogueTestPlayout({ prepared, connection: { authenticated: true, write: async () => {
      writes++; stop.abort(Object.assign(new Error("deadline"), { code: "CATALOGUE_TEST_DEADLINE" }));
    } }, ffmpegPath: process.execPath, signal: stop.signal, registerResource: resources.registerResource, emit: async () => true },
    { spawnProcess: () => fakeChild(Array.from({ length: 3751 }, frame), { stdin: true }) }), { code: "CATALOGUE_TEST_DEADLINE" });
    await resources.close(); assert.equal(writes, 1); assert.equal(resources.values.size, 0);
  } finally { await resources.close(); prepared?.dispose(); await data.cleanup(); }
});

test("source and audit failures stop the one encoder without claiming completed handovers", async () => {
  const data = await fixture();
  try {
    for (const failure of ["source", "audit"]) {
      const resources = registry(), signal = new AbortController().signal; let prepared, writes = 0, ended = 0;
      try {
        prepared = await prepareCatalogueTestPlayout({ session: session(), files: data.files, ffmpegPath: process.execPath,
          signal, registerResource: resources.registerResource }, { spawnProcess: decoder });
        await assert.rejects(sendCatalogueTestPlayout({ prepared, ffmpegPath: process.execPath, signal,
          registerResource: resources.registerResource, connection: { authenticated: true, write: async () => {
            writes++; if (failure === "source") throw Object.assign(new Error("source"), { code: "TEST_SOURCE_DISCONNECTED" });
          } }, emit: async event => { if (event.type === "SEGMENT_ENDED") ended++; return false; } },
        { spawnProcess: () => fakeChild(Array.from({ length: 3751 }, frame), { stdin: true }) }),
        { code: failure === "source" ? "TEST_SOURCE_DISCONNECTED" : "TEST_PLAYOUT_EVENT_FAILED" });
        await resources.close(); assert.equal(writes, 1); assert.equal(ended, 0); assert.equal(resources.values.size, 0);
      } finally { await resources.close(); prepared?.dispose(); }
    }
  } finally { await data.cleanup(); }
});

function wav(frequency) {
  const frames = 30 * 48_000, pcm = Buffer.alloc(frames * 4), header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  for (let n = 0; n < frames; n++) { const value = Math.round(12000 * Math.sin(2 * Math.PI * frequency * n / 48000)); pcm.writeInt16LE(value, n * 4); pcm.writeInt16LE(value, n * 4 + 2); }
  return { file: Buffer.concat([header, pcm]), pcm };
}
function energyAt(pcm, second, frequency) {
  let re = 0, im = 0; const count = 4800, start = Math.floor(second * 48000);
  for (let n = 0; n < count; n++) { const value = pcm.readInt16LE((start + n) * 4), phase = 2 * Math.PI * frequency * n / 48000; re += value * Math.cos(phase); im += value * Math.sin(phase); }
  return Math.hypot(re, im) / count;
}

test("real local codec acceptance preserves exact input cuts and audible identities through one MP3 encoder", { timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url), ffmpegPath = require("ffmpeg-static");
  const data = await fixture(), resources = registry(), signal = new AbortController().signal;
  const frequencies = [220, 660, 440], tones = frequencies.map(wav); let prepared;
  try {
    for (let index = 0; index < 3; index++) await writeFile(data.files.get(`track-${index}`), tones[index].file);
    prepared = await prepareCatalogueTestPlayout({ session: session(), files: data.files, ffmpegPath, signal, registerResource: resources.registerResource });
    const output = []; let inputBytes = 0, encoderCount = 0;
    const result = await sendCatalogueTestPlayout({ prepared, connection: { authenticated: true, write: async bytes => { output.push(Buffer.from(bytes)); } },
      ffmpegPath, signal, registerResource: resources.registerResource, emit: async () => true }, { spawnProcess: (binary, args, opts) => {
      encoderCount++; assert.ok(args.includes("-re"));
      // Local acceptance runs faster than wall clock; production arguments retain -re.
      const child = spawn(binary, args.filter(arg => arg !== "-re"), opts), write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (chunk, ...rest) => {
        const segment = Math.floor(inputBytes / tones[0].pcm.length), offset = inputBytes % tones[0].pcm.length;
        assert.deepEqual(chunk, tones[segment].pcm.subarray(offset, offset + chunk.length)); inputBytes += chunk.length;
        return write(chunk, ...rest);
      };
      return child;
    } });
    assert.equal(encoderCount, 1); assert.equal(inputBytes, 17_280_000); assert.equal(result.segmentsEnded, 3);
    const encoded = Buffer.concat(output); assert.equal(encoded.length, result.audioBytesSent);
    const decoded = spawnSync(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
      "-f", "mp3", "-i", "pipe:0", "-f", "s16le", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
    { input: encoded, encoding: null, maxBuffer: 32 * 1024 * 1024, timeout: 10_000, windowsHide: true,
      env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {} });
    assert.equal(decoded.status, 0);
    for (const [second, expected] of [[1, 220], [29.8, 220], [30.1, 660], [59.8, 660], [60.1, 440], [89, 440]]) {
      assert.ok(energyAt(decoded.stdout, second, expected) > 4000);
      assert.ok(frequencies.filter(value => value !== expected).every(value => energyAt(decoded.stdout, second, value) < 100));
    }
  } finally { await resources.close(); prepared?.dispose(); await data.cleanup(); }
});

test("playout source graph cannot connect to cloud, read credentials or publish a schedule", async () => {
  const source = (await Promise.all(["../lib/catalogue-test-playout.mjs", "../lib/catalogue-test-playout-plan.mjs"].map(file => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(source, /node:net|node:dns|fetch\(|@aws-sdk|@prisma|decryptSecret|R2_SECRET|SOURCE_PASSWORD|process\.env\.(?!SystemRoot)/);
});
