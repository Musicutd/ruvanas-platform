import test from "node:test";
import assert from "node:assert/strict";
import { createShopperSavingsHttp } from "../lib/retail-rewards/shopper-savings-http.mjs";
import { pilotPreviewRoute } from "../lib/retail-rewards/pilot-preview-routes.mjs";

const ON = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true" };
const AT = "2026-11-22T12:00:00.000Z";
const snapshot = () => ({ ok: true, checkedAt: AT, period: { kind: "ALL_TIME", through: AT }, paymentEvidence: "UNAVAILABLE", currencies: [] });
const request = (suffix = "", method = "GET") => new Request(`https://example.invalid/api/rewards/savings${suffix}`, { method });
function fixture(overrides = {}) {
  const calls = [], env = { ...ON };
  const handler = createShopperSavingsHttp({ env,
    authorize: async () => { calls.push("auth"); return { ok: true, shopperId: "private-shopper" }; },
    rateLimit: async ({ access }) => { calls.push(access ? "rate-shopper" : "rate-ip"); return { allowed: true }; },
    loadService: async () => { calls.push("load"); return { inspect: async (...args) => { assert.equal(args.length, 0); calls.push("inspect"); return snapshot(); } }; },
    ...overrides });
  return { handler, calls, env };
}
test("closed Rewards makes no authentication, limiter, database or payment request", async () => {
  const h = fixture({ env: {} }), result = await h.handler.inspect(request());
  assert.equal(result.status, 403); assert.equal((await result.json()).code, "FEATURE_DISABLED"); assert.deepEqual(h.calls, []);
});
test("savings accepts only GET without supplied shopper, currency, date, payment or other query parameters", async () => {
  const h = fixture();
  for (const method of ["POST", "PATCH", "DELETE", "HEAD"]) {
    const result = await h.handler.inspect(request("", method)); assert.equal(result.status, 405); assert.equal(result.headers.get("allow"), "GET");
  }
  for (const query of ["?shopperId=other", "?currency=EUR", "?paid=0", "?from=2026-01-01", "?a=1&a=2"])
    assert.equal((await h.handler.inspect(request(query))).status, 400);
  assert.deepEqual(h.calls, []);
});
test("IP and shopper throttles bound work before the read service", async () => {
  const ip = fixture({ rateLimit: async () => ({ allowed: false, retryAfterSeconds: 12 }) });
  const limited = await ip.handler.inspect(request()); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "12"); assert.deepEqual(ip.calls, []);
  const account = fixture({ rateLimit: async ({ access }) => ({ allowed: !access }) });
  assert.equal((await account.handler.inspect(request())).status, 429); assert.deepEqual(account.calls, ["auth"]);
});
test("failed authentication is sanitised and cannot load savings", async () => {
  const h = fixture({ authorize: async () => ({ ok: false, code: "UNAUTHENTICATED", error: "private raw error", shopperId: "private" }) });
  const response = await h.handler.inspect(request()); assert.equal(response.status, 401);
  assert.equal((await response.text()).includes("private"), false); assert.deepEqual(h.calls, ["rate-ip"]);
});
test("authenticated page/refresh result is strict, private and non-cacheable", async () => {
  const h = fixture(), response = await h.handler.inspect(request()); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot());
  assert.match(response.headers.get("cache-control"), /private, no-store/); assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(h.calls, ["rate-ip", "auth", "rate-shopper", "load", "inspect"]);
});
test("malformed or credential-bearing results and internal failures never cross the HTTP boundary", async () => {
  for (const inspect of [
    async () => ({ ...snapshot(), shopperId: "private" }),
    async () => ({ ...snapshot(), paymentEvidence: "GUESSED" }),
    async () => ({ ok: false, code: "UNAVAILABLE", error: "private database password" }),
    async () => { throw new Error("private database password"); }
  ]) {
    const h = fixture({ loadService: async () => ({ inspect }) }), result = await h.handler.inspect(request());
    assert.equal(result.status, 503); assert.equal((await result.text()).includes("private"), false);
  }
});
test("feature withdrawal during async collection suppresses the completed snapshot", async () => {
  const env = { ...ON }, h = fixture({ env, loadService: async () => ({ inspect: async () => {
    env.RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED = "false"; return snapshot();
  } }) });
  assert.equal((await h.handler.inspect(request())).status, 403);
});
test("private pilot admits only exact savings read routes, preserving shopper role and action boundaries", () => {
  for (const path of ["/rewards/savings", "/api/rewards/savings"]) {
    assert.equal(pilotPreviewRoute(path, "GET"), "SHOPPER"); assert.equal(pilotPreviewRoute(path, "HEAD"), "SHOPPER");
    for (const method of ["POST", "PATCH", "DELETE"]) assert.equal(pilotPreviewRoute(path, method), null);
    assert.equal(pilotPreviewRoute(path, "GET", true), null);
    for (const suffix of ["/private", "/", "%2f", "/../billing"]) assert.equal(pilotPreviewRoute(path + suffix, "GET"), null);
  }
  for (const path of ["/api/rewards/payments", "/rewards/billing", "/api/rewards/savings/refresh"]) assert.equal(pilotPreviewRoute(path, "GET"), null);
});
