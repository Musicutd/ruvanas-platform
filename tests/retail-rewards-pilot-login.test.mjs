import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";
import { pilotPreviewRoute } from "../lib/retail-rewards/pilot-preview-routes.mjs";
import { pilotPreviewBusinessIdentity } from "../lib/retail-rewards/pilot-preview-business.mjs";
import { createPilotLoginService, pilotLoginIdentity } from "../lib/retail-rewards/pilot-login-service.mjs";
import { createPilotLoginHttp } from "../lib/retail-rewards/pilot-login-http.mjs";
import { getSessionFromToken } from "../lib/session-lookup.js";
const secret = "local-synthetic-pilot-secret-not-used-elsewhere";
const env = { ...pilotPreviewEnvironment(), SESSION_SECRET: secret };
const now = new Date("2026-11-14T12:00:00Z");
function user(overrides = {}) { return { id: "owner-one", email: "client@example.invalid", role: "OWNER", privatePreviewAccess: null,
  memberships: [{ id: "member-one", userId: "owner-one", organisationId: "org-one", role: "OWNER", organisation: { id: "org-one", enterpriseSecurityPolicy: null } }], ...overrides }; }
const session = u => ({ id: "session-one", userId: u.id, activeOrganisationId: "org-one", authMethod: "PASSWORD", user: u,
  createdAt: now, lastSeenAt: now, expiresAt: new Date(+now + 3600000), revokedAt: null, activeOrganisation: { enterpriseSecurityPolicy: null } });

test("pilot business identity requires explicit valid bridge, ordinary account, exact active tenant and current membership", () => {
  const s = session(user()); assert.equal(pilotPreviewBusinessIdentity(s, env).role, "OWNER");
  for (const mutation of [v => v.authMethod = "PREVIEW_PASSWORD", v => v.user.privatePreviewAccess = { userId: v.user.id },
    v => v.activeOrganisationId = "foreign", v => v.user.memberships = [], v => v.user.role = "STUDENT", v => v.user.role = "SUPPORT"]) {
    const changed = structuredClone(s); mutation(changed); assert.equal(pilotPreviewBusinessIdentity(changed, env), null);
  }
  assert.equal(pilotPreviewBusinessIdentity(s, { ...env, RUVANAS_RETAIL_REWARDS_ENABLED: "false" }), null);
  assert.equal(pilotPreviewBusinessIdentity(s, { ...env, RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "false" }), null);
});

test("password login selects one exact tenant without arbitrary fallback and preserves SSO-only policy", () => {
  assert.equal(pilotLoginIdentity(user(), undefined, env).organisationId, "org-one");
  assert.equal(pilotLoginIdentity(user(), "foreign", env), null);
  const u = user(); u.memberships[0].organisation.enterpriseSecurityPolicy = { ssoRequired: true, passwordFallback: false };
  assert.equal(pilotLoginIdentity(u, undefined, env), null);
  u.memberships[0].organisation.enterpriseSecurityPolicy.passwordFallback = true;
  assert.ok(pilotLoginIdentity(u, undefined, env));
  const multi = user(); multi.memberships.push({ ...multi.memberships[0], id: "member-two", organisationId: "org-two", organisation: { id: "org-two" } });
  const e = { ...env, RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: '["org-one","org-two"]' };
  assert.equal(pilotLoginIdentity(multi, undefined, e), null);
  assert.equal(pilotLoginIdentity(multi, "org-two", e).organisationId, "org-two");
});

test("ordinary session lookup remains closed; only explicit Rewards lookup admits a current pilot identity", async () => {
  const s = session(user()), db = { session: { findUnique: async () => s, update: async () => assert.fail("Fresh session should not write") } };
  const options = { db, secret, now, env };
  assert.equal(await getSessionFromToken("a".repeat(64), options), null);
  assert.equal((await getSessionFromToken("a".repeat(64), { ...options, allowRewardsPilot: true })).id, s.id);
  s.revokedAt = now;
  assert.equal(await getSessionFromToken("a".repeat(64), { ...options, allowRewardsPilot: true }), null);
  s.revokedAt = null; s.expiresAt = now;
  assert.equal(await getSessionFromToken("a".repeat(64), { ...options, allowRewardsPilot: true }), null);
});

test("scoped session lookup preserves enterprise absolute/idle timeout and SSO requirements", async () => {
  for (const policy of [{ sessionMaxAgeMinutes: 1, idleTimeoutMinutes: 60 }, { sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 1 },
    { sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 60, ssoRequired: true, passwordFallback: false }]) {
    const s = session(user()); s.createdAt = s.lastSeenAt = new Date(+now - 120000); s.activeOrganisation.enterpriseSecurityPolicy = policy;
    const db = { session: { findUnique: async () => s, update: async () => assert.fail() } };
    assert.equal(await getSessionFromToken("a".repeat(64), { db, secret, now, env, allowRewardsPilot: true }), null);
  }
});

test("reviewed pilot routes are explicit and never grant methods, other pillars, server actions or encoded siblings", () => {
  for (const [path, method, kind] of [["/rewards/pilot-sign-in", "GET", "BOOTSTRAP"], ["/api/rewards/auth/login", "POST", "BOOTSTRAP"],
    ["/api/admin/retail-rewards/pilot/publishShop", "POST", "ADMIN"], ["/api/retail-rewards/staff/overview", "GET", "MERCHANT"],
    ["/api/retail-rewards/offers/offer-one/resume", "POST", "MERCHANT"], ["/rewards/wallet", "GET", "SHOPPER"]]) {
    assert.equal(pilotPreviewRoute(path, method), kind); assert.equal(pilotPreviewRoute(path, method, true), null);
  }
  for (const path of ["/admin", "/dashboard", "/api/auth/login", "/register", "/dashboard/retail", "/api/retail-stream/start",
    "/admin/retail-rewards/pilot/extra", "/api/rewards/discovery/shops/%2fsecret", "/api/retail-rewards/staff/unknown", "/_next/static/../secret"]) {
    for (const method of ["GET", "POST", "DELETE"]) assert.equal(pilotPreviewRoute(path, method), null, `${method} ${path}`);
  }
  assert.equal(pilotPreviewRoute("/dashboard/retail/rewards", "POST"), null);
});

test("location search and pagination use only the exact shopper read route in private preview", () => {
  const path = "/api/rewards/discovery/locations";
  for (const method of ["GET", "HEAD"]) {
    assert.equal(pilotPreviewRoute(path, method), "SHOPPER", `${method} location reads require shopper authentication`);
    assert.equal(pilotPreviewRoute(path, method, true), null, "A server action is never a shopper read");
  }
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "OPTIONS"]) {
    assert.equal(pilotPreviewRoute(path, method), null, `${method} is not admitted`);
  }
  for (const sibling of [`${path}/`, `${path}/extra`, `${path}-admin`, "/api/rewards/discovery/%6cocations",
    `${path}%2fextra`, "/api/rewards/discovery\\locations"]) {
    for (const method of ["GET", "HEAD", "POST"]) assert.equal(pilotPreviewRoute(sibling, method), null, `${method} ${sibling}`);
  }
});

test("actual password comparison creates only a bounded session; stale password or authority cannot commit", async () => {
  const password = "local pilot client password", passwordHash = await bcrypt.hash(password, 4);
  for (const changed of [null, "password", "preview", "membership"]) {
    const initial = user({ passwordHash }), current = structuredClone(initial), sessions = [];
    if (changed === "password") current.passwordHash = await bcrypt.hash("changed local password", 4);
    if (changed === "preview") current.privatePreviewAccess = { userId: current.id };
    if (changed === "membership") current.memberships = [];
    const tx = { user: { findUnique: async () => current }, $queryRaw: async () => [{ id: "owned-row" }], session: { create: async row => sessions.push(row.data) } };
    const db = { user: { findUnique: async () => initial }, $transaction: async work => work(tx) };
    const result = await createPilotLoginService({ db, env, clock: () => now }).login({ email: initial.email, password });
    assert.equal(result.ok, !changed); assert.equal(sessions.length, changed ? 0 : 1);
    if (!changed) { assert.equal(sessions[0].authMethod, "PASSWORD"); assert.equal(sessions[0].activeOrganisationId, "org-one");
      assert.equal(+result.expiresAt - +now, 3600000); assert.notEqual(sessions[0].tokenHash, result.rawSessionToken); }
  }
});

const request = (body = { email: "client@example.invalid", password: "local password" }, extra = {}) => new Request("https://preview.example.invalid/api/retail-rewards/pilot-login", {
  method: "POST", headers: { Origin: "https://preview.example.invalid", "Content-Type": "application/json", ...extra }, body: JSON.stringify(body)
});
test("pilot login HTTP has no flag-off side effects and rejects cross-site, unknown fields and oversize input", async () => {
  let calls = 0;
  const deps = { env, rateLimit: async () => ({ allowed: true }), loadService: async () => { calls++; return { login: async () => ({ ok: false, code: "AUTH_FAILED" }) }; } };
  assert.equal((await createPilotLoginHttp({ ...deps, env: { ...env, RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "false" } })(request())).status, 404);
  for (const [req, status] of [[request(undefined, { Origin: "https://evil.example" }), 403], [request(undefined, { "Sec-Fetch-Site": "cross-site" }), 403],
    [request(undefined, { "next-action": "forged" }), 403], [request({ email: "client@example.invalid", password: "local password", role: "SUPER_ADMIN" }), 400],
    [request({ email: "client@example.invalid", password: "x".repeat(9000) }), 400]]) assert.equal((await createPilotLoginHttp(deps)(req)).status, status);
  assert.equal(calls, 0);
});
test("login HTTP independently throttles identity, exposes no secrets and validates redirect literals", async () => {
  let rate = [], serviceCalls = 0;
  const deps = { env: { ...env, NODE_ENV: "production" }, clock: () => now,
    rateLimit: async value => { rate.push(value); return { allowed: true }; },
    loadService: async () => ({ login: async () => { serviceCalls++; return { ok: true, rawSessionToken: "b".repeat(64), expiresAt: new Date(+now + 3600000), landing: "/dashboard/retail/rewards" }; } }) };
  const response = await createPilotLoginHttp(deps)(request());
  assert.deepEqual(await response.json(), { ok: true, landing: "/dashboard/retail/rewards" });
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; .*; Secure$/);
  assert.equal(rate.length, 2); assert.match(rate[1].identity, /^[a-f0-9]{64}$/); assert.equal(serviceCalls, 1);
  const denied = await createPilotLoginHttp({ ...deps, rateLimit: async ({ identity }) => ({ allowed: !identity }) })(request());
  assert.equal(denied.status, 429); assert.equal(denied.headers.get("set-cookie"), null); assert.equal(serviceCalls, 1);
  const unsafe = await createPilotLoginHttp({ ...deps, loadService: async () => ({ login: async () => ({ ok: true, rawSessionToken: "b".repeat(64), expiresAt: new Date(+now + 3600000), landing: "https://evil.example" }) }) })(request());
  assert.equal(unsafe.status, 503); assert.equal(unsafe.headers.get("set-cookie"), null);
  const invalidDate = await createPilotLoginHttp({ ...deps, loadService: async () => ({ login: async () => ({ ok: true, rawSessionToken: "b".repeat(64), expiresAt: new Date(NaN), landing: "/dashboard/retail/rewards" }) }) })(request());
  assert.equal(invalidDate.status, 503); assert.equal(invalidDate.headers.get("set-cookie"), null);
});
