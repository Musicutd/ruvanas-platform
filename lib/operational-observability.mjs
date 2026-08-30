import crypto from "node:crypto";

export const OPERATIONAL_SERVICE_KINDS = Object.freeze(["WEB", "OPERATIONS_WORKER", "AUDIO_WORKER"]);
export const SERVICE_HEARTBEAT_STALE_SECONDS = 120;

function clean(value, limit = 120) {
  return String(value || "").trim().replace(/[\r\n\t]/g, " ").slice(0, limit);
}

export function deploymentIdentity({ service, env = process.env, instanceId, startedAt = new Date() } = {}) {
  const kind = clean(service, 40).toUpperCase();
  if (!OPERATIONAL_SERVICE_KINDS.includes(kind)) throw new Error("Choose a supported operational service.");
  const commitSha = clean(env.RENDER_GIT_COMMIT || env.SOURCE_VERSION || env.GIT_COMMIT, 100) || null;
  const version = clean(env.RUVANAS_RELEASE_VERSION, 100) || commitSha?.slice(0, 12) || "local";
  const environment = clean(env.RUVANAS_ENVIRONMENT || env.RENDER_SERVICE_NAME || env.NODE_ENV, 80) || "local";
  const resolvedInstanceId = clean(instanceId || env.RENDER_INSTANCE_ID || `${kind.toLowerCase()}-${process.pid}`, 160);
  return { service: kind, environment, instanceId: resolvedInstanceId, version, commitSha, startedAt: new Date(startedAt) };
}

export function safeInstanceKey(instanceId) {
  return crypto.createHash("sha256").update(String(instanceId || "unknown")).digest("hex").slice(0, 12);
}

export function heartbeatState(lastSeenAt, now = new Date(), staleSeconds = SERVICE_HEARTBEAT_STALE_SECONDS) {
  const seen = new Date(lastSeenAt);
  if (Number.isNaN(seen.getTime())) return "MISSING";
  return new Date(now).getTime() - seen.getTime() <= Math.max(30, Number(staleSeconds) || SERVICE_HEARTBEAT_STALE_SECONDS) * 1000 ? "CURRENT" : "STALE";
}

export function safeOperationalErrorCode(error, fallback = "OPERATIONAL_WORKER_FAILED") {
  const code = clean(error?.code || error?.name || fallback, 80).replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  return code || fallback;
}

export function structuredServiceLog(identity, level, event, details = {}) {
  const safeDetails = details && typeof details === "object" && !Array.isArray(details) ? details : {};
  return JSON.stringify({
    ...safeDetails,
    timestamp: new Date().toISOString(),
    level: ["info", "warn", "error"].includes(level) ? level : "info",
    event: clean(event, 100) || "operational_event",
    service: identity.service,
    environment: identity.environment,
    version: identity.version,
    instanceKey: safeInstanceKey(identity.instanceId)
  });
}

export function operationalReadiness({ missingServices = [], mixedVersions = false, deadLetterJobs = 0, abandonedWebhooks = 0, criticalPlayerIncidents = 0, criticalStreamIncidents = 0, recentMediaFailures = 0, offlinePlayers = 0 } = {}) {
  const findings = [];
  if (missingServices.length) findings.push({ severity: "CRITICAL", code: "SERVICE_HEARTBEAT_MISSING", count: missingServices.length });
  if (deadLetterJobs > 0) findings.push({ severity: "CRITICAL", code: "DEAD_LETTER_JOBS", count: deadLetterJobs });
  if (criticalPlayerIncidents > 0) findings.push({ severity: "CRITICAL", code: "CRITICAL_PLAYER_INCIDENTS", count: criticalPlayerIncidents });
  if (criticalStreamIncidents > 0) findings.push({ severity: "CRITICAL", code: "CRITICAL_STREAM_INCIDENTS", count: criticalStreamIncidents });
  if (mixedVersions) findings.push({ severity: "WARNING", code: "MIXED_ACTIVE_RELEASES", count: 1 });
  if (abandonedWebhooks > 0) findings.push({ severity: "WARNING", code: "ABANDONED_WEBHOOKS", count: abandonedWebhooks });
  if (recentMediaFailures > 0) findings.push({ severity: "WARNING", code: "RECENT_MEDIA_FAILURES", count: recentMediaFailures });
  if (offlinePlayers > 0) findings.push({ severity: "WARNING", code: "OFFLINE_PLAYERS", count: offlinePlayers });
  const status = findings.some((item) => item.severity === "CRITICAL") ? "CRITICAL" : findings.length ? "ATTENTION" : "HEALTHY";
  return { status, findings };
}
