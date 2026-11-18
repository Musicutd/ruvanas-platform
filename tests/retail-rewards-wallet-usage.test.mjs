import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { safeCheckoutResult } from "../lib/retail-rewards/checkout-dtos.mjs";
import { fixture, clone, NOW, SECRET } from "./fixtures/rewards-checkout.mjs";

function receipt(f, id, patch = {}) {
  f.data.receipts.push({ id, organisationId: "org-one", offerId: "offer-one", shopperId: "shopper-one",
    claimId: `history-${id}`, locationId: "shop-two", occurredAt: NOW, revision: 2, ...patch });
}
function existingRetry(f) {
  const key = randomUUID(), input = { shopSlug: "home-shop", offerSlug: "home-offer", expectedRevision: 1, idempotencyKey: key };
  f.data.requests.push({ shopperId: "shopper-one", claimId: "claim-one",
    idempotencyKeyHash: createHmac("sha256", SECRET).update(`ruvanas-rewards-claim-request:v1:${key}`).digest("hex"),
    requestHash: createHash("sha256").update(JSON.stringify([input.shopSlug, input.offerSlug, input.expectedRevision])).digest("hex") });
  return input;
}
function interceptCounts(f, callback) {
  const decorate = client => ({ ...client, rewardRedemption: { ...client.rewardRedemption,
    count: async args => callback(await client.rewardRedemption.count(args), args) } });
  const transaction = f.db.$transaction;
  const direct = f.db.rewardRedemption;
  f.db.rewardRedemption = { ...direct, count: async args => callback(await direct.count(args), args) };
  f.db.$transaction = (execute, options) => transaction(tx => execute(decorate(tx)), options);
}

test("wallet usage counts exact shopper, tenant and stable offer across revisions and locations", async () => {
  const f = fixture();
  receipt(f, "used-original", { revision: 1, locationId: "shop-one" });
  receipt(f, "used-new-revision", { revision: 99, locationId: "shop-two" });
  receipt(f, "corrected");
  f.data.reversals.push({ id: "correction", redemptionId: "corrected", organisationId: "org-one", reason: "WRONG_COUPON", occurredAt: NOW });
  receipt(f, "another-shopper", { shopperId: "shopper-two" });
  receipt(f, "another-offer", { offerId: "offer-two" });
  receipt(f, "another-tenant", { organisationId: "org-two" });
  // Neither a changed draft allowance nor an additional issued claim counts.
  f.data.offers[0].draft.perShopperLimit = 100;
  f.data.claims.push({ ...clone(f.data.claims[0]), id: "another-issued" });
  const before = clone(f.data), result = await f.service.wallet();
  assert.equal(result.ok, true);
  assert.equal(result.claims.length, 2);
  for (const claim of result.claims) assert.deepEqual(claim.usage, { used: 2, limit: 10, remaining: 8, asOf: NOW.toISOString() });
  assert.deepEqual(f.data, before, "wallet does not mutate claims, tokens or redemptions");
  assert.deepEqual(f.calls.filter(call => call[0] === "receipts" && call[1] === "count"), [
    ["receipts", "count", { organisationId: "org-one", offerId: "offer-one", shopperId: "shopper-one", reversal: null }]
  ], "duplicate claims share one exact-scope count within this response");
  assert.ok(safeCheckoutResult("wallet", result));
});

test("each issued revision retains its own allowance while sharing the stable-offer observation", async () => {
  const f = fixture();
  f.data.snapshots.push({ ...clone(f.data.snapshots[0]), revision: 2, terms: { ...clone(f.data.snapshots[0].terms), perShopperLimit: 4 } });
  f.data.claims.push({ ...clone(f.data.claims[0]), id: "newer-claim", revision: 2 });
  for (let i = 0; i < 5; i++) receipt(f, `used-${i}`);
  const result = await f.service.wallet();
  assert.deepEqual(result.claims.map(c => [c.revision, c.usage.limit, c.usage.used, c.usage.remaining]), [[1, 10, 5, 5], [2, 4, 5, 0]]);
  assert.ok(result.claims.every(c => c.status === "READY"), "remaining uses is not a replacement for claim availability");
  assert.equal(f.calls.filter(c => c[0] === "receipts" && c[1] === "count").length, 1);
  assert.ok(safeCheckoutResult("wallet", result));
});

test("usage observations refresh on the next wallet read instead of persisting a cached allowance", async () => {
  const f = fixture();
  assert.equal((await f.service.wallet()).claims[0].usage.remaining, 10);
  receipt(f, "new-use");
  f.now = new Date(NOW.getTime() + 1000);
  const second = await f.service.wallet();
  assert.deepEqual(second.claims[0].usage, { used: 1, limit: 10, remaining: 9, asOf: f.now.toISOString() });
});

test("single-use coupons show one then zero uses without changing receipt and reversed-code status", async () => {
  const f = fixture();
  Object.assign(f.data.snapshots[0].terms, { usage: "SINGLE_USE", perShopperLimit: 1, perShopperDailyLimit: 1 });
  const first = await f.service.wallet();
  assert.equal(first.ok, true);
  assert.deepEqual(first.claims[0].usage, { used: 0, limit: 1, remaining: 1, asOf: NOW.toISOString() });
  const redeemed = await f.service.redeem(f.input);
  assert.equal(redeemed.ok, true);
  const consumed = (await f.service.wallet()).claims[0];
  assert.equal(consumed.status, "REDEEMED");
  assert.equal(consumed.usage.remaining, 0);
  f.data.reversals.push({ id: "correction", redemptionId: redeemed.receipt.id, organisationId: "org-one", reason: "WRONG_COUPON", occurredAt: NOW });
  const reversed = (await f.service.wallet()).claims[0];
  assert.equal(reversed.status, "REVERSED");
  assert.equal(reversed.usage.remaining, 1);
  assert.equal((await f.service.credential(reversed.id)).code, "ALREADY_REDEEMED", "restored allowance never reactivates this old coupon");
});

test("expired and unavailable claims retain their status even with personal uses left", async () => {
  for (const kind of ["expired", "unavailable"]) {
    const f = fixture(); receipt(f, "old-use");
    if (kind === "expired") f.now = new Date(NOW.getTime() + 3600_001);
    else f.data.offers[0].state = "CANCELLED";
    const result = await f.service.wallet();
    assert.equal(result.claims[0].status, kind === "expired" ? "EXPIRED" : "UNAVAILABLE");
    assert.equal(result.claims[0].usage.remaining, 9);
  }
});

test("claim retry and credential report usage without consuming another use", async () => {
  const f = fixture(); receipt(f, "old-use");
  const retry = await f.service.claim(existingRetry(f));
  const code = await f.service.credential("claim-one");
  for (const [operation, result] of [["claim", retry], ["credential", code]]) {
    assert.equal(result.ok, true);
    assert.deepEqual(result.claim.usage, { used: 1, limit: 10, remaining: 9, asOf: NOW.toISOString() });
    assert.ok(safeCheckoutResult(operation, result));
  }
  assert.equal(f.data.receipts.length, 1);
  assert.equal(f.data.claims.length, 1);
});

test("missing, invalid or failed counts fail closed instead of inventing a fresh allowance", async () => {
  for (const value of [undefined, null, -1, 0.5, "0", Infinity, Number.MAX_SAFE_INTEGER + 1, new Error("private connection string")]) {
    const f = fixture();
    interceptCounts(f, () => { if (value instanceof Error) throw value; return value; });
    const result = await f.service.wallet();
    assert.equal(result.code, "UNAVAILABLE");
    assert.ok(!JSON.stringify(result).includes("private connection"));
    assert.ok(!Object.hasOwn(result, "claims"));
  }
});

test("post-count auth and feature revocation suppress the wallet and roll back code rotation", async () => {
  for (const operation of ["wallet", "credential"]) for (const failure of ["auth", "flag"]) {
    const f = fixture(), before = clone(f.data.tokens);
    interceptCounts(f, count => {
      if (failure === "auth") f.afterAuth = () => ({ ok: false, code: "UNAUTHENTICATED" });
      else f.env.RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED = "false";
      return count;
    });
    const result = operation === "wallet" ? await f.service.wallet() : await f.service.credential("claim-one");
    assert.equal(result.code, failure === "auth" ? "UNAUTHENTICATED" : "FEATURE_DISABLED");
    assert.deepEqual(f.data.tokens, before);
    assert.ok(!Object.hasOwn(result, "claims"));
  }
});

test("count delays cannot return a code past expiry or hide a clock rollback", async () => {
  for (const mode of ["expired", "backwards"]) {
    const f = fixture(), before = clone(f.data.tokens);
    interceptCounts(f, count => { f.now = new Date(NOW.getTime() + (mode === "expired" ? 3600_001 : -1000)); return count; });
    const result = await f.service.credential("claim-one");
    assert.equal(result.code, mode === "expired" ? "CLAIM_EXPIRED" : "UNAVAILABLE");
    assert.deepEqual(f.data.tokens, before);
  }
});

test("claim DTO rejects missing, inconsistent, over-precise and private usage fields", async () => {
  const valid = (await fixture().service.wallet()).claims[0];
  for (const usage of [undefined, null, { ...valid.usage, limit: 11 }, { ...valid.usage, remaining: 9 },
    { ...valid.usage, used: -1 }, { ...valid.usage, used: 0.5 }, { ...valid.usage, used: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid.usage, asOf: "not a date" }, { ...valid.usage, shopperId: "private" }]) {
    const claim = { ...valid, usage };
    assert.equal(safeCheckoutResult("wallet", { ok: true, claims: [claim], page: 1, hasMore: false }), null);
    assert.equal(safeCheckoutResult("claim", { ok: true, claim }), null);
  }
});
