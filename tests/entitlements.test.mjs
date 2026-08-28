import test from "node:test";
import assert from "node:assert/strict";

import {
  isWithinLimit,
  resolveEntitlements
} from "../lib/entitlements.mjs";

const plan = {
  active: true,
  code: "BUSINESS",
  stationLimit: 5,
  storageLimitGb: 20,
  listenerLimit: 200,
  maxBitrateKbps: 192,
  includesRuvanasCatalogue: true,
  promoUploadEnabled: true,
  schoolRadioEnabled: true
};

test("active and trial subscriptions receive plan entitlements", () => {
  for (const status of ["TRIAL", "ACTIVE", "PAST_DUE"]) {
    const entitlements = resolveEntitlements({ status, plan });
    assert.equal(entitlements.serviceEnabled, true);
    assert.equal(entitlements.stationLimit, 5);
    assert.equal(entitlements.promoUploadEnabled, true);
    assert.equal(entitlements.schoolRadioEnabled, true);
  }
});

test("a configured overdue subscription only works inside its grace period", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  const duringGrace = resolveEntitlements({
    status: "PAST_DUE",
    plan,
    billingContract: { graceEndsAt: "2026-09-12T12:00:00.000Z" }
  }, now);
  const afterGrace = resolveEntitlements({
    status: "PAST_DUE",
    plan,
    billingContract: { graceEndsAt: "2026-09-09T12:00:00.000Z" }
  }, now);

  assert.equal(duringGrace.serviceEnabled, true);
  assert.equal(duringGrace.accessReason, "PAYMENT_GRACE_PERIOD");
  assert.equal(afterGrace.serviceEnabled, false);
  assert.equal(afterGrace.accessReason, "PAYMENT_GRACE_EXPIRED");
  assert.equal(afterGrace.stationLimit, 0);
});

test("legacy overdue subscriptions retain access until a billing contract is attached", () => {
  const entitlements = resolveEntitlements({ status: "PAST_DUE", plan });
  assert.equal(entitlements.serviceEnabled, true);
  assert.equal(entitlements.accessReason, "LEGACY_PAST_DUE_ACCESS");
});

test("an organisation subscription can override the shared School Radio plan default", () => {
  assert.equal(
    resolveEntitlements({
      status: "ACTIVE",
      schoolRadioEnabled: false,
      plan
    }).schoolRadioEnabled,
    false
  );
  assert.equal(
    resolveEntitlements({
      status: "ACTIVE",
      schoolRadioEnabled: true,
      plan: { ...plan, schoolRadioEnabled: false }
    }).schoolRadioEnabled,
    true
  );
});

test("suspended, cancelled, missing, and inactive plans deny service", () => {
  for (const subscription of [
    { status: "SUSPENDED", plan },
    { status: "CANCELLED", plan },
    { status: "ACTIVE", plan: { ...plan, active: false } },
    null
  ]) {
    const entitlements = resolveEntitlements(subscription);
    assert.equal(entitlements.serviceEnabled, false);
    assert.equal(entitlements.stationLimit, 0);
    assert.equal(entitlements.promoUploadEnabled, false);
    assert.equal(entitlements.schoolRadioEnabled, false);
  }
});

test("limit checks stop at the configured boundary", () => {
  assert.equal(isWithinLimit(4, 5), true);
  assert.equal(isWithinLimit(5, 5), false);
  assert.equal(isWithinLimit(6, 5), false);
});


