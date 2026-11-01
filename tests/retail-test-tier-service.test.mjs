import assert from "node:assert/strict";
import test from "node:test";
import { getRetailTestTiers, selectRetailTestTier } from "../lib/retail-test-tier-service.mjs";
import { PREVIEW_TESTER_PLAN, assertPreviewTesterState, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { PUBLIC_PLAN_CATALOGUE } from "../lib/product-plan-catalogue.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "../lib/retail-subscriber-access.mjs";

const NOW = new Date("2026-11-01T10:00:00Z"), END = new Date("2026-11-23T10:00:00Z");
const clone = structuredClone;
function fixture() {
  let state = {
    user: { id: "retail_user", email: "retail@manuelchircop.com", role: "OWNER" },
    grant: { userId: "retail_user", organisationId: ORG, enabled: true, passwordEnabled: true,
      subscriberTestingEnabled: true, expiresAt: END, pillars: ["RETAIL"] },
    session: { id: "retail_session", userId: "retail_user", activeOrganisationId: ORG,
      authMethod: "PREVIEW_PASSWORD", revokedAt: null, expiresAt: END },
    subscription: { id: "retail_subscription", organisationId: ORG, planId: "preview_plan", status: "TRIAL",
      currentPeriodEnd: END, complimentaryAccessActive: false, billingContract: null, ...previewTesterOverrides(["RETAIL"]),
      schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false,
      plan: { id: "preview_plan", ...PREVIEW_TESTER_PLAN }, subscriberTestPlanSnapshot: null },
    plans: PUBLIC_PLAN_CATALOGUE.filter(plan => plan.productFamily === "RETAIL").map(plan => ({ ...plan, id: `plan_${plan.code}` })),
    memberCount: 1, userMembershipCount: 1, membershipRole: "OWNER", security: null,
    usage: { locations: 0, players: 0, bytes: 1331200n }, audits: [], updates: []
  };
  let failAudit = false;
  const queries = [], transactions = [];
  function userFor(s) {
    return { ...clone(s.user), privatePreviewAccess: clone(s.grant), memberships: Array.from({ length: s.userMembershipCount }, (_, i) => ({
      userId: s.user.id, organisationId: i ? "foreign_org" : ORG, role: s.membershipRole,
      organisation: { id: i ? "foreign_org" : ORG, subscription: clone(s.subscription), enterpriseSecurityPolicy: clone(s.security) }
    })) };
  }
  function tables(s) {
    return {
      user: { findUnique: async args => { queries.push(["user", args]); return userFor(s); } },
      session: { findUnique: async args => { queries.push(["session", args]); return clone(s.session); } },
      organisationMember: { count: async args => { queries.push(["member", args]); return s.memberCount; } },
      plan: { findMany: async args => { queries.push(["plans", args]); return clone(s.plans); } },
      location: { count: async args => { queries.push(["locations", args]); return s.usage.locations; } },
      player: { count: async args => { queries.push(["players", args]); return s.usage.players; } },
      mediaAsset: { aggregate: async args => { queries.push(["media", args]); return { _sum: { sizeBytes: s.usage.bytes } }; } },
      subscription: { update: async args => {
        assert.deepEqual(Object.keys(args.data), ["subscriberTestPlanSnapshot"]);
        assert.deepEqual(args.where, { id: s.subscription.id });
        s.updates.push(clone(args)); Object.assign(s.subscription, clone(args.data)); return clone(s.subscription);
      } },
      auditLog: { create: async args => { if (failAudit) throw new Error("synthetic persistence failure"); s.audits.push(clone(args.data)); return args.data; } }
    };
  }
  const db = { async $transaction(callback, options) {
    transactions.push(options); const next = clone(state);
    const result = await callback(tables(next)); state = next; return result;
  } };
  return { db, queries, transactions, get state() { return state; },
    failAudit() { failAudit = true; },
    context() { const user = userFor(state), membership = user.memberships[0];
      return { user, session: { ...clone(state.session), user }, membership, memberships: user.memberships }; } };
}
const select = (f, planCode, extra = {}) => selectRetailTestTier(f.db, { context: f.context(),
  input: { planCode, confirmed: true, ...extra }, now: NOW });
const denied = (promise, code = "ACCESS_DENIED") => assert.rejects(promise, error => error.code === `RETAIL_TEST_TIER_${code}`);

test("GET reads all five current database tiers and only this tenant's usage without mutations", async () => {
  const f = fixture(), original = clone(f.state);
  const result = await getRetailTestTiers(f.db, { context: f.context(), now: NOW });
  assert.equal(result.freeTest, true); assert.equal(result.currentPlan, null); assert.equal(result.revision, null);
  assert.deepEqual(result.plans.map(p => p.tierNumber), [1, 2, 3, 4, 5]);
  assert.ok(result.plans.every(p => p.monthlyPriceCents === 0 && p.digitalDisplaysEnabled === false));
  assert.deepEqual(result.usage, { locations: 0, players: 0, storageBytes: 1331200 });
  assert.deepEqual(f.state, original);
  for (const name of ["member", "locations", "players", "media"]) {
    assert.equal(f.queries.find(([key]) => key === name)[1].where.organisationId, ORG);
  }
  assert.deepEqual(f.queries.find(([key]) => key === "plans")[1].where,
    { active: true, publiclyAvailable: true, productFamily: "RETAIL" });
});

test("switching all tiers and downgrading preserves the original subscription and running-stream dependencies", async () => {
  const f = fixture(), original = clone(f.state);
  f.state.usage = { locations: 8, players: 4, bytes: 8n * 1024n ** 3n };
  let expectedRevision = null;
  for (const tier of [5, 1, 2, 3, 4, 1, 5]) {
    const planCode = f.state.plans.find(p => p.tierNumber === tier).code;
    const result = await select(f, planCode, { expectedRevision });
    assert.equal(result.currentPlan.code, planCode); assert.equal(result.freeTest, true);
    assert.equal(result.changed, true); assert.match(result.revision, /^[a-f0-9]{64}$/);
    expectedRevision = result.revision;
    const { subscriberTestPlanSnapshot, ...base } = f.state.subscription;
    const { subscriberTestPlanSnapshot: before, ...originalBase } = original.subscription;
    assert.deepEqual(base, originalBase);
    assert.equal(subscriberTestPlanSnapshot.userId, f.state.user.id);
    assert.equal(subscriberTestPlanSnapshot.organisationId, ORG);
    assert.equal(subscriberTestPlanSnapshot.expiresAt, END.toISOString());
    assert.equal(subscriberTestPlanSnapshot.plan.monthlyPriceCents, 0);
    assert.deepEqual(f.state.grant, original.grant); assert.deepEqual(f.state.session, original.session);
    assert.deepEqual(f.state.plans, original.plans);
    assertPreviewTesterState(f.context().user, { now: NOW });
    if (tier === 1) assert.equal(result.warnings.length, 3);
  }
  assert.equal(f.state.updates.length, 7);
  assert.ok(f.transactions.every(options => options.isolationLevel === "Serializable"));
  assert.ok(f.state.audits.every(row => row.organisationId === ORG && row.actorUserId === "retail_user" &&
    row.details.billingChanged === false && row.details.dataDeleted === false && row.details.sourceChanged === false));
});

test("same saved features are idempotent; stale revisions fail without overwriting another selection", async () => {
  const f = fixture();
  const first = await select(f, "RETAIL_START", { expectedRevision: null });
  const repeat = await select(f, "RETAIL_START", { expectedRevision: first.revision });
  assert.equal(repeat.changed, false); assert.equal(repeat.revision, first.revision);
  assert.equal(f.state.audits.length, 1);
  await denied(select(f, "RETAIL_ENTERPRISE", { expectedRevision: null }), "SELECTION_CHANGED");
  assert.equal(f.state.audits.length, 1);
  f.state.plans[0].stationLimit = 2;
  const refreshed = await select(f, "RETAIL_START", { expectedRevision: first.revision });
  assert.equal(refreshed.changed, true); assert.equal(refreshed.currentPlan.limits.locations, 2);
});

test("fresh persistent principal checks reject revoked, foreign, elevated, expired or malformed tester states", async () => {
  const variants = [
    s => { s.grant.subscriberTestingEnabled = false; }, s => { s.grant.enabled = false; },
    s => { s.grant.expiresAt = NOW; s.subscription.currentPeriodEnd = NOW; },
    s => { s.grant.organisationId = "foreign_org"; }, s => { s.grant.pillars = ["ONLINE"]; },
    s => { s.user.email = "someone@example.test"; }, s => { s.user.role = "SUPER_ADMIN"; },
    s => { s.session.revokedAt = NOW; }, s => { s.session.expiresAt = NOW; },
    s => { s.session.userId = "someone_else"; }, s => { s.session.authMethod = "PASSWORD"; },
    s => { s.session.activeOrganisationId = "foreign_org"; }, s => { s.memberCount = 2; },
    s => { s.userMembershipCount = 2; }, s => { s.membershipRole = "MANAGER"; },
    s => { s.subscription.plan.stationLimit = 10; }, s => { s.subscription.status = "ACTIVE"; },
    s => { s.subscription.billingContract = { id: "paid_contract" }; },
    s => { s.subscription.complimentaryAccessActive = true; },
    s => { s.security = { ssoRequired: true, passwordFallback: false }; }
  ];
  for (const mutate of variants) {
    const f = fixture(), staleContext = f.context(); mutate(f.state);
    await denied(selectRetailTestTier(f.db, { context: staleContext, input: { planCode: "RETAIL_START", confirmed: true }, now: NOW }));
    assert.equal(f.state.updates.length, 0);
  }
});

test("unavailable/foreign plan choices and malformed public plans cannot create a mirror", async () => {
  const f = fixture(); await denied(select(f, "ONLINE_ENTERPRISE"), "PLAN_UNAVAILABLE");
  for (const mutate of [s => s.plans.pop(), s => { s.plans[0].active = false; }, s => { s.plans[0].publiclyAvailable = false; },
    s => { s.plans[0].productFamily = "SCHOOL"; }, s => { s.plans[0].tierNumber = 2; },
    s => { s.plans[0].onlineRadioEnabled = true; }, s => { s.plans[0].storageLimitGb = -1; }]) {
    const bad = fixture(); mutate(bad.state);
    await denied(select(bad, "RETAIL_START"), "PLANS_UNAVAILABLE");
    assert.equal(bad.state.updates.length, 0);
  }
});

test("failed audit rolls back the snapshot; invalid usage and tampered bodies cannot mutate", async () => {
  const f = fixture(), original = clone(f.state); f.failAudit();
  await assert.rejects(select(f, "RETAIL_ENTERPRISE")); assert.deepEqual(f.state, original);
  for (const input of [{ planCode: "RETAIL_START", confirmed: false }, { planCode: "RETAIL_START", confirmed: true, organisationId: "foreign" },
    { planCode: "RETAIL_START", confirmed: true, plan: { stationLimit: 1000 } }, { planCode: "retail_start", confirmed: true }]) {
    const bad = fixture(); await denied(selectRetailTestTier(bad.db, { context: bad.context(), input, now: NOW }), "REQUEST_INVALID");
    assert.equal(bad.transactions.length, 0);
  }
  const badUsage = fixture(); badUsage.state.usage.bytes = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  await denied(select(badUsage, "RETAIL_START"), "USAGE_UNAVAILABLE");
  assert.equal(badUsage.state.updates.length, 0);
});
