import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createRewardReversalService } from "../lib/retail-rewards/reversal-service.mjs";
import { safeReversalResult } from "../lib/retail-rewards/reversal-dtos.mjs";
import { fixture, clone, NOW, SECRET } from "./fixtures/rewards-checkout.mjs";

async function setup() {
  const f = fixture();
  f.env.RUVANAS_RETAIL_REWARDS_REVERSALS_ENABLED = "true";
  const result = await f.service.redeem(f.input); assert.equal(result.ok, true, JSON.stringify(result));
  f.original = result.receipt;
  f.corrections = createRewardReversalService({ db: f.db, env: f.env, loadContext: async () => clone(f.context), clock: () => f.now });
  f.correction = { redemptionId: result.receipt.id, locationId: "shop-one", reason: "WRONG_COUPON", idempotencyKey: randomUUID(), correctionConfirmed: true };
  f.calls.length = 0; return f;
}

test("reversals default off before every dependency and reject malformed authority input before reads", async () => {
  const no = () => { throw new Error("Forbidden effect"); };
  const service = createRewardReversalService({ db: new Proxy({}, { get: no }), loadContext: no, clock: no });
  for (const result of await Promise.all([service.locations(), service.inspect({}), service.reverse({})])) assert.equal(result.code, "FEATURE_DISABLED");
  const f = await setup();
  for (const patch of [{ correctionConfirmed: false }, { reason: "FREE_TEXT" }, { organisationId: "foreign" }, { idempotencyKey: "not-a-key" }])
    assert.equal((await f.corrections.reverse({ ...f.correction, ...patch })).code, "INVALID_REQUEST");
  assert.equal((await f.corrections.locations({ shopperId: "foreign" })).code, "INVALID_REQUEST");
  assert.equal(f.calls.length, 0);
});

test("inspection is read-only, scoped and reports the exact correction deadline", async () => {
  const f = await setup(), result = await f.corrections.inspect({ redemptionId: f.original.id, locationId: "shop-one" });
  assert.equal(result.ok, true); assert.equal(result.canReverse, true); assert.deepEqual(result.receipt, f.original);
  assert.equal(Date.parse(result.deadline), NOW.getTime() + 86_400_000); assert.ok(safeReversalResult("inspect", result));
  assert.equal(f.calls.some(c => c[1] === "write" || c[0] === "transaction"), false);
  assert.equal((await f.corrections.inspect({ redemptionId: f.original.id, locationId: "shop-two" })).code, "REDEMPTION_UNAVAILABLE");
  assert.equal((await f.corrections.inspect({ redemptionId: "foreign-receipt", locationId: "shop-one" })).code, "REDEMPTION_UNAVAILABLE");
});

test("cashier REDEEM cannot reverse; manager needs exact REVERSE location grant", async () => {
  const f = await setup();
  for (const role of ["VIEWER", "CONTENT_EDITOR"]) {
    f.context.membership.role = f.context.memberships[0].role = role;
    assert.equal((await f.corrections.locations()).code, "FORBIDDEN");
    assert.equal((await f.corrections.reverse(f.correction)).code, "FORBIDDEN");
  }
  f.context.membership.role = f.context.memberships[0].role = "MANAGER";
  assert.equal((await f.corrections.reverse(f.correction)).code, "FORBIDDEN");
  f.data.staff[0].capabilities = ["REVERSE"];
  const places = await f.corrections.locations(); assert.ok(safeReversalResult("locations", places));
  assert.deepEqual(places.locations, [{ id: "shop-one", name: "Public Home Shop" }]);
  assert.equal((await f.corrections.reverse({ ...f.correction, locationId: "shop-two" })).code, "LOCATION_UNAVAILABLE");
  assert.equal((await f.corrections.reverse(f.correction)).ok, true);
});

test("correction appends exactly one immutable ledger row without changing original claim, receipt or code", async () => {
  const f = await setup(), original = clone({ claims: f.data.claims, receipts: f.data.receipts, tokens: f.data.tokens });
  const result = await f.corrections.reverse(f.correction); assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(safeReversalResult("reverse", result)); assert.equal(result.receipt.reversal.reason, "WRONG_COUPON");
  assert.deepEqual({ ...result.receipt, reversal: null }, f.original); assert.equal(f.data.reversals.length, 1);
  assert.deepEqual({ claims: f.data.claims, receipts: f.data.receipts, tokens: f.data.tokens }, original);
  assert.equal(f.data.reversals[0].idempotencyKeyHash, createHmac("sha256", SECRET).update(`ruvanas-rewards-reversal-request:v1:${f.correction.idempotencyKey}`).digest("hex"));
  for (const secret of ["actorUserId", "shopperId", "organisationId", "locationIds", "requestHash", "idempotencyKeyHash"]) assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(f.calls.filter(c => c[1] === "write").length, 1);
});

test("exact completed replay survives the deadline, changed payload conflicts and another key cannot reverse twice", async () => {
  const f = await setup(), first = await f.corrections.reverse(f.correction); assert.equal(first.ok, true);
  f.now = new Date(NOW.getTime() + 86_400_001);
  assert.deepEqual(await f.corrections.reverse(f.correction), first);
  assert.equal((await f.corrections.reverse({ ...f.correction, reason: "PURCHASE_CANCELLED" })).code, "CONFLICT");
  assert.equal((await f.corrections.reverse({ ...f.correction, idempotencyKey: randomUUID() })).code, "ALREADY_REVERSED");
  const inspected = await f.corrections.inspect({ redemptionId: f.original.id, locationId: "shop-one" });
  assert.equal(inspected.canReverse, false); assert.deepEqual(inspected.receipt, first.receipt); assert.equal(f.data.reversals.length, 1);
  f.context.session.revokedAt = f.now;
  assert.equal((await f.corrections.reverse(f.correction)).code, "UNAUTHENTICATED");
});

test("unused correction window closes exactly at 24 hours and rejects future receipts", async () => {
  for (const offset of [86_400_000, 86_400_001, -1]) {
    const f = await setup(); f.now = new Date(NOW.getTime() + offset);
    assert.equal((await f.corrections.reverse(f.correction)).code, offset < 0 ? "REDEMPTION_UNAVAILABLE" : "REVERSAL_WINDOW_CLOSED");
    assert.equal(f.data.reversals.length, 0);
  }
});

test("shopper expiry/revocation and offer cancellation do not prevent an authorised receipt correction", async () => {
  const f = await setup(); f.data.shoppers[0].status = "SUSPENDED"; f.data.shoppers[0].authVersion++;
  f.data.shoppers[0].membership.revokedAt = NOW; f.data.offers[0].state = "CANCELLED";
  f.data.claims[0].expiresAt = new Date(NOW - 1);
  f.data.grants[0].monthlyRedemptions = 0;
  assert.equal((await f.corrections.reverse(f.correction)).ok, true);
});

test("current staff, merchant and location authority are rechecked after entering the transaction", async () => {
  for (const [mutate, code] of [
    [f => { f.context.session.revokedAt = NOW; }, "UNAUTHENTICATED"],
    [f => { f.context.membership.role = f.context.memberships[0].role = "VIEWER"; }, "FORBIDDEN"],
    [f => { f.data.grants[0].revokedAt = NOW; }, "NOT_ENTITLED"],
    [f => { f.data.locations[0].status = "INACTIVE"; }, "LOCATION_UNAVAILABLE"]
  ]) {
    const f = await setup(); f.beforeTransaction = () => mutate(f);
    assert.equal((await f.corrections.reverse(f.correction)).code, code); assert.equal(f.data.reversals.length, 0);
  }
});

test("an owner-to-manager role transition cannot switch the transaction to an unlocked staff grant", async () => {
  const f = await setup(); f.data.staff[0].capabilities = ["REVERSE"];
  f.beforeTransaction = () => { f.context.membership.role = f.context.memberships[0].role = "MANAGER"; };
  assert.equal((await f.corrections.reverse(f.correction)).code, "FORBIDDEN"); assert.equal(f.data.reversals.length, 0);
});

test("ledger storage, clock, gate, final authority and deadline failures roll back the correction", async () => {
  for (const kind of ["storage", "backwards", "disabled", "session", "deadline"]) {
    const f = await setup(); f.failReversal = kind === "storage";
    f.afterWrite = () => {
      if (kind === "backwards") f.now = new Date(NOW - 1);
      if (kind === "disabled") f.env.RUVANAS_RETAIL_REWARDS_REVERSALS_ENABLED = "false";
      if (kind === "session") f.context.session.revokedAt = NOW;
      if (kind === "deadline") f.now = new Date(NOW.getTime() + 86_400_000);
    };
    const result = await f.corrections.reverse(f.correction);
    assert.equal(result.code, { storage: "UNAVAILABLE", backwards: "UNAVAILABLE", disabled: "FEATURE_DISABLED", session: "UNAUTHENTICATED", deadline: "REVERSAL_WINDOW_CLOSED" }[kind]);
    assert.equal(f.data.reversals.length, 0); assert.equal(f.data.receipts.length, 1);
    assert.ok(!JSON.stringify(result).includes("private DB"));
  }
});
