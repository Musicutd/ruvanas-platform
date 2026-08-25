import crypto from "node:crypto";

const TOKEN_BYTES = 32;
export const PLAYER_HEARTBEAT_INTERVAL_SECONDS = 30;
export const PLAYER_OFFLINE_AFTER_SECONDS = 90;

export function createPlayerToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashPlayerToken(token, secret) {
  if (typeof token !== "string" || !token) {
    throw new TypeError("A player token is required.");
  }

  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }

  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}

export function effectivePlayerStatus(player, now = new Date()) {
  if (!player || player.status === "DISABLED") {
    return "DISABLED";
  }

  if (!player.enrolledAt || !player.lastHeartbeatAt) {
    return "PENDING_ENROLMENT";
  }

  const elapsedMs = now.getTime() - new Date(player.lastHeartbeatAt).getTime();
  return elapsedMs <= PLAYER_OFFLINE_AFTER_SECONDS * 1000 ? "ONLINE" : "OFFLINE";
}

