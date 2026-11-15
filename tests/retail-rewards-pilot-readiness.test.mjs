import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePilotReadiness, collectPilotReadiness } from "../lib/retail-rewards/pilot-readiness.mjs";
import { pilotReadinessSchema } from "../lib/retail-rewards/pilot-readiness-contracts.mjs";
import { createRewardPilotAdminService } from "../lib/retail-rewards/pilot-admin-service.mjs";
import { createPilotAdminHttp } from "../lib/retail-rewards/pilot-admin-http.mjs";
import { safePilotAdminResult } from "../lib/retail-rewards/pilot-admin-dtos.mjs";

const NOW = new Date("2026-11-14T12:00:00.000Z"), START = new Date("2026-11-14T10:00:00.000Z"), END = new Date("2026-11-30T12:00:00.000Z");
const ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: '["org-one"]',
  RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "true", RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "true",
  SESSION_SECRET: "local-synthetic-readiness-secret-over-32-characters" };
const abort = code => { throw Object.assign(new Error(code), { code }); };
const clone = value => structuredClone(value);
function fixture() {
  const terms = { schemaVersion: 1, title: "10% local offer", description: "Synthetic offer", category: "FASHION", type: "PERCENT_OFF", percentBps: 1000,
    amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000, exclusions: "", legalTerms: "Synthetic terms.", combinable: false,
    startsAt: START.toISOString(), endsAt: END.toISOString(), timezone: "Europe/Malta", locationIds: ["shop-one"], usage: "REUSABLE", totalLimit: 10,
    perShopperLimit: 2, perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED" };
  return { organisationId: "org-one", env: { ...ENV }, now: NOW, abort,
    state: { organisation: { id: "org-one", name: "Synthetic business" }, subscription: { id: "sub-one", organisationId: "org-one", status: "ACTIVE",
      plan: { id: "plan-one", active: true, code: "RETAIL_START", productFamily: "RETAIL", retailRadioEnabled: true } },
      program: { id: "program-one", organisationId: "org-one", status: "ACTIVE", timezone: "Europe/Malta", networkOptIn: true },
      grant: { id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER",
        status: "TRIAL", startsAt: START, expiresAt: END, revokedAt: null, limits: { activeOffers: 5, locations: 2, staffSeats: 2, monthlyRedemptions: 20,
          analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false } } },
    members: [{ id: "member-owner", organisationId: "org-one", userId: "owner", role: "OWNER", user: { id: "owner", role: "OWNER", privatePreviewAccess: null }, rewardStaffGrants: [] }],
    locations: [{ id: "shop-one", organisationId: "org-one", status: "ACTIVE" }, { id: "shop-two", organisationId: "org-one", status: "ACTIVE" }],
    profiles: [{ id: "profile-one", organisationId: "org-one", locationId: "shop-one", publicSlug: "sample-shop", displayName: "Sample shop", description: "Sample only",
      locality: "Valletta", countryCode: "MT", status: "PUBLISHED", networkOptIn: true, publishedAt: START, revokedAt: null }],
    offers: [{ id: "offer-one", organisationId: "org-one", programId: "program-one", state: "PUBLISHED", publishedRevision: 1, publishedStartsAt: START, publishedEndsAt: END,
      publishedSnapshot: { organisationId: "org-one", offerId: "offer-one", revision: 1, terms },
      locations: [{ organisationId: "org-one", offerId: "offer-one", locationId: "shop-one", scope: "PUBLISHED" }],
      discovery: { organisationId: "org-one", offerId: "offer-one", publicSlug: "local-offer", revision: 1, discoverable: true, approvedAt: START, revokedAt: null } }],
    enrollments: [{ shopperId: "shopper-one", organisationId: "org-one", shopper: { id: "shopper-one", status: "ACTIVE", authVersion: 1,
      credential: { shopperId: "shopper-one" }, membership: { id: "membership-one", shopperId: "shopper-one", source: "MANUAL_INTERNAL", status: "ACTIVE",
        startsAt: START, expiresAt: END, revokedAt: null, version: 1 }, invitation: { id: "invitation-one", shopperId: "shopper-one", authVersion: 1,
        createdAt: START, expiresAt: new Date("2026-11-15T10:00:00.000Z"), acceptedAt: new Date("2026-11-14T11:00:00.000Z"), revokedAt: null } } }]
  };
}
const row = (result, key) => result.checks.find(check => check.key === key);
function cashier(f, changes = {}) {
  const grant = { id: "staff-one", organisationId: "org-one", organisationMemberId: "member-cashier", scope: "LOCATIONS", locationId: "shop-one", capabilities: ["REDEEM"],
    startsAt: START, expiresAt: END, revokedAt: null, ...changes };
  f.members = [{ id: "member-cashier", organisationId: "org-one", userId: "cashier", role: "VIEWER", user: { id: "cashier", role: "VIEWER", privatePreviewAccess: null }, rewardStaffGrants: [grant] }];
}
test("configured pilot with normal owner can check out without a separate cashier, never claims tested", () => {
  const result = evaluatePilotReadiness(fixture()); assert.equal(result.configured, true); assert.equal(result.eligibleNow, true);
  assert.equal(row(result, "cashiers").eligibleCount, 1); assert.equal(result.endToEndTest, "NOT_VERIFIED"); assert.equal(result.pendingInvitations, 0);
  assert.equal(safePilotAdminResult("readiness", result)?.ok, true); assert.equal(JSON.stringify(result).includes("shopper-one"), false);
});
test("valid private preview is explicitly incompatible; malformed or public-site-only preview fails closed", () => {
  const f = fixture(); Object.assign(f.env, { RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "admin@example.test",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "admin@example.test", RUVANAS_PUBLIC_URL: "https://preview.example.test", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.test/" });
  let result = evaluatePilotReadiness(f); assert.equal(result.configured, true); assert.equal(result.eligibleNow, false); assert.equal(row(result, "environment").code, "PRIVATE_PREVIEW_BLOCKED");
  for (const change of [{ RUVANAS_PRIVATE_PREVIEW_ENABLED: "false" }, { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1" }]) {
    const data = fixture(); Object.assign(data.env, change); result = evaluatePilotReadiness(data); assert.equal(result.eligibleNow, false); assert.equal(row(result, "environment").code, "ENVIRONMENT_INVALID");
  }
});
test("shopper/auth/checkout gates and secret validity are evaluated without exposing configuration", () => {
  for (const key of ["RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED", "RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED", "RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED"]) {
    const f = fixture(); f.env[key] = "false"; assert.equal(row(evaluatePilotReadiness(f), "environment").code, "FEATURES_DISABLED");
    f.env[key] = true; assert.equal(row(evaluatePilotReadiness(f), "environment").code, "ENVIRONMENT_INVALID");
  }
  const f = fixture(); f.env.SESSION_SECRET = "short"; const result = evaluatePilotReadiness(f); assert.equal(row(result, "environment").code, "AUTH_CONFIGURATION_UNAVAILABLE");
  assert.equal(JSON.stringify(result).includes("short"), false);
});
test("preview pilot compatibility requires explicit valid opt-in for this exact organisation", () => {
  const f = fixture(); Object.assign(f.env, { RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "admin@example.test",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "admin@example.test", RUVANAS_PUBLIC_URL: "https://preview.example.test", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.test/",
    RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "true" });
  const ready = evaluatePilotReadiness(f); assert.equal(row(ready, "environment").code, "ENVIRONMENT_COMPATIBLE"); assert.equal(ready.eligibleNow, true);
  assert.equal(ready.endToEndTest, "NOT_VERIFIED", "compatibility does not establish a completed role journey");
  const other = { ...fixture(), env: { ...f.env } }; other.env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["other-org"]';
  assert.equal(row(evaluatePilotReadiness(other), "environment").code, "PRIVATE_PREVIEW_BLOCKED");
  for (const value of [undefined, "false"]) {
    const disabled = { ...fixture(), env: { ...f.env } }; disabled.env.RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED = value;
    assert.equal(row(evaluatePilotReadiness(disabled), "environment").code, "PRIVATE_PREVIEW_BLOCKED");
  }
  for (const value of [true, "1", "TRUE", ""]) {
    const malformed = { ...fixture(), env: { ...f.env } }; malformed.env.RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED = value;
    assert.equal(row(evaluatePilotReadiness(malformed), "environment").code, "ENVIRONMENT_INVALID");
  }
});
test("ordinary owner is required; Super Admin, support and preview membership are not merchant proof", () => {
  for (const role of ["SUPER_ADMIN", "SUPPORT", "STUDENT"]) {
    const f = fixture(); f.members[0].user.role = role; assert.equal(row(evaluatePilotReadiness(f), "owner").code, "OWNER_MISSING");
  }
  const f = fixture(); f.members[0].user.privatePreviewAccess = { userId: "owner" }; assert.equal(evaluatePilotReadiness(f).eligibleNow, false);
});
test("entitlement must be current, active Retail and permit redemption", () => {
  for (const change of [f => { f.state.grant.revokedAt = NOW; }, f => { f.state.grant.expiresAt = NOW; }, f => { f.state.subscription.status = "SUSPENDED"; },
    f => { f.state.program.networkOptIn = false; }, f => { f.state.grant.limits.monthlyRedemptions = 0; }, f => { f.state.grant.limits.staffSeats = 0; }]) {
    const f = fixture(); change(f); const result = evaluatePilotReadiness(f); assert.equal(row(result, "entitlement").code, "ENTITLEMENT_INACTIVE"); assert.equal(result.eligibleNow, false);
  }
  const f = fixture(); f.state.grant = null; assert.equal(row(evaluatePilotReadiness(f), "entitlement").code, "ENTITLEMENT_MISSING");
});
test("active public shop consent is separate from a saved location", () => {
  for (const change of [f => { f.profiles[0].revokedAt = NOW; }, f => { f.profiles[0].networkOptIn = false; }, f => { f.locations[0].status = "PAUSED"; },
    f => { f.profiles[0].publishedAt = new Date(+NOW + 1000); }]) {
    const f = fixture(); change(f); const result = evaluatePilotReadiness(f); assert.equal(row(result, "shops").eligibleCount, 0); assert.equal(row(result, "coupons").eligibleCount, 0);
  }
});
test("only exact current approved coupon revision qualifies; future/expired terms are not current", () => {
  const stale = fixture(); stale.offers[0].publishedRevision = 2; stale.offers[0].publishedSnapshot.revision = 2;
  assert.equal(row(evaluatePilotReadiness(stale), "coupons").code, "COUPONS_NOT_APPROVED");
  for (const change of [f => { f.offers[0].discovery.revokedAt = NOW; }, f => { f.offers[0].discovery.approvedAt = new Date(+NOW + 1000); },
    f => { f.offers[0].state = "PAUSED"; }, f => { f.offers[0].publishedStartsAt = new Date(+NOW + 1000); f.offers[0].publishedSnapshot.terms.startsAt = f.offers[0].publishedStartsAt.toISOString(); },
    f => { f.offers[0].publishedEndsAt = NOW; f.offers[0].publishedSnapshot.terms.endsAt = NOW.toISOString(); }]) {
    const f = fixture(); change(f); assert.equal(row(evaluatePilotReadiness(f), "coupons").eligibleCount, 0);
  }
});
test("REDEEM-only cashier must have current role-compatible scope matching a usable coupon shop", () => {
  const f = fixture(); cashier(f); assert.equal(row(evaluatePilotReadiness(f), "cashiers").eligibleCount, 1);
  for (const change of [{ locationId: "shop-two" }, { startsAt: new Date(+NOW + 1000) }, { expiresAt: NOW }, { revokedAt: NOW }, { capabilities: ["READ"] }]) {
    const f = fixture(); cashier(f, change); assert.equal(row(evaluatePilotReadiness(f), "cashiers").eligibleCount, 0);
  }
  const editor = fixture(); cashier(editor); editor.members[0].role = "CONTENT_EDITOR"; assert.equal(row(evaluatePilotReadiness(editor), "cashiers").eligibleCount, 0);
});
test("accepted pilot shopper needs active membership, credential and current invitation authVersion", () => {
  for (const change of [s => { s.status = "SUSPENDED"; }, s => { s.credential = null; }, s => { s.authVersion = 2; }, s => { s.membership.revokedAt = NOW; },
    s => { s.membership.expiresAt = NOW; }, s => { s.membership.startsAt = new Date(+NOW + 1000); }, s => { s.invitation.revokedAt = NOW; }]) {
    const f = fixture(); change(f.enrollments[0].shopper); const result = evaluatePilotReadiness(f); assert.equal(row(result, "shoppers").eligibleCount, 0); assert.equal(result.eligibleNow, false);
  }
  const f = fixture(); f.now = new Date("2026-11-16T12:00:00.000Z"); assert.equal(row(evaluatePilotReadiness(f), "shoppers").eligibleCount, 1, "accepted invitation expiry does not revoke active account");
});
test("pending invitations are separate, and accepted shoppers from another pilot never count", () => {
  const f = fixture(), s = f.enrollments[0].shopper; s.status = "DISABLED"; s.credential = null; s.invitation.acceptedAt = null;
  const result = evaluatePilotReadiness(f); assert.equal(result.pendingInvitations, 1); assert.equal(row(result, "shoppers").configuredCount, 0);
  f.enrollments[0].organisationId = "other-org"; assert.throws(() => evaluatePilotReadiness(f), error => error.code === "UNAVAILABLE");
});
test("malformed, duplicate and cross-tenant projections fail closed", () => {
  for (const change of [f => { f.offers[0].discovery.organisationId = "foreign"; }, f => { f.offers[0].publishedSnapshot.revision = 9; },
    f => { f.offers[0].locations[0].locationId = "shop-two"; }, f => { f.profiles[0].locationId = "foreign-shop"; },
    f => { f.enrollments[0].shopper.credential.shopperId = "foreign-shopper"; }, f => { f.members.push(clone(f.members[0])); },
    f => { f.enrollments[0].shopper.membership.source = "STRIPE"; }]) {
    const f = fixture(); change(f); assert.throws(() => evaluatePilotReadiness(f), error => error.code === "UNAVAILABLE");
  }
});
test("readiness is bounded and DTO cannot promote successful checks to a test result or expose identities", () => {
  const f = fixture(); f.locations = Array.from({ length: 101 }, (_, i) => ({ id: `location-${i}`, organisationId: "org-one", status: "ACTIVE" }));
  assert.throws(() => evaluatePilotReadiness(f), error => error.code === "REVIEW_TOO_LARGE");
  const good = evaluatePilotReadiness(fixture());
  for (const bad of [{ ...good, endToEndTest: "VERIFIED" }, { ...good, email: "private@example.test" }, { ...good, configured: false },
    { ...good, checks: good.checks.map((row, index) => index ? row : { ...row, code: "PASS_ANYTHING" }) },
    { ...good, checks: good.checks.map((row, index) => index ? row : { ...row, code: "FEATURES_DISABLED" }) },
    { ...good, eligibleNow: false, checks: good.checks.map((row, index) => index === 1 ? { ...row, code: "OWNER_MISSING", status: "MISSING", eligibleCount: 0 } : row) }])
    assert.equal(pilotReadinessSchema.safeParse(bad).success, false);
});

function project(row, select) {
  if (row == null || !select) return row;
  return Object.fromEntries(Object.entries(select).map(([key, s]) => [key, s === true ? row[key] : Array.isArray(row[key]) ? row[key].map(item => project(item, s.select)) : project(row[key], s.select)]));
}
function database(f) {
  const calls = [], { limits, ...grant } = f.state.grant, tables = {
    organisation: [{ ...f.state.organisation, subscription: f.state.subscription }], rewardProgram: [f.state.program],
    rewardEntitlementGrant: [{ ...grant, limitsVersion: 1, ...limits }], organisationMember: f.members, location: f.locations,
    rewardPublicShopProfile: f.profiles, rewardOffer: f.offers, rewardPilotShopperEnrollment: f.enrollments };
  const db = { $queryRaw: async (parts, ...values) => { calls.push({ kind: "lock", sql: parts.join("?") });
    return parts.join("?").includes('FROM "User"') || parts.join("?").includes('FROM "Session"') ? [{ id: values[0] }] : []; },
    $transaction: async (run, options) => { assert.equal(options.isolationLevel, "Serializable"); return run(db); } };
  for (const [model, rows] of Object.entries(tables)) db[model] = { findMany: async ({ select }) => { calls.push({ kind: "read", model }); return rows.map(row => project(row, select)); },
    findFirst: async ({ select }) => project(rows[0], select), findUnique: async ({ select }) => project(rows[0], select),
    create: async () => { throw Error("Readiness attempted write"); }, update: async () => { throw Error("Readiness attempted write"); } };
  return { db, calls };
}
test("pilot service readiness uses serializable read-only projections and exact existing Super Admin guard", async () => {
  const f = fixture(), { db, calls } = database(f); let context = { session: { id: "session-admin", userId: "super-admin", authMethod: "PASSWORD", expiresAt: END, revokedAt: null },
    user: { id: "super-admin", role: "SUPER_ADMIN", privatePreviewAccess: null } };
  const service = createRewardPilotAdminService({ db, env: f.env, loadContext: async () => context, clock: () => NOW });
  const result = await service.readiness({ organisationId: "org-one" }); assert.equal(result.eligibleNow, true, JSON.stringify(result));
  assert.equal(calls.some(call => /FOR UPDATE|INSERT|DELETE|UPDATE /.test(call.sql || "")), false);
  assert.equal((await service.readiness({ organisationId: "foreign" })).code, "FORBIDDEN");
  context.user.role = "OWNER"; assert.equal((await service.readiness({ organisationId: "org-one" })).code, "FORBIDDEN");
});
test("read-only collection has explicit finite projections without email, token or password fields", async () => {
  const f = fixture(), { db } = database(f); const snapshot = await collectPilotReadiness(db, "org-one", abort);
  const result = evaluatePilotReadiness({ ...f, ...snapshot }); assert.equal(result.eligibleNow, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /emailCanonical|tokenHash|passwordHash/);
});
test("readiness evaluates expiry after the final async authority check", async () => {
  const f = fixture(); f.state.grant.expiresAt = new Date(+NOW + 1000); const { db } = database(f); let checked = NOW, loads = 0;
  const service = createRewardPilotAdminService({ db, env: f.env, clock: () => checked, loadContext: async () => {
    if (++loads === 3) checked = new Date(+NOW + 2000);
    return { session: { id: "session-admin", userId: "super-admin", authMethod: "PASSWORD", expiresAt: END, revokedAt: null },
      user: { id: "super-admin", role: "SUPER_ADMIN", privatePreviewAccess: null } };
  } });
  const result = await service.readiness({ organisationId: "org-one" }); assert.equal(result.ok, true); assert.equal(result.eligibleNow, false);
  assert.equal(row(result, "entitlement").code, "ENTITLEMENT_INACTIVE"); assert.equal(result.checkedAt, new Date(+NOW + 2000).toISOString());
});
test("HTTP exposes readiness only as allowlisted GET, with private no-store strict DTO", async () => {
  const ready = evaluatePilotReadiness(fixture()), calls = [];
  const http = createPilotAdminHttp({ env: ENV, authorize: async id => { calls.push(id); return { ok: true, userId: "super-admin" }; },
    rateLimit: async () => ({ allowed: true }), loadService: async () => ({ readiness: async () => ready }) });
  const base = "https://example.test/api/admin/retail-rewards/pilot/readiness";
  const response = await http.run(new Request(base + "?organisationId=org-one"), "readiness");
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), ready); assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual(calls, ["org-one"]);
  assert.equal((await http.run(new Request(base, { method: "POST" }), "readiness")).status, 405);
  for (const query of ["?organisationId=org-one&organisationId=foreign", "?organisationId=org-one&token=private", ""]) assert.equal((await http.run(new Request(base + query), "readiness")).status, 400);
});
