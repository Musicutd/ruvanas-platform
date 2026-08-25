import assert from "node:assert/strict";
import test from "node:test";
import { validateAudioUpload } from "../lib/audio-validation.mjs";

test("audio validation accepts matching file signatures", () => {
  const cases = [
    { fileName: "clip.mp3", claimedType: "audio/mpeg", buffer: Buffer.from("ID3abcdefghi") },
    { fileName: "clip.wav", claimedType: "audio/wav", buffer: Buffer.from("RIFFxxxxWAVEdata") },
    { fileName: "clip.ogg", claimedType: "audio/ogg", buffer: Buffer.from("OggSabcdefgh") },
    { fileName: "clip.m4a", claimedType: "audio/mp4", buffer: Buffer.from("xxxxftypM4A ") }
  ];

  for (const input of cases) {
    assert.equal(validateAudioUpload(input).ok, true, input.fileName);
  }
});

test("audio validation rejects renamed and MIME-mismatched files", () => {
  assert.equal(
    validateAudioUpload({
      fileName: "not-audio.mp3",
      claimedType: "audio/mpeg",
      buffer: Buffer.from("this is not audio")
    }).ok,
    false
  );

  assert.equal(
    validateAudioUpload({
      fileName: "clip.wav",
      claimedType: "audio/mpeg",
      buffer: Buffer.from("RIFFxxxxWAVEdata")
    }).ok,
    false
  );
});
