import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { publicRequestOrigin } from "../lib/origin-policy.mjs";
import * as policy from "../lib/private-preview-policy.mjs";
import { privatePreviewTesterRequestAllowed, isPrivatePreviewOnlineDraftSession } from "../lib/private-preview-tester-policy.mjs";
import { catalogueRequestSizePolicy } from "../lib/catalogue-request-limits.mjs";
import { retailTestPlayerBootstrapRequest, retailTestPlayerDeviceRequest } from "../lib/retail-test-player-request.mjs";
import { isPrivatePreviewSubscriberTestingSession } from "../lib/private-preview-subscriber-testing.mjs";
import { hashPlayerToken } from "../lib/player-tokens.mjs";
import { readPilotPreviewPolicy } from "../lib/retail-rewards/pilot-preview-policy.mjs";
import { pilotPreviewRoute } from "../lib/retail-rewards/pilot-preview-routes.mjs";
import { pilotPreviewBusinessIdentity } from "../lib/retail-rewards/pilot-preview-business.mjs";
import { pilotPreviewAdminIdentity } from "../lib/retail-rewards/pilot-preview-admin.mjs";
import { requirePilotAdminAccess } from "../lib/retail-rewards/pilot-admin-access.mjs";
import { requireRewardShopperAccess, hashShopperSessionToken, SHOPPER_COOKIE } from "../lib/retail-rewards/shopper-access.mjs";
import { pilotPreviewOwnerContext } from "./fixtures/rewards-pilot-preview-admin.mjs";
import { readPrivatePreviewRecoveryPolicy, privatePreviewRecoveryRoute } from "../lib/private-preview-account-recovery.mjs";

const source = await readFile(new URL("../middleware.js", import.meta.url), "utf8");
const BASE_ENV = {
  NODE_ENV: "production", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
  RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
  RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/",
  ALLOWED_ORIGINS: "https://ruvanas-platform.onrender.com,https://unapproved.example.test",
  RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: undefined,
  RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ENABLED: undefined,
  RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ACCOUNTS: undefined,
  RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_EXPIRES_AT: undefined
};

test("preparation uses ordinary owner routing while Rewards pilot mutation routes stay closed", async () => {
  await withEnv({ RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "false",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.invalid", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.invalid" }, async () => {
    const owner = middlewareHarness({ session: pilotPreviewOwnerContext().session });
    for (const route of ["/admin/retail-rewards/preparation?organisationId=org-one", "/api/admin/retail-rewards/preparation?organisationId=org-one"]) {
      assert.equal(pilotPreviewRoute(new URL(route, "https://www.ruvanas.com").pathname, "GET", false), null);
      const response = await owner.run(request(route));
      assert.equal(response.headers.get("x-test-action"), "next", route);
    }
    for (const [route, method] of [["/admin/retail-rewards/pilot", "GET"], ["/api/admin/retail-rewards/pilot/renew", "POST"],
      ["/api/admin/retail-rewards/pilot/invite", "POST"]]) {
      assert.equal((await owner.run(request(route, { method, headers: { origin: "https://www.ruvanas.com" } }))).status, 404, route);
    }
  });
});

test("preparation routes do not admit anonymous or subscriber sessions through the closed pilot bridge", async () => {
  await withEnv({ RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "false" }, async () => {
    const subscriber = pilotPreviewOwnerContext().session;
    subscriber.user.role = "OWNER";
    subscriber.user.privatePreviewAccess = { userId: subscriber.userId, enabled: true, passwordEnabled: true,
      organisationId: "org-one", expiresAt: new Date(Date.now() + 3600000), pillars: ["RETAIL"] };
    subscriber.activeOrganisationId = "org-one";
    for (const session of [null, subscriber]) {
      const harness = middlewareHarness({ session });
      for (const path of ["/admin/retail-rewards/preparation?organisationId=org-one", "/api/admin/retail-rewards/preparation?organisationId=org-one"]) {
        const response = await harness.run(request(path));
        assert.notEqual(response.headers.get("x-test-action"), "next", path);
        assert.ok([307, 401, 403].includes(response.status), path);
      }
    }
  });
});

class TestResponse extends Response {
  static next() { return new TestResponse(null, { headers: { "x-test-action": "next" } }); }
  static rewrite(url) { return new TestResponse(null, { headers: { "x-test-action": "rewrite", "x-test-rewrite": String(url) } }); }
  static redirect(url) { return new TestResponse(null, { status: 307, headers: { location: String(url) } }); }
  static json(body, init = {}) { return new TestResponse(JSON.stringify(body), init); }
}

function middlewareHarness({ session = null, lookupThrows = false, deviceAllowed = false, shopperDb = {} } = {}) {
  let loads = 0;
  let lookups = 0;
  // Execute the actual middleware body with only Next's response adapter and
  // Prisma/session transport replaced. Auth/routing policies are real imports.
  // The explicit import replacement also detects changes to that test seam.
  const importStatement = 'const { prisma } = await import("@/lib/prisma");';
  const shopperImport = 'const { requireRewardShopperAccess, SHOPPER_COOKIE } = await import("@/lib/retail-rewards/shopper-access.mjs");';
  assert.equal(source.split(importStatement).length, 3, "Preview and Rewards pilot authentication each load Prisma lazily");
  assert.equal(source.split(shopperImport).length, 2, "Shopper pilot authentication has one reviewed import seam");
  const body = source.replace(/^import [^\n]+;\r?\n/gm, "")
    .replaceAll(importStatement, "const prisma = await loadPrisma();")
    .replace(shopperImport, "")
    .replace('const { prisma: deviceDb } = await import("@/lib/prisma");', "const deviceDb = {};")
    .replace('const { loadRetailTestPlayerByTokenHash } = await import("@/lib/retail-test-player-access.mjs");', "")
    .replace("export async function middleware", "async function middleware")
    .replace("export const config", "const config");
  const names = ["NextResponse", "publicRequestOrigin", "privatePreviewTesterRequestAllowed", "getSessionFromToken", "SESSION_COOKIE",
    "readPrivatePreviewPolicy", "isPrivatePreviewPublicPath", "isPrivatePreviewRegistrationPath", "privatePreviewSessionLanding",
    "isPrivatePreviewAdminSession", "isPrivatePreviewOwnerBootstrapSession", "loadPrisma", "crypto", "catalogueRequestSizePolicy",
    "retailTestPlayerBootstrapRequest", "retailTestPlayerDeviceRequest", "hashPlayerToken", "loadRetailTestPlayerByTokenHash", "isPrivatePreviewSubscriberTestingSession",
    "isPrivatePreviewOnlineDraftSession", "readPilotPreviewPolicy", "pilotPreviewRoute", "pilotPreviewBusinessIdentity", "pilotPreviewAdminIdentity", "requireRewardShopperAccess", "SHOPPER_COOKIE",
    "readPrivatePreviewRecoveryPolicy", "privatePreviewRecoveryRoute"];
  const values = [TestResponse, publicRequestOrigin, privatePreviewTesterRequestAllowed,
    async () => { lookups += 1; if (lookupThrows) throw new Error("No public session query allowed"); return session; },
    "ruvanas_session", policy.readPrivatePreviewPolicy, policy.isPrivatePreviewPublicPath, policy.isPrivatePreviewRegistrationPath,
    policy.privatePreviewSessionLanding, policy.isPrivatePreviewAdminSession, policy.isPrivatePreviewOwnerBootstrapSession,
    async () => { loads += 1; return shopperDb; }, { randomUUID: () => "synthetic-request-id" }, catalogueRequestSizePolicy,
    retailTestPlayerBootstrapRequest, retailTestPlayerDeviceRequest, hashPlayerToken, async () => deviceAllowed ? { subscriberTestStream: {} } : null,
    isPrivatePreviewSubscriberTestingSession, isPrivatePreviewOnlineDraftSession, readPilotPreviewPolicy, pilotPreviewRoute,
    pilotPreviewBusinessIdentity, pilotPreviewAdminIdentity, requireRewardShopperAccess, SHOPPER_COOKIE,
    readPrivatePreviewRecoveryPolicy, privatePreviewRecoveryRoute];
  const run = new Function(...names, `${body}\nreturn middleware;`)(...values);
  return { run, get loads() { return loads; }, get lookups() { return lookups; } };
}

function request(pathname, { method = "GET", origin = "https://www.ruvanas.com", headers = {}, cookie = true, deviceCookie = false, shopperCookie = false } = {}) {
  const url = new URL(pathname, origin);
  return { url: url.href, nextUrl: url, method,
    headers: new Headers({ host: url.host, ...headers }),
    cookies: { get: name => name === "ruvanas_player" ? (deviceCookie ? { value: "p".repeat(43) } : undefined)
      : name === SHOPPER_COOKIE ? (shopperCookie ? { value: "b".repeat(64) } : undefined)
      : name === "ruvanas_session" && cookie ? { value: "a".repeat(64) } : undefined } };
}

async function withEnv(overrides, action) {
  const values = { ...BASE_ENV, ...overrides };
  const before = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    return await action();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("public home and guide rewrite only to frozen documents without any session/database lookup", async () => {
  await withEnv({}, async () => {
    const harness = middlewareHarness({ lookupThrows: true });
    for (const method of ["GET", "HEAD"]) {
      for (const [path, expected] of [["/", "/public-marketing/index.html"],
        ["/how-it-works", "/public-marketing/how-it-works/index.html"],
        ["/how-it-works/", "/public-marketing/how-it-works/index.html"]]) {
        const result = await harness.run(request(`${path}?ignored=private`, { method }));
        assert.equal(result.status, 200);
        assert.equal(result.headers.get("x-test-action"), "rewrite");
        assert.equal(new URL(result.headers.get("x-test-rewrite")).pathname, expected);
        assert.equal(new URL(result.headers.get("x-test-rewrite")).search, "");
        assert.equal(result.headers.get("set-cookie"), null);
        assert.equal(result.headers.get("cache-control"), null, "Raw public handler owns the cache policy");
        assert.match(result.headers.get("x-robots-tag"), /noindex/);
      }
      for (const path of ["/public-marketing/index.html", "/public-marketing/how-it-works/index.html"]) {
        assert.equal((await harness.run(request(path, { method }))).headers.get("x-test-action"), "next");
      }
    }
    assert.equal(harness.loads, 0);
    assert.equal(harness.lookups, 0);
  });
});

test("public paths never permit a write or bypass CSRF by an alias", async () => {
  await withEnv({}, async () => {
    const harness = middlewareHarness({ lookupThrows: true });
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "OPTIONS"]) {
      for (const path of ["/", "/how-it-works", "/how-it-works/", "/public-marketing/index.html", "/public-marketing/how-it-works/index.html"]) {
        const response = await harness.run(request(path, { method, headers: { origin: "https://www.ruvanas.com" } }));
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal(response.headers.get("x-test-action"), null);
        assert.equal(response.headers.get("location"), null);
      }
    }
    assert.equal(harness.loads, 0);
  });
});

test("absent or disabled Rewards pilot bridge does not expose pilot sign-in, shopper or business routes", async () => {
  for (const flag of [undefined, "false"]) {
    await withEnv({ RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "true",
      RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: '["org-one"]', RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: flag }, async () => {
      const harness = middlewareHarness({ lookupThrows: true });
      for (const path of ["/rewards/pilot-sign-in", "/rewards/sign-in", "/rewards/accept-invitation", "/rewards/wallet",
        "/dashboard/retail/rewards", "/admin/retail-rewards/pilot"]) {
        const response = await harness.run(request(path, { cookie: false }));
        if (path === "/admin/retail-rewards/pilot") { assert.equal(response.status, 404); continue; }
        assert.equal(response.status, 307, path);
        assert.equal(response.headers.get("location"), "https://www.ruvanas.com/login");
        assert.equal(response.headers.get("x-test-action"), null);
      }
      for (const [path, method] of [["/api/retail-rewards/pilot-login", "POST"], ["/api/rewards/auth/login", "POST"],
        ["/api/rewards/auth/invitation", "POST"], ["/api/rewards/discovery/shops", "GET"], ["/api/rewards/claims", "GET"]]) {
        const response = await harness.run(request(path, { method, cookie: false, headers: { origin: "https://www.ruvanas.com" } }));
        assert.equal(response.status, 401, path);
        assert.equal(response.headers.get("x-test-action"), null);
      }
      assert.equal(harness.loads, 0);
      assert.equal(harness.lookups, 0);
    });
  }
});

const ADMIN_PILOT_ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: '["org-one"]', RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "true",
  RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.invalid", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.invalid" };

const SHOPPER_PILOT_ENV = { ...ADMIN_PILOT_ENV, RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
  SESSION_SECRET: "synthetic-local-shopper-middleware-secret-only" };
function middlewareShopperFixture() {
  const now = new Date(), start = new Date(now.getTime() - 60_000), end = new Date(now.getTime() + 3_600_000);
  const row = { id: "shopper-session-one", shopperId: "shopper-one",
    tokenHash: hashShopperSessionToken("b".repeat(64), SHOPPER_PILOT_ENV.SESSION_SECRET),
    authVersion: 1, createdAt: start, expiresAt: end, revokedAt: null,
    shopper: { id: "shopper-one", status: "ACTIVE", authVersion: 1, membership: {
      id: "shopper-membership-one", shopperId: "shopper-one", status: "ACTIVE", source: "MANUAL_INTERNAL",
      startsAt: start, expiresAt: end, revokedAt: null, version: 1 } } };
  const reads = [];
  const db = { rewardShopperSession: { findUnique: async query => {
    reads.push(query); assert.equal(query.where.tokenHash, row.tokenHash); return structuredClone(row);
  } }, rewardPilotShopperEnrollment: { findUnique: async query => {
    assert.equal(query.where.shopperId, row.shopperId); return { shopperId: row.shopperId, organisationId: "org-one" };
  } } };
  return { row, db, reads };
}

test("actual middleware admits location search and paging with only a current pilot shopper session", async () => {
  await withEnv(SHOPPER_PILOT_ENV, async () => {
    const fixture = middlewareShopperFixture(), harness = middlewareHarness({ shopperDb: fixture.db, lookupThrows: true });
    for (const method of ["GET", "HEAD"]) {
      const response = await harness.run(request("/api/rewards/discovery/locations?search=Sli&countryCode=MT&page=2",
        { method, cookie: false, shopperCookie: true }));
      assert.equal(response.headers.get("x-test-action"), "next", method);
      assert.match(response.headers.get("cache-control"), /private, no-store/);
    }
    assert.equal(fixture.reads.length, 2);
    assert.equal(harness.lookups, 0, "A business/preview session is neither required nor consulted");
    const missing = await harness.run(request("/api/rewards/discovery/locations", { cookie: false }));
    assert.equal(missing.status, 401); assert.equal(missing.headers.get("x-test-action"), null);
    assert.equal(fixture.reads.length, 2, "Missing shopper cookies cause no shopper lookup");
    fixture.row.revokedAt = new Date();
    const revoked = await harness.run(request("/api/rewards/discovery/locations", { cookie: false, shopperCookie: true }));
    assert.equal(revoked.status, 401); assert.equal(revoked.headers.get("x-test-action"), null);
    assert.equal(harness.lookups, 0, "Failure does not fall back to a business identity");
  });
});

test("location shopper admission stays closed when pilot or Rewards is disabled and never opens registration", async () => {
  for (const disabled of ["RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED", "RUVANAS_RETAIL_REWARDS_ENABLED"]) {
    await withEnv({ ...SHOPPER_PILOT_ENV, [disabled]: "false" }, async () => {
      const fixture = middlewareShopperFixture(), harness = middlewareHarness({ shopperDb: fixture.db, lookupThrows: true });
      const response = await harness.run(request("/api/rewards/discovery/locations", { cookie: false, shopperCookie: true }));
      assert.equal(response.status, 401, disabled); assert.equal(response.headers.get("x-test-action"), null);
      assert.equal(fixture.reads.length, 0); assert.equal(harness.loads, 0); assert.equal(harness.lookups, 0);
      assert.equal((await harness.run(request("/register", { cookie: false, shopperCookie: true }))).status, 404);
      assert.equal((await harness.run(request("/api/auth/register", { method: "POST", cookie: false, shopperCookie: true }))).status, 403);
    });
  }
});

test("actual middleware admits connected wallet and savings routes only for a current shopper", async () => {
  await withEnv(SHOPPER_PILOT_ENV, async () => {
    const fixture = middlewareShopperFixture(), harness = middlewareHarness({ shopperDb: fixture.db, lookupThrows: true });
    const routes = [["/api/rewards/saved-wallet?page=2", "GET"], ["/api/rewards/saved-wallet", "HEAD"],
      ["/api/rewards/saved-wallet", "POST"], ["/api/rewards/saved-wallet/status", "POST"],
      ["/api/rewards/saved-wallet/saved-own", "DELETE"], ["/api/rewards/savings", "GET"], ["/rewards/savings", "GET"]];
    for (const [path, method] of routes) {
      const response = await harness.run(request(path, { method, cookie: false, shopperCookie: true, headers: { origin: "https://www.ruvanas.com" } }));
      assert.equal(response.headers.get("x-test-action"), "next", `${method} ${path}`);
      assert.match(response.headers.get("cache-control"), /private, no-store/);
    }
    assert.equal(harness.lookups, 0, "These routes cannot borrow a business or administrator session");
    for (const [path, method] of routes.filter(([path]) => path.startsWith("/api/"))) {
      const missing = await harness.run(request(path, { method, cookie: false, headers: { origin: "https://www.ruvanas.com" } }));
      assert.equal(missing.status, 401); assert.equal(missing.headers.get("x-test-action"), null);
      fixture.row.shopper.membership.status = "REVOKED";
      const revoked = await harness.run(request(path, { method, cookie: false, shopperCookie: true, headers: { origin: "https://www.ruvanas.com" } }));
      assert.equal(revoked.status, 401); assert.equal(revoked.headers.get("x-test-action"), null);
      fixture.row.shopper.membership.status = "ACTIVE";
    }
    assert.equal(harness.lookups, 0);
  });
});

test("connected wallet middleware cannot bypass disabled gates, method scope, origin checks or closed registration", async () => {
  for (const disabled of ["RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED", "RUVANAS_RETAIL_REWARDS_ENABLED", "RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED"]) {
    await withEnv({ ...SHOPPER_PILOT_ENV, [disabled]: "false" }, async () => {
      const fixture = middlewareShopperFixture(), harness = middlewareHarness({ shopperDb: fixture.db, lookupThrows: true });
      for (const [path, method] of [["/api/rewards/saved-wallet", "GET"], ["/api/rewards/saved-wallet", "POST"], ["/api/rewards/saved-wallet/saved-own", "DELETE"], ["/api/rewards/savings", "GET"]]) {
        const response = await harness.run(request(path, { method, cookie: false, shopperCookie: true, headers: { origin: "https://www.ruvanas.com" } }));
        assert.equal(response.headers.get("x-test-action"), null); assert.equal(response.status, 401);
      }
      assert.equal(fixture.reads.length, 0);
      assert.equal((await harness.run(request("/register", { cookie: false, shopperCookie: true }))).status, 404);
      assert.equal((await harness.run(request("/api/auth/register", { method: "POST", cookie: false, shopperCookie: true }))).status, 403);
    });
  }
  await withEnv(SHOPPER_PILOT_ENV, async () => {
    const fixture = middlewareShopperFixture(), harness = middlewareHarness({ shopperDb: fixture.db, lookupThrows: true });
    for (const [path, method, headers] of [["/api/rewards/saved-wallet/status", "DELETE", {}], ["/api/rewards/saved-wallet/status", "GET", {}],
      ["/api/rewards/saved-wallet", "POST", { "next-action": "unreviewed" }], ["/api/rewards/saved-wallet", "POST", { origin: "https://unapproved.example.test" }]]) {
      const response = await harness.run(request(path, { method, cookie: false, shopperCookie: true, headers: { origin: "https://www.ruvanas.com", ...headers } }));
      assert.equal(response.headers.get("x-test-action"), null); assert.ok([401, 403].includes(response.status));
    }
  });
});

test("actual middleware admits the established preview owner only to scoped pilot administration", async () => {
  await withEnv({ ...ADMIN_PILOT_ENV, RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true" }, async () => {
    const c = pilotPreviewOwnerContext(), harness = middlewareHarness({ session: c.session });
    for (const path of ["/admin/retail-rewards/pilot", "/api/admin/retail-rewards/pilot/organisations",
      "/api/admin/retail-rewards/pilot/readiness?organisationId=org-one",
      "/api/admin/retail-rewards/pilot/renewalReview?organisationId=org-one&shopperId=shopper-one"]) {
      const response = await harness.run(request(path));
      assert.equal(response.headers.get("x-test-action"), "next", path);
    }
    assert.equal((await harness.run(request("/api/admin/retail-rewards/pilot/renew", {
      method: "POST", headers: { origin: "https://www.ruvanas.com" }
    }))).headers.get("x-test-action"), "next");
    const merchant = await harness.run(request("/dashboard/retail/rewards"));
    assert.equal(merchant.status, 307);
    assert.equal(new URL(merchant.headers.get("location")).pathname, "/rewards/pilot-sign-in");
    const merchantApi = await harness.run(request("/api/retail-rewards/offers"));
    assert.equal(merchantApi.status, 401);
    const beforeShopperLookups = harness.lookups;
    const shopper = await harness.run(request("/rewards/wallet"));
    assert.equal(shopper.status, 307);
    assert.equal(new URL(shopper.headers.get("location")).pathname, "/rewards/sign-in");
    assert.equal(harness.lookups, beforeShopperLookups, "owner cookie is not consulted for shopper authentication");
    // Middleware selects roles; the same route's guard selects the exact tenant.
    assert.equal((await requirePilotAdminAccess({ env: process.env, loadContext: async () => c,
      organisationId: "other-org" })).code, "FORBIDDEN");
    assert.equal((await harness.run(request("/register"))).status, 404);
  });
});

test("actual middleware denies disabled pilot admin gates before any session or database lookup", async () => {
  for (const key of ["RUVANAS_RETAIL_REWARDS_ENABLED", "RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED", "RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED"]) {
    await withEnv({ ...ADMIN_PILOT_ENV, [key]: "false" }, async () => {
      const harness = middlewareHarness({ session: pilotPreviewOwnerContext().session, lookupThrows: true });
      for (const [path, method] of [["/admin/retail-rewards/pilot", "GET"], ["/api/admin/retail-rewards/pilot/overview", "GET"],
        ["/api/admin/retail-rewards/pilot/prepare", "POST"], ["/api/admin/retail-rewards/pilot/renewalReview", "GET"],
        ["/api/admin/retail-rewards/pilot/renew", "POST"]]) {
        const response = await harness.run(request(path, { method, headers: { origin: "https://www.ruvanas.com" } }));
        assert.equal(response.status, 404, `${key} ${path}`);
      }
      assert.equal(harness.loads, 0); assert.equal(harness.lookups, 0);
    });
  }
});

test("actual middleware rejects preview bootstrap and malformed owner grants on pilot admin routes", async () => {
  await withEnv(ADMIN_PILOT_ENV, async () => {
    for (const mutate of [s => s.authMethod = "PREVIEW_CODE", s => s.user.email = "tester@example.invalid",
      s => s.user.privatePreviewAccess.enabled = false, s => s.user.privatePreviewAccess.organisationId = "org-one",
      s => s.user.privatePreviewAccess.pillars = ["RETAIL"], s => s.revokedAt = new Date(), s => s.expiresAt = new Date(0)]) {
      const session = pilotPreviewOwnerContext().session; mutate(session);
      for (const [path, method] of [["/api/admin/retail-rewards/pilot/organisations", "GET"],
        ["/api/admin/retail-rewards/pilot/renewalReview", "GET"], ["/api/admin/retail-rewards/pilot/renew", "POST"]]) {
        const response = await middlewareHarness({ session }).run(request(path, { method, headers: { origin: "https://www.ruvanas.com" } }));
        assert.equal(response.status, 401, `${String(mutate)} ${path}`);
      }
    }
  });
});

test("anonymous private app, API and assets remain protected; public-looking unknown paths are not documents", async () => {
  await withEnv({}, async () => {
    const harness = middlewareHarness();
    for (const path of ["/admin", "/dashboard", "/preview-dashboard", "/public-marketing/new-page", "/how-it-works/extra"]) {
      const response = await harness.run(request(path, { cookie: false }));
      assert.equal(response.status, 307, path);
      assert.equal(response.headers.get("location"), "https://www.ruvanas.com/login");
      assert.equal(response.headers.get("x-test-rewrite"), null);
    }
    assert.equal((await harness.run(request("/api/admin/private-preview/testers", { cookie: false }))).status, 401);
    for (const path of ["/_next/static/app.js.map", "/fonts/private.woff", "/images/private.png", "/public-marketing/private.html",
      "/public-marketing/%69ndex.html", "/public-marketing/index.html/other", "/how-it-works.json"]) {
      const response = await harness.run(request(path, { cookie: false }));
      assert.ok([307, 404].includes(response.status), path);
      assert.equal(response.headers.get("x-test-rewrite"), null);
    }
  });
});

test("registration and alternate account creation remain closed before any redirect or session query", async () => {
  await withEnv({}, async () => {
    const harness = middlewareHarness({ lookupThrows: true });
    for (const origin of ["https://www.ruvanas.com", "https://ruvanas-platform.onrender.com"]) {
      for (const path of ["/register", "/team-invitation/accept", "/school-student/accept"]) {
        assert.equal((await harness.run(request(path, { origin }))).status, 404);
      }
      for (const path of ["/api/auth/register", "/api/complimentary-access/redeem", "/api/school-student/accept"]) {
        assert.equal((await harness.run(request(path, { origin, method: "POST" }))).status, 403);
      }
    }
    assert.equal(harness.loads, 0);
  });
});

test("old Render and apex read navigation redirect to configured www without forwarding query codes or POSTs", async () => {
  await withEnv({}, async () => {
    const harness = middlewareHarness({ lookupThrows: true });
    for (const origin of ["https://ruvanas-platform.onrender.com", "https://ruvanas.com"]) {
      for (const path of ["/", "/login", "/admin", "/how-it-works"]) {
        for (const method of ["GET", "HEAD"]) {
          const result = await harness.run(request(`${path}?code=do-not-forward`, { origin, method }));
          assert.equal(result.status, 307);
          assert.equal(result.headers.get("location"), `https://www.ruvanas.com${path}`);
        }
      }
      const result = await harness.run(request("/api/auth/preview-password", {
        origin, method: "POST", headers: { origin: "https://www.ruvanas.com" }
      }));
      assert.equal(result.status, 403);
      assert.equal(result.headers.get("location"), null);
      assert.equal((await harness.run(request("/api/private-preview/health", { origin }))).headers.get("x-test-action"), "next");
    }
    assert.equal(harness.loads, 0);
  });
});

test("unknown or attacker-controlled host/protocol cannot select redirect targets or public exemptions", async () => {
  await withEnv({}, async () => {
    const harness = middlewareHarness({ lookupThrows: true });
    for (const headers of [
      { host: "evil.example.test" }, { "x-forwarded-host": "evil.example.test" },
      { "x-forwarded-host": "ruvanas-platform.onrender.com.evil.test" },
      { "x-forwarded-host": "evil.example.test,www.ruvanas.com" },
      { "x-forwarded-host": "user@www.ruvanas.com" }, { "x-forwarded-proto": "http" }
    ]) {
      for (const path of ["/", "/login", "/admin", "/api/private-preview/health"]) {
        const response = await harness.run(request(path, { headers }));
        assert.equal(response.status, 404, JSON.stringify(headers));
        assert.equal(response.headers.get("location"), null);
        assert.equal(response.headers.get("x-test-action"), null);
      }
    }
    assert.equal(harness.loads, 0);
  });
});

test("canonical private form actions keep exact same-origin CSRF despite stale ALLOWED_ORIGINS", async () => {
  await withEnv({}, async () => {
    const harness = middlewareHarness();
    const priorWarn = console.warn; console.warn = () => {};
    try {
      for (const origin of [undefined, "null", "https://ruvanas-platform.onrender.com", "https://unapproved.example.test", "https://www.ruvanas.com.evil.test"]) {
        const headers = origin === undefined ? {} : { origin };
        const response = await harness.run(request("/api/auth/logout", { method: "POST", headers }));
        assert.equal(response.status, 403, String(origin));
      }
      const response = await harness.run(request("/api/auth/logout", { method: "POST", headers: { origin: "https://www.ruvanas.com" } }));
      assert.equal(response.headers.get("x-test-action"), "next");
    } finally { console.warn = priorWarn; }
  });
});

test("invalid public-site flag fails closed even if preview is disabled; legacy distinct mode is preserved", async () => {
  const harness = middlewareHarness({ lookupThrows: true });
  for (const flag of ["", "false", "yes", "01", "1"]) {
    await withEnv({ RUVANAS_PRIVATE_PREVIEW_ENABLED: "0", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: flag }, async () => {
      assert.equal((await harness.run(request("/"))).status, 503);
      assert.equal((await harness.run(request("/api/auth/register", { method: "POST" }))).status, 503);
    });
  }
  await withEnv({ RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: undefined, RUVANAS_PUBLIC_URL: "https://ruvanas-platform.onrender.com" }, async () => {
    const result = await middlewareHarness().run(request("/", { origin: "https://ruvanas-platform.onrender.com", cookie: false }));
    assert.equal(result.status, 307);
    assert.equal(result.headers.get("location"), "https://www.ruvanas.com/");
    const denied = await middlewareHarness().run(request("/admin", { origin: "https://ruvanas-platform.onrender.com", cookie: false }));
    assert.equal(denied.headers.get("location"), "https://ruvanas-platform.onrender.com/preview-login");
  });
  assert.equal(harness.loads, 0);
});

test("Retail player bootstrap and valid device routes retain CSRF and registration closure", async () => {
  await withEnv({ SESSION_SECRET: 'x'.repeat(32) }, async () => {
    const noSession = { cookie: false };
    const anonymous = middlewareHarness({ lookupThrows: true });
    assert.equal((await anonymous.run(request('/player', noSession))).headers.get('x-test-action'), 'next');
    assert.equal((await anonymous.run(request('/_next/static/chunks/player.js', noSession))).headers.get('x-test-action'), 'next');
    assert.equal((await anonymous.run(request('/api/player/enrol', { ...noSession, method:'POST', headers:{origin:'https://www.ruvanas.com'} }))).headers.get('x-test-action'), 'next');
    const oldWarn = console.warn; console.warn = () => {};
    try {
      assert.equal((await anonymous.run(request('/api/player/enrol', { ...noSession, method:'POST', headers:{origin:'https://evil.invalid'} }))).status,403);
      const valid = middlewareHarness({ deviceAllowed:true });
      const options = {cookie:false,deviceCookie:true};
      for (const path of ['/api/player/state','/api/player/manifest']) assert.equal((await valid.run(request(path,options))).headers.get('x-test-action'),'next');
      for (const path of ['/api/player/media/asset','/api/player/proof-of-play','/api/player/commands','/api/account/test-tier']) assert.equal((await valid.run(request(path,options))).status,401,path);
      assert.equal((await valid.run(request('/api/player/heartbeat',{...options,method:'POST',headers:{origin:'https://evil.invalid'}}))).status,403);
      assert.equal((await valid.run(request('/api/auth/register',{...options,method:'POST',headers:{origin:'https://www.ruvanas.com'}}))).status,403);
      assert.equal((await middlewareHarness().run(request('/api/player/state',options))).status,401);
    } finally { console.warn = oldWarn; }
  });
});
