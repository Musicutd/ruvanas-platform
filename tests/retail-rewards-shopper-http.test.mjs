import test from "node:test";
import assert from "node:assert/strict";
import { createShopperDiscoveryHttp } from "../lib/retail-rewards/shopper-http.mjs";
const ON = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true" };
const req = (query = "", method = "GET") => new Request(`https://www.ruvanas.com/api/rewards/discovery/shops${query}`, { method });
function fixture(env = ON, overrides = {}) {
  const calls = [];
  const service = { locations: async input => { calls.push(["locations", input]); return { ok: true, locations: [], page: 1, hasMore: false }; },
    shops: async input => { calls.push(["shops", input]); return { ok: true, shops: [], page: 1, hasMore: false }; },
    shop: async (slug, input) => { calls.push(["shop", slug, input]); return { ok: true, shop: { slug }, offers: [] }; },
    offer: async (shop, offer) => { calls.push(["offer", shop, offer]); return { ok: true, offer: { slug: offer } }; } };
  const handlers = createShopperDiscoveryHttp({ env,
    authorize: async () => { calls.push("auth"); return { ok: true, shopperId: "private-shopper", sessionId: "private-session" }; },
    rateLimit: async ({ access }) => { calls.push(access ? "rate-account" : "rate-ip"); return { allowed: true }; },
    loadService: async () => { calls.push("load"); return service; }, ...overrides });
  return { handlers, calls };
}
test("disabled shopper routes call no auth, limiter or service adapters", async () => {
  const f = fixture({});
  for (const response of [await f.handlers.locations(req()), await f.handlers.shops(req()), await f.handlers.shop(req(), "sample-shop"), await f.handlers.offer(req(), "sample-shop", "offer-10")]) {
    assert.equal(response.status, 403); assert.equal((await response.json()).code, "FEATURE_DISABLED");
  }
  assert.deepEqual(f.calls, []);
});
test("read-only methods and strict bounded public query reject authority injection before authentication", async () => {
  const f = fixture();
  assert.equal((await f.handlers.shops(req("", "POST"))).status, 405);
  for (const query of ["?organisationId=private", "?page=1&page=2", "?page=0", "?page=1e3", "?page=1001", "?category=PRIVATE"])
    assert.equal((await f.handlers.shops(req(query))).status, 400);
  assert.equal((await f.handlers.offer(req("?shopperId=secret"), "sample-shop", "offer-10")).status, 400);
  assert.equal((await f.handlers.shop(req(), "../private")).status, 404);
  assert.deepEqual(f.calls, []);
});
test("IP throttling precedes authentication; failed auth never loads discovery", async () => {
  const limited = fixture(ON, { rateLimit: async () => ({ allowed: false, retryAfterSeconds: 12 }) });
  const response = await limited.handlers.shops(req());
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "12"); assert.deepEqual(limited.calls, []);
  const denied = fixture(ON, { authorize: async () => ({ ok: false, status: 401, code: "UNAUTHENTICATED", error: "Shopper access required." }) });
  assert.equal((await denied.handlers.shops(req())).status, 401); assert.deepEqual(denied.calls, ["rate-ip"]);
});
test("bounded reads dispatch public slugs and return private non-cacheable responses", async () => {
  const f = fixture();
  const response = await f.handlers.shops(req("?category=HOME&search=chair&page=2"));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.deepEqual(f.calls, ["rate-ip", "auth", "rate-account", "load", ["shops", { category: "HOME", search: "chair", page: 2 }]]);
  const body = await response.text(); assert.equal(body.includes("private-shopper"), false); assert.equal(body.includes("private-session"), false);
  await f.handlers.offer(req(), "sample-shop", "offer-10");
  assert.deepEqual(f.calls.at(-1), ["offer", "sample-shop", "offer-10"]);
});
test("errors do not expose storage, session or customer data", async () => {
  const f = fixture(ON, { loadService: async () => { throw new Error("postgresql://private credentials"); } });
  const response = await f.handlers.shops(req());
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("credentials"), false);
});

test("location reads and exact town shop filtering retain private no-store and strict authority boundaries", async () => {
  const f = fixture();
  const response = await f.handlers.locations(req("?search=Sli&countryCode=MT&page=2"));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.deepEqual(f.calls.at(-1), ["locations", { search: "Sli", countryCode: "MT", page: 2 }]);
  await f.handlers.shops(req("?locality=Sliema&countryCode=MT&category=FASHION"));
  assert.deepEqual(f.calls.at(-1), ["shops", { category: "FASHION", locality: "Sliema", countryCode: "MT" }]);
  const invalid = fixture();
  assert.equal((await invalid.handlers.locations(req("", "POST"))).status, 405);
  for (const query of ["?shopperId=foreign", "?countryCode=MT&countryCode=GB", "?countryCode=mt", "?page=0", "?category=HOME"])
    assert.equal((await invalid.handlers.locations(req(query))).status, 400);
  assert.deepEqual(invalid.calls, []);
});
