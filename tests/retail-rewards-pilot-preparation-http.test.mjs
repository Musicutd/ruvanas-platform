import assert from "node:assert/strict";
import test from "node:test";
import { createPilotPreparationHttp } from "../lib/retail-rewards/pilot-preparation-http.mjs";

const URL_BASE = "https://example.invalid/api/admin/retail-rewards/preparation";
const checkedAt = "2026-11-19T12:00:00.000Z";
function snapshot() {
  const organisation = { id: "org-one", name: "Synthetic Test Shop" };
  return { ok: true, mode: "READ_ONLY_PREPARATION", rewardsEnabled: false, organisation,
    readiness: { ok: true, organisation, configured: false, eligibleNow: false, endToEndTest: "NOT_VERIFIED", pendingInvitations: 0, checkedAt,
      checks: [
        { key: "environment", status: "BLOCKED", code: "FEATURES_DISABLED", configuredCount: 1, eligibleCount: 0 },
        { key: "owner", status: "READY", code: "OWNER_READY", configuredCount: 1, eligibleCount: 1 },
        { key: "entitlement", status: "BLOCKED", code: "ENTITLEMENT_INACTIVE", configuredCount: 1, eligibleCount: 0 },
        ...["shops", "coupons", "cashiers", "shoppers"].map(key => ({ key, status: "MISSING", code: `${key.toUpperCase()}_MISSING`, configuredCount: 0, eligibleCount: 0 }))
      ] },
    preparedShoppers: { total: 1, disabled: 1, active: 0, suspended: 0, enrolled: 1, expiredMemberships: 1, revokedInvitations: 1 },
    grantExpiresAt: "2026-11-18T12:00:00.000Z", checkedAt, endToEndTest: "NOT_VERIFIED" };
}
function harness(options = {}) {
  const calls = [];
  const http = createPilotPreparationHttp({ authorize: async () => { calls.push("authorize"); return options.access || { ok: true, userId: "super-admin" }; },
    rateLimit: async input => { calls.push(input.principal ? "userLimit" : "ipLimit"); return options.rateLimit?.(input) || { allowed: true }; },
    loadService: async () => { calls.push("loadService"); return { inspect: async input => { calls.push(input); if (options.throw) throw new Error("private database credential"); return options.result || snapshot(); } }; }
  });
  return { calls, run: (suffix = "?organisationId=org-one", init) => http.run(new Request(URL_BASE + suffix, init)) };
}
test("GET returns strictly bound private non-cacheable snapshot", async () => {
  const h = harness(), response = await h.run(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot()); assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer"); assert.equal(response.headers.get("vary"), "Cookie");
  assert.deepEqual(h.calls, ["ipLimit", "authorize", "userLimit", "loadService", { organisationId: "org-one" }]);
});
test("no write method is exposed and query has exactly one explicit organisation", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const h = harness(), response = await h.run(undefined, { method });
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET"); assert.equal(h.calls.length, 0);
  }
  for (const query of ["", "?organisationId=", "?organisationId=../bad", "?organisationId=org-one&organisationId=foreign", "?organisationId=org-one&shopperId=hidden", "?organisationId=org-one&renew=true"]) {
    const h = harness(); assert.equal((await h.run(query)).status, 400); assert.equal(h.calls.length, 0);
  }
});
test("cross-site requests, missing authority and rate limiting never load the service", async () => {
  const cross = harness(); assert.equal((await cross.run(undefined, { headers: { "sec-fetch-site": "cross-site" } })).status, 403); assert.equal(cross.calls.length, 0);
  for (const access of [{ ok: false, code: "AUTH_REQUIRED" }, { ok: false, code: "FORBIDDEN" }, { ok: true, userId: "../bad" }]) {
    const h = harness({ access }); assert.notEqual((await h.run()).status, 200); assert.equal(h.calls.includes("loadService"), false);
  }
  for (const atUser of [false, true]) {
    const h = harness({ rateLimit: input => Boolean(input.principal) === atUser ? { allowed: false, retryAfterSeconds: Infinity } : { allowed: true } });
    const response = await h.run(); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(h.calls.includes("loadService"), false);
  }
});
test("unexpected or foreign service data and errors are never returned", async () => {
  const good = snapshot();
  for (const result of [{ ...good, token: "secret" }, { ...good, organisation: { id: "foreign", name: "Foreign" } },
    { ...good, endToEndTest: "VERIFIED" }, { ...good, rewardsEnabled: true }, { ok: false, code: "database-password", error: "private" }]) {
    const response = await harness({ result }).run(); assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(await response.json()), /secret|Foreign|password|private/i);
  }
  const error = await harness({ throw: true }).run(); assert.equal(error.status, 503); assert.doesNotMatch(JSON.stringify(await error.json()), /database|credential/);
});
test("no page-supplied status can override closed-state service denial", async () => {
  const h = harness({ result: { ok: false, code: "PREPARATION_UNAVAILABLE" } });
  const response = await h.run(); assert.equal(response.status, 409); assert.equal((await response.json()).code, "PREPARATION_UNAVAILABLE");
});
