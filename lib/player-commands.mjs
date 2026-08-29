export const PLAYER_COMMAND_TTL_MINUTES = 10;
export const PLAYER_COMMAND_KINDS = Object.freeze([
  "PING",
  "REFRESH_STATE",
  "REFRESH_MANIFEST",
  "COLLECT_DIAGNOSTICS"
]);

const OUTCOMES = new Set(["SUCCEEDED", "FAILED", "UNSUPPORTED"]);
const SOURCE_STATUSES = new Set(["CONNECTED", "DEGRADED", "DISCONNECTED", "UNKNOWN"]);

function cleanText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function normalizePlayerCommandKind(value) {
  const kind = cleanText(value, 50).toUpperCase();
  if (!PLAYER_COMMAND_KINDS.includes(kind)) {
    throw new Error("Choose an approved player diagnostic command.");
  }
  return kind;
}

export function playerCommandExpiry(now = new Date(), ttlMinutes = PLAYER_COMMAND_TTL_MINUTES) {
  const minutes = Math.min(60, Math.max(5, Number(ttlMinutes) || PLAYER_COMMAND_TTL_MINUTES));
  return new Date(new Date(now).getTime() + minutes * 60_000);
}

export function normalizePlayerCommandAcknowledgement(input = {}) {
  const outcome = cleanText(input.outcome, 30).toUpperCase();
  if (!OUTCOMES.has(outcome)) throw new Error("Report SUCCEEDED, FAILED, or UNSUPPORTED.");
  const sourceStatus = cleanText(input?.details?.sourceStatus, 40).toUpperCase();
  return {
    status: outcome === "SUCCEEDED" ? "ACKNOWLEDGED" : "FAILED",
    resultCode: outcome,
    resultMessage: cleanText(input.message, 500) || null,
    resultDetails: {
      appVersion: cleanText(input?.details?.appVersion, 100) || null,
      manifestVersion: cleanText(input?.details?.manifestVersion, 100) || null,
      sourceStatus: SOURCE_STATUSES.has(sourceStatus) ? sourceStatus : null
    }
  };
}

export function canAcknowledgePlayerCommand(command, now = new Date()) {
  if (!command || command.status !== "DELIVERED") return { ok: false, reason: "NOT_DELIVERED" };
  if (new Date(command.expiresAt) <= new Date(now)) return { ok: false, reason: "EXPIRED" };
  return { ok: true };
}

export function replacementPlayerName(currentName, requestedName) {
  const cleaned = cleanText(requestedName, 120);
  return cleaned || `${cleanText(currentName, 100) || "Player"} replacement`;
}
