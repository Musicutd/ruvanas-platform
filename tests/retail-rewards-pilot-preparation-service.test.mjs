import assert from "node:assert/strict";
import test from "node:test";
import { createPilotPreparationService } from "../lib/retail-rewards/pilot-preparation-service.mjs";
import { authorizePilotPreparationSession, pilotPreparationIsClosed } from "../lib/retail-rewards/pilot-preparation-context.mjs";
import { safePilotPreparationSnapshot } from "../lib/retail-rewards/pilot-preparation-contracts.mjs";

const NOW = new Date("2026-11-19T12:00:00.000Z"), START = new Date("2026-11-18T10:00:00.000Z"), END = new Date("2026-11-18T12:00:00.000Z");
const clone = value => structuredClone(value);
function session() { return { id: "admin-session", userId: "admin-one", authMethod: "PASSWORD", revokedAt: null,
  createdAt: new Date(+NOW - 3600000), lastSeenAt: new Date(+NOW - 60000), expiresAt: new Date(+NOW + 3600000), activeOrganisation: null,
  user: { id: "admin-one", email: "admin@example.invalid", role: "SUPER_ADMIN", privatePreviewAccess: null } }; }
function fixture() {
  return { session: session(), env: { RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, now: NOW,
    organisation: { id: "org-one", name: "Synthetic Rewards Shop", subscription: { id: "sub-one", organisationId: "org-one", status: "TRIAL",
      plan: { id: "plan-one", active: true, code: "RETAIL_START", productFamily: "RETAIL", retailRadioEnabled: true }, billingContract: null } },
    program: { id: "program-one", organisationId: "org-one", status: "ACTIVE", networkOptIn: true, timezone: "Europe/Malta" },
    grant: { id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER",
      status: "TRIAL", startsAt: START, expiresAt: END, revokedAt: null, limitsVersion: 1,
      activeOffers: 3, locations: 1, staffSeats: 1, monthlyRedemptions: 4, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false },
    setups: [{ shopperId: "shopper-one", organisationId: "org-one", createdByUserId: "admin-one", createdAt: START,
      shopper: { id: "shopper-one", status: "DISABLED" } }],
    audits: [
      { organisationId: "org-one", action: "ORDINARY_OWNER_ORGANISATION_CREATED", entityType: "Organisation", entityId: "org-one", actorUserId: "admin-one",
        details: { ownerRole: "OWNER", ownerUserId: "owner-one", planId: "plan-one", subscriptionStatus: "TRIAL" } },
      { organisationId: "org-one", action: "DORMANT_SHOPPER_PREPARED", entityType: "RewardShopper", entityId: "shopper-one", actorUserId: "admin-one",
        details: { shopperId: "shopper-one", status: "DISABLED", accessGranted: false } }
    ],
    members: [{ id: "member-one", organisationId: "org-one", userId: "owner-one", role: "OWNER",
      user: { id: "owner-one", role: "OWNER", privatePreviewAccess: null }, rewardStaffGrants: [] }],
    locations: [{ id: "location-one", organisationId: "org-one", status: "ACTIVE" }], profiles: [], offers: [],
    enrollments: [{ shopperId: "shopper-one", organisationId: "org-one", shopper: { id: "shopper-one", status: "DISABLED", authVersion: 1, credential: null,
      membership: { id: "membership-one", shopperId: "shopper-one", source: "MANUAL_INTERNAL", status: "ACTIVE", startsAt: START, expiresAt: END, revokedAt: null, version: 1 },
      invitation: { id: "invitation-one", shopperId: "shopper-one", authVersion: 1, createdAt: START, expiresAt: END, acceptedAt: null, revokedAt: END } } }]
  };
}
function project(row, select) {
  if (row == null || !select) return clone(row);
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key, value === true || value.include ? clone(row[key]) :
    Array.isArray(row[key]) ? row[key].map(item => project(item, value.select)) : project(row[key], value.select)]));
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => value && typeof value === "object" && "in" in value ? value.in.includes(row[key]) : row[key] === value);
}
function harness(change, hook) {
  const f = fixture(); change?.(f); const calls = [], writes = [];
  const table = (model, read) => ({
    findMany: async args => { calls.push({ model, operation: "findMany", args }); hook?.(model, f, calls);
      return read().filter(row => matches(row, args.where)).slice(0, args.take).map(row => project(row, args.select)); },
    findUnique: async args => { calls.push({ model, operation: "findUnique", args }); hook?.(model, f, calls);
      return project(read().find(row => matches(row, args.where)) || null, args.select); },
    findFirst: async args => { calls.push({ model, operation: "findFirst", args }); hook?.(model, f, calls);
      return project(read().find(row => matches(row, args.where)) || null, args.select); },
    create: async () => { writes.push(model); throw Error("Unexpected mutation"); }, update: async () => { writes.push(model); throw Error("Unexpected mutation"); },
    delete: async () => { writes.push(model); throw Error("Unexpected mutation"); }
  });
  const db = { session: table("session", () => f.session ? [f.session] : []), organisation: table("organisation", () => [f.organisation]),
    rewardProgram: table("rewardProgram", () => [f.program]), rewardEntitlementGrant: table("rewardEntitlementGrant", () => [f.grant]),
    rewardShopperSetup: table("rewardShopperSetup", () => f.setups), auditLog: table("auditLog", () => f.audits),
    organisationMember: table("organisationMember", () => f.members), location: table("location", () => f.locations),
    rewardPublicShopProfile: table("rewardPublicShopProfile", () => f.profiles), rewardOffer: table("rewardOffer", () => f.offers),
    rewardPilotShopperEnrollment: table("rewardPilotShopperEnrollment", () => f.enrollments),
    $queryRaw: async (parts, ...values) => { const sql = parts.join("?"); calls.push({ model: "lock", sql });
      assert.doesNotMatch(sql, /FOR UPDATE|INSERT|DELETE|UPDATE /);
      return /FROM "(?:User|Session)"/.test(sql) ? [{ id: values[0] }] : []; },
    $transaction: async (run, options) => { assert.deepEqual(options, { isolationLevel: "Serializable" }); return run(db); }
  };
  return { f, calls, writes, service: createPilotPreparationService({ db, env: f.env, loadSession: async () => clone(f.session), clock: () => f.now }) };
}

test("closed Rewards preparation uses durable provenance without temporary allowlist or writes", async () => {
  const h = harness(), result = await h.service.inspect({ organisationId: "org-one" });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.readiness.eligibleNow, false);
  assert.equal(result.endToEndTest, "NOT_VERIFIED"); assert.equal(result.readiness.endToEndTest, "NOT_VERIFIED");
  assert.equal(result.readiness.checks[0].code, "FEATURES_DISABLED");
  assert.deepEqual(result.preparedShoppers, { total: 1, disabled: 1, active: 0, suspended: 0, enrolled: 1, expiredMemberships: 1, revokedInvitations: 1 });
  assert.equal(result.grantExpiresAt, END.toISOString()); assert.deepEqual(h.writes, []);
  assert.doesNotMatch(JSON.stringify(result), /shopper-one|admin@example|token|fingerprint|authVersion|password|requestId|createdByUserId/i);
  assert.ok(safePilotPreparationSnapshot(result, "org-one")); assert.equal(safePilotPreparationSnapshot(result, "foreign"), null);
});
test("ordinary established preview owner works with pilot flags and allowlist absent", async () => {
  const h = harness(f => {
    Object.assign(f.env, { NODE_ENV: "production", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "admin@example.invalid",
      RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "admin@example.invalid", RUVANAS_PUBLIC_URL: "https://preview.example.invalid", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/" });
    f.session.authMethod = "PREVIEW_PASSWORD"; f.session.user.privatePreviewAccess = { userId: "admin-one", enabled: true, passwordEnabled: true, organisationId: null, expiresAt: null, pillars: [] };
  });
  assert.equal((await h.service.inspect({ organisationId: "org-one" })).ok, true);
});
test("invalid input, signed-out users and every non-admin role are rejected before business reads", async () => {
  for (const input of [{}, { organisationId: "org-one", shopperId: "shopper-one" }, { organisationId: "../foreign" }]) {
    const h = harness(); assert.equal((await h.service.inspect(input)).code, "INVALID_REQUEST"); assert.equal(h.calls.length, 0);
  }
  for (const role of [null, "OWNER", "MANAGER", "SUPPORT", "VIEWER", "STUDENT", "CONTENT_EDITOR"]) {
    const h = harness(f => { if (role === null) f.session = null; else f.session.user.role = role; });
    assert.equal((await h.service.inspect({ organisationId: "org-one" })).ok, false); assert.equal(h.calls.length, 0);
  }
});
test("enabled or malformed Rewards configuration cannot use preparation", async () => {
  for (const flag of ["true", "TRUE", "0", true]) {
    const h = harness(f => { f.env.RUVANAS_RETAIL_REWARDS_ENABLED = flag; });
    assert.equal((await h.service.inspect({ organisationId: "org-one" })).code, "PREPARATION_UNAVAILABLE"); assert.equal(h.calls.length, 0);
  }
  assert.equal(pilotPreparationIsClosed({}), true);
  assert.equal(pilotPreparationIsClosed({ RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "invalid" }), false);
});
test("non-test tenant, missing or altered setup/audit provenance fail before readiness collection", async () => {
  const changes = [
    f => { f.organisation.subscription.status = "ACTIVE"; },
    f => { f.organisation.subscription.plan.productFamily = "ONLINE"; },
    f => { f.grant.status = "ACTIVE"; }, f => { f.grant.subscriptionId = "foreign"; },
    f => { f.audits = f.audits.slice(1); }, f => { f.audits[0].details.planId = "foreign"; },
    f => { f.setups = []; }, f => { f.setups[0].organisationId = "foreign"; },
    f => { f.audits[1].actorUserId = "foreign"; }, f => { f.audits[1].details.accessGranted = true; },
    f => { f.setups[0].shopper.id = "foreign"; }, f => { f.setups[0].createdAt = new Date(+NOW + 1); }
  ];
  for (const change of changes) {
    const h = harness(change), result = await h.service.inspect({ organisationId: "org-one" });
    assert.equal(result.ok, false, String(change)); assert.equal(h.calls.some(c => c.model === "organisationMember"), false); assert.deepEqual(h.writes, []);
  }
  const foreign = harness(); assert.equal((await foreign.service.inspect({ organisationId: "foreign" })).code, "PREPARATION_UNAVAILABLE");
});
test("mismatched and foreign enrollment origins fail without returning a snapshot", async () => {
  for (const change of [f => { f.enrollments[0].organisationId = "foreign"; },
    f => { f.enrollments[0].shopperId = "unprepared-shopper"; },
    f => { f.enrollments[0].shopper.status = "ACTIVE"; }]) {
    const h = harness(change); assert.equal((await h.service.inspect({ organisationId: "org-one" })).ok, false); assert.deepEqual(h.writes, []);
  }
});
test("preparation is bounded and does not expose errors", async () => {
  const h = harness(f => { f.setups = Array.from({ length: 101 }, (_, i) => ({ ...f.setups[0], shopperId: `s-${i}` })); });
  assert.equal((await h.service.inspect({ organisationId: "org-one" })).code, "REVIEW_TOO_LARGE");
  const error = harness(null, model => { if (model === "auditLog") throw new Error("private database connection credential"); });
  const result = await error.service.inspect({ organisationId: "org-one" }); assert.equal(result.code, "UNAVAILABLE"); assert.doesNotMatch(JSON.stringify(result), /credential|connection/);
});
test("authority, feature closure and clock are rechecked after asynchronous collection", async () => {
  for (const change of [f => { f.session.user.role = "OWNER"; }, f => { f.session.revokedAt = NOW; },
    f => { f.env.RUVANAS_RETAIL_REWARDS_ENABLED = "true"; }, f => { f.now = new Date(+NOW + 7200000); }, f => { f.now = new Date(+NOW - 1); }]) {
    const h = harness(null, (model, f) => { if (model === "rewardOffer") change(f); });
    assert.equal((await h.service.inspect({ organisationId: "org-one" })).ok, false); assert.deepEqual(h.writes, []);
  }
});
test("fresh authority cannot omit preview relation or change authentication method", async () => {
  for (const change of [f => { delete f.session.user.privatePreviewAccess; }, f => { f.session.authMethod = "SSO"; }]) {
    const h = harness(null, (model, f) => { if (model === "session") change(f); });
    assert.equal((await h.service.inspect({ organisationId: "org-one" })).ok, false);
    assert.equal(h.calls.some(c => c.model === "organisation"), false);
  }
});
test("snapshot DTO refuses invented proof, credentials, extra action state and inconsistent counts", async () => {
  const good = await harness().service.inspect({ organisationId: "org-one" });
  for (const bad of [{ ...good, endToEndTest: "VERIFIED" }, { ...good, rewardsEnabled: true }, { ...good, expectedState: "a".repeat(64) },
    { ...good, preparedShoppers: { ...good.preparedShoppers, disabled: 0 } },
    { ...good, checkedAt: "2026-11-19T13:00:00.000Z" },
    { ...good, readiness: { ...good.readiness, eligibleNow: true } }]) assert.equal(safePilotPreparationSnapshot(bad, "org-one"), null);
});
test("stale or scoped preview administrator cannot inherit ordinary owner access", () => {
  const value = session(); value.expiresAt = NOW;
  assert.equal(authorizePilotPreparationSession(value, NOW, {}).ok, false);
  value.expiresAt = new Date(+NOW + 1000); value.user.privatePreviewAccess = { userId: value.userId, organisationId: "org-one" };
  assert.equal(authorizePilotPreparationSession(value, NOW, {}).ok, false);
});
