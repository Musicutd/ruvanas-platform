import test from "node:test";
import assert from "node:assert/strict";

import {
  canRedeemComplimentaryAccess,
  clearComplimentaryAccess,
  complimentaryCodeSuffix,
  complimentaryPlanProducts,
  complimentaryPlanSnapshot,
  generateComplimentaryCode,
  hashComplimentaryCode,
  normaliseComplimentaryCode,
  resolveComplimentaryPlan
} from "../lib/complimentary-access.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";

const tier = {
  active: true,
  name: "Premium",
  code: "PREMIUM",
  stationLimit: 5,
  storageLimitGb: 25,
  listenerLimit: 500,
  maxBitrateKbps: 320,
  includesRuvanasCatalogue: true,
  promoUploadEnabled: true,
  schoolRadioEnabled: true,
  schoolPublicPublishingEnabled: false,
  retailMediaEnabled: true,
  digitalSignageEnabled: true
};

test("complimentary codes are high-entropy, normalised, and hashed without storing plaintext", () => {
  const code = generateComplimentaryCode();
  assert.match(code, /^RUV-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/);
  assert.equal(normaliseComplimentaryCode(code.toLowerCase()), code.replaceAll("-", ""));
  assert.equal(hashComplimentaryCode(code), hashComplimentaryCode(code.toLowerCase().replaceAll("-", " ")));
  assert.equal(complimentaryCodeSuffix(code), code.slice(-4));
  assert.notEqual(hashComplimentaryCode(code), code);
});

test("only organisation owners and managers can redeem a complimentary code", () => {
  assert.equal(canRedeemComplimentaryAccess("OWNER"), true);
  assert.equal(canRedeemComplimentaryAccess("MANAGER"), true);
  assert.equal(canRedeemComplimentaryAccess("CONTENT_EDITOR"), false);
  assert.equal(canRedeemComplimentaryAccess("VIEWER"), false);
  assert.equal(canRedeemComplimentaryAccess("STUDENT"), false);
});

test("an active complimentary tier overrides billing without becoming a trial", () => {
  const subscription = {
    status: "SUSPENDED",
    plan: { ...tier, name: "Normal plan", code: "NORMAL", stationLimit: 1 },
    schoolRadioEnabled: false,
    retailMediaEnabled: false,
    digitalSignageEnabled: false,
    complimentaryAccessActive: true,
    complimentaryAccessActivatedAt: new Date("2026-09-02T18:00:00.000Z"),
    ...complimentaryPlanSnapshot(tier)
  };
  const entitlements = resolveEntitlements(subscription);
  assert.equal(entitlements.serviceEnabled, true);
  assert.equal(entitlements.accessReason, "COMPLIMENTARY_ACCESS");
  assert.equal(entitlements.complimentaryAccess, true);
  assert.equal(entitlements.planName, "Premium");
  assert.equal(entitlements.stationLimit, 5);
  assert.equal(entitlements.streamLimit, 5);
  assert.equal(entitlements.listenerLimit, 500);
  assert.equal(entitlements.schoolRadioEnabled, true);
  assert.equal(entitlements.retailMediaEnabled, true);
  assert.equal(entitlements.digitalSignageEnabled, true);
});

test("stopping complimentary access clears every override and restores normal billing rules", () => {
  const active = {
    status: "SUSPENDED",
    plan: tier,
    complimentaryAccessActive: true,
    ...complimentaryPlanSnapshot(tier)
  };
  assert.equal(resolveComplimentaryPlan(active)?.name, "Premium");
  const stopped = { ...active, ...clearComplimentaryAccess() };
  assert.equal(resolveComplimentaryPlan(stopped), null);
  assert.equal(resolveEntitlements(stopped).serviceEnabled, false);
  assert.equal(resolveEntitlements(stopped).stationLimit, 0);
});

test("inactive tiers cannot be snapshotted for complimentary access", () => {
  assert.throws(() => complimentaryPlanSnapshot({ ...tier, active: false }), /active tier/i);
});

test("complimentary tiers identify the product dashboards they unlock", () => {
  assert.deepEqual(complimentaryPlanProducts(tier), ["Retail Radio", "Online Radio", "School Radio"]);
  assert.deepEqual(complimentaryPlanProducts({ ...tier, promoUploadEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false, schoolRadioEnabled: false }), ["Online Radio"]);
});
