export const SCHOOL_PILOT_RUN_ACTIONS = Object.freeze(["START", "PAUSE", "RESUME", "COMPLETE", "CANCEL"]);
export const SCHOOL_PILOT_EVENT_KINDS = Object.freeze(["DRILL", "INCIDENT"]);
export const SCHOOL_PILOT_EVENT_CATEGORIES = Object.freeze([
  "EMERGENCY_WITHDRAWAL",
  "SERVICE_RECOVERY",
  "SUPPORT_ESCALATION",
  "CONTENT_SAFETY",
  "PLATFORM_AVAILABILITY",
  "OTHER"
]);
export const SCHOOL_PILOT_EVENT_SEVERITIES = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const SCHOOL_PILOT_EVENT_OUTCOMES = Object.freeze(["PASSED", "NEEDS_ACTION", "NOT_APPLICABLE"]);
export const SCHOOL_PILOT_EVENT_ACTIONS = Object.freeze(["ACKNOWLEDGE", "RESOLVE"]);

export const SCHOOL_PILOT_OPERATIONS_NOTICE = "Pilot operations are manager-recorded evidence only. This workflow does not withdraw content, contact external parties, shut down services, delete records, or include student identities.";

const MAX_PILOT_MS = 90 * 86_400_000;
const MAX_FUTURE_EVENT_MS = 5 * 60_000;

function requiredText(value, label, minLength, maxLength) {
  const text = String(value || "").trim();
  if (text.length < minLength) throw new Error(`${label} must be at least ${minLength} characters.`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function optionalText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`Text must be ${maxLength} characters or fewer.`);
  return text;
}

function enumValue(value, allowed, message) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!allowed.includes(normalized)) throw new Error(message);
  return normalized;
}

function dateValue(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return date;
}

export function normalizeSchoolPilotRun(input = {}) {
  const title = requiredText(input.title, "Pilot title", 3, 160);
  const plannedStartAt = dateValue(input.plannedStartAt, "Pilot start");
  const plannedEndAt = dateValue(input.plannedEndAt, "Pilot end");
  const duration = plannedEndAt.getTime() - plannedStartAt.getTime();
  if (duration <= 0) throw new Error("Pilot end must be after the start.");
  if (duration > MAX_PILOT_MS) throw new Error("A supervised pilot can cover at most 90 days.");
  return {
    title,
    plannedStartAt,
    plannedEndAt,
    notes: optionalText(input.notes, 2000)
  };
}

export function schoolPilotReadinessSnapshot(readiness = {}, recordedAt = new Date()) {
  return Object.freeze({
    recordedAt: dateValue(recordedAt, "Snapshot time").toISOString(),
    status: String(readiness.status || "IN_PROGRESS"),
    readyForPilot: readiness.readyForPilot === true,
    completedChecks: Number.isInteger(readiness.completedChecks) ? readiness.completedChecks : 0,
    totalChecks: Number.isInteger(readiness.totalChecks) ? readiness.totalChecks : 0,
    activeHoldCount: Number.isInteger(readiness.activeHoldCount) ? readiness.activeHoldCount : 0,
    prerequisiteGapCount: Array.isArray(readiness.prerequisiteGaps) ? readiness.prerequisiteGaps.length : 0,
    studentIdentitiesIncluded: false
  });
}

export function transitionSchoolPilotRun(currentStatus, input = {}, readiness = {}, now = new Date()) {
  const status = String(currentStatus || "").trim().toUpperCase();
  const action = enumValue(input.action, SCHOOL_PILOT_RUN_ACTIONS, "Choose a valid pilot action.");
  const reason = requiredText(input.reason, "Transition reason", 10, 1000);
  const transitions = {
    PLANNED: { START: "ACTIVE", CANCEL: "CANCELLED" },
    ACTIVE: { PAUSE: "PAUSED", COMPLETE: "COMPLETED", CANCEL: "CANCELLED" },
    PAUSED: { RESUME: "ACTIVE", COMPLETE: "COMPLETED", CANCEL: "CANCELLED" },
    COMPLETED: {},
    CANCELLED: {}
  };
  const nextStatus = transitions[status]?.[action];
  if (!nextStatus) throw new Error(`A ${status || "missing"} pilot cannot be changed with ${action}.`);
  if (new Set(["START", "RESUME"]).has(action) && readiness.readyForPilot !== true) {
    throw new Error("Pilot readiness must be READY before starting or resuming operations.");
  }
  const changedAt = dateValue(now, "Transition time");
  return Object.freeze({
    action,
    status: nextStatus,
    transitionReason: reason,
    startedAt: action === "START" ? changedAt : undefined,
    endedAt: new Set(["COMPLETE", "CANCEL"]).has(action) ? changedAt : undefined,
    readinessSnapshot: new Set(["START", "RESUME"]).has(action)
      ? schoolPilotReadinessSnapshot(readiness, changedAt)
      : undefined
  });
}

export function normalizeSchoolPilotEvent(input = {}, now = new Date()) {
  const pilotRunId = requiredText(input.pilotRunId, "Pilot run", 1, 191);
  const kind = enumValue(input.kind, SCHOOL_PILOT_EVENT_KINDS, "Choose whether this is a drill or an incident.");
  const category = enumValue(input.category, SCHOOL_PILOT_EVENT_CATEGORIES, "Choose a valid event category.");
  const severity = enumValue(input.severity, SCHOOL_PILOT_EVENT_SEVERITIES, "Choose a valid event severity.");
  const occurredAt = dateValue(input.occurredAt || now, "Event time");
  const currentTime = dateValue(now, "Current time");
  if (occurredAt.getTime() > currentTime.getTime() + MAX_FUTURE_EVENT_MS) {
    throw new Error("An event cannot be recorded more than five minutes in the future.");
  }
  const outcome = kind === "DRILL"
    ? enumValue(input.outcome, SCHOOL_PILOT_EVENT_OUTCOMES, "Record the drill outcome.")
    : null;
  return {
    pilotRunId,
    kind,
    category,
    severity,
    status: kind === "DRILL" ? "RESOLVED" : "OPEN",
    outcome,
    summary: requiredText(input.summary, "Event summary", 10, 1000),
    responseActions: optionalText(input.responseActions, 2000),
    occurredAt,
    resolvedAt: kind === "DRILL" ? occurredAt : null
  };
}

export function transitionSchoolPilotEvent(currentStatus, input = {}, now = new Date()) {
  const status = String(currentStatus || "").trim().toUpperCase();
  const action = enumValue(input.action, SCHOOL_PILOT_EVENT_ACTIONS, "Choose a valid incident action.");
  const notes = requiredText(input.notes, "Incident action notes", 10, 2000);
  if (status === "RESOLVED") throw new Error("This event is already resolved.");
  if (action === "ACKNOWLEDGE" && status !== "OPEN") throw new Error("Only an open incident can be acknowledged.");
  const changedAt = dateValue(now, "Incident action time");
  return Object.freeze({
    action,
    status: action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED",
    resolutionNotes: action === "RESOLVE" ? notes : undefined,
    responseActions: action === "ACKNOWLEDGE" ? notes : undefined,
    acknowledgedAt: action === "ACKNOWLEDGE" ? changedAt : undefined,
    resolvedAt: action === "RESOLVE" ? changedAt : undefined
  });
}

export function schoolPilotOperationsSummary({ runs = [], events = [] } = {}) {
  const operationalRun = runs.find((item) => new Set(["ACTIVE", "PAUSED"]).has(item.status)) || null;
  return Object.freeze({
    operationalRunId: operationalRun?.id || null,
    operationalRunStatus: operationalRun?.status || null,
    plannedRuns: runs.filter((item) => item.status === "PLANNED").length,
    openIncidents: events.filter((item) => item.kind === "INCIDENT" && item.status !== "RESOLVED").length,
    criticalOpenIncidents: events.filter((item) => item.kind === "INCIDENT" && item.severity === "CRITICAL" && item.status !== "RESOLVED").length,
    recordedDrills: events.filter((item) => item.kind === "DRILL").length,
    studentIdentitiesIncluded: false,
    automaticActionsPerformed: false
  });
}
