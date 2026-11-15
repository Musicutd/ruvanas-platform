import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRewardCheckoutService, hashRewardCheckoutToken } from "../lib/retail-rewards/checkout-service.mjs";
import { safeCheckoutResult } from "../lib/retail-rewards/checkout-dtos.mjs";

import { fixture, clone, ENV, ACCESS, NOW, SECRET, CODE } from "./fixtures/rewards-checkout.mjs";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";

test("checkout token hashes are domain separated and never accept IDs or malformed codes", () => {
  const hash = hashRewardCheckoutToken(CODE, SECRET);
  assert.equal(hash, createHmac("sha256", SECRET).update(`ruvanas-rewards-checkout:v1:${CODE}`).digest("hex"));
  assert.notEqual(hash, createHmac("sha256", SECRET).update(`ruvanas-rewards-shopper:v1:${CODE}`).digest("hex"));
  for (const value of ["claim-one", CODE.toUpperCase(), `${CODE} `, null]) assert.throws(() => hashRewardCheckoutToken(value, SECRET));
  assert.throws(() => hashRewardCheckoutToken(CODE, "short"));
});

test("all checkout operations default off without auth, clock, database or transaction access", async () => {
  const no = () => { throw new Error("Forbidden effect"); };
  const service = createRewardCheckoutService({ db: new Proxy({}, { get: no }), loadShopper: no, loadContext: no, clock: no });
  for (const result of await Promise.all([service.claim({}), service.wallet(), service.credential("claim"), service.staffLocations(), service.validate({}), service.redeem({})])) assert.equal(result.code, "FEATURE_DISABLED");
});

test("strict input rejects authority injection and unsafe purchase values before access", async () => {
  const f = fixture();
  assert.equal((await f.service.claim({ shopSlug: "home-shop", offerSlug: "home-offer", expectedRevision: 1, idempotencyKey: randomUUID(), shopperId: "another" })).code, "INVALID_REQUEST");
  assert.equal((await f.service.wallet({ shopperId: "another" })).code, "INVALID_REQUEST");
  for (const patch of [{ eligibleSpendMinor: -1 }, { eligibleSpendMinor: 2.5 }, { eligibleSpendMinor: 100_000_001 }, { termsConfirmed: false }, { organisationId: "foreign" }]) {
    assert.equal((await f.service.redeem({ ...f.input, ...patch })).code, "INVALID_REQUEST");
  }
  assert.equal(f.calls.length, 0); assert.equal(f.authCount, 0);
});

test("wallet returns only its shopper's pinned published terms and explicit public fields", async () => {
  const f = fixture(); f.data.claims.push({ ...clone(f.data.claims[0]), id: "foreign-claim", shopperId: "another-shopper" });
  const result = await f.service.wallet(); assert.equal(result.ok, true); assert.equal(result.claims.length, 1); assert.equal(result.claims[0].terms.title, "Issued home offer");
  assert.equal(result.claims[0].revision, 1); assert.ok(safeCheckoutResult("wallet", result));
  for (const value of ["Unpublished", "organisationId", "shopperAuthVersion", "locationIds", "tokenHash", "another-shopper"]) assert.ok(!JSON.stringify(result).includes(value));
  f.afterAuth = () => ({ ok: false, code: "UNAUTHENTICATED" }); assert.equal((await f.service.wallet()).code, "UNAUTHENTICATED");
});

test("pilot shopper wallet and issued-code access exclude an otherwise valid non-pilot merchant", async () => {
  const f = fixture(); Object.assign(f.env, pilotPreviewEnvironment());
  assert.equal((await f.service.wallet()).claims.length, 1);
  assert.equal((await f.service.credential("claim-one")).ok, true);
  f.env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["different-org"]';
  assert.equal((await f.service.wallet()).claims.length, 0);
  assert.equal((await f.service.credential("claim-one")).code, "CLAIM_UNAVAILABLE");
  assert.equal(f.data.receipts.length, 0);
});

test("idempotent shopper claim retry cannot disclose a claim after its merchant leaves the pilot", async () => {
  const f = fixture(), key = randomUUID(); Object.assign(f.env, pilotPreviewEnvironment());
  f.data.requests.push({ shopperId: "shopper-one", claimId: "claim-one",
    idempotencyKeyHash: createHmac("sha256", SECRET).update(`ruvanas-rewards-claim-request:v1:${key}`).digest("hex"),
    requestHash: createHash("sha256").update(JSON.stringify(["home-shop", "home-offer", 1])).digest("hex") });
  f.env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["different-org"]';
  const result = await f.service.claim({ shopSlug: "home-shop", offerSlug: "home-offer", expectedRevision: 1, idempotencyKey: key });
  assert.equal(result.code, "CLAIM_UNAVAILABLE"); assert.equal(f.data.claims.length, 1);
  assert.ok(!JSON.stringify(result).includes("Issued home offer"));
});

test("idempotent claim retry returns its original claim, rejects changed payload and rechecks authorization", async () => {
  const f = fixture(), key = randomUUID(), input = { shopSlug: "home-shop", offerSlug: "home-offer", expectedRevision: 1, idempotencyKey: key };
  f.data.requests.push({ shopperId: "shopper-one", claimId: "claim-one",
    idempotencyKeyHash: createHmac("sha256", SECRET).update(`ruvanas-rewards-claim-request:v1:${key}`).digest("hex"),
    requestHash: createHash("sha256").update(JSON.stringify(["home-shop", "home-offer", 1])).digest("hex") });
  const result = await f.service.claim(input); assert.equal(result.ok, true); assert.equal(result.claim.id, "claim-one"); assert.equal(f.data.claims.length, 1);
  assert.equal((await f.service.claim({ ...input, expectedRevision: 2 })).code, "CONFLICT");
  f.afterAuth = count => count === 3 ? { ok: false, code: "UNAUTHENTICATED" } : undefined;
  f.authCount = 0; assert.equal((await f.service.claim(input)).code, "UNAUTHENTICATED");
});

test("credential rotation creates a five-minute hash-only code without consuming a use", async () => {
  const f = fixture(), result = await f.service.credential("claim-one"); assert.equal(result.ok, true); assert.ok(safeCheckoutResult("credential", result));
  assert.equal(Date.parse(result.tokenExpiresAt) - NOW, 300_000); assert.equal(f.data.tokens.length, 1);
  assert.equal(f.data.tokens[0].tokenHash, hashRewardCheckoutToken(result.token, SECRET)); assert.notEqual(result.token, CODE);
  assert.ok(!JSON.stringify(f.data).includes(result.token)); assert.equal(f.data.receipts.length, 0);
  assert.equal((await f.service.validate({ token: CODE, locationId: "shop-one" })).code, "CLAIM_UNAVAILABLE");
  assert.equal((await f.service.credential("foreign-claim")).code, "CLAIM_UNAVAILABLE");
});

test("failed final expiry or feature check rolls back token rotation", async () => {
  for (const failure of ["expired", "disabled"]) {
    const f = fixture(), previous = clone(f.data.tokens);
    f.afterWrite = () => { if (failure === "expired") f.now = new Date(NOW.getTime() + 3600_000); else f.env.RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED = "false"; };
    assert.equal((await f.service.credential("claim-one")).code, failure === "expired" ? "CLAIM_EXPIRED" : "FEATURE_DISABLED"); assert.deepEqual(f.data.tokens, previous);
  }
});

test("REDEEM-only cashier sees only permitted shops and validation consumes nothing", async () => {
  const f = fixture(); f.context.membership.role = f.context.memberships[0].role = "VIEWER";
  const locations = await f.service.staffLocations(); assert.deepEqual(locations.locations, [{ id: "shop-one", name: "Public Home Shop" }]);
  const result = await f.service.validate({ token: CODE, locationId: "shop-one" }); assert.equal(result.ok, true); assert.ok(safeCheckoutResult("validate", result));
  assert.equal(result.review.terms.percentBps, 1000); assert.equal(f.data.receipts.length, 0); assert.equal(f.calls.some(c => c[1] === "write"), false);
  assert.equal((await f.service.validate({ token: CODE, locationId: "shop-two" })).code, "LOCATION_UNAVAILABLE");
});

test("redemption uses issued discount, returns one receipt and supports safe same-payload retries", async () => {
  const f = fixture(), first = await f.service.redeem(f.input); assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.receipt.discountMinor, 500); assert.equal(first.receipt.offerTitle, "Issued home offer"); assert.ok(safeCheckoutResult("redeem", first));
  assert.equal(f.data.receipts.length, 1); assert.ok(!JSON.stringify(f.data.receipts).includes(CODE));
  f.now = new Date(NOW.getTime() + 3600_001);
  assert.deepEqual(await f.service.redeem(f.input), first); assert.equal(f.data.receipts.length, 1);
  assert.equal((await f.service.redeem({ ...f.input, eligibleSpendMinor: 6000 })).code, "CONFLICT");
  assert.equal((await f.service.redeem({ ...f.input, idempotencyKey: randomUUID() })).code, "ALREADY_REDEEMED");
});

test("cashier must confirm matching currency and minimum qualifying spend", async () => {
  const f = fixture();
  for (const patch of [{ currency: "USD" }, { eligibleSpendMinor: 4999 }, { termsConfirmed: false }]) assert.equal((await f.service.redeem({ ...f.input, ...patch })).code, "INVALID_REQUEST");
  assert.equal(f.data.receipts.length, 0);
});

test("current quota and stable-offer aggregate usage are enforced before new receipt", async () => {
  for (const kind of ["daily", "monthly"]) {
    const f = fixture();
    if (kind === "monthly") f.data.grants[0].monthlyRedemptions = 1;
    const count = kind === "daily" ? 3 : 1;
    for (let i = 0; i < count; i++) f.data.receipts.push({ id: `old-${i}`, organisationId: "org-one", offerId: kind === "daily" ? "offer-one" : "another-offer",
      shopperId: "shopper-one", locationId: "other-old-shop", claimId: `old-claim-${i}`, occurredAt: NOW });
    assert.equal((await f.service.redeem(f.input)).code, "LIMIT_REACHED"); assert.equal(f.data.receipts.length, count);
  }
});

test("current shopper revocation, merchant revocation and cancelled offer block issued claims", async () => {
  for (const [change, code] of [[f => { f.data.shoppers[0].authVersion++; }, "CLAIM_UNAVAILABLE"], [f => { f.data.shoppers[0].membership.revokedAt = NOW; }, "CLAIM_UNAVAILABLE"],
    [f => { f.data.grants[0].revokedAt = NOW; }, "NOT_ENTITLED"], [f => { f.data.offers[0].state = "CANCELLED"; }, "CLAIM_UNAVAILABLE"]]) {
    const f = fixture(); f.beforeTransaction = () => change(f); assert.equal((await f.service.redeem(f.input)).code, code); assert.equal(f.data.receipts.length, 0);
  }
});

test("checkout rejects role transitions that would need a different staff grant locking path", async () => {
  const f = fixture(); f.beforeTransaction = () => { f.context.membership.role = f.context.memberships[0].role = "MANAGER"; };
  assert.equal((await f.service.redeem(f.input)).code, "FORBIDDEN"); assert.equal(f.data.receipts.length, 0);
});

test("issued pause policy is honoured without requiring the old discovery listing", async () => {
  const f = fixture(); f.data.offers[0].state = "PAUSED"; assert.equal((await f.service.redeem(f.input)).ok, true);
  const blocked = fixture(); blocked.data.offers[0].state = "PAUSED"; blocked.data.snapshots[0].terms.pausedClaimsPolicy = "BLOCK_WHILE_PAUSED";
  assert.equal((await blocked.service.redeem(blocked.input)).code, "CLAIM_UNAVAILABLE"); assert.equal(blocked.data.receipts.length, 0);
});

test("storage and final-expiry failures roll back receipt creation without leaking diagnostics", async () => {
  const f = fixture(); f.failReceipt = true; const failed = await f.service.redeem(f.input); assert.equal(failed.code, "UNAVAILABLE"); assert.ok(!JSON.stringify(failed).includes("private DB")); assert.equal(f.data.receipts.length, 0);
  const g = fixture(); g.afterWrite = () => { g.now = new Date(NOW.getTime() + 300_000); };
  assert.equal((await g.service.redeem(g.input)).code, "CLAIM_EXPIRED"); assert.equal(g.data.receipts.length, 0);
});

test("reversed receipt stays consumed and checkout retries and wallet show its latest correction even when reversal gate is off", async () => {
  const f = fixture(), first = await f.service.redeem(f.input); assert.equal(first.receipt.reversal, null);
  f.data.reversals.push({ id: "reversal-one", redemptionId: first.receipt.id, organisationId: "org-one", reason: "WRONG_COUPON", occurredAt: NOW });
  const retry = await f.service.redeem(f.input); assert.equal(retry.ok, true); assert.ok(safeCheckoutResult("redeem", retry));
  assert.equal(retry.receipt.reversal.reason, "WRONG_COUPON"); assert.deepEqual({ ...retry.receipt, reversal: null }, first.receipt);
  const wallet = await f.service.wallet(); assert.ok(safeCheckoutResult("wallet", wallet)); assert.equal(wallet.claims[0].status, "REVERSED");
  assert.equal((await f.service.credential("claim-one")).code, "ALREADY_REDEEMED");
  assert.equal((await f.service.redeem({ ...f.input, idempotencyKey: randomUUID() })).code, "ALREADY_REDEEMED");
  assert.equal(f.data.receipts.length, 1);
});

test("same-tenant reversals restore net offer, shopper and daily allowance but keep monthly service usage gross", async () => {
  for (const kind of ["net", "gross", "foreign"]) {
    const f = fixture(); f.data.snapshots[0].terms.totalLimit = f.data.snapshots[0].terms.perShopperLimit = f.data.snapshots[0].terms.perShopperDailyLimit = 1;
    f.data.receipts.push({ id: "old-receipt", organisationId: "org-one", offerId: "offer-one", shopperId: "shopper-one", locationId: "shop-two", claimId: "old-claim", occurredAt: NOW });
    f.data.reversals.push({ id: "old-reversal", redemptionId: "old-receipt", organisationId: kind === "foreign" ? "foreign" : "org-one", reason: "WRONG_COUPON", occurredAt: NOW });
    if (kind === "gross") f.data.grants[0].monthlyRedemptions = 1;
    const result = await f.service.redeem(f.input);
    assert.equal(result.ok, kind === "net", JSON.stringify(result));
    if (kind !== "net") assert.equal(result.code, "LIMIT_REACHED");
    assert.equal(f.data.receipts.length, kind === "net" ? 2 : 1);
  }
});
