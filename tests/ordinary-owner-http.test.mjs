import test from "node:test";
import assert from "node:assert/strict";
import { createOrdinaryOwnerHttp } from "../lib/ordinary-owner-http.mjs";

const env = { NODE_ENV: "production", RUVANAS_PUBLIC_URL: "https://ruvanas.example.invalid" };
const input = { name: "Synthetic test shop", slug: "synthetic-test-shop", planId: "retail-start",
  ownerName: "Test Client Admin", ownerEmail: "owner@example.invalid", password: "synthetic test password only", confirmCreate: true };
const created = { ok: true, organisation: { id: "org-new", name: input.name, slug: input.slug },
  owner: { id: "owner-new", name: input.ownerName, email: input.ownerEmail, role: "OWNER" } };
function request(body = input, { method = "POST", headers = {}, query = "", raw } = {}) {
  return new Request(`${env.RUVANAS_PUBLIC_URL}/api/admin/organisations/ordinary-owner${query}`, {
    method, headers: { origin: env.RUVANAS_PUBLIC_URL, "content-type": "application/json", ...headers },
    ...(["GET", "HEAD"].includes(method) ? {} : { body: raw ?? JSON.stringify(body) })
  });
}
function setup(overrides = {}) {
  const calls = [];
  const http = createOrdinaryOwnerHttp({ env,
    authorize: async () => { calls.push("auth"); return { ok: true, userId: "super-admin" }; },
    rateLimit: async ({ operation, principal }) => { calls.push(principal ? "user-limit" : "ip-limit"); assert.equal(operation, "createOrdinaryOwner"); return { allowed: true }; },
    loadService: async () => { calls.push("load"); return { create: async value => { calls.push(value); return created; } }; },
    ...overrides
  });
  return { http, calls };
}

test("ordinary owner HTTP requires POST and rejects query values before dependencies", async () => {
  for (const options of [{ method: "GET" }, { method: "DELETE" }, { query: "?password=private-value" }]) {
    const { http, calls } = setup(); const response = await http.run(request(input, options));
    assert.equal(response.status, options.query ? 400 : 405);
    if (!options.query) assert.equal(response.headers.get("allow"), "POST");
    assert.deepEqual(calls, []); assert.doesNotMatch(await response.text(), /private-value/);
  }
});

test("ordinary owner HTTP uses canonical same-origin CSRF policy", async () => {
  for (const headers of [{ origin: "https://foreign.invalid" }, { origin: "" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }]) {
    const { http, calls } = setup(); assert.equal((await http.run(request(input, { headers }))).status, 403); assert.deepEqual(calls, []);
  }
  for (const policy of [{ NODE_ENV: "production" }, { ...env, RUVANAS_PUBLIC_URL: "http://ruvanas.example.invalid" }, { ...env, RUVANAS_PUBLIC_URL: `${env.RUVANAS_PUBLIC_URL}/private` }]) {
    const { http, calls } = setup({ env: policy }); assert.equal((await http.run(request())).status, 403); assert.deepEqual(calls, []);
  }
});

test("ordinary owner HTTP authorizes and rate limits before reading credentials", async () => {
  for (const access of [{ ok: false, code: "AUTH_REQUIRED", error: "private-auth-error" }, { ok: false, code: "FORBIDDEN" }]) {
    const { http, calls } = setup({ authorize: async () => access });
    const req = request(); req.body.getReader = () => { throw Error("body read before authorization"); };
    const response = await http.run(req); assert.equal(response.status, access.code === "AUTH_REQUIRED" ? 401 : 403);
    assert.deepEqual(calls, ["ip-limit"]); assert.doesNotMatch(await response.text(), /private-auth-error|password/);
  }
  const { http, calls } = setup({ authorize: async () => ({ ok: true }) });
  assert.equal((await http.run(request())).status, 503); assert.deepEqual(calls, ["ip-limit"]);
});

test("ordinary owner HTTP strictly validates body and never loads service for privilege injection", async () => {
  const requests = [request({ ...input, role: "SUPER_ADMIN" }), request({ ...input, confirmCreate: false }), request({ ...input, ownerEmail: "invalid" }),
    request({ ...input, password: "short" }), request(null), request([]), request(input, { raw: "{" }),
    request(input, { headers: { "content-type": "text/plain" } }), request(input, { raw: new Uint8Array([255, 255]) })];
  for (const req of requests) {
    const { http, calls } = setup(); const response = await http.run(req);
    assert.equal(response.status, 400); assert.deepEqual(calls, ["ip-limit", "auth", "user-limit"]);
    assert.doesNotMatch(await response.text(), /synthetic test password only/);
  }
});

test("ordinary owner HTTP bounds declared and actual credential payload bytes", async () => {
  for (const options of [{ headers: { "content-length": "8193" } }, { headers: { "content-length": "NaN" } }, { raw: " ".repeat(8193) }]) {
    const { http, calls } = setup(); assert.equal((await http.run(request(input, options))).status, 400); assert.ok(!calls.includes("load"));
  }
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4096)); controller.enqueue(new Uint8Array(4097)); }, cancel() { cancelled = true; } });
  const req = new Request(`${env.RUVANAS_PUBLIC_URL}/api/admin/organisations/ordinary-owner`, { method: "POST", headers: { origin: env.RUVANAS_PUBLIC_URL, "content-type": "application/json" }, body: stream, duplex: "half" });
  const { http } = setup(); assert.equal((await http.run(req)).status, 400); assert.equal(cancelled, true);
});

test("ordinary owner HTTP returns safe created identifiers without credential or session material", async () => {
  const { http, calls } = setup(); const response = await http.run(request());
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), created);
  assert.deepEqual(calls, ["ip-limit", "auth", "user-limit", "load", input]);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("vary"), "Cookie"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("set-cookie"), null);
});

test("ordinary owner provisioning remains independent of disabled Rewards flags", async () => {
  const { http } = setup({ env: { ...env, RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false" } });
  assert.equal((await http.run(request())).status, 201);
});

test("ordinary owner HTTP applies IP and principal throttling without creating anything", async () => {
  for (const phase of ["ip", "user"]) {
    const { http, calls } = setup({ rateLimit: async ({ principal }) => ({ allowed: phase === "user" && !principal, retryAfterSeconds: 3.1 }) });
    const response = await http.run(request()); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "4");
    assert.deepEqual(calls, phase === "ip" ? [] : ["auth"]);
  }
  const { http } = setup({ rateLimit: async () => ({ allowed: false, retryAfterSeconds: Infinity }) });
  assert.equal((await http.run(request())).headers.get("retry-after"), "60");
});

test("ordinary owner HTTP maps only known error codes and never forwards exception details", async () => {
  for (const [code, status] of [["AUTH_REQUIRED", 401], ["FORBIDDEN", 403], ["INVALID_REQUEST", 400], ["EMAIL_EXISTS", 409], ["SLUG_EXISTS", 409], ["PLAN_UNAVAILABLE", 409], ["CONFLICT", 409], ["UNAVAILABLE", 503], ["constructor", 503]]) {
    const { http } = setup({ loadService: async () => ({ create: async () => ({ ok: false, code, status: 200, error: "private-database-secret", password: input.password }) }) });
    const response = await http.run(request()); assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /private-database-secret|synthetic test password only/);
  }
  for (const overrides of [{ authorize: async () => { throw Error("private-auth-secret"); } }, { rateLimit: async () => { throw Error("private-rate-secret"); } }, { loadService: async () => { throw Error("private-db-secret"); } }]) {
    const { http } = setup(overrides); const response = await http.run(request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private-.*-secret/);
  }
});

test("ordinary owner HTTP rejects unsafe success payloads rather than echoing upstream data", async () => {
  for (const result of [{ ...created, passwordHash: "private-hash" }, { ...created, owner: { ...created.owner, sessions: ["private-session"] } }, { ...created, owner: { ...created.owner, role: "SUPER_ADMIN" } }, { ...created, organisation: { ...created.organisation, subscription: { planId: "private-plan" } } }]) {
    const { http } = setup({ loadService: async () => ({ create: async () => result }) });
    const response = await http.run(request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private-hash|private-session|private-plan/);
  }
});
