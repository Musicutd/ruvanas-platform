import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { publicRequestOrigin } from "../lib/origin-policy.mjs";
import * as policy from "../lib/private-preview-policy.mjs";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";
import { catalogueRequestSizePolicy } from "../lib/catalogue-request-limits.mjs";

const source = await readFile(new URL("../middleware.js", import.meta.url), "utf8");
const BASE_ENV = {
  NODE_ENV: "production", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
  RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
  RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/",
  ALLOWED_ORIGINS: "https://ruvanas-platform.onrender.com,https://unapproved.example.test"
};

class TestResponse extends Response {
  static next() { return new TestResponse(null, { headers: { "x-test-action": "next" } }); }
  static rewrite(url) { return new TestResponse(null, { headers: { "x-test-action": "rewrite", "x-test-rewrite": String(url) } }); }
  static redirect(url) { return new TestResponse(null, { status: 307, headers: { location: String(url) } }); }
  static json(body, init = {}) { return new TestResponse(JSON.stringify(body), init); }
}

function middlewareHarness({ session = null, lookupThrows = false } = {}) {
  let loads = 0;
  let lookups = 0;
  // Execute the actual middleware body with only Next's response adapter and
  // Prisma/session transport replaced. Auth/routing policies are real imports.
  // The explicit import replacement also detects changes to that test seam.
  const importStatement = 'const { prisma } = await import("@/lib/prisma");';
  assert.equal(source.split(importStatement).length, 2);
  const body = source.replace(/^import [^\n]+;\r?\n/gm, "")
    .replace(importStatement, "const prisma = await loadPrisma();")
    .replace("export async function middleware", "async function middleware")
    .replace("export const config", "const config");
  const names = ["NextResponse", "publicRequestOrigin", "privatePreviewTesterRequestAllowed", "getSessionFromToken", "SESSION_COOKIE",
    "readPrivatePreviewPolicy", "isPrivatePreviewPublicPath", "isPrivatePreviewRegistrationPath", "privatePreviewSessionLanding",
    "isPrivatePreviewAdminSession", "isPrivatePreviewOwnerBootstrapSession", "loadPrisma", "crypto", "catalogueRequestSizePolicy"];
  const values = [TestResponse, publicRequestOrigin, privatePreviewTesterRequestAllowed,
    async () => { lookups += 1; if (lookupThrows) throw new Error("No public session query allowed"); return session; },
    "ruvanas_session", policy.readPrivatePreviewPolicy, policy.isPrivatePreviewPublicPath, policy.isPrivatePreviewRegistrationPath,
    policy.privatePreviewSessionLanding, policy.isPrivatePreviewAdminSession, policy.isPrivatePreviewOwnerBootstrapSession,
    async () => { loads += 1; return {}; }, { randomUUID: () => "synthetic-request-id" }, catalogueRequestSizePolicy];
  const run = new Function(...names, `${body}\nreturn middleware;`)(...values);
  return { run, get loads() { return loads; }, get lookups() { return lookups; } };
}

function request(pathname, { method = "GET", origin = "https://www.ruvanas.com", headers = {}, cookie = true } = {}) {
  const url = new URL(pathname, origin);
  return { url: url.href, nextUrl: url, method,
    headers: new Headers({ host: url.host, ...headers }),
    cookies: { get: () => cookie ? { value: "a".repeat(64) } : undefined } };
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
    for (const path of ["/_next/static/app.js", "/fonts/private.woff", "/images/private.png", "/public-marketing/private.html",
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
