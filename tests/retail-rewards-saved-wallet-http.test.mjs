import test from "node:test";
import assert from "node:assert/strict";
import { createShopperSavedWalletHttp } from "../lib/retail-rewards/shopper-saved-wallet-http.mjs";
import { pilotPreviewRoute } from "../lib/retail-rewards/pilot-preview-routes.mjs";

const ON = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true", RUVANAS_PUBLIC_URL: "https://example.invalid" };
const pair = { shopSlug: "test-shop", offerSlug: "test-voucher" };
const empty = () => ({ ok: true, items: [], page: 1, hasMore: false, savedCount: 0 });
function req(method = "GET", body, suffix = "", extra = {}) {
  return new Request(`https://example.invalid/api/rewards/saved-wallet${suffix}`, { method,
    headers: { Origin: "https://example.invalid", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extra },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}
function fixture(overrides = {}) {
  const calls = [], env = { ...ON };
  const service = { list: async input => { calls.push(["list", input]); return empty(); },
    save: async input => { calls.push(["save", input]); return { ok: true, item: { id: "saved-own", savedAt: "2026-11-22T00:00:00.000Z", status: "UNAVAILABLE" } }; },
    remove: async input => { calls.push(["remove", input]); return { ok: true, removed: true }; },
    status: async input => { calls.push(["status", input]); return { ok: true, items: input.offers.map(value => ({ ...value, savedId: null })) }; } };
  const http = createShopperSavedWalletHttp({ env,
    authorize: async () => { calls.push("auth"); return { ok: true, shopperId: "shopper-own" }; },
    rateLimit: async ({ access }) => { calls.push(access ? "account-limit" : "ip-limit"); return { allowed: true }; },
    loadService: async () => { calls.push("load"); return service; }, ...overrides });
  return { http, calls, env, service };
}
test("disabled saved wallet makes no calls or writes", async () => {
  const h = fixture({ env: {} });
  for (const [operation, request, id] of [["list", req()], ["save", req("POST", pair)], ["status", req("POST", { offers: [pair] })], ["remove", req("DELETE"), "saved-own"]])
    assert.equal((await h.http[operation](request, id)).status, 403);
  assert.deepEqual(h.calls, []);
});
test("save/remove/status reject cross-origin and cross-site requests before auth or persistence", async () => {
  for (const operation of ["save", "remove", "status"]) for (const headers of [{ Origin: "null" }, { Origin: "https://attacker.invalid" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const h = fixture(), response = await h.http[operation](req(operation === "remove" ? "DELETE" : "POST", operation === "status" ? { offers: [pair] } : pair, "", headers), "saved-own");
    assert.equal(response.status, 403); assert.deepEqual(h.calls, []);
  }
});
test("list rejects foreign shopper selectors, invalid or duplicate pages", async () => {
  for (const suffix of ["?shopperId=other", "?page=0", "?page=1&page=2", "?page=1001", "?page=1.5", "?page=1e1"]) {
    const h = fixture(); assert.equal((await h.http.list(req("GET", undefined, suffix))).status, 400);
    assert.equal(h.calls.includes("auth"), false);
  }
});
test("mutation contracts reject caller shopper IDs, revisions, unknown fields and duplicate pairs", async () => {
  for (const body of [{ ...pair, shopperId: "other" }, { ...pair, revision: 99 }, { shopSlug: "../secret", offerSlug: "test" }, null, []]) {
    const h = fixture(); assert.equal((await h.http.save(req("POST", body))).status, 400); assert.equal(h.calls.includes("auth"), false);
  }
  for (const body of [{ offers: [pair, pair] }, { offers: [pair], shopperId: "other" }, { offers: Array.from({ length: 26 }, (_, i) => ({ shopSlug: "test-shop", offerSlug: `offer-${i}` })) }]) {
    const h = fixture(); assert.equal((await h.http.status(req("POST", body))).status, 400);
  }
});
test("invalid, oversized and non-JSON bodies are bounded and rejected", async () => {
  for (const [body, headers] of [["{"], ["x".repeat(8193)], [pair, { "Content-Type": "text/plain" }], [pair, { "Content-Length": "99999" }]]) {
    const h = fixture(); assert.equal((await h.http.save(req("POST", body, "", headers))).status, 400); assert.equal(h.calls.includes("load"), false);
  }
});
test("authentication and both throttles precede service writes", async () => {
  const denied = fixture({ authorize: async () => ({ ok: false, code: "UNAUTHENTICATED", error: "private credential" }) });
  const response = await denied.http.save(req("POST", pair)); assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /private credential/);
  assert.equal(denied.calls.includes("load"), false);
  for (const rejectAccess of [false, true]) {
    const h = fixture({ rateLimit: async ({ access }) => ({ allowed: Boolean(access) !== rejectAccess, retryAfterSeconds: 3 }) });
    const limited = await h.http.save(req("POST", pair)); assert.equal(limited.status, 429); assert.equal(limited.headers.get("Retry-After"), "3"); assert.equal(h.calls.includes("load"), false);
  }
});
test("private strict successful reads and mutations delegate only validated input", async () => {
  const h = fixture();
  const result = await h.http.list(req("GET", undefined, "?page=2")); assert.equal(result.status, 200);
  assert.match(result.headers.get("Cache-Control"), /private, no-store/); assert.equal(result.headers.get("Vary"), "Cookie");
  assert.deepEqual(h.calls.at(-1), ["list", { page: 2 }]);
  assert.equal((await h.http.save(req("POST", pair))).status, 200);
  assert.deepEqual(h.calls.at(-1), ["save", pair]);
  assert.equal((await h.http.remove(req("DELETE"), "saved-own")).status, 200);
  assert.deepEqual(h.calls.at(-1), ["remove", "saved-own"]);
  assert.equal((await h.http.status(req("POST", { offers: [pair] }))).status, 200);
});
test("DELETE rejects body selectors and unexpected query or methods", async () => {
  const h = fixture();
  assert.equal((await h.http.remove(req("DELETE", { shopperId: "other" }), "saved-own")).status, 400);
  assert.equal((await h.http.remove(req("DELETE", undefined, "?shopperId=other"), "saved-own")).status, 400);
  assert.equal((await h.http.remove(req("DELETE"), "../bad")).status, 400);
  for (const operation of ["list", "save", "remove", "status"]) assert.equal((await h.http[operation](req("PATCH", {}), "saved-own")).status, 405);
});
test("private fields, forged projections and internal errors never leave handlers", async () => {
  for (const list of [async () => ({ ...empty(), shopperId: "private" }), async () => ({ ...empty(), items: [{ id: "saved-own", savedAt: "2026-11-22T00:00:00.000Z", status: "UNAVAILABLE", title: "private" }] }), async () => { throw new Error("private connection"); }]) {
    const h = fixture({ loadService: async () => ({ list }) }), response = await h.http.list(req());
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private/);
  }
});
test("feature revocation suppresses completed results", async () => {
  const env = { ...ON }, h = fixture({ env, loadService: async () => ({ list: async () => { env.RUVANAS_RETAIL_REWARDS_ENABLED = "false"; return empty(); } }) });
  assert.equal((await h.http.list(req())).status, 403);
});
test("private preview admits only the exact saved wallet operations", () => {
  assert.equal(pilotPreviewRoute("/api/rewards/saved-wallet", "GET"), "SHOPPER");
  assert.equal(pilotPreviewRoute("/api/rewards/saved-wallet", "POST"), "SHOPPER");
  assert.equal(pilotPreviewRoute("/api/rewards/saved-wallet/status", "POST"), "SHOPPER");
  assert.equal(pilotPreviewRoute("/api/rewards/saved-wallet/saved-own", "DELETE"), "SHOPPER");
  for (const [path, method] of [["/api/rewards/saved-wallet/status", "DELETE"], ["/api/rewards/saved-wallet/status", "GET"], ["/api/rewards/saved-wallet", "DELETE"], ["/api/rewards/saved-wallet/saved-own", "GET"], ["/api/rewards/saved-wallet/saved-own/other", "DELETE"], ["/api/rewards/saved-wallet/%2f", "DELETE"]]) assert.equal(pilotPreviewRoute(path, method), null);
  assert.equal(pilotPreviewRoute("/api/rewards/saved-wallet", "POST", true), null);
});
