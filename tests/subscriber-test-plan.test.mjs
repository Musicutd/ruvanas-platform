import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriberTestPlanSnapshot, readSubscriberTestPlan, resolveSubscriberTestPlan,
  bindSubscriberTestPlan, loadSubscriberTestPlanBinding } from "../lib/subscriber-test-plan.mjs";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { PUBLIC_PLAN_CATALOGUE } from "../lib/product-plan-catalogue.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { subscriberTestingContext } from "./fixtures/private-preview-subscriber-testing.mjs";

const now = new Date("2026-11-01T08:00:00Z"), expiresAt = new Date("2026-11-23T08:00:00Z");
function fixture() {
  const plan = { ...PUBLIC_PLAN_CATALOGUE.find(row => row.code === "RETAIL_PROFESSIONAL"), id: "retail-professional" };
  const snapshot = createSubscriberTestPlanSnapshot({ plan, userId: "retail-user", organisationId: "retail-org",
    basePlanId: "original-plan", pillars: ["RETAIL"], expiresAt, now });
  return { plan, snapshot, subscription: { organisationId: "retail-org", planId: "original-plan",
    plan: { ...PREVIEW_TESTER_PLAN }, status: "TRIAL", currentPeriodEnd: expiresAt,
    ...previewTesterOverrides(["RETAIL"]), digitalSignageEnabled: false, retailMediaEnabled: false,
    schoolPublicPublishingEnabled: false, subscriberTestPlanSnapshot: snapshot } };
}

test("a free feature snapshot copies the selected plan without altering billing or existing output approval", () => {
  const { plan, snapshot, subscription } = fixture(), original = structuredClone(subscription);
  const resolved = readSubscriberTestPlan(subscription, now);
  assert.equal(resolved.code, plan.code);
  for (const key of ["stationLimit", "storageLimitGb", "listenerLimit", "maxBitrateKbps", "promoUploadEnabled", "licensedMusicCatalogueLevel"]) {
    assert.equal(resolved[key], plan[key]);
  }
  assert.equal(resolved.monthlyPriceCents, 0);
  assert.equal(resolved.digitalSignageEnabled, false);
  assert.equal(resolved.schoolPublicPublishingEnabled, false);
  assert.equal(resolved.retailMediaEnabled, false);
  assert.deepEqual(subscription, original);
  assert.equal(resolveEntitlements(subscription, now).outputEnabled, false);
  assert.equal(snapshot.basePlanId, subscription.planId);
});

test("selection rejects other products, private/malformed plans, incomplete identity and expired grants", () => {
  const { plan } = fixture();
  const valid = { plan, userId: "retail-user", organisationId: "retail-org", basePlanId: "original-plan", pillars: ["RETAIL"], expiresAt, now };
  for (const change of [{ pillars: ["ONLINE"] }, { pillars: ["RETAIL", "ONLINE"] }, { userId: "" },
    { organisationId: "" }, { basePlanId: "" }, { expiresAt: now }, { now: new Date("invalid") },
    { plan: { ...plan, active: false } }, { plan: { ...plan, publiclyAvailable: false } },
    { plan: { ...plan, stationLimit: -1 } }, { plan: { ...plan, onlineRadioEnabled: true } },
    { plan: { ...plan, code: "PRIVATE_PREVIEW_FAKE" } }]) {
    assert.throws(() => createSubscriberTestPlanSnapshot({ ...valid, ...change }));
  }
});

test("snapshots fail closed for another tenant, changed plan/expiry, billing or malformed privileges", () => {
  const { subscription } = fixture();
  for (const change of [
    s => { s.organisationId = "other-org"; }, s => { s.planId = "other-plan"; },
    s => { s.currentPeriodEnd = new Date("2026-11-24T08:00:00Z"); },
    s => { s.billingContract = { id: "paid" }; }, s => { s.complimentaryAccessActive = true; },
    s => { s.status = "ACTIVE"; }, s => { s.subscriberTestPlanSnapshot.plan.monthlyPriceCents = 100; },
    s => { s.subscriberTestPlanSnapshot.plan.digitalSignageEnabled = true; },
    s => { s.subscriberTestPlanSnapshot.plan.schoolRadioEnabled = true; },
    s => { s.subscriberTestPlanSnapshot.issuedAt = "2027-01-01T00:00:00Z"; },
    s => { s.subscriberTestPlanSnapshot.kind = "anything"; }, s => { s.retailRadioEnabled = false; }
  ]) {
    const changed = structuredClone(subscription); change(changed);
    assert.equal(readSubscriberTestPlan(changed, now), null);
  }
  assert.equal(readSubscriberTestPlan(subscription, expiresAt), null);
  assert.equal(readSubscriberTestPlan({ ...subscription, subscriberTestPlanSnapshot: null }, now), null);
});

function boundFixture() {
  const context = subscriberTestingContext({ organisationId: "cmvmeq5880005lf2knwtw1b93",
    email: "retail@manuelchircop.com", now });
  const subscription = context.membership.organisation.subscription;
  Object.assign(subscription, { id: "test-subscription", planId: "original-plan" });
  const plan = { ...PUBLIC_PLAN_CATALOGUE.find(row => row.code === "RETAIL_PROFESSIONAL"), id: "retail-professional" };
  subscription.subscriberTestPlanSnapshot = createSubscriberTestPlanSnapshot({ plan, userId: context.user.id,
    organisationId: subscription.organisationId, basePlanId: subscription.planId,
    pillars: ["RETAIL"], expiresAt: context.user.privatePreviewAccess.expiresAt, now });
  return { context, subscription, plan };
}

test("only the exact authenticated enabled Retail profile applies the test tier, never raw worker data", () => {
  const { context, subscription, plan } = boundFixture();
  const workerSubscription = structuredClone(subscription);
  assert.equal(resolveSubscriberTestPlan(subscription, now), null);
  assert.equal(resolveEntitlements(workerSubscription, now).stationLimit, 1);
  bindSubscriberTestPlan(subscription, context.user, now);
  assert.equal(resolveSubscriberTestPlan(subscription, now).code, plan.code);
  assert.equal(resolveEntitlements(subscription, now).stationLimit, plan.stationLimit);
  assert.equal(resolveEntitlements(subscription, now).storageLimitGb, plan.storageLimitGb);
  assert.equal(resolveEntitlements(subscription, now).outputEnabled, false);
  assert.equal(resolveEntitlements(subscription, now).digitalSignageEnabled, false);
  assert.equal(resolveEntitlements(subscription, now).subscriberTesting, true);
  assert.equal(resolveEntitlements(workerSubscription, now).stationLimit, 1);
  assert.equal(resolveEntitlements({ ...subscription }, now).stationLimit, 1, "copying JSON cannot copy authentication");
});

test("revocation, expiry, foreign user, another account and changed snapshot remove the projection", () => {
  for (const mutate of [
    c => { c.user.privatePreviewAccess.subscriberTestingEnabled = false; },
    c => { c.user.privatePreviewAccess.enabled = false; },
    c => { c.user.email = "another@example.test"; },
    c => { c.user.id = "wrong-user"; },
    c => { c.user.memberships[0].role = "MANAGER"; }
  ]) {
    const { context, subscription } = boundFixture();
    bindSubscriberTestPlan(subscription, context.user, now);
    mutate(context);
    assert.equal(resolveSubscriberTestPlan(subscription, now), null);
  }
  const { context, subscription } = boundFixture();
  bindSubscriberTestPlan(subscription, context.user, now);
  assert.equal(resolveSubscriberTestPlan(subscription, context.user.privatePreviewAccess.expiresAt), null);
  const fresh = structuredClone(subscription);
  fresh.subscriberTestPlanSnapshot.issuedAt = "2026-11-01T07:59:00Z";
  bindSubscriberTestPlan(fresh, context.user, now);
  assert.equal(resolveSubscriberTestPlan(fresh, now), null, "snapshot changed between session and membership reads");
});

test("transactional limit checks reload the current grant and fail closed for revoked or non-isolated accounts", async () => {
  const { context, subscription } = boundFixture();
  let members = 1, reads = 0;
  const db = { user: { findUnique: async args => { reads++; assert.equal(args.where.id, context.user.id); return context.user; } },
    organisationMember: { count: async () => members } };
  const fresh = structuredClone(subscription);
  await loadSubscriberTestPlanBinding(db, fresh, now);
  assert.equal(resolveEntitlements(fresh, now).stationLimit, 10);
  members = 2;
  const ambiguous = structuredClone(subscription);
  await loadSubscriberTestPlanBinding(db, ambiguous, now);
  assert.equal(resolveEntitlements(ambiguous, now).stationLimit, 1);
  const ordinary = { plan: PUBLIC_PLAN_CATALOGUE[0], status: "ACTIVE" };
  await loadSubscriberTestPlanBinding(db, ordinary, now);
  assert.equal(reads, 2);
});
