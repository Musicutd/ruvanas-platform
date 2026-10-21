import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { accountedMediaIdentity, downloadAccountedMedia, validateAccountedSource, connectAccountedSource,
  accountedFfmpegArguments, mp3FrameLength, sendAccountedTrack } from "../lib/online-radio-accounted-transport.mjs";
import { runAccountedRotation } from "../lib/online-radio-accounted-runner.mjs";
import { createOnlineRadioDeliveryLedger } from "../lib/online-radio-delivery-ledger.mjs";
const source = () => ({ providerKey: "CENTOVA_CAST", serverHost: "pollux.shoutca.st", sourcePort: 8282,
  sourceUsername: null, sourcePasswordEncrypted: "synthetic-encrypted", bitrateKbps: 128, outboundAutoDjEnabled: true });
const require = createRequire(import.meta.url);
const binary = path.join(path.dirname(require.resolve("ffmpeg-static/package.json")), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
function wave(seconds = 1) {
  const samples = Math.round(44100 * seconds), bytes = samples * 4, result = Buffer.alloc(44 + bytes);
  result.write("RIFF"); result.writeUInt32LE(bytes + 36, 4); result.write("WAVEfmt ", 8); result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20); result.writeUInt16LE(2, 22); result.writeUInt32LE(44100, 24); result.writeUInt32LE(176400, 28);
  result.writeUInt16LE(4, 32); result.writeUInt16LE(16, 34); result.write("data", 36); result.writeUInt32LE(bytes, 40);
  for (let index = 0; index < samples; index++) { const value = Math.round(Math.sin(index * Math.PI * 880 / 44100) * 4000); result.writeInt16LE(value, 44 + index * 4); result.writeInt16LE(value, 46 + index * 4); }
  return result;
}
async function removeFixture(directory) {
  const resolved = path.resolve(directory), root = path.resolve(tmpdir());
  assert.equal(path.dirname(resolved), root); assert.match(path.basename(resolved), /^ruvanas-accounted-test-/);
  await rm(resolved, { recursive: true, force: true });
}

test("accounted source requires an enabled owner-configured direct SHOUTcast source", () => {
  assert.equal(validateAccountedSource(source()), true);
  for (const change of [{ outboundAutoDjEnabled: false }, { sourceUsername: "dj-user" }, { bitrateKbps: 320 },
    { sourcePort: 0 }, { serverHost: "localhost" }, { serverHost: "private.internal" }, { providerKey: "GENERIC_HTTP" }])
    assert.throws(() => validateAccountedSource({ ...source(), ...change }), /ENCODER_SOURCE_NOT_READY/);
  assert.equal(accountedFfmpegArguments("fixture.wav").includes("-t"), false);
  assert.deepEqual(accountedFfmpegArguments("fixture.mp3").slice(-3), ["-f", "mp3", "pipe:1"]);
  assert.throws(() => accountedFfmpegArguments("https://bad.invalid/list.m3u"));
});

test("source authentication uses the configured 8282 port, exact OK2 token and excludes headers from counters", async () => {
  for (const accepted of [true, false]) {
    const writes = [], resources = []; let destination;
    class Socket extends EventEmitter {
      destroyed = false;
      write(data, done) { writes.push(data); done?.(); if (writes.length === 1) queueMicrotask(() => this.emit("data", Buffer.from(accepted ? "OK2\r\n" : "ERROR bad OK2\n"))); }
      destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("close"); } }
    }
    const socket = new Socket();
    const task = connectAccountedSource({ source: source(), password: "synthetic-only", signal: new AbortController().signal,
      registerResource: resource => resources.push(resource), lookupHost: async () => [{ address: "88.198.70.25" }],
      openSocket: options => { destination = options; queueMicrotask(() => socket.emit("connect")); return socket; } });
    if (accepted) {
      const connection = await task; assert.equal(connection.authenticated, true); assert.equal(destination.port, 8282);
      assert.equal(writes.length, 2); assert.match(writes[1], /icy-pub:0/); await connection.close();
    } else await assert.rejects(task, /SOURCE_AUTHENTICATION_FAILED/);
    assert.equal(resources.length, 1); resources[0].forceClose(); await resources[0].close();
  }
});

test("private source DNS and credentials containing header injection fail before a socket opens", async () => {
  let opened = 0;
  const options = { source: source(), password: "synthetic-only", signal: new AbortController().signal,
    registerResource() {}, lookupHost: async () => [{ address: "127.0.0.1" }], openSocket: () => { opened++; } };
  await assert.rejects(connectAccountedSource(options), /ENCODER_SOURCE_ADDRESS_INVALID/);
  await assert.rejects(connectAccountedSource({ ...options, password: "bad\nheader" }), /ENCODER_SOURCE_ARGUMENTS_INVALID/);
  assert.equal(opened, 0);
});

test("a stalled authenticated source write times out, destroys the socket and cannot later report success", { timeout: 6000 }, async () => {
  const resources = []; let writes = 0, pendingWrite, destroyed = 0;
  class Socket extends EventEmitter {
    destroyed = false;
    write(_data, done) {
      writes += 1;
      if (writes <= 2) done?.();
      else pendingWrite = done;
      if (writes === 1) queueMicrotask(() => this.emit("data", Buffer.from("OK2\r\n")));
    }
    destroy() { if (!this.destroyed) { destroyed += 1; this.destroyed = true; this.emit("close"); } }
  }
  const socket = new Socket();
  const connection = await connectAccountedSource({ source: source(), password: "synthetic-only", signal: new AbortController().signal,
    registerResource: resource => resources.push(resource), lookupHost: async () => [{ address: "88.198.70.25" }],
    openSocket: () => { queueMicrotask(() => socket.emit("connect")); return socket; } });
  const started = performance.now();
  await assert.rejects(connection.write(Buffer.alloc(417)), { code: "SOURCE_DISCONNECTED" });
  assert.ok(performance.now() - started < 4500, "the stalled write is bounded rather than waiting indefinitely");
  assert.equal(socket.destroyed, true); assert.equal(destroyed, 1);
  pendingWrite(); // A late kernel callback must not reverse the rejected promise.
  await assert.rejects(connection.write(Buffer.alloc(417)), { code: "SOURCE_DISCONNECTED" });
  assert.equal(writes, 3, "no subsequent frame is offered to a failed source");
  assert.equal((await connection.close()).closed, true);
  assert.equal(resources.length, 1);
});

test("malformed and truncated MP3 headers are rejected before frame accounting", () => {
  assert.equal(mp3FrameLength(Buffer.from([0xff, 0xfb, 0x90, 0x00])), 417);
  for (const header of [Buffer.alloc(0), Buffer.from([0xff, 0xfb, 0x90]), Buffer.from([0x00, 0xfb, 0x90, 0x00]),
    Buffer.from([0xff, 0xfb, 0x80, 0x00]), Buffer.from([0xff, 0xfb, 0x94, 0x00])]) {
    assert.throws(() => mp3FrameLength(header), { code: "ENCODER_MP3_FRAME_INVALID" });
  }
});

test("a malformed or truncated FFmpeg stdout and a false zero exit cannot certify natural completion", async () => {
  const validFrame = Buffer.alloc(417); Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(validFrame);
  const cases = [
    { name: "malformed first frame", chunks: [Buffer.from([0, 0, 0, 0])], durationSeconds: 1, expectedCode: "ENCODER_MP3_FRAME_INVALID", bytes: 0 },
    { name: "truncated header", chunks: [validFrame.subarray(0, 3)], durationSeconds: 1, expectedCode: "SOURCE_ENCODER_FAILED", bytes: 0 },
    { name: "partial last frame", chunks: [validFrame, validFrame.subarray(0, 100)], durationSeconds: 1, expectedCode: "SOURCE_ENCODER_FAILED", bytes: 417 },
    { name: "malformed later frame", chunks: [validFrame, Buffer.alloc(4)], durationSeconds: 1, expectedCode: "ENCODER_MP3_FRAME_INVALID", bytes: 417 },
    { name: "zero exit with far too little actual audio", chunks: [validFrame], durationSeconds: 10, expectedCode: "SOURCE_ENCODER_FAILED", bytes: 417 }
  ];
  for (const scenario of cases) {
    const resources = [], observations = []; let acceptedBytes = 0, spawned = 0;
    class Child extends EventEmitter {
      stdout = Readable.from(scenario.chunks);
      closed = false;
      constructor() {
        super();
        this.stdout.once("end", () => this.finish(0));
      }
      finish(code) { if (!this.closed) { this.closed = true; queueMicrotask(() => this.emit("close", code)); } }
      kill() { this.finish(null); return true; }
    }
    await assert.rejects(sendAccountedTrack({ ffmpegPath: "injected-synthetic-only", filePath: "fixture.wav",
      track: { durationSeconds: scenario.durationSeconds }, connection: { authenticated: true, write: async chunk => { acceptedBytes += chunk.length; } },
      signal: new AbortController().signal, emit: async observation => { observations.push(observation); return true; },
      registerResource: resource => { resources.push(resource); return () => {}; },
      spawnProcess: () => { spawned += 1; return new Child(); }
    }), { code: scenario.expectedCode }, scenario.name);
    assert.equal(spawned, 1, scenario.name);
    assert.equal(acceptedBytes, scenario.bytes, `${scenario.name}: partial frames never enter source counters`);
    assert.equal(observations.at(-1)?.audioBytesSent ?? 0, scenario.bytes, scenario.name);
    for (const resource of resources) assert.equal((await resource.close()).closed, true, scenario.name);
  }
});

test("only exact immutable bytes/checksum enter the local audio cache", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-accounted-test-"));
  try {
    const body = wave(), hash = createHash("sha256").update(body).digest("hex");
    const identity = accountedMediaIdentity({ libraryType: "RUVANAS_CATALOGUE", organisationId: null,
      storageKey: `catalogue/music/${hash}.wav`, sizeBytes: body.length, durationSeconds: 1 }, "org-1");
    const target = path.join(directory, "fixture.wav");
    assert.equal(await downloadAccountedMedia(Readable.from([body]), target, identity, new AbortController().signal), body.length);
    assert.deepEqual(await readFile(target), body);
    await assert.rejects(downloadAccountedMedia(Readable.from([Buffer.alloc(body.length)]), path.join(directory, "bad.wav"), identity, new AbortController().signal), /ENCODER_MEDIA_IDENTITY_MISMATCH/);
    assert.throws(() => accountedMediaIdentity({ storageKey: "outside.wav", sizeBytes: 4, durationSeconds: 1 }, "org-1"));
  } finally { await removeFixture(directory); }
});

test("real local encoder serializes two synthetic tracks into one fake sink with measured source records", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-accounted-test-"));
  try {
    const file = path.join(directory, "fixture.wav"); await writeFile(file, wave());
    const chunks = [], rows = [], ledger = createOnlineRadioDeliveryLedger({ identity: { organisationId: "org-1", stationId: "station-1", destinationId: "source-1", sessionId: "session-1" },
      prisma: { auditLog: { upsert: async ({ create }) => { rows.push(create); return create; } } } });
    let connects = 0;
    const result = await runAccountedRotation({ entries: [1, 2].map(id => ({ track: { id: `track-${id}`, mediaAsset: { id: `asset-${id}`, durationSeconds: 1 } } })),
      ledger, maxSegments: 2, loadApproval: async () => ({ allowed: true, approvedUntil: new Date(Date.now() + 10000) }), renewLease: async () => true,
      prepareAudio: async () => ({}), connectSource: async () => { connects++; return { authenticated: true, write: async chunk => chunks.push(Buffer.from(chunk)) }; },
      playTrack: ({ entry, ...options }) => sendAccountedTrack({ ...options, ffmpegPath: binary, filePath: file, track: { durationSeconds: entry.track.mediaAsset.durationSeconds } }) });
    assert.equal(result.endedSegments, 2); assert.equal(result.stopConfirmed, true); assert.equal(connects, 1);
    assert.deepEqual(rows.map(row => row.details.event.type), ["STARTED", "AUDIO_SENT", "ENDED", "STARTED", "AUDIO_SENT", "ENDED"]);
    const encoded = Buffer.concat(chunks); assert.ok(encoded.length > 30000); assert.equal(mp3FrameLength(encoded), chunks[0].length);
    const decoded = spawnSync(binary, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", "pipe:0", "-f", "null", "-"],
      { input: encoded, windowsHide: true, timeout: 10000 });
    assert.equal(decoded.status, 0, "concatenated locally generated MP3 frames remain decodable");
    assert.equal(rows.filter(row => row.details.event.type === "ENDED").reduce((sum, row) => sum + row.details.event.transmittedBytes, 0), encoded.length);
  } finally { await removeFixture(directory); }
});

test("malformed synthetic input and an interrupted encoder never report natural completion", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-accounted-test-"));
  try {
    const badFile = path.join(directory, "invalid.wav"); await writeFile(badFile, Buffer.from("not a valid synthetic wave"));
    const badResources = []; let badBytes = 0, badObservations = 0;
    await assert.rejects(sendAccountedTrack({ ffmpegPath: binary, filePath: badFile, track: { durationSeconds: 1 },
      connection: { authenticated: true, write: async chunk => { badBytes += chunk.length; } }, signal: new AbortController().signal,
      emit: async () => { badObservations += 1; return true; }, registerResource: resource => { badResources.push(resource); return () => {}; }
    }), { code: "SOURCE_ENCODER_FAILED" });
    assert.equal(badBytes, 0); assert.equal(badObservations, 0);
    for (const resource of badResources) assert.equal((await resource.close()).closed, true);

    const file = path.join(directory, "interrupted.wav"); await writeFile(file, wave());
    const controller = new AbortController(), resources = []; let observedBytes = 0;
    await assert.rejects(sendAccountedTrack({ ffmpegPath: binary, filePath: file, track: { durationSeconds: 1 },
      connection: { authenticated: true, write: async () => {} }, signal: controller.signal,
      emit: async observation => { observedBytes = observation.audioBytesSent; controller.abort(Object.assign(new Error("synthetic interruption"), { code: "TEST_INTERRUPTED" })); return true; },
      registerResource: resource => { resources.push(resource); return () => {}; }
    }));
    assert.ok(observedBytes > 0, "only an actually accepted synthetic frame was observed before interruption");
    for (const resource of resources) assert.equal((await resource.close()).closed, true);
  } finally { await removeFixture(directory); }
});
