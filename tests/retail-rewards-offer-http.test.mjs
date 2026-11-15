import test from "node:test";
import assert from "node:assert/strict";
import { createOfferHttpHandlers, rewardsMutationOriginAllowed } from "../lib/retail-rewards/offer-http.mjs";
import { createRewardsContextLoader } from "../lib/retail-rewards/context-loader.mjs";

const environment = { NODE_ENV: "production", RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_PUBLIC_URL: "https://www.ruvanas.com" };
function fixture(env = environment) {
  const calls = [];
  const handlers = createOfferHttpHandlers({ env, authorize: async action => { calls.push(["authorize", action]); return { ok: true, organisationId: "org-one", userId: "user-one" }; },
    rateLimit: async input => { calls.push(["rate", input.mutation]); return { allowed: true }; },
    loadService: async () => { calls.push(["service"]); return {
      list: async input => { calls.push(["list", input]); return { ok: true, offers: [] }; },
      transition: async (...input) => { calls.push(["transition", ...input]); return { ok: true, offer: { id: "offer-one", version: 2 } }; }
    }; }
  });
  return { handlers, calls };
}
const req = (body = { expectedVersion: 1 }, headers = {}) => new Request("https://www.ruvanas.com/api/retail-rewards/offers/offer-one/publish", { method: "POST", headers: { origin: "https://www.ruvanas.com", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("disabled HTTP handlers do not parse bodies, authenticate or reach storage", async () => {
  const f = fixture({});
  const response = await f.handlers.transition(req(), "offer-one", "PUBLISH");
  assert.equal(response.status, 403); assert.deepEqual(f.calls, []);
  assert.equal((await response.json()).code, "FEATURE_DISABLED");
});
test("mutation origin rejects forged forwarding, cross-site, null and unconfigured production", () => {
  assert.equal(rewardsMutationOriginAllowed(req(), environment), true);
  for (const headers of [{ origin: "https://evil.test", "x-forwarded-host": "evil.test" }, { origin: "null" }, { origin: "https://www.ruvanas.com.evil.test" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal(rewardsMutationOriginAllowed(req({}, headers), environment), false);
  }
  assert.equal(rewardsMutationOriginAllowed(req(), { NODE_ENV: "production" }), false);
});
test("strict bounded parsing rejects attacker fields, huge streamed bodies and duplicate queries", async () => {
  const f = fixture();
  for (const body of [{ expectedVersion: 1, organisationId: "other" }, { expectedVersion: "1" }, "{bad", `{"padding":"${"x".repeat(131073)}"}`]) {
    assert.equal((await f.handlers.transition(req(body), "offer-one", "PUBLISH")).status, 400);
  }
  assert.equal((await f.handlers.transition(req({}, { "content-type": "text/plain" }), "offer-one", "PUBLISH")).status, 400);
  for (const query of ["page=1&page=2", "page=-1", "organisationId=other", "state=bogus"]) {
    assert.equal((await f.handlers.list(new Request(`https://www.ruvanas.com/api/retail-rewards/offers?${query}`))).status, 400);
  }
  assert.deepEqual(f.calls, []);
});
test("valid publication is authorised, limited and carries no-store headers", async () => {
  const f = fixture(); const res = await f.handlers.transition(req(), "offer-one", "PUBLISH");
  assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(f.calls, [["authorize", "PUBLISH_OFFERS"], ["rate", true], ["service"], ["transition", "offer-one", "PUBLISH", { expectedVersion: 1 }]]);
});
test("read access and pagination are checked before loading offers", async () => {
  const f = fixture(); const res = await f.handlers.list(new Request("https://www.ruvanas.com/api/retail-rewards/offers?search=summer&category=FASHION&page=2"));
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls, [["authorize", "READ"], ["rate", false], ["service"], ["list", { search: "summer", category: "FASHION", page: 2 }]]);
});
test("denied and rate-limited requests cannot load the service; exceptions are sanitised", async () => {
  for (const mode of ["denied", "limited", "exception"]) {
    let called = false;
    const handlers = createOfferHttpHandlers({ env: environment,
      authorize: async () => { if (mode === "exception") throw new Error("database password sensitive"); return mode === "denied" ? { ok: false, status: 403, code: "FORBIDDEN", error: "Forbidden." } : { ok: true }; },
      rateLimit: async () => ({ allowed: false, retryAfterSeconds: 10 }),
      loadService: async () => { called = true; }
    });
    const res = await handlers.transition(req(), "offer-one", "PUBLISH");
    assert.equal(res.status, mode === "denied" ? 403 : mode === "limited" ? 429 : 503);
    assert.equal(called, false); assert.doesNotMatch(await res.text(), /password|sensitive/);
  }
});
test("context loader rereads auth, preview status and exact membership using the supplied transaction", async () => {
  const calls = [], tx = { user: { findUnique: async input => { calls.push("user"); assert.deepEqual(input.select.privatePreviewAccess, { select: { userId: true } }); return { id: "u1", role: "OWNER", privatePreviewAccess: { userId: "u1" } }; } }, organisationMember: { findMany: async input => { calls.push(input); return [{ id: "m2", userId: "u1", organisationId: "other" }]; } } };
  const loader = createRewardsContextLoader({ db: {}, token: "opaque-session", env: {}, authenticate: async (token, options) => { assert.equal(token, "opaque-session"); assert.equal(options.db, tx); calls.push("auth"); return { userId: "u1", activeOrganisationId: "revoked-org" }; } });
  const context = await loader(tx);
  assert.equal(context.membership, null); assert.equal(context.user.privatePreviewAccess.userId, "u1");
  assert.equal(calls[0], "auth"); assert.equal(calls[2].take, 1001);
  const noSession = createRewardsContextLoader({ db: tx, authenticate: async () => null });
  assert.equal(await noSession(), null); assert.equal(calls.length, 3);
});
