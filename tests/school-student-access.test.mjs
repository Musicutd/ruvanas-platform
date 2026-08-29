import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSchoolStudentAccessActive,
  assertSchoolStudentInvitationEligibility,
  createSchoolStudentInvitation,
  hasCurrentSchoolStudentConsent,
  hashSchoolStudentInvitationToken,
  normalizeStudentEmail,
  schoolStudentSafetyBoundary
} from "../lib/school-student-access.mjs";

const now = new Date("2026-09-18T10:00:00.000Z");
const readiness = { status: "APPROVED", studentIdentityMode: "INVITATION_ONLY" };
const contributor = { status: "ACTIVE" };
const consentRecords = [{ status: "GRANTED", episodeId: null, revokedAt: null, expiresAt: new Date("2027-01-01T00:00:00.000Z") }];

test("student email and invitation tokens are normalised without storing the raw token", () => {
  assert.equal(normalizeStudentEmail(" Student@School.Example "), "student@school.example");
  assert.throws(() => normalizeStudentEmail("not-an-email"), /valid student email/);
  const invitation = createSchoolStudentInvitation(now);
  assert.match(invitation.token, /^[a-f0-9]{64}$/);
  assert.equal(invitation.tokenHash, hashSchoolStudentInvitationToken(invitation.token));
  assert.notEqual(invitation.tokenHash, invitation.token);
  assert.equal(invitation.expiresAt.toISOString(), "2026-09-25T10:00:00.000Z");
  assert.throws(() => createSchoolStudentInvitation(now, 15), /within 14 days/);
});

test("only current school-level consent permits a student invitation", () => {
  assert.equal(hasCurrentSchoolStudentConsent(consentRecords, now), true);
  assert.equal(hasCurrentSchoolStudentConsent([{ ...consentRecords[0], episodeId: "episode-1" }], now), false);
  assert.equal(hasCurrentSchoolStudentConsent([{ ...consentRecords[0], revokedAt: now }], now), false);
  assert.equal(hasCurrentSchoolStudentConsent([{ ...consentRecords[0], expiresAt: now }], now), false);
  assert.equal(hasCurrentSchoolStudentConsent([
    { ...consentRecords[0], createdAt: new Date("2026-09-17T09:00:00.000Z") },
    { status: "REVOKED", episodeId: null, revokedAt: now, createdAt: new Date("2026-09-18T09:00:00.000Z") }
  ], now), false);
});

test("student invitations require the approved invitation-only safeguarding decision", () => {
  assert.equal(assertSchoolStudentInvitationEligibility({ readiness, contributor, consentRecords, now }), true);
  assert.throws(() => assertSchoolStudentInvitationEligibility({ readiness: { ...readiness, status: "READY_FOR_REVIEW" }, contributor, consentRecords, now }), /must approve/);
  assert.throws(() => assertSchoolStudentInvitationEligibility({ readiness: { ...readiness, studentIdentityMode: "DISABLED" }, contributor, consentRecords, now }), /invitation-only/);
  assert.throws(() => assertSchoolStudentInvitationEligibility({ readiness, contributor: { status: "INACTIVE" }, consentRecords, now }), /active student contributor/);
  assert.throws(() => assertSchoolStudentInvitationEligibility({ readiness, contributor, consentRecords: [], now }), /school-level consent/);
  assert.throws(() => assertSchoolStudentInvitationEligibility({ readiness, contributor, consentRecords, existingAccess: { status: "ACTIVE" }, now }), /already has active/);
});

test("an active student workspace is withdrawn if safeguarding or consent stops being valid", () => {
  const access = {
    status: "ACTIVE",
    revokedAt: null,
    organisation: { schoolSafeguardingReadiness: readiness },
    contributor: { ...contributor, consentRecords }
  };
  assert.equal(assertSchoolStudentAccessActive({ access, now }), true);
  assert.throws(() => assertSchoolStudentAccessActive({ access: { ...access, revokedAt: now }, now }), /not active/);
  assert.throws(() => assertSchoolStudentAccessActive({ access: { ...access, contributor: { ...contributor, consentRecords: [] } }, now }), /school-level consent/);
});

test("student workspace safety remains least privilege", () => {
  assert.deepEqual(schoolStudentSafetyBoundary(), {
    staffDashboardAccess: false,
    administrationAccess: false,
    directMessagingEnabled: false,
    publicPublishingEnabled: false,
    crossSchoolAuthority: false,
    workspaceMode: "PRIVATE_READ_ONLY"
  });
});
