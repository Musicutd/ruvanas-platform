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
  trackId: "track-1"
};

test("proof-of-play tokens authenticate the player, manifest, and track", () => {
  const token = createPlaybackProofToken(input, secret);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(verifyPlaybackProofToken(input, token, secret), true);
});

test("proof-of-play tokens reject tampered attribution", () => {
  const token = createPlaybackProofToken(input, secret);
  assert.equal(verifyPlaybackProofToken({ ...input, trackId: "track-2" }, token, secret), false);
  assert.equal(verifyPlaybackProofToken({ ...input, playerId: "player-2" }, token, secret), false);
  assert.equal(verifyPlaybackProofToken(input, "not-a-token", secret), false);
});
