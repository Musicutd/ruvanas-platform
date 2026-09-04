import crypto from "node:crypto";

export const PLAYOUT_SOURCE_PRIORITIES = Object.freeze({
  EMERGENCY_OVERRIDE: 1200,
  LIVE_SESSION: 1100,
  SCHOOL_PROGRAMMING: 1000,
  PROGRAMME_SCHEDULE: 800,
  ZONE_SLOT: 620,
  LOCATION_SLOT: 600,
  DEFAULT_AUTODJ: 400,
  BACKUP_AUTODJ: 300
});

export const PLAYOUT_PROOF_CLASSIFICATIONS = Object.freeze([
  "EMERGENCY",
  "LIVE",
  "SCHOOL",
  "SCHEDULED",
  "AUTODJ",
  "CRITICAL_FAILURE"
]);

function asDate(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const result = value instanceof Date ? value : new Date(value);
  return Number.isNaN(result.valueOf()) ? fallback : result;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function boundedText(value, maximum, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maximum);
}

function normaliseCandidate(candidate, context, index) {
  const sourceType = boundedText(candidate?.sourceType, 32);
  const sourceId = boundedText(candidate?.sourceId, 160);
  if (!sourceType || !sourceId) throw new Error(`Playout candidate ${index + 1} needs a stable source type and source ID.`);
  if (candidate.organisationId && candidate.organisationId !== context.organisationId) {
    throw new Error("A playout candidate belongs to another organisation.");
  }
  if (candidate.channelId && context.channelId && candidate.channelId !== context.channelId) {
    throw new Error("A playout candidate belongs to another channel.");
  }
  const validFrom = asDate(candidate.validFrom, context.instant);
  const validUntil = asDate(candidate.validUntil, new Date(context.instant.getTime() + context.decisionTtlSeconds * 1000));
  if (!validFrom || !validUntil || validUntil <= validFrom) throw new Error(`Playout candidate ${sourceId} has an invalid validity window.`);
  const priority = Number(candidate.priority ?? PLAYOUT_SOURCE_PRIORITIES[sourceType] ?? 0);
  if (!Number.isInteger(priority) || priority < 0 || priority > 2000) throw new Error(`Playout candidate ${sourceId} has an invalid priority.`);
  const proofClassification = PLAYOUT_PROOF_CLASSIFICATIONS.includes(candidate.proofClassification)
    ? candidate.proofClassification
    : "SCHEDULED";
  const withinWindow = context.instant >= validFrom && context.instant < validUntil;
  return {
    sourceType,
    sourceId,
    sourceRevision: boundedText(candidate.sourceRevision, 200, "unversioned"),
    label: boundedText(candidate.label, 160, sourceType.replaceAll("_", " ")),
    priority,
    available: candidate.available !== false && withinWindow,
    unavailableReason: candidate.available === false
      ? boundedText(candidate.unavailableReason, 200, "SOURCE_UNAVAILABLE")
      : withinWindow ? null : "OUTSIDE_VALIDITY_WINDOW",
    hardStart: candidate.hardStart === true,
    validFrom,
    validUntil,
    proofClassification,
    payload: candidate.payload ?? null
  };
}

function compareCandidate(left, right) {
  return right.priority - left.priority ||
    Number(right.hardStart) - Number(left.hardStart) ||
    left.validUntil - right.validUntil ||
    left.sourceType.localeCompare(right.sourceType) ||
    left.sourceId.localeCompare(right.sourceId);
}

function normaliseInsertions(insertions, context) {
  const unique = new Map();
  for (const insertion of insertions || []) {
    const scheduleItemId = boundedText(insertion?.scheduleItemId, 128);
    const plannedStart = asDate(insertion?.plannedStart);
    if (!scheduleItemId || !plannedStart) continue;
    if (insertion.organisationId && insertion.organisationId !== context.organisationId) {
      throw new Error("A required insertion belongs to another organisation.");
    }
    if (!unique.has(scheduleItemId)) unique.set(scheduleItemId, { ...insertion, scheduleItemId, plannedStart });
  }
  return [...unique.values()].sort((left, right) =>
    left.plannedStart - right.plannedStart || left.scheduleItemId.localeCompare(right.scheduleItemId)
  );
}

function decisionKey(context, selected, evaluated, insertions) {
  const bucket = Math.floor(context.instant.getTime() / (context.decisionTtlSeconds * 1000));
  return crypto.createHash("sha256").update(stableJson({
    organisationId: context.organisationId,
    channelId: context.channelId,
    targetId: context.targetId,
    bucket,
    sourceType: selected?.sourceType || "CRITICAL_FAILURE",
    sourceId: selected?.sourceId || null,
    sourceRevision: selected?.sourceRevision || null,
    evaluated: evaluated.map((candidate) => ({
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      sourceRevision: candidate.sourceRevision,
      priority: candidate.priority,
      available: candidate.available,
      unavailableReason: candidate.unavailableReason
    })),
    insertions: insertions.map((item) => ({
      scheduleItemId: item.scheduleItemId,
      sourceRevision: item.sourceRevision || null,
      plannedStart: item.plannedStart.toISOString()
    }))
  })).digest("hex");
}

export function resolveUnifiedPlayout({
  organisationId,
  channelId = null,
  targetId,
  instant = new Date(),
  candidates = [],
  requiredInsertions = [],
  decisionTtlSeconds = 300
}) {
  const resolvedInstant = asDate(instant);
  if (!organisationId || !targetId || !resolvedInstant) throw new Error("Playout resolution needs an organisation, target and valid instant.");
  if (!Number.isInteger(decisionTtlSeconds) || decisionTtlSeconds < 30 || decisionTtlSeconds > 3600) {
    throw new Error("Playout decision TTL must be between 30 and 3,600 seconds.");
  }
  const context = { organisationId, channelId, targetId, instant: resolvedInstant, decisionTtlSeconds };
  const evaluated = candidates.map((candidate, index) => normaliseCandidate(candidate, context, index)).sort(compareCandidate);
  const selected = evaluated.find((candidate) => candidate.available) || null;
  const insertions = normaliseInsertions(requiredInsertions, context);
  const unavailable = evaluated.filter((candidate) => !candidate.available);
  const nextBoundary = evaluated
    .flatMap((candidate) => [candidate.validFrom, candidate.validUntil])
    .filter((boundary) => boundary > resolvedInstant)
    .sort((left, right) => left - right)[0];
  const defaultDecisionEnd = new Date(resolvedInstant.getTime() + decisionTtlSeconds * 1000);
  const validUntil = selected ? new Date(Math.min(selected.validUntil.getTime(), defaultDecisionEnd.getTime())) : defaultDecisionEnd;
  const nextDecisionAt = nextBoundary && nextBoundary < validUntil ? nextBoundary : validUntil;
  const higherUnavailable = selected
    ? unavailable.filter((candidate) => candidate.priority > selected.priority)
    : unavailable;
  const operatorAlert = !selected
    ? { severity: "CRITICAL", code: "NO_PLAYABLE_SOURCE", message: "No authoritative playout source is currently available." }
    : higherUnavailable.length
      ? { severity: "WARNING", code: "PLAYOUT_FALLBACK_ACTIVE", message: `${selected.label} is active because ${higherUnavailable[0].label} is unavailable.` }
      : null;
  const key = decisionKey(context, selected, evaluated, insertions);

  return {
    decisionId: key,
    decisionKey: key,
    decidedAt: resolvedInstant,
    channelId,
    targetId,
    sourceType: selected?.sourceType || "CRITICAL_FAILURE",
    sourceId: selected?.sourceId || null,
    sourceRevision: selected?.sourceRevision || null,
    sourceLabel: selected?.label || "Critical programming failure",
    reason: selected ? `SELECTED_${selected.sourceType}` : "NO_PLAYABLE_SOURCE",
    priority: selected?.priority ?? 0,
    proofClassification: selected?.proofClassification || "CRITICAL_FAILURE",
    validFrom: selected?.validFrom || resolvedInstant,
    validUntil,
    nextDecisionAt,
    fallbackChain: evaluated.map((candidate) => ({
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      label: candidate.label,
      priority: candidate.priority,
      available: candidate.available,
      unavailableReason: candidate.unavailableReason
    })),
    unavailableReasons: unavailable.map((candidate) => ({
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      reason: candidate.unavailableReason
    })),
    requiredInsertions: insertions,
    operatorAlert,
    selectedPayload: selected?.payload ?? null
  };
}

export function playoutDecisionEvidence(decision) {
  return {
    decisionKey: decision.decisionKey,
    sourceType: decision.sourceType,
    sourceId: decision.sourceId,
    sourceRevision: decision.sourceRevision,
    reason: decision.reason,
    priority: decision.priority,
    proofClassification: decision.proofClassification,
    validFrom: decision.validFrom,
    validUntil: decision.validUntil,
    nextDecisionAt: decision.nextDecisionAt,
    fallbackChain: decision.fallbackChain,
    unavailableReasons: decision.unavailableReasons,
    requiredInsertionIds: decision.requiredInsertions.map((item) => item.scheduleItemId)
  };
}
