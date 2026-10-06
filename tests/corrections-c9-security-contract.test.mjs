import assert from "node:assert/strict";
import test from "node:test";
import { enterpriseSessionIsUsable, SERVICE_ACCOUNT_SCOPES, scopeAllows, validateEnterprisePolicy } from "../lib/enterprise-security.mjs";
import { correctionsFacilityPermission } from "../lib/corrections-policy.mjs";
import { correctionsProgrammePermission } from "../lib/corrections-workflow.mjs";
import { correctionsStudioSessionAvailable, correctionsStudioSupervisorAllowed } from "../lib/corrections-studio-policy.mjs";

const now = new Date("2026-09-30T12:00:00.000Z");

test("C9 keeps SSO optional without a verified customer provider and enforces session expiry and revocation", () => {
  const policy = { ssoRequired: false, passwordFallback: true, sessionMaxAgeMinutes: 120, idleTimeoutMinutes: 30 };
  const session = {
    createdAt: new Date("2026-09-30T10:30:00.000Z"), lastSeenAt: new Date("2026-09-30T11:45:00.000Z"),
    expiresAt: new Date("2026-10-30T12:00:00.000Z"), revokedAt: null, authMethod: "PASSWORD", user: { role: "OWNER" }
  };
  assert.equal(validateEnterprisePolicy(policy).ok, true);
  assert.equal(validateEnterprisePolicy({ ...policy, ssoRequired: true }).ok, false);
  assert.equal(enterpriseSessionIsUsable(session, policy, now), true);
  assert.equal(enterpriseSessionIsUsable(session, null, now), true);
  assert.equal(enterpriseSessionIsUsable(null, policy, now), false);
  assert.equal(enterpriseSessionIsUsable({ ...session, revokedAt: now }, policy, now), false);
  assert.equal(enterpriseSessionIsUsable({ ...session, expiresAt: new Date("2026-09-30T11:59:00.000Z") }, policy, now), false);
  assert.equal(enterpriseSessionIsUsable({ ...session, createdAt: new Date("2026-09-30T09:59:00.000Z") }, policy, now), false);
  assert.equal(enterpriseSessionIsUsable({ ...session, lastSeenAt: new Date("2026-09-30T11:29:00.000Z") }, policy, now), false);
  assert.equal(enterpriseSessionIsUsable(session, { ...policy, ssoRequired: true, passwordFallback: false }, now), false);
  assert.equal(enterpriseSessionIsUsable({ ...session, authMethod: "SSO" }, { ...policy, ssoRequired: true, passwordFallback: false }, now), true);
});

test("generic service-account read scopes never imply Corrections facility authority", () => {
  assert.equal(SERVICE_ACCOUNT_SCOPES.some((scope) => scope.startsWith("corrections:")), false);
  for (const scope of SERVICE_ACCOUNT_SCOPES) {
    assert.equal(scopeAllows([scope], "corrections:facility:read"), false);
    assert.equal(scopeAllows([scope], "corrections:facility:manage"), false);
  }
});

test("Corrections staff grants are tenant, member, facility and action bounded", () => {
  const base = { role: "MANAGER", organisationId: "org-a", memberId: "member-a", locationId: "facility-a" };
  const assignment = { organisationId: "org-a", organisationMemberId: "member-a", facilityId: "facility-a", permission: "MANAGER" };
  assert.equal(correctionsFacilityPermission({ ...base, assignment, edit: true }), true);
  assert.equal(correctionsFacilityPermission({ ...base, organisationId: "org-b", assignment }), false);
  assert.equal(correctionsFacilityPermission({ ...base, memberId: "member-b", assignment }), false);
  assert.equal(correctionsFacilityPermission({ ...base, locationId: "facility-b", assignment }), false);
  assert.equal(correctionsFacilityPermission({ ...base, assignment: null }), false);
  assert.equal(correctionsFacilityPermission({ ...base, role: "VIEWER", assignment: { ...assignment, permission: "VIEWER" }, edit: true }), false);
  assert.equal(correctionsProgrammePermission({ ...base, facilityId: "facility-a", assignment, action: "EDIT" }), true);
  assert.equal(correctionsProgrammePermission({ ...base, facilityId: "facility-b", assignment, action: "EDIT" }), false);
  assert.equal(correctionsProgrammePermission({ ...base, role: "CONTENT_EDITOR", facilityId: "facility-a", assignment: { ...assignment, permission: "EDITOR" }, action: "SUBMIT" }), true);
  assert.equal(correctionsProgrammePermission({ ...base, role: "CONTENT_EDITOR", facilityId: "facility-a", assignment: { ...assignment, permission: "EDITOR" }, action: "APPROVE" }), false);
  assert.equal(correctionsStudioSupervisorAllowed({ ...base, facilityId: "facility-a", grant: assignment }), true);
  assert.equal(correctionsStudioSupervisorAllowed({ ...base, facilityId: "facility-b", grant: assignment }), false);
  assert.equal(correctionsStudioSupervisorAllowed({ ...base, role: "VIEWER", facilityId: "facility-a", grant: assignment }), false);
});

test("supervised contributor sessions deny revoked, expired and cross-facility access", () => {
  const session = {
    status: "ACTIVE", accessTokenHash: "hash", activatedAt: new Date("2026-09-30T11:00:00.000Z"),
    expiresAt: new Date("2026-09-30T13:00:00.000Z"), revokedAt: null,
    organisationId: "org-a", facilityId: "facility-a", project: { organisationId: "org-a" },
    contributor: { status: "ACTIVE", organisationId: "org-a", facilityId: "facility-a" },
    programme: { status: "DRAFT", organisationId: "org-a", facilityId: "facility-a" },
    facility: { status: "ACTIVE", organisationId: "org-a" }
  };
  assert.equal(correctionsStudioSessionAvailable(session, now), true);
  assert.equal(correctionsStudioSessionAvailable({ ...session, revokedAt: now }, now), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, expiresAt: now }, now), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, accessTokenHash: null }, now), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, programme: { ...session.programme, facilityId: "facility-b" } }, now), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, contributor: { ...session.contributor, organisationId: "org-b" } }, now), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, project: { organisationId: "org-b" } }, now), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, facility: { ...session.facility, status: "CLOSED" } }, now), false);
});
