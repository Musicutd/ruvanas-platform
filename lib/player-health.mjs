import { PLAYER_OFFLINE_AFTER_SECONDS } from "./player-tokens.mjs";

export const PLAYER_HEARTBEAT_SAMPLE_SECONDS = 300;
export const PLAYER_HEALTH_SCAN_SECONDS = 30;

const SOURCE_STATUSES = new Set(["CONNECTED", "DEGRADED", "DISCONNECTED", "UNKNOWN"]);
const ACTIONS = new Set(["ACKNOWLEDGE", "RESOLVE"]);

function cleanText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function heartbeatBucketStart(instant, bucketSeconds = PLAYER_HEARTBEAT_SAMPLE_SECONDS) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error("A valid heartbeat time is required.");
  const bucketMs = bucketSeconds * 1000;
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
}

export function normalizeHeartbeatDiagnostics(input = {}) {
  const sourceStatus = cleanText(input?.sourceStatus, 40).toUpperCase();
  return {
    appVersion: cleanText(input?.appVersion, 100) || null,
    manifestVersion: cleanText(input?.manifestVersion, 100) || null,
    sourceStatus: SOURCE_STATUSES.has(sourceStatus) ? sourceStatus : null
  };
}

export function incidentSeverityForOfflineDuration(durationMs) {
  const minutes = Math.max(0, Number(durationMs) || 0) / 60_000;
  if (minutes >= 60) return "CRITICAL";
  if (minutes >= 15) return "HIGH";
  if (minutes >= 5) return "MEDIUM";
  return "LOW";
}

export function missedHeartbeatWindow(player, now = new Date()) {
  if (!player?.enrolledAt || !player?.lastHeartbeatAt || player.status === "DISABLED") return null;
  const observedAt = new Date(now);
  const lastHeartbeatAt = new Date(player.lastHeartbeatAt);
  const firstObservedAt = new Date(lastHeartbeatAt.getTime() + PLAYER_OFFLINE_AFTER_SECONDS * 1000);
  if (observedAt <= firstObservedAt) return null;
  const durationMs = observedAt.getTime() - firstObservedAt.getTime();
  return {
    firstObservedAt,
    lastObservedAt: observedAt,
    durationMs,
    severity: incidentSeverityForOfflineDuration(durationMs)
  };
}

export function incidentTransition(currentStatus, action, note, now = new Date()) {
  const status = cleanText(currentStatus, 40).toUpperCase();
  const requestedAction = cleanText(action, 40).toUpperCase();
  const cleanNote = cleanText(note, 2_000);
  if (!ACTIONS.has(requestedAction)) throw new Error("Choose ACKNOWLEDGE or RESOLVE.");
  if (status === "RESOLVED") throw new Error("This health incident is already resolved.");
  if (requestedAction === "ACKNOWLEDGE" && status !== "OPEN") {
    throw new Error("Only an open health incident can be acknowledged.");
  }
  if (cleanNote.length < 3) throw new Error("Add a short operational note.");
  const changedAt = new Date(now);
  if (requestedAction === "ACKNOWLEDGE") {
    return { status: "ACKNOWLEDGED", acknowledgedAt: changedAt, acknowledgementNote: cleanNote };
  }
  return { status: "RESOLVED", resolvedAt: changedAt, resolutionNote: cleanNote };
}

export function playerHealthSummary(players = [], incidents = [], now = new Date()) {
  const offlinePlayers = players.filter((player) => missedHeartbeatWindow(player, now)).length;
  const unresolved = incidents.filter((incident) => incident.status !== "RESOLVED");
  return {
    totalPlayers: players.length,
    offlinePlayers,
    openIncidents: unresolved.length,
    criticalIncidents: unresolved.filter((incident) => incident.severity === "CRITICAL").length
  };
}

