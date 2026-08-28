import assert from "node:assert/strict";
import test from "node:test";
import {
  canChangeSchoolNetworkOwners,
  canManageSchoolNetwork,
  canViewSchoolNetwork,
  redactedNetworkMember,
  schoolNetworkSummary,
  validateSchoolAccessGrant
} from "../lib/school-network.mjs";

test("academy access is explicit and role bounded", () => {
  assert.equal(canViewSchoolNetwork({ platformRole: "OWNER", networkRole: "VIEWER" }), true);
  assert.equal(canViewSchoolNetwork({ platformRole: "OWNER", networkRole: null }), false);
  assert.equal(canManageSchoolNetwork({ platformRole: "OWNER", networkRole: "ADMIN" }), true);
  assert.equal(canManageSchoolNetwork({ platformRole: "OWNER", networkRole: "VIEWER" }), false);
  assert.equal(canChangeSchoolNetworkOwners({ platformRole: "OWNER", networkRole: "OWNER" }), true);
  assert.equal(canChangeSchoolNetworkOwners({ platformRole: "OWNER", networkRole: "ADMIN" }), false);
  assert.equal(canManageSchoolNetwork({ platformRole: "SUPER_ADMIN", networkRole: null }), true);
});

test("academy school summaries expose aggregate counts only", () => {
  const summary = schoolNetworkSummary({
    id: "network-school",
    active: true,
    joinedAt: new Date("2026-08-28T00:00:00Z"),
    organisation: {
      id: "school-one",
      name: "School One",
      slug: "school-one",
      _count: { locations: 2, studentGroups: 3, schoolProgrammes: 4, schoolEpisodes: 5, assignments: 6 },
      studentContributors: [{ displayName: "Must not leak" }]
    }
  }, { canOpen: true });
  assert.deepEqual(summary.metrics, { locations: 2, classes: 3, programmes: 4, episodes: 5, assignments: 6 });
  assert.equal(summary.canOpen, true);
  assert.equal("studentContributors" in summary, false);
});

test("viewer responses redact academy member identities", () => {
  const member = { id: "member", role: "VIEWER", user: { id: "user", name: "Teacher", email: "teacher@example.test" } };
  assert.deepEqual(redactedNetworkMember(member), { id: "member", role: "VIEWER" });
  assert.equal(redactedNetworkMember(member, { includeIdentity: true }).user.email, "teacher@example.test");
});

test("academy grants cannot create organisation owners", () => {
  assert.equal(validateSchoolAccessGrant({ organisationRole: "MANAGER" }), "MANAGER");
  assert.throws(() => validateSchoolAccessGrant({ organisationRole: "OWNER" }), /manager, content editor, or viewer/);
});

