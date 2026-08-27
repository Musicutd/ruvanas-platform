import crypto from "node:crypto";

function tokenPayload({ playerId, manifestVersion, trackId }) {
  return `${playerId}:${manifestVersion}:${trackId}`;
}

function validateSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("A proof-of-play signing secret of at least 32 characters is required.");
  }
}

export function createPlaybackProofToken(input, secret) {
  validateSecret(secret);
  return crypto
    .createHmac("sha256", secret)
    .update(tokenPayload(input))
    .digest("hex");
}

export function verifyPlaybackProofToken(input, token, secret) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return false;
  }

  const expected = createPlaybackProofToken(input, secret);
  return crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
}

