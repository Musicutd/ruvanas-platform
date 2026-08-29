import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSchoolPilotReadiness,
  normalizeSchoolPilotChecklist,
  normalizeSchoolRetentionHold,
  normalizeSchoolRetentionHoldRelease,
  schoolRetentionCandidatePreview,
  SCHOOL_RETENTION_SAFETY_NOTICE
} from "../lib/school-pilot-readiness.mjs";

const completeChecklist = {
  staffTrainingConfirmed: true,
  emergencyWithdrawalDrillConfirmed: true,
  retentionReviewConfirmed: true,
  supportContactsConfirmed: true,
  recoveryPlanConfirmed: true,
  notes: "Pilot reviewed by school management."
};

test("pilot readiness is ready only after all operational and safeguarding prerequisites pass", () => {
  const ready = deriveSchoolPilotReadiness({
    checklist: completeChecklist,
    safeguarding: { status: "APPROVED", rawRecordingRetentionDays: 30, consentEvidenceRetentionDays: 365 },
    activeHoldCount: 2
  });
  assert.equal(ready.status, "READY");
  assert.equal(ready.readyForPilot, true);
  assert.equal(ready.activeHoldCount, 2);
  assert.equal(ready.deletionEnabled, false);

  const blocked = deriveSchoolPilotReadiness({
    checklist: completeChecklist,
    safeguarding: { status: "READY_FOR_REVIEW", rawRecordingRetentionDays: 30, consentEvidenceRetentionDays: null }
  });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.readyForPilot, false);
  assert.match(blocked.prerequisiteGaps.join(" "), /Safeguarding readiness/);
  assert.match(blocked.prerequisiteGaps.join(" "), /Consent-evidence retention/);

  const inProgress = deriveSchoolPilotReadiness({
    checklist: { ...completeChecklist, staffTrainingConfirmed: false },
    safeguarding: { status: "APPROVED", rawRecordingRetentionDays: 30, consentEvidenceRetentionDays: 365 }
  });
  assert.equal(inProgress.status, "IN_PROGRESS");
});

test("pilot checklist normalisation accepts only explicit confirmations and bounded notes", () => {
  const checklist = normalizeSchoolPilotChecklist({ ...completeChecklist, staffTrainingConfirmed: "true", notes: "  Reviewed  " });
  assert.equal(checklist.staffTrainingConfirmed, false);
  assert.equal(checklist.notes, "Reviewed");
  assert.throws(() => normalizeSchoolPilotChecklist({ notes: "x".repeat(2001) }), /2000 characters/);
});

test("retention holds require tenant-verifiable references and explicit reasons", () => {
  assert.deepEqual(normalizeSchoolRetentionHold({ scope: "ORGANISATION", reason: "Safeguarding review is in progress." }), {
    scope: "ORGANISATION",
    referenceId: null,
    reason: "Safeguarding review is in progress."
  });
  assert.deepEqual(normalizeSchoolRetentionHold({ scope: "EPISODE", referenceId: "episode-1", reason: "Legal review requires this episode to be preserved." }).scope, "EPISODE");
  assert.throws(() => normalizeSchoolRetentionHold({ scope: "EPISODE", reason: "Missing reference" }), /reference ID is required/);
  assert.throws(() => normalizeSchoolRetentionHold({ scope: "ORGANISATION", referenceId: "unexpected", reason: "Organisation-wide safeguarding review." }), /does not use a reference ID/);
  assert.throws(() => normalizeSchoolRetentionHold({ scope: "EPISODE", referenceId: "episode-1", reason: "Too short" }), /at least 10 characters/);
  assert.equal(normalizeSchoolRetentionHoldRelease({ reason: "Review completed and release approved." }).reason, "Review completed and release approved.");
});

test("retention candidate results remain aggregate and non-destructive", () => {
  const preview = schoolRetentionCandidatePreview({
    safeguarding: { rawRecordingRetentionDays: 30, consentEvidenceRetentionDays: 365 },
    counts: { rawRecordings: 12, consentEvidence: 4 },
    now: new Date("2026-08-29T12:00:00.000Z")
  });
  assert.equal(preview.rawRecordings.candidateCount, 12);
  assert.equal(preview.rawRecordings.cutoff, "2026-07-30T12:00:00.000Z");
  assert.equal(preview.consentEvidence.candidateCount, 4);
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.destructiveActionAvailable, false);
  assert.equal(preview.destructiveActionPerformed, false);
  assert.equal(preview.containsStudentIdentities, false);
  assert.match(SCHOOL_RETENTION_SAFETY_NOTICE, /No school recording/);
  assert.match(SCHOOL_RETENTION_SAFETY_NOTICE, /deleted or changed/);
});
