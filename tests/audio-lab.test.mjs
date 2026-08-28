import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_LAB_PART_SIZE_BYTES,
  createDefaultEditDecision,
  normalizeEditDecision,
  validateAudioLabUpload,
  validateUploadPart
} from "../lib/audio-lab.mjs";
import { validateAudioUpload } from "../lib/audio-validation.mjs";

test("AudioLab creates safe non-destructive editing defaults", () => {
  assert.deepEqual(createDefaultEditDecision(), {
    trimStartMs: 0,
    trimEndMs: null,
    fadeInMs: 0,
    fadeOutMs: 0,
    normalize: true,
    targetLufs: -16,
    noiseCleanup: false
  });
});

test("AudioLab normalises untrusted edit decisions", () => {
  assert.deepEqual(normalizeEditDecision({
    trimStartMs: 1200,
    trimEndMs: 900,
    fadeInMs: 250,
    fadeOutMs: 999999,
    normalize: false,
    targetLufs: -23,
    noiseCleanup: true
  }), {
    trimStartMs: 1200,
    trimEndMs: null,
    fadeInMs: 250,
    fadeOutMs: 0,
    normalize: false,
    targetLufs: -23,
    noiseCleanup: true
  });
});

test("AudioLab plans 5 MB resumable upload parts", () => {
  const plan = validateAudioLabUpload({ sizeBytes: AUDIO_LAB_PART_SIZE_BYTES + 123, mimeType: "audio/webm;codecs=opus" });
  assert.equal(plan.extension, "webm");
  assert.equal(plan.partCount, 2);
  assert.equal(plan.partSizeBytes, AUDIO_LAB_PART_SIZE_BYTES);
  assert.equal(validateUploadPart({ partNumber: 1, partCount: 2, sizeBytes: AUDIO_LAB_PART_SIZE_BYTES, partSizeBytes: AUDIO_LAB_PART_SIZE_BYTES }), 1);
  assert.throws(() => validateUploadPart({ partNumber: 1, partCount: 2, sizeBytes: 99, partSizeBytes: AUDIO_LAB_PART_SIZE_BYTES }), /final upload part/);
});

test("AudioLab accepts a WebM EBML signature and rejects mismatched content", () => {
  const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
  assert.equal(validateAudioUpload({ buffer: webmHeader, fileName: "take.webm", claimedType: "audio/webm" }).ok, true);
  assert.equal(validateAudioUpload({ buffer: Buffer.alloc(12), fileName: "take.webm", claimedType: "audio/webm" }).ok, false);
});

