import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSchoolSafeguardingReadyForReview,
  normalizeSchoolSafeguardingReadiness,
  normalizeTargetCountries,
  schoolSafeguardingReadinessGaps,
  schoolStudentAccessSafetyState
} from "../lib/school-safeguarding-readiness.mjs";

const complete = {
  targetCountries: ["MT", "GB"],
  minimumStudentAge: 8,
  maximumStudentAge: 18,
  consentModel: "BOTH",
  studentIdentityMode: "INVITATION_ONLY",
  privacyContactEmail: "privacy@school.example",
  rawRecordingRetentionDays: 90,
  consentEvidenceRetentionDays: 730,
  localPolicyReference: "Safeguarding policy v3, approved 2026-08-10",
  notes: null,
  staffModerationConfirmed: true,
  noDirectMessagingConfirmed: true,
  privateByDefaultConfirmed: true
};

test("target countries are deduplicated and use bounded two-letter codes", () => {
  assert.deepEqual(normalizeTargetCountries([" mt ", "MT", "gb"]), ["MT", "GB"]);
  assert.throws(() => normalizeTargetCountries(["Malta"]), /two-letter country codes/);
});

test("safeguarding readiness normalises a complete policy pack", () => {
  const result = normalizeSchoolSafeguardingReadiness({ ...complete, privacyContactEmail: " Privacy@School.Example " });
  assert.equal(result.privacyContactEmail, "privacy@school.example");
  assert.deepEqual(assertSchoolSafeguardingReadyForReview(result), { status: "READY_FOR_REVIEW", gaps: [] });
});

test("readiness submission reports missing policy decisions", () => {
  const draft = normalizeSchoolSafeguardingReadiness({});
  const gaps = schoolSafeguardingReadinessGaps(draft);
  assert.ok(gaps.length >= 9);
  assert.throws(() => assertSchoolSafeguardingReadyForReview(draft), /target country/);
});

test("age and retention windows remain bounded", () => {
  assert.throws(() => normalizeSchoolSafeguardingReadiness({ ...complete, minimumStudentAge: 19, maximumStudentAge: 12 }), /valid range/);
  assert.throws(() => normalizeSchoolSafeguardingReadiness({ ...complete, rawRecordingRetentionDays: 0 }), /between 1 and 3650/);
  assert.throws(() => normalizeSchoolSafeguardingReadiness({ ...complete, consentEvidenceRetentionDays: 10 }), /between 30 and 3650/);
});

test("a completed readiness pack never enables student or public access", () => {
  const safety = schoolStudentAccessSafetyState({ ...complete, status: "READY_FOR_REVIEW" });
  assert.equal(safety.requestedIdentityMode, "INVITATION_ONLY");
  assert.equal(safety.directStudentAccessEnabled, false);
  assert.equal(safety.publicPublishingEnabled, false);
  assert.equal(safety.directMessagingEnabled, false);
});
