import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCheckoutHttp } from "../lib/retail-rewards/checkout-http.mjs";
import { readCheckoutPolicy, createClaimSchema, staffRedeemSchema } from "../lib/retail-rewards/checkout-contracts.mjs";
import { safeCheckoutResult } from "../lib/retail-rewards/checkout-dtos.mjs";

const origin = "https://www.ruvanas.com";
const env = { NODE_ENV: "production", RUVANAS_PUBLIC_URL: origin, ALLOWED_ORIGINS: origin,
  RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true", RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "true" };
const body = { shopSlug: "sample-shop", offerSlug: "sample-offer", expectedRevision: 1, idempotencyKey: randomUUID() };
const token = "a".repeat(64);
const receipt = { id: "receipt-safe", redeemedAt: "2026-11-14T08:00:00.000Z", shopName: "Sample shop", offerTitle: "Ten percent", revision: 1,
  currency: "EUR", eligibleSpendMinor: 5000, discountMinor: 500, reversal: null };
function request(path = "/api/rewards/claims", data, options = {}) {
  return new Request(origin + path, { method: data === undefined ? "GET" : "POST", ...options,
    headers: { origin, ...(data === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
    ...(data === undefined ? {} : { body: typeof data === "string" ? data : JSON.stringify(data) }) });
}
function fixture(overrides = {}) {
  const calls = [], service = {
    wallet: async input => { calls.push(["wallet", input]); return { ok: true, claims: [], page: 1, hasMore: false }; },
    claim: async input => { calls.push(["claim", input]); return { ok: false, code: "CONFLICT" }; },
    credential: async id => { calls.push(["credential", id]); return { ok: false, code: "CONFLICT" }; },
    staffLocations: async () => ({ ok: true, locations: [{ id: "shop-A", name: "Shop A" }], page: 1, hasMore: false }),
    validate: async input => { calls.push(["validate", input]); return { ok: false, code: "CONFLICT" }; },
    redeem: async input => { calls.push(["redeem", input]); return { ok: true, receipt }; }
  };
  const handlers = createCheckoutHttp({ env,
    authorizeShopper: async () => { calls.push(["shopper"]); return { ok: true, shopperId: "shopper-A" }; },
    authorizeStaff: async id => { calls.push(["staff", id]); return { ok: true, organisationId: "org-A", userId: "user-A" }; },
    rateLimit: async value => { calls.push(["limit", value.operation, value.principal]); return { allowed: true }; },
    loadService: async () => { calls.push(["service"]); return service; }, ...overrides });
  return { handlers, calls, service };
}

test("checkout requires all exact enabled gates; strict bodies cannot provide identity or fractional money", () => {
  assert.equal(readCheckoutPolicy({}).enabled, false); assert.equal(readCheckoutPolicy(env).enabled, true);
  for (const key of ["RUVANAS_RETAIL_REWARDS_ENABLED", "RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED", "RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED"])
    for (const value of [undefined, "false", "TRUE", "1", true]) assert.equal(readCheckoutPolicy({ ...env, [key]: value }).enabled, false);
  assert.ok(createClaimSchema.safeParse(body).success); assert.equal(createClaimSchema.safeParse({ ...body, shopperId: "foreign" }).success, false);
  const redemption = { token, locationId: "shop-A", idempotencyKey: randomUUID(), eligibleSpendMinor: 5000, currency: "EUR", termsConfirmed: true };
  assert.ok(staffRedeemSchema.safeParse(redemption).success);
  for (const change of [{ eligibleSpendMinor: 1.5 }, { eligibleSpendMinor: -1 }, { termsConfirmed: false }, { organisationId: "foreign" }, { token: "1234" }])
    assert.equal(staffRedeemSchema.safeParse({ ...redemption, ...change }).success, false);
});

test("disabled checkout returns before any auth, throttle or database adapter", async () => {
  const f = fixture({ env: {} });
  for (const [method, req, id] of [["wallet", request()], ["claim", request(undefined, body)], ["credential", request("/credential", {}), "claim-A"],
    ["staffLocations", request("/locations")], ["validate", request("/validate", {})], ["redeem", request("/redeem", {})]]) {
    const response = await f.handlers[method](req, id); assert.equal(response.status, 403); assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.deepEqual(f.calls, []);
});

test("mutations reject wrong method, foreign origin, cross-site fetch and credential query before auth", async () => {
  const f = fixture();
  assert.equal((await f.handlers.claim(request())).status, 405);
  assert.equal((await f.handlers.claim(request(undefined, body, { headers: { origin: "https://foreign.invalid" } }))).status, 403);
  assert.equal((await f.handlers.claim(request(undefined, body, { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
  assert.equal((await f.handlers.claim(request("/api/rewards/claims?token=not-allowed", body))).status, 400);
  assert.deepEqual(f.calls, []);
});

test("streamed JSON limit and strict fields reject forged identities despite false content length", async () => {
  const f = fixture();
  assert.equal((await f.handlers.claim(request(undefined, " ".repeat(8300), { headers: { "content-length": "1" } }))).status, 400);
  assert.equal((await f.handlers.claim(request(undefined, { ...body, shopperId: "other" }))).status, 400);
  assert.equal((await f.handlers.claim(request(undefined, body, { headers: { "content-type": "text/plain" } }))).status, 400);
  assert.equal(f.calls.some(row => ["service", "shopper", "staff"].includes(row[0])), false);
});

test("shopper and staff authority use separate adapters; exact shop reaches staff authorization", async () => {
  const f = fixture();
  await f.handlers.claim(request(undefined, body));
  assert.ok(f.calls.some(row => row[0] === "shopper")); assert.ok(!f.calls.some(row => row[0] === "staff"));
  f.calls.length = 0;
  const response = await f.handlers.redeem(request("/redeem", { token, locationId: "shop-A", idempotencyKey: randomUUID(), eligibleSpendMinor: 5000, currency: "EUR", termsConfirmed: true }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, receipt });
  assert.ok(f.calls.some(row => row[0] === "staff" && row[1] === "shop-A")); assert.ok(!f.calls.some(row => row[0] === "shopper"));
  assert.ok(f.calls.some(row => row[0] === "limit" && row[2] === "staff:org-A:user-A"));
});

test("IP throttle precedes authentication; denied identity and principal throttle cannot call service", async () => {
  const ip = fixture({ rateLimit: async () => ({ allowed: false }) });
  assert.equal((await ip.handlers.wallet(request())).status, 429); assert.deepEqual(ip.calls, []);
  const denied = fixture({ authorizeShopper: async () => ({ ok: false, code: "UNAUTHENTICATED" }) });
  assert.equal((await denied.handlers.claim(request(undefined, body))).status, 401); assert.ok(!denied.calls.some(row => row[0] === "service"));
  const principal = fixture({ rateLimit: async ({ principal }) => ({ allowed: !principal }) });
  assert.equal((await principal.handlers.wallet(request())).status, 429); assert.ok(!principal.calls.some(row => row[0] === "service"));
});

test("wallet and location query validation prevent identity/token enumeration", async () => {
  const f = fixture();
  for (const query of ["?shopperId=another", "?token=" + token, "?page=1&page=2", "?page=0", "?page=1.2"]) {
    assert.equal((await f.handlers.wallet(request("/api/rewards/claims" + query))).status, 400);
    assert.equal((await f.handlers.staffLocations(request("/locations" + query))).status, 400);
  }
  assert.ok(!f.calls.some(row => ["service", "shopper", "staff"].includes(row[0])));
  assert.equal((await f.handlers.wallet(request())).status, 200);
});

test("malformed/private nested responses and raw exceptions fail closed without leaking", async () => {
  assert.equal(safeCheckoutResult("redeem", { ok: true, receipt: { ...receipt, shopperId: "PRIVATE" } }), null);
  assert.equal(safeCheckoutResult("redeem", { ok: true, receipt, token }), null);
  const f = fixture(); f.service.redeem = async () => { throw new Error("PRIVATE DATABASE SECRET"); };
  const result = await f.handlers.redeem(request("/redeem", { token, locationId: "shop-A", idempotencyKey: randomUUID(), eligibleSpendMinor: 5000, currency: "EUR", termsConfirmed: true }));
  assert.equal(result.status, 503); assert.ok(!(await result.text()).includes("PRIVATE"));
  f.service.wallet = async () => ({ ok: true, claims: [], page: 1, hasMore: false, secret: token });
  assert.equal((await f.handlers.wallet(request())).status, 503);
});
