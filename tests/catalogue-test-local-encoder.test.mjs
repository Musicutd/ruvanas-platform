// Local synthetic decoder/encoder acceptance, NOT a Centova/library test.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sendCatalogueTestTrack } from "../lib/catalogue-test-transport.mjs";

const require = createRequire(import.meta.url);
const binary = path.join(path.dirname(require.resolve("ffmpeg-static/package.json")), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
function syntheticWave(seconds = 1) {
  const samples = 44100 * seconds, bytes = samples * 4, data = Buffer.alloc(44 + bytes);
  data.write("RIFF"); data.writeUInt32LE(bytes + 36, 4); data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(44100, 24); data.writeUInt32LE(176400, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(Math.sin(i * 2 * Math.PI * 440 / 44100) * 4000);
    data.writeInt16LE(value, 44 + i * 4); data.writeInt16LE(value, 46 + i * 4);
  }
  return data;
}
test("actual packaged encoder sends bounded MP3 to a fake local sink and confirms child closure", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-test-encoder-"));
  const file = path.join(directory, "fixture.wav"), resources = [], observations = [], chunks = [];
  try {
    await writeFile(file, syntheticWave());
    const result = await sendCatalogueTestTrack({ ffmpegPath: binary, filePath: file,
      track: { id: "synthetic-track", durationSeconds: 1 }, signal: AbortSignal.timeout(8000),
      connection: { authenticated: true, write: async bytes => { chunks.push(Buffer.from(bytes)); } },
      emit: async observation => { observations.push(observation); return true; }, registerResource: resource => { resources.push(resource); } });
    const encoded = Buffer.concat(chunks);
    assert.equal(result.completed, true); assert.equal(result.audioBytesSent, encoded.length); assert.ok(encoded.length > 10000);
    assert.ok(observations.length > 0); assert.equal(observations.at(-1).audioBytesSent, encoded.length);
    assert.equal(resources.length, 1); await resources[0].close();
    assert.equal(encoded[0], 255); assert.equal(encoded[1] & 224, 224);
  } finally { for (const resource of resources) { resource.forceClose(); await resource.close(); } await rm(directory, { recursive: true, force: true }); }
});
test("a sink failure stops the actual child and never reports a completed send", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-test-failure-")), resources = [];
  try {
    const file = path.join(directory, "fixture.wav"); await writeFile(file, syntheticWave(2));
    await assert.rejects(sendCatalogueTestTrack({ ffmpegPath: binary, filePath: file, track: { id: "synthetic-track", durationSeconds: 2 },
      signal: AbortSignal.timeout(8000), connection: { authenticated: true, write: async () => { throw new Error("synthetic sink failure"); } },
      emit: async () => true, registerResource: resource => { resources.push(resource); } }), /synthetic sink failure/);
    assert.equal(resources.length, 1); await resources[0].close();
  } finally { for (const resource of resources) { resource.forceClose(); await resource.close(); } await rm(directory, { recursive: true, force: true }); }
});
