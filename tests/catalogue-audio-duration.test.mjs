import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  measureCatalogueAudioDuration,
  parseCatalogueAudioDurationProbe
} from "../lib/catalogue-audio-duration.mjs";

function probeOutput(duration, streams = [{ codec_type: "audio" }]) {
  return JSON.stringify({ streams, format: { duration } });
}

function silentWav(seconds = 1) {
  const sampleRate = 8_000;
  const dataBytes = seconds * sampleRate * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

test("the bundled ffprobe measures a tiny uploaded audio buffer in seconds", async () => {
  assert.equal(await measureCatalogueAudioDuration(silentWav(2)), 2);
});

test("a probe sees only the temporary uploaded buffer and its file is removed afterward", async () => {
  const source = Buffer.from("synthetic-upload");
  let temporaryFile;
  const seconds = await measureCatalogueAudioDuration(source, { runProbe: async (filePath) => {
    temporaryFile = filePath;
    assert.deepEqual(await readFile(filePath), source);
    return probeOutput("166.6");
  } });
  assert.equal(seconds, 167);
  await assert.rejects(access(temporaryFile), { code: "ENOENT" });
});

test("only a present audio stream and a real positive duration are accepted", () => {
  assert.equal(parseCatalogueAudioDurationProbe(probeOutput("0.4")), 1);
  assert.equal(parseCatalogueAudioDurationProbe(probeOutput("167.49")), 167);
  assert.equal(parseCatalogueAudioDurationProbe(probeOutput("167.50")), 168);
  assert.throws(() => parseCatalogueAudioDurationProbe(probeOutput("3.0", [])),
    { code: "CATALOGUE_DURATION_NO_AUDIO" });
  for (const invalid of ["", "N/A", "0", "-1", "NaN", "Infinity", "86400.1"]) {
    assert.throws(() => parseCatalogueAudioDurationProbe(probeOutput(invalid)),
      { code: "CATALOGUE_DURATION_UNAVAILABLE" });
  }
  assert.throws(() => parseCatalogueAudioDurationProbe("not JSON"),
    { code: "CATALOGUE_DURATION_PROBE_INVALID" });
  assert.throws(() => parseCatalogueAudioDurationProbe("x".repeat(4_097)),
    { code: "CATALOGUE_DURATION_PROBE_INVALID" });
});

test("empty, non-buffer and larger-than-50-MB uploads fail before probing", async () => {
  let probes = 0;
  const runProbe = async () => { probes++; return probeOutput("3"); };
  await assert.rejects(measureCatalogueAudioDuration(Buffer.alloc(0), { runProbe }),
    { code: "CATALOGUE_DURATION_BUFFER_INVALID" });
  await assert.rejects(measureCatalogueAudioDuration("not a buffer", { runProbe }),
    { code: "CATALOGUE_DURATION_BUFFER_INVALID" });
  await assert.rejects(measureCatalogueAudioDuration(Buffer.allocUnsafe(50 * 1024 * 1024 + 1), { runProbe }),
    { code: "CATALOGUE_DURATION_BUFFER_INVALID" });
  assert.equal(probes, 0);
});

test("a failing probe exposes no raw tool error and still removes the temporary file", async () => {
  let temporaryFile;
  await assert.rejects(measureCatalogueAudioDuration(Buffer.from("synthetic-upload"), {
    runProbe: async (filePath) => { temporaryFile = filePath; throw Error("untrusted ffprobe output"); }
  }), { code: "CATALOGUE_DURATION_PROBE_FAILED", message: "CATALOGUE_DURATION_PROBE_FAILED" });
  await assert.rejects(access(temporaryFile), { code: "ENOENT" });
});

test("at most two probes run concurrently and the slot is released afterward", async () => {
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let bothStarted;
  const started = new Promise((resolve) => { bothStarted = resolve; });
  let active = 0;
  const runProbe = async () => {
    active += 1;
    if (active === 2) bothStarted();
    await hold;
    return probeOutput("2.4");
  };
  const source = Buffer.from("synthetic-upload");
  const first = measureCatalogueAudioDuration(source, { runProbe });
  const second = measureCatalogueAudioDuration(source, { runProbe });
  try {
    await started;
    await assert.rejects(measureCatalogueAudioDuration(source, { runProbe }),
      { code: "CATALOGUE_DURATION_BUSY" });
    assert.equal(active, 2);
  } finally {
    release();
  }
  assert.deepEqual(await Promise.all([first, second]), [2, 2]);
  assert.equal(await measureCatalogueAudioDuration(source, { runProbe: async () => probeOutput("3") }), 3);
});
