import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as context from "../lib/retail-rewards/pilot-preparation-context.mjs";
import * as contracts from "../lib/retail-rewards/pilot-preparation-contracts.mjs";
import * as http from "../lib/retail-rewards/pilot-preparation-http.mjs";

const require = createRequire(import.meta.url);
const filename = "lib/retail-rewards/pilot-preparation-server.js";
const code = require("next/dist/build/swc").transformSync(readFileSync(new URL(`../${filename}`, import.meta.url), "utf8"), {
  filename, jsc: { parser: { syntax: "ecmascript" }, target: "es2022" }, module: { type: "commonjs" }
}).code;
function harness({ token = "a".repeat(64), role = "SUPER_ADMIN", flag = "false", limitAllowed = true } = {}) {
  const reads = [], limits = [], hashes = [], inspections = [];
  const now = Date.now(), session = { id: "owner-session", userId: "owner", authMethod: "PASSWORD", revokedAt: null,
    createdAt: new Date(now - 10000), lastSeenAt: new Date(now - 5000), expiresAt: new Date(now + 3600000),
    user: { id: "owner", role, privatePreviewAccess: null }, activeOrganisation: null };
  const deps = {
    "next/headers": { headers: async () => new Headers(), cookies: async () => ({ get: name => { assert.equal(name, "ruvanas_session"); return token ? { value: token } : undefined; } }) },
    "@/lib/prisma": { prisma: { session: { findUnique: async query => { reads.push(query); return session; } } } },
    "@/lib/session-lookup": { SESSION_COOKIE: "ruvanas_session", hashSessionToken: value => { hashes.push(value); return "fixture-hash"; } },
    "@/lib/rate-limit": { consumeRateLimit: async options => { limits.push(options); return { allowed: limitAllowed }; }, createRateLimitKey: prefix => prefix + ":fixture" },
    "./pilot-preparation-context.mjs": context, "./pilot-preparation-contracts.mjs": contracts,
    "./pilot-preparation-http.mjs": http,
    "./pilot-preparation-service.mjs": { createPilotPreparationService: options => ({ inspect: async input => {
      inspections.push({ input, session: await options.loadSession(), env: options.env });
      return contracts.pilotPreparationDenied("PREPARATION_UNAVAILABLE");
    } }) }
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, process: { env: { RUVANAS_RETAIL_REWARDS_ENABLED: flag } },
    require: name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } }, { filename });
  return { api: module.exports, reads, limits, hashes, inspections };
}

test("server uses a narrow ordinary cookie read without a session update or pilot bridge", async () => {
  const h = harness(), result = await h.api.authorizePilotPreparation();
  assert.equal(result.ok, true); assert.equal(h.reads.length, 1);
  assert.equal(h.hashes[0], "a".repeat(64));
  assert.equal(h.reads[0].where.tokenHash, "fixture-hash");
  assert.equal(h.reads[0].select, context.PILOT_PREPARATION_SESSION_SELECT);
});
test("missing or malformed cookies never query the database", async () => {
  for (const token of [null, "short", "A".repeat(64), "a".repeat(65)]) {
    const h = harness({ token });
    assert.equal((await h.api.authorizePilotPreparation()).ok, false);
    assert.equal(h.reads.length, 0); assert.equal(h.hashes.length, 0);
  }
});
test("server gates reject non-admin and enabled Rewards", async () => {
  for (const options of [{ role: "OWNER" }, { role: "SUPPORT" }, { flag: "true" }, { flag: "broken" }]) {
    assert.equal((await harness(options).api.authorizePilotPreparation()).ok, false);
  }
});
test("HTTP composition applies both IP and principal limits before the scoped service", async () => {
  const h = harness();
  const response = await h.api.pilotPreparationHttp.run(new Request("https://example.invalid/api/admin/retail-rewards/preparation?organisationId=org-one"));
  assert.equal(response.status, 409); assert.equal(h.inspections.length, 1);
  assert.deepEqual(h.limits.map(row => [row.limit, row.windowMs]), [[60, 60000], [15, 60000]]);
  assert.match(h.limits[0].key, /^rewards-preparation-ip:/);
  assert.equal(h.limits[1].key, "rewards-preparation:admin:owner");
  assert.equal(h.inspections[0].input.organisationId, "org-one");
  assert.match(response.headers.get("cache-control"), /no-store/);
});
test("unauthenticated HTTP cannot instantiate the preparation service", async () => {
  const h = harness({ token: null });
  const response = await h.api.pilotPreparationHttp.run(new Request("https://example.invalid/api/admin/retail-rewards/preparation?organisationId=org-one"));
  assert.equal(response.status, 401); assert.equal(h.inspections.length, 0);
});
test("page loading shares both API buckets and stops before inspection when throttled", async () => {
  const h = harness();
  assert.equal((await h.api.loadPilotPreparationPage("org-one")).code, "PREPARATION_UNAVAILABLE");
  assert.equal(h.inspections.length, 1);
  assert.deepEqual(h.limits.map(row => [row.key, row.limit]), [["rewards-preparation-ip:fixture", 60], ["rewards-preparation:admin:owner", 15]]);
  const blocked = harness({ limitAllowed: false });
  assert.equal((await blocked.api.loadPilotPreparationPage("org-one")).code, "RATE_LIMITED");
  assert.equal(blocked.inspections.length, 0); assert.equal(blocked.reads.length, 0);
});
