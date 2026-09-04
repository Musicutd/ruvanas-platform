import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlaybackProofToken,
  verifyPlaybackProofToken
} from "../lib/playback-proof.mjs";

const secret = "proof-of-play-test-secret-with-adequate-length";
const input = {
  playerId: "player-1",
  manifestVersion: "1234567890abcdef12345678",
  scheduleItemId: "a".repeat(64),
  contentId: "track-1"
};

test("proof-of-play tokens authenticate the player, manifest, and track", () => {
  const token = createPlaybackProofToken(input, secret);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(verifyPlaybackProofToken(input, token, secret), true);
});

test("proof-of-play tokens reject tampered attribution", () => {
  const token = createPlaybackProofToken(input, secret);
  assert.equal(verifyPlaybackProofToken({ ...input, contentId: "track-2" }, token, secret), false);
  assert.equal(verifyPlaybackProofToken({ ...input, scheduleItemId: "b".repeat(64) }, token, secret), false);
  assert.equal(verifyPlaybackProofToken({ ...input, playerId: "player-2" }, token, secret), false);
  assert.equal(verifyPlaybackProofToken(input, "not-a-token", secret), false);
});

test("programming-source evidence is authenticated independently of the rolling-deployment token", () => {
  const legacyToken = createPlaybackProofToken(input, secret);
  const sourceToken = createPlaybackProofToken({ ...input, programmingSource: "DEFAULT_AUTODJ" }, secret);
  assert.equal(verifyPlaybackProofToken(input, legacyToken, secret), true);
  assert.equal(verifyPlaybackProofToken({ ...input, programmingSource: "DEFAULT_AUTODJ" }, sourceToken, secret), true);
  assert.equal(verifyPlaybackProofToken({ ...input, programmingSource: "BACKUP_AUTODJ" }, sourceToken, secret), false);
  assert.equal(verifyPlaybackProofToken(input, sourceToken, secret), false);
});
