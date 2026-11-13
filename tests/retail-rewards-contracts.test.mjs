import test from "node:test";
import assert from "node:assert/strict";
import { REWARDS_ACTIONS, rewardActionSchema, rewardIdSchema, rewardGrantSchema,
  rewardLimitsSchema, rewardProgramSchema, rewardStaffGrantSchema } from "../lib/retail-rewards/contracts.mjs";

const startsAt = new Date("2026-11-01T00:00:00.000Z");
const expiresAt = new Date("2026-12-01T00:00:00.000Z");
const limits = { activeOffers: 3, locations: 2, staffSeats: 4, monthlyRedemptions: 100,
  analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false };
const grant = { id: "grant_1", organisationId: "org_1", subscriptionId: "subscription_1",
  capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "ACTIVE",
  startsAt, expiresAt, revokedAt: null, limits };
const program = { id: "program_1", organisationId: "org_1", status: "ACTIVE" };
const staffGrant = { id: "staff_grant_1", organisationId: "org_1", organisationMemberId: "member_1",
  capabilities: ["READ", "REDEEM"], scope: "LOCATIONS", locationIds: ["location_1"],
  startsAt, expiresAt, revokedAt: null };

test("Rewards action and identifier contracts are bounded and exact", () => {
  assert.deepEqual(REWARDS_ACTIONS, ["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS", "REDEEM",
    "REVERSE", "VIEW_INSIGHTS", "EXPORT", "MANAGE_STAFF"]);
  assert.equal(Object.isFrozen(REWARDS_ACTIONS), true);
  for (const value of REWARDS_ACTIONS) assert.equal(rewardActionSchema.safeParse(value).success, true);
  for (const value of ["", "read", " READ", "CLAIM", true, 1, null]) {
    assert.equal(rewardActionSchema.safeParse(value).success, false);
  }
  for (const value of ["a", "A09_-", "a".repeat(191)]) assert.equal(rewardIdSchema.safeParse(value).success, true);
  for (const value of ["", "a".repeat(192), " a", "a ", "a.b", "a/b", "a\nb", "é", "-a", "_a", 1, null]) {
    assert.equal(rewardIdSchema.safeParse(value).success, false);
  }
});

test("grant, program and staff projections require every field and reject unknown fields", () => {
  for (const [schema, value] of [[rewardGrantSchema, grant], [rewardProgramSchema, program],
    [rewardStaffGrantSchema, staffGrant], [rewardLimitsSchema, limits]]) {
    assert.equal(schema.safeParse(value).success, true);
    assert.equal(schema.safeParse({ ...value, role: "SUPER_ADMIN" }).success, false);
    for (const key of Object.keys(value)) {
      const incomplete = { ...value };
      delete incomplete[key];
      assert.equal(schema.safeParse(incomplete).success, false, key);
    }
    for (const malformed of [undefined, null, [], true, "ACTIVE", 1]) {
      assert.equal(schema.safeParse(malformed).success, false);
    }
  }
  assert.equal(rewardGrantSchema.safeParse({ ...grant, limits: { ...limits, unlimited: true } }).success, false);
});

test("grant source, tier, capability and lifecycle values cannot imply billing or default permissions", () => {
  for (const tier of ["REWARDS_STARTER", "REWARDS_PRO", "REWARDS_BUSINESS", "REWARDS_ENTERPRISE"]) {
    assert.equal(rewardGrantSchema.safeParse({ ...grant, tier }).success, true);
  }
  for (const status of ["DISABLED", "TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"]) {
    assert.equal(rewardGrantSchema.safeParse({ ...grant, status }).success, true);
  }
  for (const override of [{ source: "BILLING" }, { source: "MANUAL" }, { source: "manual_internal" },
    { tier: "ENTERPRISE" }, { tier: "RETAIL_ENTERPRISE" }, { tier: "REWARDS_UNKNOWN" },
    { capability: "RETAIL_RADIO" }, { status: "active" }, { status: "GRACE" }]) {
    assert.equal(rewardGrantSchema.safeParse({ ...grant, ...override }).success, false);
  }
  for (const status of ["DISABLED", "ACTIVE", "PAUSED"]) {
    assert.equal(rewardProgramSchema.safeParse({ ...program, status }).success, true);
  }
  assert.equal(rewardProgramSchema.safeParse({ ...program, status: "TRIAL" }).success, false);
});

test("grant windows are finite Date values with an explicit revocation field", () => {
  for (const [schema, value] of [[rewardGrantSchema, grant], [rewardStaffGrantSchema, staffGrant]]) {
    for (const field of ["startsAt", "expiresAt", "revokedAt"]) {
      for (const malformed of ["2026-11-01T00:00:00Z", 0, new Date(NaN), undefined, true]) {
        assert.equal(schema.safeParse({ ...value, [field]: malformed }).success, false, field);
      }
    }
    for (const end of [startsAt, new Date(startsAt.getTime() - 1)]) {
      assert.equal(schema.safeParse({ ...value, expiresAt: end }).success, false);
    }
    assert.equal(schema.safeParse({ ...value, revokedAt: startsAt }).success, true);
  }
});

test("limits are explicit safe bounded integers and actual booleans", () => {
  for (const field of ["activeOffers", "locations", "staffSeats", "monthlyRedemptions", "analyticsRetentionDays"]) {
    for (const valid of [0, 1, 1_000_000_000]) {
      assert.equal(rewardLimitsSchema.safeParse({ ...limits, [field]: valid }).success, true);
    }
    for (const invalid of [-1, 0.5, 1_000_000_001, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "1", null, true]) {
      assert.equal(rewardLimitsSchema.safeParse({ ...limits, [field]: invalid }).success, false, field);
    }
  }
  for (const field of ["exportEnabled", "brandingEnabled"]) {
    for (const invalid of [0, 1, "false", "true", null, undefined]) {
      assert.equal(rewardLimitsSchema.safeParse({ ...limits, [field]: invalid }).success, false, field);
    }
  }
});

test("staff capability and location scope are explicit, unique and bounded", () => {
  assert.equal(rewardStaffGrantSchema.safeParse({ ...staffGrant, capabilities: [...REWARDS_ACTIONS] }).success, true);
  for (const capabilities of [[], ["REDEEM", "REDEEM"], ["REDEEM", "UNKNOWN"],
    [...REWARDS_ACTIONS, "READ"], "REDEEM", null]) {
    assert.equal(rewardStaffGrantSchema.safeParse({ ...staffGrant, capabilities }).success, false);
  }
  assert.equal(rewardStaffGrantSchema.safeParse({ ...staffGrant, scope: "ALL_LOCATIONS", locationIds: [] }).success, true);
  assert.equal(rewardStaffGrantSchema.safeParse({ ...staffGrant, scope: "ALL_LOCATIONS" }).success, false);
  for (const locationIds of [[], ["location_1", "location_1"], [" "], "location_1", null,
    Array.from({ length: 501 }, (_, index) => `location_${index}`)]) {
    assert.equal(rewardStaffGrantSchema.safeParse({ ...staffGrant, locationIds }).success, false);
  }
  assert.equal(rewardStaffGrantSchema.safeParse({ ...staffGrant,
    locationIds: Array.from({ length: 500 }, (_, index) => `location_${index}`) }).success, true);
  assert.equal(rewardStaffGrantSchema.safeParse({ ...staffGrant, scope: "ANY" }).success, false);
});
