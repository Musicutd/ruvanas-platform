import test from "node:test";
import assert from "node:assert/strict";
import { pilotReadiness, pilotReadinessRow, pilotNextStep, pilotReadinessMessage, PILOT_READINESS_KEYS, PILOT_READINESS_UI_CODES } from "../lib/retail-rewards/pilot-readiness-ui.mjs";
import { PILOT_READINESS_KEYS as SERVER_KEYS, PILOT_READINESS_CODES, pilotReadinessSchema } from "../lib/retail-rewards/pilot-readiness-contracts.mjs";

function ready() { return { ok: true, organisation: { id: "pilot-one", name: "Sample shop" }, configured: true, eligibleNow: true, endToEndTest: "NOT_VERIFIED",
  checks: PILOT_READINESS_KEYS.map(key => ({ key, status: "READY", code: PILOT_READINESS_UI_CODES[key][0], configuredCount: 1, eligibleCount: 1 })),
  pendingInvitations: 0, checkedAt: "2026-11-14T13:00:00.000Z" }; }
function blocked(key, code, configured = 1, status = "BLOCKED") { const value = ready(), row = value.checks.find(check => check.key === key); Object.assign(row, { status, code, configuredCount: configured, eligibleCount: 0 }); value.eligibleNow = false; if (key !== "environment" && configured === 0) value.configured = false; return value; }

test("Browser keys and safe codes mirror the server's narrow readiness contract", () => {
  assert.deepEqual(PILOT_READINESS_KEYS, SERVER_KEYS); assert.deepEqual(PILOT_READINESS_UI_CODES, PILOT_READINESS_CODES);
  for (const value of [ready(), blocked("environment", "PRIVATE_PREVIEW_BLOCKED"), blocked("environment", "ENVIRONMENT_INVALID", 0), blocked("owner", "OWNER_MISSING", 0, "MISSING")]) {
    assert.equal(pilotReadinessSchema.safeParse(value).success, true); assert.equal(pilotReadiness(value, "pilot-one"), value);
  }
});

test("Readiness is exact, organisation-bound and contains no identity or credential payloads", () => {
  const value = ready(); assert.equal(pilotReadiness(value, "pilot-one"), value); assert.equal(pilotReadiness(value, "other"), null);
  for (const edit of [
    data => { data.token = "secret"; }, data => { data.organisation.email = "owner@example.test"; }, data => { data.checks[0].rawConfig = "private"; },
    data => { data.checks[4].offerIds = ["private-id"]; }, data => { data.checkedAt = "2026-11-14"; }, data => { data.pendingInvitations = 101; },
    data => { data.checks.reverse(); }, data => { data.checks[4] = data.checks[3]; }, data => { data.checks[2].code = "UNKNOWN_ERROR"; }
  ]) { const modified = structuredClone(value); edit(modified); assert.equal(pilotReadiness(modified, "pilot-one"), null); }
});
test("Configured is distinct from eligible and never means end-to-end tested", () => {
  const value = blocked("environment", "PRIVATE_PREVIEW_BLOCKED"); assert.equal(pilotReadiness(value, "pilot-one"), value);
  assert.equal(value.configured, true); assert.equal(value.eligibleNow, false); assert.equal(value.endToEndTest, "NOT_VERIFIED");
  assert.equal(pilotReadiness({ ...value, endToEndTest: "PASSED" }, "pilot-one"), null);
  assert.equal(pilotReadiness({ ...value, eligibleNow: true }, "pilot-one"), null);
  const missing = blocked("owner", "OWNER_MISSING", 0, "MISSING"); assert.equal(pilotReadiness(missing, "pilot-one"), missing);
  assert.equal(pilotReadiness({ ...missing, configured: true }, "pilot-one"), null);
});
test("Inconsistent status, code and counts are rejected rather than rendered as ready", () => {
  for (const edit of [
    row => { row.status = "READY"; row.code = "SHOPS_MISSING"; row.eligibleCount = 0; },
    row => { row.status = "BLOCKED"; }, row => { row.code = "SHOPS_INACTIVE"; },
    row => { row.eligibleCount = 0; }, row => { row.configuredCount = 0; }, row => { row.eligibleCount = 101; },
    row => { row.status = "MISSING"; row.code = "SHOPS_MISSING"; row.eligibleCount = 0; }
  ]) { const value = ready(); edit(value.checks[3]); assert.equal(pilotReadiness(value, "pilot-one"), null); }
});
test("Private-preview incompatibility is explicit and never proposes impersonation or an activation link", () => {
  const value = blocked("environment", "PRIVATE_PREVIEW_BLOCKED"), step = pilotNextStep(value);
  assert.equal(step.key, "environment"); assert.match(step.message, /tester sign-in is incompatible/); assert.match(step.action.text, /does not change private preview/); assert.equal(step.action.tab, undefined);
  assert.equal(pilotReadinessRow({ key: "environment", code: "unexpected" }), null);
});
test("Only existing Super Admin setup sections are navigation targets", () => {
  for (const [key, code, tab] of [["entitlement", "ENTITLEMENT_INACTIVE", "access"], ["shops", "SHOPS_INACTIVE", "shops"], ["coupons", "COUPONS_INACTIVE", "coupons"], ["shoppers", "SHOPPERS_INACTIVE", "shoppers"]]) {
    const step = pilotNextStep(blocked(key, code)); assert.equal(step.action.tab, tab); assert.equal(Object.hasOwn(step.action, "href"), false);
  }
  const cashier = pilotNextStep(blocked("cashiers", "CASHIERS_INACTIVE")); assert.equal(cashier.action.tab, undefined); assert.match(cashier.action.text, /Client Admin owner: sign in with your own account/); assert.match(cashier.action.text, /exact shop/);
  const owner = pilotNextStep(blocked("owner", "OWNER_MISSING", 0, "MISSING")); assert.equal(owner.action.tab, undefined); assert.match(owner.action.text, /does not create or impersonate/);
});
test("Pending shopper invitations do not imply accepted active access", () => {
  const value = blocked("shoppers", "SHOPPERS_INACTIVE"); value.pendingInvitations = 1;
  assert.equal(pilotReadiness(value, "pilot-one"), value); const step = pilotNextStep(value);
  assert.match(step.message, /pending invitation alone does not establish/); assert.match(step.action.text, /must accept it/);
  const pending = blocked("shoppers", "SHOPPERS_MISSING", 0, "MISSING"); pending.pendingInvitations = 1;
  assert.equal(pilotReadiness(pending, "pilot-one"), pending); assert.match(pilotNextStep(pending).message, /Review pending invitations/);
});
test("All-ready snapshot suggests own-account testing while remaining unverified", () => {
  const value = ready(); const step = pilotNextStep(value); assert.equal(step.key, "test"); assert.equal(step.action, null);
  assert.match(step.message, /not proof/); assert.match(step.message, /repeat-use limits/); assert.equal(value.endToEndTest, "NOT_VERIFIED");
});
test("Safe unavailable wording never echoes backend strings or claims a mutation failed", () => {
  assert.match(pilotReadinessMessage("FEATURE_DISABLED"), /disabled/); assert.match(pilotReadinessMessage("PRIVATE_SECRET"), /could not be verified/);
  assert.doesNotMatch(pilotReadinessMessage("PRIVATE_SECRET"), /PRIVATE_SECRET|No change was made/);
});
