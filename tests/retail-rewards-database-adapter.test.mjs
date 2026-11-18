import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createRewardsDatabaseAdapter } from "../lib/retail-rewards/database-adapter.mjs";
import { requireRetailRewardsAccess } from "../lib/retail-rewards/access.mjs";

const NOW = new Date("2026-11-13T10:00:00Z");
const START = new Date("2000-01-01T00:00:00Z"), END = new Date("2099-01-01T00:00:00Z");
const env = { RUVANAS_RETAIL_REWARDS_ENABLED: "true" };
const stateScope = { organisationId: "org-one", subscriptionId: "sub-one" };
const staffScope = { organisationId: "org-one", organisationMemberId: "member-one" };
const locationScope = { organisationId: "org-one", locationId: "shop-one" };

function fixture(role = "OWNER") {
  const member = { id: "member-one", organisationId: "org-one", userId: "user-one", role };
  const subscription = { id: "sub-one", organisationId: "org-one", status: "ACTIVE",
    plan: { code: "RETAIL_START", active: true, retailRadioEnabled: true } };
  const context = { session: { id: "session-one", userId: "user-one", activeOrganisationId: "org-one",
    authMethod: "PASSWORD", revokedAt: null, expiresAt: END }, user: { id: "user-one", role },
    membership: { ...member, organisation: { id: "org-one", subscription } }, memberships: [member] };
  const data = {
    program: { id: "program-one", organisationId: "org-one", status: "ACTIVE" },
    grant: { id: "grant-one", ...stateScope, capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL",
      tier: "REWARDS_STARTER", status: "ACTIVE", startsAt: START, expiresAt: END, revokedAt: null,
      limitsVersion: 1, activeOffers: 2, locations: 2, staffSeats: 3, monthlyRedemptions: 20,
      analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false },
    staff: [{ id: "staff-one", ...staffScope, scope: "LOCATIONS", locationId: "shop-one",
      capabilities: ["READ", "REDEEM"], startsAt: START, expiresAt: END, revokedAt: null }],
    location: { id: "shop-one", organisationId: "org-one", status: "ACTIVE" }
  };
  const calls = [];
  const db = {
    rewardProgram: { findFirst: async query => { calls.push(["program", query]); return data.program; } },
    rewardEntitlementGrant: { findFirst: async query => { calls.push(["grant", query]); return data.grant; } },
    rewardStaffGrant: { findMany: async query => { calls.push(["staff", query]); return data.staff; } },
    location: { findFirst: async query => { calls.push(["location", query]); return data.location; } }
  };
  const adapter = createRewardsDatabaseAdapter(db);
  const dependencies = { ...adapter, env, clock: () => NOW,
    loadContext: async () => { calls.push(["context"]); return context; } };
  return { context, data, db, adapter, dependencies, calls };
}

test("adapter construction and the disabled guard make no authentication or database calls", async () => {
  const db = new Proxy({}, { get() { throw new Error("Database must not be touched while off"); } });
  const adapter = createRewardsDatabaseAdapter(db);
  for (const off of [{}, { RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { RUVANAS_RETAIL_REWARDS_ENABLED: true }]) {
    const result = await requireRetailRewardsAccess({ action: "READ" }, {
      ...adapter, env: off, loadContext() { throw new Error("Authentication must not be loaded while off"); }
    });
    assert.equal(result.code, "FEATURE_DISABLED");
  }
});

test("adapter rejects malformed or extra scope fields before querying", async () => {
  for (const [method, values] of [
    ["loadRewardsState", [null, {}, { ...stateScope, organisationId: "../other" }, { ...stateScope, subscriptionId: 1 }, { ...stateScope, enabled: true }]],
    ["loadStaffGrants", [null, {}, { ...staffScope, organisationMemberId: "" }, { ...staffScope, scope: "ALL_LOCATIONS" }]],
    ["loadLocation", [null, {}, { ...locationScope, organisationId: " org-one " }, { ...locationScope, active: true }]]
  ]) {
    for (const input of values) {
      const f = fixture();
      await assert.rejects(f.adapter[method](input), { message: "Rewards database projection unavailable." });
      assert.deepEqual(f.calls, []);
    }
  }
});

test("state reads use exact tenant and subscription filters with explicit narrow projections", async () => {
  const f = fixture();
  const result = await f.adapter.loadRewardsState(stateScope);
  assert.deepEqual(f.calls, [
    ["program", { where: { organisationId: "org-one" }, select: { id: true, organisationId: true, status: true } }],
    ["grant", { where: stateScope, select: {
      id: true, organisationId: true, subscriptionId: true, capability: true, source: true, tier: true,
      status: true, startsAt: true, expiresAt: true, revokedAt: true, limitsVersion: true, activeOffers: true,
      locations: true, staffSeats: true, monthlyRedemptions: true, analyticsRetentionDays: true,
      exportEnabled: true, brandingEnabled: true
    } }]
  ]);
  assert.deepEqual(result.program, f.data.program);
  assert.deepEqual(result.grant.limits, { activeOffers: 2, locations: 2, staffSeats: 3,
    monthlyRedemptions: 20, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false });
  assert.equal(Object.hasOwn(result.grant, "limitsVersion"), false);
  assert.equal(Object.hasOwn(result.grant, "staffSeats"), false);
  assert.equal(result.grant.startsAt instanceof Date, true);
  assert.equal(result.grant.startsAt.getTime(), START.getTime());
});

test("missing Rewards rows confer no authority and are never provisioned by reads", async () => {
  for (const missing of ["program", "grant", "both"]) {
    const f = fixture();
    if (missing !== "grant") f.data.program = null;
    if (missing !== "program") f.data.grant = null;
    const state = await f.adapter.loadRewardsState(stateScope);
    assert.equal(state.program === null, missing !== "grant");
    assert.equal(state.grant === null, missing !== "program");
    assert.equal((await requireRetailRewardsAccess({ action: "READ" }, f.dependencies)).code, "NOT_ENTITLED");
    assert.equal(f.calls.every(([name]) => ["context", "program", "grant"].includes(name)), true);
  }
});

test("foreign, malformed and unsupported state projections fail closed without coercion", async () => {
  for (const mutate of [
    f => { f.data.program.organisationId = "org-two"; },
    f => { f.data.program.networkOptIn = true; },
    f => { f.data.program.status = "active"; },
    f => { f.data.grant.organisationId = "org-two"; },
    f => { f.data.grant.subscriptionId = "sub-two"; },
    f => { f.data.grant.limitsVersion = 2; },
    f => { delete f.data.grant.limitsVersion; },
    f => { f.data.grant.staffSeats = "3"; },
    f => { f.data.grant.exportEnabled = "false"; },
    f => { f.data.grant.activeOffers = -1; },
    f => { f.data.grant.source = "CLIENT_BODY"; },
    f => { f.data.grant.startsAt = START.toISOString(); },
    f => { f.data.grant.expiresAt = START; },
    f => { f.data.grant.expiresAt = new Date(NaN); },
    f => { f.data.grant.revokedAt = undefined; },
    f => { f.data.grant.extraSecret = "sensitive-test-value"; },
    f => { f.data.grant = undefined; }
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.adapter.loadRewardsState(stateScope), { message: "Rewards database projection unavailable." });
    assert.equal((await requireRetailRewardsAccess({ action: "READ" }, f.dependencies)).code, "UNAVAILABLE");
  }
});

test("staff reads preserve action-specific per-location grants and explicit all-location scope", async () => {
  const f = fixture("VIEWER");
  f.data.staff.push({ ...f.data.staff[0], id: "staff-all", scope: "ALL_LOCATIONS", locationId: null, capabilities: ["READ"] });
  const rows = await f.adapter.loadStaffGrants(staffScope);
  assert.deepEqual(f.calls[0], ["staff", { where: staffScope, select: {
    id: true, organisationId: true, organisationMemberId: true, capabilities: true,
    scope: true, locationId: true, startsAt: true, expiresAt: true, revokedAt: true
  }, orderBy: { id: "asc" }, take: 1001 }]);
  assert.deepEqual(rows[0].locationIds, ["shop-one"]);
  assert.deepEqual(rows[1].locationIds, []);
  assert.equal(Object.hasOwn(rows[0], "locationId"), false);
  const read = await requireRetailRewardsAccess({ action: "READ" }, f.dependencies);
  assert.deepEqual(read.locationScope, { kind: "ALL_LOCATIONS", locationIds: [] });
  const redeem = await requireRetailRewardsAccess({ action: "REDEEM", locationId: "shop-one" }, f.dependencies);
  assert.equal(redeem.ok, true);
  assert.deepEqual(redeem.locationScope, { kind: "LOCATIONS", locationIds: ["shop-one"] });
  assert.equal((await requireRetailRewardsAccess({ action: "REDEEM", locationId: "shop-two" }, f.dependencies)).code, "LOCATION_UNAVAILABLE");
});

test("foreign, malformed and duplicate staff rows fail closed", async () => {
  for (const mutate of [
    f => { f.data.staff[0].organisationId = "org-two"; },
    f => { f.data.staff[0].organisationMemberId = "member-two"; },
    f => { f.data.staff[0].scope = "ALL_LOCATIONS"; },
    f => { f.data.staff[0].locationId = null; },
    f => { f.data.staff[0].capabilities = []; },
    f => { f.data.staff[0].capabilities = ["READ", "READ"]; },
    f => { f.data.staff[0].capabilities = ["ADMIN"]; },
    f => { f.data.staff[0].capabilities = ["READ", null]; },
    f => { f.data.staff[0].expiresAt = START; },
    f => { f.data.staff[0].locationId = "../shop"; },
    f => { f.data.staff.push({ ...f.data.staff[0] }); },
    f => { f.data.staff[0].locationIds = ["shop-two"]; },
    f => { f.data.staff = null; }
  ]) {
    const f = fixture("VIEWER"); mutate(f);
    await assert.rejects(f.adapter.loadStaffGrants(staffScope), { message: "Rewards database projection unavailable." });
    assert.equal((await requireRetailRewardsAccess({ action: "READ" }, f.dependencies)).code, "UNAVAILABLE");
  }
});

test("staff overflow is rejected rather than truncated; the 1000-row guard bound remains valid", async () => {
  const f = fixture("VIEWER");
  const row = f.data.staff[0];
  f.data.staff = Array.from({ length: 1000 }, (_, index) => ({ ...row, id: `staff-${index}`, locationId: `shop-${index}` }));
  assert.equal((await f.adapter.loadStaffGrants(staffScope)).length, 1000);
  f.data.staff.push({ ...row, id: "staff-overflow" });
  await assert.rejects(f.adapter.loadStaffGrants(staffScope), { message: "Rewards database projection unavailable." });
  assert.equal((await requireRetailRewardsAccess({ action: "READ" }, f.dependencies)).code, "UNAVAILABLE");
});

test("location reads require exact tenant and active status; missing, foreign and inactive share one response", async () => {
  const f = fixture();
  assert.deepEqual(await f.adapter.loadLocation(locationScope), f.data.location);
  assert.deepEqual(f.calls[0], ["location", { where: { id: "shop-one", organisationId: "org-one", status: "ACTIVE" },
    select: { id: true, organisationId: true, status: true } }]);
  const results = [];
  for (const row of [null, { ...f.data.location, id: "shop-two" }, { ...f.data.location, organisationId: "org-two" },
    { ...f.data.location, status: "CLOSED" }, { ...f.data.location, status: "DRAFT" }, { ...f.data.location, status: "PAUSED" }]) {
    const current = fixture(); current.data.location = row;
    assert.equal(await current.adapter.loadLocation(locationScope), null);
    results.push(await requireRetailRewardsAccess({ action: "REDEEM", locationId: "shop-one" }, current.dependencies));
  }
  assert.equal(results[0].code, "LOCATION_UNAVAILABLE");
  assert.equal(results.every(row => JSON.stringify(row) === JSON.stringify(results[0])), true);
});

test("adapter policy integration denies removed authority and selected-tenant mismatches before scope expansion", async () => {
  const f = fixture("VIEWER");
  assert.equal((await requireRetailRewardsAccess({ action: "REDEEM", locationId: "shop-one" }, f.dependencies)).ok, true);
  f.data.staff = [];
  assert.equal((await requireRetailRewardsAccess({ action: "REDEEM", locationId: "shop-one" }, f.dependencies)).code, "FORBIDDEN");
  const mismatch = fixture();
  mismatch.context.session.activeOrganisationId = "org-two";
  assert.equal((await requireRetailRewardsAccess({ action: "READ" }, mismatch.dependencies)).code, "FORBIDDEN");
  assert.deepEqual(mismatch.calls, [["context"]]);
  const preview = fixture(); preview.context.session.authMethod = "PREVIEW_PASSWORD";
  assert.equal((await requireRetailRewardsAccess({ action: "READ" }, preview.dependencies)).code, "UNAUTHENTICATED");
  assert.deepEqual(preview.calls, [["context"]]);
});

test("database exceptions are sanitized by the policy boundary", async () => {
  const f = fixture();
  f.db.rewardEntitlementGrant.findFirst = async () => { throw new Error("postgresql://secret@example.invalid/database"); };
  const result = await requireRetailRewardsAccess({ action: "READ" }, f.dependencies);
  assert.equal(result.code, "UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /secret|example\.invalid|postgresql/);
});

const require = createRequire(import.meta.url);
const babel = require("next/dist/compiled/babel/core");
const serverSource = babel.transformSync(readFileSync(new URL("../lib/retail-rewards/server-access.js", import.meta.url), "utf8"), {
  filename: "server-access.js", babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
}).code;
function serverWrapper(f, environment) {
  const module = { exports: {} };
  const imports = {
    "@/lib/auth": { getActiveOrganisationContext: async include => {
      assert.deepEqual(JSON.parse(JSON.stringify(include)), { subscription: { include: { plan: true, billingContract: true } } });
      f.calls.push(["context"]); return f.context;
    } },
    "@/lib/prisma": { prisma: f.db },
    "./access.mjs": { requireRetailRewardsAccess },
    "./database-adapter.mjs": { createRewardsDatabaseAdapter }
  };
  vm.runInNewContext(serverSource, { module, exports: module.exports, process: { env: environment },
    require: name => {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`);
      throw new Error(`Unexpected server import: ${name}`);
    } });
  return module.exports.requireRetailRewardsServerAccess;
}

test("server wrapper uses existing current context, preserves its subscription, and defaults off", async () => {
  const off = fixture();
  assert.equal((await serverWrapper(off, {})({ action: "READ" })).code, "FEATURE_DISABLED");
  assert.deepEqual(off.calls, []);
  const on = fixture();
  const subscription = on.context.membership.organisation.subscription;
  const result = await serverWrapper(on, env)({ action: "READ" });
  assert.equal(result.ok, true);
  assert.equal(result.organisationId, "org-one");
  assert.equal(on.context.membership.organisation.subscription, subscription);
  assert.deepEqual(on.calls.map(([name]) => name), ["context", "program", "grant"]);
  const forged = fixture();
  assert.equal((await serverWrapper(forged, env)({ action: "READ", organisationId: "org-two" })).code, "INVALID_REQUEST");
  assert.deepEqual(forged.calls, []);
});
