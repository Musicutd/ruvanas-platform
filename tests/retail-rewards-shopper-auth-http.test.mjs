import test from "node:test";
import assert from "node:assert/strict";
import { createShopperAuthHttp } from "../lib/retail-rewards/shopper-auth-http.mjs";
import { readShopperAuthPolicy, shopperPasswordSchema, canonicalEmailSchema, acceptShopperInvitationSchema } from "../lib/retail-rewards/shopper-auth-contracts.mjs";
const env = { NODE_ENV: "production", RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_RETAIL_REWARDS_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "true" };
const password = "Synthetic phrase 12345", token = "ab".repeat(32);
const req = (body = { email: "Shopper@Example.Invalid", password }, headers = {}, method = "POST", suffix = "") => new Request(`https://www.ruvanas.com/api/rewards/auth/login${suffix}`, {
  method, headers: { origin: env.RUVANAS_PUBLIC_URL, "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
function harness(patch = {}) {
  const calls = [];
  const api = createShopperAuthHttp({ env, rateLimit: async input => { calls.push({ kind: "limit", ...input }); return { allowed: true }; },
    getToken: async () => { calls.push({ kind: "token" }); return token; },
    loadService: async () => { calls.push({ kind: "load" }); return Object.fromEntries(["login", "acceptInvite", "logout"].map(name => [name, async input => {
      calls.push({ kind: name, input }); return { ok: true, rawSessionToken: token, expiresAt: new Date(Date.now() + 3600_000) };
    }])); }, ...patch });
  return { api, calls };
}
test("auth gate is exact and password/email contracts do not silently truncate", () => {
  assert.equal(readShopperAuthPolicy({}).enabled, false); assert.equal(readShopperAuthPolicy(env).enabled, true);
  for (const flag of ["TRUE", "1", true, "false", undefined]) assert.equal(readShopperAuthPolicy({ ...env, RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: flag }).enabled, false);
  assert.equal(canonicalEmailSchema.parse(" SHOPPER@Example.Invalid "), "shopper@example.invalid");
  for (const bad of ["short", "a".repeat(73), "🙂".repeat(19), "abcdefghijklmno\0", "abcdefghijklmno\ud800"]) assert.equal(shopperPasswordSchema.safeParse(bad).success, false);
  assert.equal(shopperPasswordSchema.safeParse("a".repeat(72)).success, true);
  assert.equal(acceptShopperInvitationSchema.safeParse({ token, password, role: "OWNER" }).success, false);
});
test("disabled auth performs no adapter work; disabled logout clears only shopper cookie", async () => {
  const h = harness({ env: { ...env, RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "false" } });
  assert.equal((await h.api.login(req())).status, 403); assert.equal((await h.api.invitation(req())).status, 403);
  const result = await h.api.logout(req({})); assert.equal(result.status, 200); assert.match(result.headers.get("set-cookie"), /ruvanas_rewards_shopper=;.*Max-Age=0/);
  assert.deepEqual(h.calls, []);
});
test("wrong method, cross-origin, fetch-site, query and oversized body cannot reach service", async () => {
  const h = harness();
  assert.equal((await h.api.login(req({}, {}, "GET"))).status, 405);
  assert.equal((await h.api.login(req({}, { origin: "https://foreign.invalid" }))).status, 403);
  assert.equal((await h.api.login(req({}, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await h.api.login(req({}, {}, "POST", "?next=https://foreign.invalid"))).status, 400);
  assert.equal((await h.api.login(req({ password: "x".repeat(9000) }))).status, 400);
  assert.ok(h.calls.every(call => call.kind === "limit"));
});
test("IP limit runs before body processing and identity limit uses canonical email", async () => {
  const h = harness(); assert.equal((await h.api.login(req())).status, 200);
  assert.equal(h.calls[0].identity, undefined); assert.equal(h.calls[1].identity, "shopper@example.invalid");
  const denied = harness({ rateLimit: async () => ({ allowed: false, retryAfterSeconds: 30 }) });
  const r = await denied.api.login(req()); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "30"); assert.deepEqual(denied.calls, []);
});
test("session token is only HttpOnly secure cookie, fixed destination and no-store", async () => {
  const h = harness(), r = await h.api.invitation(req({ token, password, displayName: "Shopper" }));
  assert.equal(r.status, 200); const text = await r.text(); assert.ok(!text.includes(token)); assert.deepEqual(JSON.parse(text), { ok: true, next: "/rewards" });
  const setCookie = r.headers.get("set-cookie"); for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Expires="]) assert.ok(setCookie.includes(attribute));
  assert.ok(!setCookie.includes("ruvanas_session=")); assert.match(r.headers.get("cache-control"), /no-store/);
  assert.equal(h.calls.find(call => call.kind === "acceptInvite").input.displayName, "Shopper");
});
test("logout revokes only dedicated cookie token and does not accept a browser-supplied identity", async () => {
  const h = harness(); assert.equal((await h.api.logout(req({ shopperId: "foreign" }))).status, 400);
  const r = await h.api.logout(req({})); assert.equal(r.status, 200); assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  assert.deepEqual(h.calls.find(call => call.kind === "logout").input, { token });
});
test("service errors and invalid session material cannot leak identity or issue cookies", async () => {
  const h = harness({ loadService: async () => ({ login: async () => ({ ok: false, status: 401, code: "AUTH_FAILED", error: "Sign-in failed.", privateId: "hidden" }) }) });
  const r = await h.api.login(req()); assert.equal(r.status, 401); assert.equal(r.headers.get("set-cookie"), null); assert.ok(!(await r.text()).includes("hidden"));
  const invalid = harness({ loadService: async () => ({ login: async () => ({ ok: true, rawSessionToken: "bad; injection", expiresAt: new Date() }) }) });
  assert.equal((await invalid.api.login(req())).status, 503);
});
