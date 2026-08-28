import crypto from "node:crypto";

export const RETENTION_LIMITS = Object.freeze({
  rawPlaybackDays: { min: 30, max: 3650, default: 395 },
  playerHeartbeatDays: { min: 7, max: 730, default: 90 },
  audioProjectDays: { min: 90, max: 3650, default: 730 },
  supportTicketDays: { min: 90, max: 3650, default: 730 },
  auditDays: { min: 365, max: 3650, default: 2555 }
});

export const DATA_REQUEST_TYPES = Object.freeze(["EXPORT", "CORRECTION", "DELETION", "RESTRICTION"]);
export const DATA_REQUEST_STATUSES = Object.freeze(["OPEN", "IN_REVIEW", "AWAITING_INFORMATION", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED"]);
export const SUPPORT_TICKET_PRIORITIES = Object.freeze(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const SUPPORT_TICKET_STATUSES = Object.freeze(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]);

const TERMINAL_DATA_REQUEST_STATUSES = new Set(["COMPLETED", "REJECTED", "CANCELLED"]);
const SUPPORT_TRANSITIONS = Object.freeze({
  OPEN: new Set(["IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]),
  IN_PROGRESS: new Set(["OPEN", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]),
  WAITING_CUSTOMER: new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
  RESOLVED: new Set(["OPEN", "IN_PROGRESS", "CLOSED"]),
  CLOSED: new Set(["OPEN"])
});

function boundedInteger(value, field) {
  const limits = RETENTION_LIMITS[field];
  const number = Number(value ?? limits.default);
  if (!Number.isInteger(number) || number < limits.min || number > limits.max) {
    throw new Error(`${field} must be a whole number between ${limits.min} and ${limits.max}.`);
  }
  return number;
}

export function normalizeRetentionPolicy(input = {}) {
  return Object.fromEntries(Object.keys(RETENTION_LIMITS).map((field) => [field, boundedInteger(input[field], field)]));
}

export function retentionCutoffs(policyInput, now = new Date()) {
  const policy = normalizeRetentionPolicy(policyInput);
  const cutoffs = {};
  for (const [field, days] of Object.entries(policy)) {
    cutoffs[field] = new Date(now.getTime() - days * 86_400_000).toISOString();
  }
  return cutoffs;
}

export function normalizeDataRequest(input = {}, now = new Date()) {
  const type = String(input.type || "").toUpperCase();
  if (!DATA_REQUEST_TYPES.includes(type)) throw new Error("Select a supported data-request type.");
  const subjectEmail = String(input.subjectEmail || "").trim().toLowerCase() || null;
  if (!input.subjectUserId && !subjectEmail) throw new Error("Provide the subject user or subject email.");
  if (subjectEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subjectEmail)) throw new Error("Provide a valid subject email.");
  const notes = String(input.notes || "").trim() || null;
  if (notes && notes.length > 4_000) throw new Error("Data-request notes must not exceed 4,000 characters.");
  const dueAt = input.dueAt ? new Date(input.dueAt) : new Date(now.getTime() + 30 * 86_400_000);
  if (Number.isNaN(dueAt.getTime()) || dueAt <= now) throw new Error("The response due date must be in the future.");
  return { type, subjectUserId: input.subjectUserId || null, subjectEmail, notes, dueAt };
}

export function dataRequestCompletion(status, actorUserId, now = new Date()) {
  if (!DATA_REQUEST_STATUSES.includes(status)) throw new Error("Select a supported data-request status.");
  return TERMINAL_DATA_REQUEST_STATUSES.has(status)
    ? { completedAt: now, completedByUserId: actorUserId }
    : { completedAt: null, completedByUserId: null };
}

export function assertSupportTransition(from, to) {
  if (!SUPPORT_TICKET_STATUSES.includes(from) || !SUPPORT_TICKET_STATUSES.includes(to)) {
    throw new Error("Select a supported support-ticket status.");
  }
  if (from !== to && !SUPPORT_TRANSITIONS[from].has(to)) {
    throw new Error(`A support ticket cannot move from ${from} to ${to}.`);
  }
  return to;
}

export function generateOperationalReference(prefix, now = new Date(), randomBytes = crypto.randomBytes) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

const SENSITIVE_KEY = /(password|secret|token|api.?key|authorization|cookie|credential|private.?key)/i;

export function redactAuditDetails(value, depth = 0) {
  if (value == null || depth > 6) return value == null ? value : "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAuditDetails(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" && value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactAuditDetails(item, depth + 1)
  ]));
}

export function csvCell(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const neutralized = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function auditLogCsv(rows = []) {
  const header = ["Created at UTC", "Action", "Entity type", "Entity ID", "Actor type", "Actor reference", "Request ID", "Details (redacted JSON)"];
  const body = rows.map((row) => {
    const details = redactAuditDetails(row.details || {});
    const requestId = typeof details?.requestId === "string" ? details.requestId : "";
    const actorType = row.actorServiceAccountId ? "SERVICE_ACCOUNT" : row.actorUserId ? "USER" : "SYSTEM";
    const actorReference = row.actorServiceAccountId || row.actorUserId || "";
    return [new Date(row.createdAt).toISOString(), row.action, row.entityType, row.entityId || "", actorType, actorReference, requestId, details];
  });
  return [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function auditExportSealHash({ previousSealHash = "GENESIS", organisationId, exportJobId, contentSha256, rowCount, fromAt, untilAt }) {
  const canonical = [previousSealHash || "GENESIS", organisationId, exportJobId, contentSha256, String(rowCount), new Date(fromAt).toISOString(), new Date(untilAt).toISOString()].join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}


