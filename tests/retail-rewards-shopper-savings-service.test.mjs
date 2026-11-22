import test from "node:test";
import assert from "node:assert/strict";
import { createShopperSavingsService } from "../lib/retail-rewards/shopper-savings-service.mjs";
import { SAVINGS_MAX_RECEIPTS } from "../lib/retail-rewards/shopper-savings-contracts.mjs";

const NOW = new Date("2026-11-22T12:00:00.000Z"), BEFORE = new Date("2026-11-20T12:00:00.000Z");
const ON = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true" };
const ACCESS = { ok: true, shopperId: "shopper-one", sessionId: "session-one", membershipId: "membership-one" };
function row(extra = {}) {
  return { id: "receipt-one", organisationId: "business-one", offerId: "offer-one", shopperId: "shopper-one", locationId: "shop-one",
    claimId: "claim-one", currency: "EUR", discountMinor: 2500, occurredAt: BEFORE, reversal: null,
    claim: { id: "claim-one", organisationId: "business-one", offerId: "offer-one", shopperId: "shopper-one", locationId: "shop-one" }, ...extra };
}
function fixture(options = {}) {
  const env = { ...ON, ...options.env }, queries = [], checks = [], writes = [];
  const model = { findMany: async query => { queries.push(query); return options.rows ? options.rows(queries.length) : [row()]; } };
  const db = new Proxy({ rewardRedemption: model }, { get(target, key) { if (key in target) return target[key]; writes.push(key); throw new Error("Unapproved adapter"); } });
  const service = createShopperSavingsService({ db, env,
    loadShopper: async adapter => { assert.equal(adapter, db); checks.push(1); return options.access ? options.access(checks.length, env) : ACCESS; },
    clock: options.clock || (() => NOW) });
  return { service, env, queries, checks, writes };
}
test("read-only savings derives scope from the shopper, rechecks authority and returns counts only", async () => {
  const h = fixture(), value = await h.service.inspect();
  assert.equal(value.ok, true); assert.equal(value.currencies[0].couponSavingsMinor, 2500);
  assert.equal(value.currencies[0].subscriptionPaidMinor, null); assert.equal(value.currencies[0].netBenefitMinor, null);
  assert.equal(h.queries.length, 2); assert.equal(h.checks.length, 3); assert.deepEqual(h.writes, []);
  for (const query of h.queries) {
    assert.deepEqual(query.where, { shopperId: ACCESS.shopperId, occurredAt: { lte: NOW } });
    assert.equal(query.take, SAVINGS_MAX_RECEIPTS + 1);
    assert.equal(Object.hasOwn(query.select, "actorUserId"), false);
  }
  for (const secret of ["shopper-one", "session-one", "membership-one", "business-one", "receipt-one", "claim-one"])
    assert.equal(JSON.stringify(value).includes(secret), false);
});
test("feature disabled, denied access and changed session stop before records can be exposed", async () => {
  const off = fixture({ env: { RUVANAS_RETAIL_REWARDS_ENABLED: "false" } });
  assert.equal((await off.service.inspect()).code, "FEATURE_DISABLED"); assert.equal(off.queries.length, 0); assert.equal(off.checks.length, 0);
  const denied = fixture({ access: () => ({ ok: false, code: "FORBIDDEN" }) });
  assert.equal((await denied.service.inspect()).code, "FORBIDDEN"); assert.equal(denied.queries.length, 0);
  for (const field of ["shopperId", "sessionId", "membershipId"]) {
    const changed = fixture({ access: n => n === 1 ? ACCESS : { ...ACCESS, [field]: "changed" } });
    assert.equal((await changed.service.inspect()).code, "UNAUTHENTICATED"); assert.equal(changed.queries.length, 1);
  }
});
test("foreign shopper, merchant, location or relation records fail instead of being included or silently skipped", async () => {
  for (const mutate of [r => { r.shopperId = "other"; }, r => { r.claim.shopperId = "other"; },
    r => { r.claim.organisationId = "other"; }, r => { r.claim.locationId = "other"; },
    r => { r.claim.offerId = "other"; }, r => { r.claim.id = "other"; },
    r => { r.reversal = { redemptionId: "other", organisationId: r.organisationId, occurredAt: NOW }; },
    r => { r.discountMinor = -1; }, r => { r.currency = "BAD"; }]) {
    const receipt = row(); mutate(receipt);
    const h = fixture({ rows: () => [receipt] });
    assert.equal((await h.service.inspect()).code, "UNAVAILABLE"); assert.deepEqual(h.writes, []);
  }
});
test("fresh second read observes a reversal and unknown-value receipts remain separately counted", async () => {
  const h = fixture({ rows: n => n === 1 ? [row()] : [row({ reversal: { redemptionId: "receipt-one", organisationId: "business-one", occurredAt: NOW } })] });
  assert.deepEqual((await h.service.inspect()).currencies, []);
  const unknown = fixture({ rows: () => [row({ discountMinor: null })] });
  const value = await unknown.service.inspect(); assert.equal(value.currencies[0].unvaluedRedemptions, 1);
  assert.equal(value.currencies[0].couponSavingsMinor, 0); assert.equal(value.currencies[0].netBenefitMinor, null);
});
test("bounded history, malformed adapters, duplicate receipts and database errors never yield partial totals", async () => {
  for (const rows of [() => Array(SAVINGS_MAX_RECEIPTS + 1).fill(row()), () => [row(), row()], () => null,
    () => { throw new Error("postgresql://credentials-private"); }]) {
    const result = await fixture({ rows }).service.inspect(); assert.equal(result.code, "UNAVAILABLE");
    assert.equal(JSON.stringify(result).includes("credentials"), false);
  }
});
test("revocation and closed flags during collection hide the response", async () => {
  const revoked = fixture({ access: n => n < 3 ? ACCESS : { ok: false, code: "UNAUTHENTICATED" } });
  assert.equal((await revoked.service.inspect()).code, "UNAUTHENTICATED");
  const off = fixture({ access: (n, env) => { if (n === 3) env.RUVANAS_RETAIL_REWARDS_ENABLED = "false"; return ACCESS; } });
  assert.equal((await off.service.inspect()).code, "FEATURE_DISABLED");
});
test("clock rollback, future receipt dates and slow snapshots fail closed", async () => {
  let calls = 0;
  assert.equal((await fixture({ clock: () => new Date(+NOW - calls++ * 1000) }).service.inspect()).code, "UNAVAILABLE");
  calls = 0;
  assert.equal((await fixture({ clock: () => new Date(+NOW + calls++ * 15000) }).service.inspect()).code, "UNAVAILABLE");
  assert.equal((await fixture({ rows: () => [row({ occurredAt: new Date(+NOW + 1) })] }).service.inspect()).code, "UNAVAILABLE");
});
