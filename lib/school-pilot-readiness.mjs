export const SCHOOL_RETENTION_HOLD_SCOPES = Object.freeze([
  "ORGANISATION",
  "EPISODE",
  "CONTRIBUTOR",
  "MEDIA_ASSET"
]);

export const SCHOOL_RETENTION_SAFETY_NOTICE = "Retention candidates are aggregate previews only. No school recording, consent evidence, contributor, episode, or media file is deleted or changed by this workflow.";

const DAY_MS = 86_400_000;
const CHECKLIST_FIELDS = Object.freeze([
  "staffTrainingConfirmed",
  "emergencyWithdrawalDrillConfirmed",
  "retentionReviewConfirmed",
  "supportContactsConfirmed",
  "recoveryPlanConfirmed"
]);

function optionalText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`Text must be ${maxLength} characters or fewer.`);
  return text;
}

function positiveDays(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function safeCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

export function normalizeSchoolPilotChecklist(input = {}) {
  const normalized = {};
  for (const field of CHECKLIST_FIELDS) normalized[field] = input[field] === true;
  normalized.notes = optionalText(input.notes, 2000);
  return normalized;
}

export function normalizeSchoolRetentionHold(input = {}) {
  const scope = String(input.scope || "").trim().toUpperCase();
  if (!SCHOOL_RETENTION_HOLD_SCOPES.includes(scope)) throw new Error("Choose a valid retention-hold scope.");
  const referenceId = optionalText(input.referenceId, 191);
  if (scope === "ORGANISATION" && referenceId) throw new Error("An organisation-wide hold does not use a reference ID.");
  if (scope !== "ORGANISATION" && !referenceId) throw new Error("A reference ID is required for this hold scope.");
  const reason = optionalText(input.reason, 1000);
  if (!reason || reason.length < 10) throw new Error("Provide a clear hold reason of at least 10 characters.");
  return { scope, referenceId, reason };
}

export function normalizeSchoolRetentionHoldRelease(input = {}) {
  const reason = optionalText(input.reason, 1000);
  if (!reason || reason.length < 10) throw new Error("Provide a clear release reason of at least 10 characters.");
  return { reason };
}

export function schoolRetentionCandidatePreview({ safeguarding = {}, counts = {}, now = new Date() } = {}) {
  const rawRecordingRetentionDays = positiveDays(safeguarding.rawRecordingRetentionDays);
  const consentEvidenceRetentionDays = positiveDays(safeguarding.consentEvidenceRetentionDays);
  const cutoff = (days) => days ? new Date(now.getTime() - days * DAY_MS) : null;
  return Object.freeze({
    rawRecordings: {
      retentionDays: rawRecordingRetentionDays,
      cutoff: cutoff(rawRecordingRetentionDays)?.toISOString() || null,
      candidateCount: safeCount(counts.rawRecordings)
    },
    consentEvidence: {
      retentionDays: consentEvidenceRetentionDays,
      cutoff: cutoff(consentEvidenceRetentionDays)?.toISOString() || null,
      candidateCount: safeCount(counts.consentEvidence)
    },
    previewOnly: true,
    destructiveActionAvailable: false,
    destructiveActionPerformed: false,
    containsStudentIdentities: false
  });
}

export function deriveSchoolPilotReadiness({ checklist = {}, safeguarding = {}, activeHoldCount = 0 } = {}) {
  const normalized = normalizeSchoolPilotChecklist(checklist);
  const checks = CHECKLIST_FIELDS.map((field) => ({ key: field, complete: normalized[field] }));
  const prerequisiteGaps = [];
  if (safeguarding.status !== "APPROVED") prerequisiteGaps.push("Safeguarding readiness must be approved.");
  if (!positiveDays(safeguarding.rawRecordingRetentionDays)) prerequisiteGaps.push("Raw-recording retention must be configured.");
  if (!positiveDays(safeguarding.consentEvidenceRetentionDays)) prerequisiteGaps.push("Consent-evidence retention must be configured.");
  const checklistComplete = checks.every((item) => item.complete);
  const status = checklistComplete && !prerequisiteGaps.length
    ? "READY"
    : checklistComplete && prerequisiteGaps.length
      ? "BLOCKED"
      : "IN_PROGRESS";
  return Object.freeze({
    status,
    checklistComplete,
    completedChecks: checks.filter((item) => item.complete).length,
    totalChecks: checks.length,
    prerequisiteGaps,
    activeHoldCount: safeCount(activeHoldCount),
    readyForPilot: status === "READY",
    deletionEnabled: false
  });
}
