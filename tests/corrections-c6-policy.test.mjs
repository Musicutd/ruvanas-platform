import assert from "node:assert/strict";
import test from "node:test";
import { chooseCorrectionsOverride, correctionsAnnouncementApproval, correctionsAnnouncementPermission, correctionsOverrideConflict } from "../lib/corrections-c6-policy.mjs";

const facility = { priorityEnabled: true, emergencyEnabled: true };
const managerGrant = { permission: "MANAGER", canPriorityActivate: true, canPriorityStop: true, canEmergencyActivate: false, canEmergencyClear: false };

test("C6 emergency authority requires an explicit facility grant and tier", () => {
  assert.equal(correctionsAnnouncementPermission({ role: "CONTENT_EDITOR", grant: { permission: "EDITOR", canEmergencyActivate: true }, action: "EMERGENCY_ACTIVATE", facility, tier: 5 }), false);
  assert.equal(correctionsAnnouncementPermission({ role: "VIEWER", grant: { permission: "VIEWER" }, action: "PRIORITY_ACTIVATE", facility, tier: 5 }), false);
  assert.equal(correctionsAnnouncementPermission({ role: "OWNER", grant: null, action: "EMERGENCY_ACTIVATE", facility, tier: 5 }), false);
  assert.equal(correctionsAnnouncementPermission({ role: "MANAGER", grant: managerGrant, action: "PRIORITY_ACTIVATE", facility, tier: 1 }), true);
  assert.equal(correctionsAnnouncementPermission({ role: "MANAGER", grant: { ...managerGrant, canEmergencyActivate: true }, action: "EMERGENCY_ACTIVATE", facility, tier: 1 }), false);
  assert.equal(correctionsAnnouncementPermission({ role: "MANAGER", grant: { ...managerGrant, canEmergencyActivate: true }, action: "EMERGENCY_ACTIVATE", facility, tier: 2 }), true);
});

test("C6 independent and dual approval cannot be self-approved", () => {
  const item = { status: "DRAFT", createdByUserId: "creator", approvedByUserId: null };
  assert.equal(correctionsAnnouncementApproval({ announcement: item, mode: "EXPLICIT", reviewerId: "creator" }), null);
  assert.equal(correctionsAnnouncementApproval({ announcement: item, mode: "DUAL", reviewerId: "reviewer-a" }), "FIRST");
  assert.equal(correctionsAnnouncementApproval({ announcement: { ...item, approvedByUserId: "reviewer-a" }, mode: "DUAL", reviewerId: "reviewer-a", second: true }), null);
  assert.equal(correctionsAnnouncementApproval({ announcement: { ...item, approvedByUserId: "reviewer-a" }, mode: "DUAL", reviewerId: "reviewer-b", second: true }), "APPROVED");
});

test("C6 Emergency outranks Priority and Priority cannot displace Emergency", () => {
  const now = new Date();
  const base = { status: "ACTIVE", startedAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 60000), targetZoneIds: ["zone"] };
  const priority = { ...base, id: "priority", type: "PRIORITY" };
  const emergency = { ...base, id: "emergency", type: "EMERGENCY" };
  assert.equal(chooseCorrectionsOverride([priority, emergency], "zone", now)?.id, "emergency");
  assert.equal(correctionsOverrideConflict(emergency, "PRIORITY") !== null, true);
  assert.equal(correctionsOverrideConflict(priority, "EMERGENCY"), null);
  assert.equal(chooseCorrectionsOverride([{ ...emergency, expiresAt: new Date(now.getTime() - 1) }], "zone", now), null);
});
