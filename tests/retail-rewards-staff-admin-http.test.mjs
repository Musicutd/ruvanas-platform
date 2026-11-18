import test from "node:test";
import assert from "node:assert/strict";
import { createStaffAdminHttp } from "../lib/retail-rewards/staff-admin-http.mjs";
import { safeStaffAdminResult } from "../lib/retail-rewards/staff-admin-dtos.mjs";
const env = { NODE_ENV: "production", RUVANAS_PUBLIC_URL: "https://rewards.example.invalid", RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_STAFF_ADMIN_ENABLED: "true" };
const input = { memberId: "member-one", expectedVersion: "a".repeat(64), locationIds: ["shop-one"], capabilities: ["REDEEM"], expiresAt: "2026-11-30T12:00:00.000Z", confirm: true };
const saved = { ok: true, memberId: "member-one", version: "b".repeat(64), changedRows: 1, checkedAt: "2026-11-14T12:00:00.000Z" };
const overview = { ok: true, organisation: { id: "org", name: "Synthetic merchant" }, members: [], locations: [], seatUsage: { used: 0, limit: 2 }, grantExpiresAt: input.expiresAt, checkedAt: saved.checkedAt };
function setup(overrides = {}) {
  const seen = [];
  const http = createStaffAdminHttp({ env, authorize: async () => { seen.push("auth"); return { ok: true, userId: "owner", organisationId: "org" }; },
    rateLimit: async value => { seen.push(value.principal ? "principal" : "ip"); return { allowed: true }; },
    loadService: async () => { seen.push("load"); return { save: async value => { seen.push(value); return saved; }, revoke: async () => saved, overview: async () => overview }; }, ...overrides });
  return { http, seen };
}
function req(body = input, { method = "POST", headers = {}, query = "", raw } = {}) {
  return new Request("https://rewards.example.invalid/api/retail-rewards/staff/save" + query, { method,
    headers: { origin: env.RUVANAS_PUBLIC_URL, "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body) }) });
}
test("staff HTTP gates are default-off before any access or database", async () => {
  for (const flags of [{}, { ...env, RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { ...env, RUVANAS_RETAIL_REWARDS_STAFF_ADMIN_ENABLED: "TRUE" }]) {
    const { http, seen } = setup({ env: flags }); assert.equal((await http.run(req(), "save")).status, 403); assert.deepEqual(seen, []);
  }
});
test("staff transport requires same-origin mutations with no query or method ambiguity", async () => {
  for (const options of [{ method: "GET" }, { headers: { origin: "https://foreign.invalid" } }, { headers: { origin: "" } }, { headers: { origin: "null" } },
    { headers: { "sec-fetch-site": "cross-site" } }, { query: "?memberId=foreign" }]) {
    const { http, seen } = setup(); assert.ok((await http.run(req(input, options), "save")).status >= 400); assert.deepEqual(seen, []);
  }
  for (const operation of ["constructor", "__proto__", "toString", "invite", "unknown"]) {
    const { http, seen } = setup(); assert.equal((await http.run(req(), operation)).status, 400); assert.deepEqual(seen, []);
  }
});
test("staff body is bounded JSON; caller cannot inject authority or arbitrary roles", async () => {
  const requests = [req({ ...input, organisationId: "foreign" }), req({ ...input, role: "OWNER" }), req({ ...input, confirm: false }),
    req({ ...input, capabilities: ["MANAGE_STAFF"] }), req({ ...input, expiresAt: "not-a-date" }), req(input, { headers: { "content-type": "text/plain" } }),
    req(input, { raw: "{" }), req(input, { raw: " ".repeat(8193) }), req(input, { headers: { "content-length": "9000" } }), req(input, { raw: new Uint8Array([255, 255]) })];
  for (const request of requests) { const { http, seen } = setup(); assert.equal((await http.run(request, "save")).status, 400); assert.ok(!seen.includes("auth")); }
});
test("REDEEM-only save remains exact and success is private no-store", async () => {
  const { http, seen } = setup(), response = await http.run(req(), "save"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), saved);
  assert.match(response.headers.get("cache-control"), /private.*no-store/); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("vary"), "Cookie"); assert.deepEqual(seen, ["ip", "auth", "principal", "load", input]);
});
test("overview accepts no tenant/member query and no mutation body", async () => {
  const { http } = setup(); const response = await http.run(req(null, { method: "GET" }), "overview"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), overview);
  assert.equal((await http.run(req(null, { method: "GET", query: "?organisationId=foreign" }), "overview")).status, 400);
  assert.equal((await http.run(req(), "overview")).status, 405);
});
test("auth errors, rate limits and implementation failures reveal no private details", async () => {
  const { http, seen } = setup({ authorize: async () => ({ ok: false, code: "FORBIDDEN", email: "private@example.invalid" }) });
  const r = await http.run(req(), "save"); assert.equal(r.status, 403); assert.ok(!(await r.text()).includes("private")); assert.ok(!seen.includes("load"));
  for (const stage of ["ip", "principal"]) {
    const { http, seen } = setup({ rateLimit: async ({ principal }) => ({ allowed: stage === "ip" ? false : !principal, retryAfterSeconds: 3.1 }) });
    const r = await http.run(req(), "save"); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "4"); assert.ok(!seen.includes("load"));
  }
  for (const loadService of [async () => { throw Error("private-database-url"); }, async () => ({ save: async () => ({ ...saved, passwordHash: "private-hash" }) })]) {
    const { http } = setup({ loadService }); const r = await http.run(req(), "save"); assert.equal(r.status, 503); assert.ok(!(await r.text()).includes("private-"));
  }
});
test("strict staff DTOs reject extra metadata, unsafe identity and malformed bounds", () => {
  assert.equal(safeStaffAdminResult("overview", { ...overview, email: "private@example.invalid" }), null);
  assert.equal(safeStaffAdminResult("save", { ...saved, changedRows: 1021 }), null);
  assert.equal(safeStaffAdminResult("save", { ...saved, version: "bad" }), null);
  assert.equal(safeStaffAdminResult("constructor", saved), null);
  const member = { id: "member-one", displayName: "Cashier", role: "VIEWER", allowedCapabilities: ["READ", "REDEEM"], version: input.expectedVersion, usesSeat: true,
    grants: [{ id: "grant-one", scope: "LOCATIONS", locationId: "shop-one", capabilities: ["REDEEM"], startsAt: saved.checkedAt, expiresAt: input.expiresAt, revokedAt: null }] };
  assert.ok(safeStaffAdminResult("overview", { ...overview, members: [member] }));
  assert.equal(safeStaffAdminResult("overview", { ...overview, members: [{ ...member, allowedCapabilities: ["MANAGE_STAFF"] }] }), null);
  assert.equal(safeStaffAdminResult("overview", { ...overview, members: [{ ...member, email: "private@example.invalid" }] }), null);
});
