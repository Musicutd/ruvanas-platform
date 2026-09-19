import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { analyzeStudioListenerPcm } from "../lib/studio-listener-audio-sample.mjs";

const rate = 16_000;

function tone(frequency, seconds = 1, amplitude = 12_000) {
  const pcm = Buffer.alloc(seconds * rate * 2);
  for (let index = 0; index < seconds * rate; index += 1) {
    pcm.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * frequency * index / rate)), index * 2);
  }
  return pcm;
}

test("offline listener samples distinguish isolated AutoDJ, Manual and protected test tones", () => {
  const pcm = Buffer.concat([tone(440, 2), tone(660, 2), tone(880, 2), tone(440, 2)]);
  const result = analyzeStudioListenerPcm(pcm);
  assert.deepEqual(result.oneSecondWindows, ["AUTODJ", "AUTODJ", "MANUAL", "MANUAL", "PROTECTED", "PROTECTED", "AUTODJ", "AUTODJ"]);
  assert.equal(result.secondsAnalyzed, 8);
  assert.equal(result.listenerVerified, false);
  assert.equal(result.interpretation, "LOCAL_AUDIO_SAMPLE_ONLY");
});

test("silence, other audio and mixed tones are not misreported as one known source", () => {
  const silent = Buffer.alloc(rate * 2 * 2);
  assert.deepEqual(analyzeStudioListenerPcm(silent).oneSecondWindows, ["SILENCE", "SILENCE"]);
  assert.deepEqual(analyzeStudioListenerPcm(tone(523, 2)).oneSecondWindows, ["UNKNOWN", "UNKNOWN"]);
  const mixed = Buffer.alloc(rate * 2 * 2);
  for (let index = 0; index < rate * 2; index += 1) {
    mixed.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * index / rate) +
      6000 * Math.sin(2 * Math.PI * 660 * index / rate)), index * 2);
  }
  assert.deepEqual(analyzeStudioListenerPcm(mixed).oneSecondWindows, ["UNKNOWN", "UNKNOWN"]);
});

test("invalid format, short or oversized recordings fail rather than claim output", () => {
  for (const pcm of [null, new Uint8Array(rate * 4), Buffer.alloc(rate * 2), Buffer.alloc(rate * 4 + 1), Buffer.alloc(121 * rate * 2)]) {
    assert.throws(() => analyzeStudioListenerPcm(pcm));
  }
});

test("sample analyser is offline and cannot alter the encoder or unlock Manual controls", async () => {
  const [analyser, cli, worker, playout] = await Promise.all([
    readFile(new URL("../lib/studio-listener-audio-sample.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/analyze-studio-listener-pcm.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/studio-playout.mjs", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(analyser + cli, /fetch\(|createConnection|spawn\(|PrismaClient|pushPreparedStudioAudio/);
  assert.doesNotMatch(worker, /studio-listener-audio-sample|analyze-studio-listener-pcm/);
  assert.match(playout, /connected: false/);
});
