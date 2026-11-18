import test from "node:test";
import assert from "node:assert/strict";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { resolveRewardsEntitlements, checkRewardsCapacity } from "../lib/retail-rewards/entitlements.mjs";

const now = new Date("2026-11-13T12:00:00.000Z");
const denied = { allowed: false, code: "NOT_ENTITLED" };
const malformed = { allowed: false, code: "INVALID_REQUEST" };
const exhausted = { allowed: false, code: "LIMIT_REACHED" };
function fixture() {
  return {
    organisationId: "org_1", action: "READ", now: new Date(now),
    subscription: { id: "subscription_1", organisationId: "org_1", status: "ACTIVE",
      plan: { active: true, code: "RETAIL_STARTER", productFamily: "RETAIL", retailRadioEnabled: true,
        stationLimit: 1, storageLimitGb: 5, listenerLimit: 10, maxBitrateKbps: 192,
        licensedMusicCatalogueLevel: "FOCUSED", includesRuvanasCatalogue: true } },
    grant: { id: "grant_1", organisationId: "org_1", subscriptionId: "subscription_1",
      capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "ACTIVE",
      startsAt: new Date("2026-11-01T00:00:00.000Z"), expiresAt: new Date("2026-12-01T00:00:00.000Z"), revokedAt: null,
      limits: { activeOffers: 3, locations: 2, staffSeats: 4, monthlyRedemptions: 100,
        analyticsRetentionDays: 30, exportEnabled: true, brandingEnabled: false } },
    program: { id: "program_1", organisationId: "org_1", status: "ACTIVE" }
  };
}

test("explicit active and trial grants work for all four Rewards tier identifiers without implied tier limits", () => {
  for (const tier of ["REWARDS_STARTER", "REWARDS_PRO", "REWARDS_BUSINESS", "REWARDS_ENTERPRISE"]) {
    for (const status of ["ACTIVE", "TRIAL"]) {
      const input = fixture();
      input.grant.tier = tier;
      input.grant.status = status;
      input.subscription.status = status;
      assert.deepEqual(resolveRewardsEntitlements(input), { allowed: true, tier, limits: input.grant.limits });
    }
  }
});

test("Rewards grant states deny every action outside active and trial, including read-only access", () => {
  for (const status of ["DISABLED", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED", "UNKNOWN", "active", null]) {
    for (const action of ["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS", "REDEEM", "REVERSE", "VIEW_INSIGHTS", "EXPORT", "MANAGE_STAFF"]) {
      const input = fixture();
      input.grant.status = status;
      input.action = action;
      assert.deepEqual(resolveRewardsEntitlements(input), denied, `${status}/${action}`);
    }
  }
});

test("subscription lapse never inherits either indefinite legacy access or billing grace", () => {
  for (const status of ["DISABLED", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED", "UNKNOWN", "active", null]) {
    for (const billingContract of [undefined, { graceEndsAt: new Date("2026-12-10T00:00:00Z") }]) {
      const input = fixture();
      input.subscription.status = status;
      input.subscription.billingContract = billingContract;
      if (status === "PAST_DUE") assert.equal(resolveEntitlements(input.subscription, now).serviceEnabled, true);
      assert.deepEqual(resolveRewardsEntitlements(input), denied);
    }
  }
});

test("program activation is independent of the add-on grant", () => {
  for (const program of [null, undefined, {}, { ...fixture().program, status: "DISABLED" },
    { ...fixture().program, status: "PAUSED" }, { ...fixture().program, status: "UNKNOWN" }]) {
    assert.deepEqual(resolveRewardsEntitlements({ ...fixture(), program }), denied);
  }
});

test("missing add-on grants never follow ordinary, overridden, complimentary or test subscription access", () => {
  const subscriptions = [fixture().subscription,
    { ...fixture().subscription, retailRadioEnabled: true },
    { ...fixture().subscription, subscriberTestPlanSnapshot: { plan: { retailRadioEnabled: true } } },
    { ...fixture().subscription, complimentaryAccessActive: true, complimentaryPlanName: "Retail test",
      complimentaryPlanCode: "RETAIL_STARTER", complimentaryStationLimit: 1, complimentaryStorageLimitGb: 5,
      complimentaryListenerLimit: 10, complimentaryMaxBitrateKbps: 192, complimentaryRetailRadioEnabled: true }];
  for (const subscription of subscriptions) {
    assert.equal(resolveEntitlements(subscription, now).retailRadioEnabled, true);
    for (const grant of [undefined, null, {}]) {
      for (const action of ["READ", "REDEEM", "EXPORT"]) {
        assert.deepEqual(resolveRewardsEntitlements({ ...fixture(), subscription, grant, action }), denied);
      }
    }
  }
});

test("tenant and subscription identities must match across all policy projections", () => {
  for (const [section, field] of [[null, "organisationId"], ["subscription", "id"], ["subscription", "organisationId"],
    ["grant", "organisationId"], ["grant", "subscriptionId"], ["program", "organisationId"]]) {
    for (const wrongId of ["foreign_1", "", null, 12, undefined]) {
      const input = fixture();
      (section ? input[section] : input)[field] = wrongId;
      assert.deepEqual(resolveRewardsEntitlements(input), denied, `${section}/${field}`);
    }
  }
});

test("grant start is inclusive, expiry is exclusive and any revocation denies", () => {
  const input = fixture();
  assert.equal(resolveRewardsEntitlements({ ...input, now: new Date(input.grant.startsAt) }).allowed, true);
  assert.deepEqual(resolveRewardsEntitlements({ ...input, now: new Date(input.grant.startsAt.getTime() - 1) }), denied);
  assert.equal(resolveRewardsEntitlements({ ...input, now: new Date(input.grant.expiresAt.getTime() - 1) }).allowed, true);
  assert.deepEqual(resolveRewardsEntitlements({ ...input, now: new Date(input.grant.expiresAt) }), denied);
  for (const revokedAt of [new Date(now.getTime() - 1), now, new Date(now.getTime() + 1)]) {
    assert.deepEqual(resolveRewardsEntitlements({ ...input, grant: { ...input.grant, revokedAt } }), denied);
  }
  for (const invalidNow of [undefined, null, now.toISOString(), now.getTime(), new Date(NaN)]) {
    assert.deepEqual(resolveRewardsEntitlements({ ...input, now: invalidNow }), denied);
  }
});

test("Retail eligibility is required and malformed truthy core inputs cannot enable Rewards", () => {
  const base = fixture().subscription;
  for (const subscription of [null, undefined, [], {}, { ...base, plan: null },
    { ...base, plan: { ...base.plan, active: false } },
    { ...base, plan: { ...base.plan, active: "true" } },
    { ...base, plan: { ...base.plan, retailRadioEnabled: false } },
    { ...base, plan: { ...base.plan, retailRadioEnabled: "true" } },
    { ...base, plan: { ...base.plan, retailRadioEnabled: undefined } },
    { ...base, retailRadioEnabled: false }, { ...base, retailRadioEnabled: "false" },
    { ...base, complimentaryAccessActive: "true" },
    { ...base, complimentaryAccessActive: true, complimentaryRetailRadioEnabled: "true" }]) {
    assert.deepEqual(resolveRewardsEntitlements({ ...fixture(), subscription }), denied);
  }
  assert.equal(resolveRewardsEntitlements({ ...fixture(), subscription: { ...base, retailRadioEnabled: true,
    plan: { ...base.plan, retailRadioEnabled: false } } }).allowed, true);
  assert.equal(resolveRewardsEntitlements({ ...fixture(), subscription: { ...base, retailRadioEnabled: null,
    unrelatedExistingColumn: "retained" } }).allowed, true);
});

test("zero limits deny their operations while retaining read-only eligibility", () => {
  for (const [field, action] of [["activeOffers", "PUBLISH_OFFERS"], ["monthlyRedemptions", "REDEEM"],
    ["locations", "REDEEM"], ["staffSeats", "REDEEM"], ["analyticsRetentionDays", "VIEW_INSIGHTS"],
    ["analyticsRetentionDays", "EXPORT"]]) {
    const input = fixture();
    input.grant.limits[field] = 0;
    assert.equal(resolveRewardsEntitlements(input).allowed, true);
    assert.deepEqual(resolveRewardsEntitlements({ ...input, action }), denied, `${field}/${action}`);
  }
  const input = fixture();
  input.grant.limits.exportEnabled = false;
  assert.equal(resolveRewardsEntitlements({ ...input, action: "VIEW_INSIGHTS" }).allowed, true);
  assert.deepEqual(resolveRewardsEntitlements({ ...input, action: "EXPORT" }), denied);
  for (const action of ["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS", "REDEEM", "REVERSE", "VIEW_INSIGHTS", "EXPORT", "MANAGE_STAFF"]) {
    assert.equal(resolveRewardsEntitlements({ ...fixture(), action }).allowed, true);
  }
});

test("unknown actions, fields, tiers and incomplete or malformed limit projections fail closed", () => {
  for (const action of [undefined, "read", "CLAIM", "PUBLISH", {}, true]) {
    assert.deepEqual(resolveRewardsEntitlements({ ...fixture(), action }), denied);
  }
  for (const input of [undefined, null, [], {}, { ...fixture(), enabled: true },
    { ...fixture(), grant: { ...fixture().grant, source: "BILLING" } },
    { ...fixture(), grant: { ...fixture().grant, tier: "REWARDS_UNKNOWN" } },
    { ...fixture(), grant: { ...fixture().grant, expiresAt: undefined } },
    { ...fixture(), grant: { ...fixture().grant, limits: { activeOffers: 5 } } }]) {
    assert.deepEqual(resolveRewardsEntitlements(input), denied);
  }
  for (const invalid of [NaN, Infinity, -1, 1.5, "10", null, Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture();
    input.grant.limits.monthlyRedemptions = invalid;
    assert.deepEqual(resolveRewardsEntitlements(input), denied);
  }
  const getter = { get grant() { throw new Error("private source error"); } };
  assert.deepEqual(resolveRewardsEntitlements(getter), denied);
});

test("resolver results expose only immutable limits and tier and never mutate inputs or existing Retail entitlements", () => {
  const input = fixture();
  const before = structuredClone(input);
  const retailBefore = resolveEntitlements(input.subscription, input.now);
  const result = resolveRewardsEntitlements(input);
  assert.deepEqual(input, before);
  assert.deepEqual(resolveEntitlements(input.subscription, input.now), retailBefore);
  assert.deepEqual(Object.keys(result).sort(), ["allowed", "limits", "tier"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.limits), true);
  assert.notEqual(result.limits, input.grant.limits);
  input.grant.limits.monthlyRedemptions = 999;
  assert.equal(result.limits.monthlyRedemptions, 100);
  assert.equal(Object.isFrozen(resolveRewardsEntitlements(null)), true);
  assert.deepEqual(resolveRewardsEntitlements({ ...fixture(), grant: null }), denied);
});

test("capacity allows exactly the requested remaining capacity and never reserves or mutates usage", () => {
  for (const resource of ["activeOffers", "locations", "staffSeats", "monthlyRedemptions"]) {
    const limits = fixture().grant.limits;
    limits[resource] = 5;
    const input = { limits, resource, used: 3, increment: 2 };
    const before = structuredClone(input);
    assert.deepEqual(checkRewardsCapacity(input), { allowed: true });
    assert.deepEqual(checkRewardsCapacity(input), { allowed: true });
    assert.deepEqual(input, before);
    assert.deepEqual(checkRewardsCapacity({ ...input, increment: 3 }), exhausted);
    assert.deepEqual(checkRewardsCapacity({ ...input, used: 4, increment: undefined }), { allowed: true });
    assert.deepEqual(checkRewardsCapacity({ ...input, used: 5, increment: 1 }), exhausted);
    assert.deepEqual(checkRewardsCapacity({ ...input, used: 6, increment: 1 }), exhausted);
    assert.deepEqual(checkRewardsCapacity({ ...input, limits: { ...limits, [resource]: 0 }, used: 0 }), exhausted);
  }
});

test("capacity rejects unknown and nonnumeric resources, absent limits and unsafe arithmetic inputs", () => {
  const input = { limits: fixture().grant.limits, resource: "monthlyRedemptions", used: 0 };
  for (const resource of [undefined, null, 1, "__proto__", "constructor", "analyticsRetentionDays", "exportEnabled", "brandingEnabled"]) {
    assert.deepEqual(checkRewardsCapacity({ ...input, resource }), malformed);
  }
  for (const limits of [undefined, null, {}, { monthlyRedemptions: 100 },
    { ...input.limits, monthlyRedemptions: "100" }, { ...input.limits, unlimited: true }]) {
    assert.deepEqual(checkRewardsCapacity({ ...input, limits }), malformed);
  }
  for (const used of [undefined, null, "0", -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(checkRewardsCapacity({ ...input, used }), malformed);
  }
  for (const increment of [null, "1", 0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(checkRewardsCapacity({ ...input, increment }), malformed);
  }
  for (const invalid of [undefined, null, [], {}, { ...input, override: true }]) {
    assert.deepEqual(checkRewardsCapacity(invalid), malformed);
  }
  assert.deepEqual(checkRewardsCapacity({ ...input, used: Number.MAX_SAFE_INTEGER, increment: Number.MAX_SAFE_INTEGER }), exhausted);
  assert.deepEqual(checkRewardsCapacity({ ...input, limits: { ...input.limits, monthlyRedemptions: 1_000_000_000 },
    used: 999_999_999 }), { allowed: true });
  assert.equal(Object.isFrozen(checkRewardsCapacity(input)), true);
});
