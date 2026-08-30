export const NOTIFICATION_TYPES = [
  "PLAYER_OFFLINE",
  "STREAM_ERROR",
  "CAMPAIGN_FAILURE",
  "PRODUCTION_ORDER_UPDATE",
  "BILLING_STATE",
  "SCHOOL_REVIEW_REQUEST",
  "CONSENT_EXPIRY"
];

export const JOB_LEASE_SECONDS = 45;
export const JOB_BATCH_SIZE = 20;
export const JOB_MAX_ATTEMPTS = 5;

function boundedText(value, field, max) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) throw new Error(`${field} must contain between 1 and ${max} characters.`);
  return text;
}

export function normalizeNotificationEvent(input = {}) {
  const type = String(input.type || "").toUpperCase();
  if (!NOTIFICATION_TYPES.includes(type)) throw new Error("Unsupported notification type.");
  const severity = String(input.severity || "INFO").toUpperCase();
  if (!["INFO", "WARNING", "CRITICAL"].includes(severity)) throw new Error("Unsupported notification severity.");
  const entityType = input.entityType ? boundedText(input.entityType, "entityType", 80) : null;
  const entityId = input.entityId ? boundedText(input.entityId, "entityId", 200) : null;
  return {
    organisationId: boundedText(input.organisationId, "organisationId", 200),
    type,
    severity,
    title: boundedText(input.title, "title", 160),
    message: boundedText(input.message, "message", 500),
    entityType,
    entityId,
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : null,
    dedupeKey: input.dedupeKey ? boundedText(input.dedupeKey, "dedupeKey", 240) : null,
    correlationId: boundedText(input.correlationId, "correlationId", 200),
    occurredAt: input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt || Date.now())
  };
}

export function jobRetryDelayMs(attempts, { baseMs = 5_000, maximumMs = 15 * 60_000 } = {}) {
  const count = Math.max(1, Number(attempts) || 1);
  return Math.min(maximumMs, baseMs * (2 ** (count - 1)));
}

export function safeJobError(error) {
  const code = String(error?.code || error?.name || "JOB_EXECUTION_FAILED").replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 80);
  return {
    code: code || "JOB_EXECUTION_FAILED",
    message: "The background operation could not be completed."
  };
}

export function structuredWorkerLog(level, event, job, details = {}) {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    jobId: job?.id || null,
    jobType: job?.type || null,
    correlationId: job?.correlationId || null,
    requestId: job?.requestId || null,
    attempts: job?.attempts || 0,
    ...details
  };
}

export function notificationSeverityForIncident(severity) {
  return ["HIGH", "CRITICAL"].includes(String(severity || "").toUpperCase()) ? "CRITICAL" : "WARNING";
}
