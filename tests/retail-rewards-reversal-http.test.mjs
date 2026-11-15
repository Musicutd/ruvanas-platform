import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createReversalHttp } from "../lib/retail-rewards/reversal-http.mjs";
import { readReversalPolicy, reversalRequestSchema, REVERSAL_WINDOW_MS } from "../lib/retail-rewards/reversal-contracts.mjs";
import { safeReversalResult } from "../lib/retail-rewards/reversal-dtos.mjs";
import { safeCheckoutResult } from "../lib/retail-rewards/checkout-dtos.mjs";
import { fixture as checkoutFixture } from "./fixtures/rewards-checkout.mjs";

const origin = "https://www.ruvanas.com";
const env = { NODE_ENV: "production", RUVANAS_PUBLIC_URL: origin, ALLOWED_ORIGINS: origin,
  RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "true", RUVANAS_RETAIL_REWARDS_REVERSALS_ENABLED: "true" };
const receipt = { id: "receipt-safe", redeemedAt: "2026-11-14T08:00:00.000Z", shopName: "Sample shop", offerTitle: "Ten percent",
  revision: 1, currency: "EUR", eligibleSpendMinor: 5000, discountMinor: 500, reversal: null };
const reversal = { id: "correction-safe", reversedAt: "2026-11-14T09:00:00.000Z", reason: "WRONG_COUPON" };
const inspect = { redemptionId: receipt.id, locationId: "shop-A" };
const body = { ...inspect, reason: reversal.reason, idempotencyKey: randomUUID(), correctionConfirmed: true };
const deadline = new Date(Date.parse(receipt.redeemedAt) + REVERSAL_WINDOW_MS).toISOString();
function request(path = "/api/retail-rewards/reversals/locations", data, options = {}) {
  return new Request(origin + path, { method: data === undefined ? "GET" : "POST", ...options,
    headers: { origin, ...(data === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
    ...(data === undefined ? {} : { body: typeof data === "string" ? data : JSON.stringify(data) }) });
}
function fixture(overrides = {}) {
  const calls = [], service = {
    locations: async input => { calls.push(["locations", input]); return { ok: true, locations: [{ id: "shop-A", name: "Shop A" }], page: 1, hasMore: false }; },
    inspect: async input => { calls.push(["inspect", input]); return { ok: true, receipt, canReverse: true, deadline }; },
    reverse: async input => { calls.push(["reverse", input]); return { ok: true, receipt: { ...receipt, reversal } }; }
  };
  const handlers = createReversalHttp({ env,
    authorizeStaff: async id => { calls.push(["staff", id]); return { ok: true, organisationId: "org-A", userId: "user-A" }; },
    rateLimit: async value => { calls.push(["limit", value.operation, value.principal]); return { allowed: true }; },
    loadService: async () => { calls.push(["service"]); return service; }, ...overrides });
  return { handlers, calls, service };
}

test("reversals require every exact enable flag and explicit constrained confirmation", () => {
  assert.equal(readReversalPolicy({}).enabled, false); assert.equal(readReversalPolicy(env).enabled, true);
  for (const key of Object.keys(env).filter(key => key.endsWith("_ENABLED")))
    for (const value of [undefined, "false", "TRUE", "1", true, "garbage"])
      assert.equal(readReversalPolicy({ ...env, [key]: value }).enabled, false);
  assert.ok(reversalRequestSchema.safeParse(body).success);
  for (const change of [{ correctionConfirmed: false }, { reason: "custom text" }, { reason: "" }, { organisationId: "other" },
    { shopperId: "other" }, { refundMinor: 500 }, { idempotencyKey: "guess" }, { redemptionId: "" }])
    assert.equal(reversalRequestSchema.safeParse({ ...body, ...change }).success, false);
});

test("disabled routes fail before auth, throttles, bodies and service adapters", async () => {
  const f = fixture({ env: {} });
  for (const [method, data] of [["locations", undefined], ["inspect", inspect], ["reverse", body]]) {
    const response = await f.handlers[method](request(undefined, data));
    assert.equal(response.status, 403); assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.equal(response.headers.get("vary"), "Cookie"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  assert.deepEqual(f.calls, []);
});

test("methods, foreign origin, cross-site fetch and query credentials rejected before adapters", async () => {
  const f = fixture();
  assert.equal((await f.handlers.locations(request(undefined, {}))).status, 405);
  for (const op of ["inspect", "reverse"]) {
    const data = op === "inspect" ? inspect : body;
    assert.equal((await f.handlers[op](request())).status, 405);
    assert.equal((await f.handlers[op](request(undefined, data, { headers: { origin: "https://other.invalid" } }))).status, 403);
    assert.equal((await f.handlers[op](request(undefined, data, { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
    assert.equal((await f.handlers[op](request("/reverse?redemptionId=receipt-safe", data))).status, 400);
  }
  assert.deepEqual(f.calls, []);
});

test("body caps, wrong content type, invalid JSON and forged scope do not authenticate", async () => {
  const f = fixture();
  for (const [data, options] of [[" ".repeat(8300), { headers: { "content-length": "1" } }], [body, { headers: { "content-length": "9000" } }],
    [body, { headers: { "content-length": "NaN" } }], [body, { headers: { "content-type": "text/plain" } }], ["{broken", {}],
    [{ ...body, organisationId: "foreign" }, {}], [{ ...body, correctionConfirmed: false }, {}]]) {
    assert.equal((await f.handlers.reverse(request(undefined, data, options))).status, 400);
  }
  assert.ok(!f.calls.some(([name]) => ["staff", "service"].includes(name)));
});

test("locations only accept one bounded page without identity or token enumeration", async () => {
  const f = fixture();
  for (const query of ["?page=1&page=2", "?page=0", "?page=-1", "?page=1.5", "?page=1001", "?page=01", "?organisationId=other", "?token=secret"])
    assert.equal((await f.handlers.locations(request("/locations" + query))).status, 400);
  assert.ok(!f.calls.some(([name]) => ["staff", "service"].includes(name)));
  assert.equal((await f.handlers.locations(request("/locations?page=2"))).status, 200);
  assert.ok(f.calls.some(([name, input]) => name === "locations" && input.page === 2));
});

test("receipt and exact shop are authorized as staff before service and global principal throttle", async () => {
  const f = fixture(), result = await f.handlers.reverse(request("/reverse", body));
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true, receipt: { ...receipt, reversal } });
  assert.deepEqual(f.calls.slice(0, 4), [["limit", "reverse", undefined], ["staff", "shop-A"],
    ["limit", "reverse", "staff:org-A:user-A"], ["service"]]);
  assert.deepEqual(f.calls.at(-1), ["reverse", body]);
});

test("IP and principal throttles and role denials cannot load service", async () => {
  const ip = fixture({ rateLimit: async () => ({ allowed: false, retryAfterSeconds: 2.1 }) });
  const limited = await ip.handlers.reverse(request("/reverse", body));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "3"); assert.deepEqual(ip.calls, []);
  for (const code of ["UNAUTHENTICATED", "FORBIDDEN", "LOCATION_UNAVAILABLE"]) {
    const denied = fixture({ authorizeStaff: async () => ({ ok: false, code }) });
    const response = await denied.handlers.reverse(request("/reverse", body)); assert.notEqual(response.status, 200);
    assert.ok(!denied.calls.some(([name]) => name === "service"));
  }
  const principal = fixture({ rateLimit: async ({ principal }) => ({ allowed: !principal }) });
  assert.equal((await principal.handlers.inspect(request("/inspect", inspect))).status, 429);
  assert.ok(!principal.calls.some(([name]) => name === "service"));
});

test("nested receipt projection rejects private fields and inconsistent reversal history", () => {
  const valid = { ok: true, receipt, canReverse: true, deadline };
  assert.deepEqual(safeReversalResult("inspect", valid), valid);
  for (const value of [{ ...valid, actorUserId: "PRIVATE" }, { ...valid, receipt: { ...receipt, shopperId: "PRIVATE" } },
    { ...valid, receipt: { ...receipt, reversal } }, { ...valid, deadline: receipt.redeemedAt }])
    assert.equal(safeReversalResult("inspect", value), null);
  assert.equal(safeReversalResult("reverse", { ok: true, receipt }), null);
  assert.equal(safeReversalResult("reverse", { ok: true, receipt: { ...receipt, reversal: { ...reversal, requestHash: "PRIVATE" } } }), null);
  assert.equal(safeReversalResult("reverse", { ok: true, receipt: { ...receipt, reversal: { ...reversal, reversedAt: "2026-11-13T09:00:00.000Z" } } }), null);
  assert.equal(safeReversalResult("locations", { ok: true, locations: [{ id: "shop-A", name: "A", organisationId: "PRIVATE" }], page: 1, hasMore: false }), null);
});

test("unknown service details and thrown database errors are sanitized", async () => {
  const f = fixture(); f.service.reverse = async () => { throw new Error("PRIVATE DATABASE CREDENTIAL"); };
  const result = await f.handlers.reverse(request("/reverse", body)); assert.equal(result.status, 503); assert.ok(!(await result.text()).includes("PRIVATE"));
  f.service.inspect = async () => ({ ok: true, receipt, canReverse: true, deadline, internal: "PRIVATE" });
  assert.equal((await f.handlers.inspect(request("/inspect", inspect))).status, 503);
  f.service.reverse = async () => ({ ok: false, code: "NOT_A_PUBLIC_CODE", error: "PRIVATE" });
  assert.ok(!(await (await f.handlers.reverse(request("/reverse", body))).text()).includes("PRIVATE"));
});

test("credential DTO never exposes a fresh code for a consumed or unavailable claim", async () => {
  const f = checkoutFixture(), credential = await f.service.credential("claim-one");
  assert.ok(safeCheckoutResult("credential", credential));
  for (const status of ["REVERSED", "REDEEMED", "EXPIRED", "UNAVAILABLE"]) {
    const result = { ...credential, claim: { ...credential.claim, status,
      receipt: status === "REVERSED" ? { ...receipt, reversal } : status === "REDEEMED" ? receipt : null } };
    assert.equal(safeCheckoutResult("credential", result), null);
  }
  assert.equal(safeCheckoutResult("wallet", { ok: true, claims: [{ ...credential.claim, receipt }], page: 1, hasMore: false }), null);
  assert.equal(safeCheckoutResult("wallet", { ok: true, claims: [{ ...credential.claim, status: "REDEEMED", receipt: null }], page: 1, hasMore: false }), null);
});
