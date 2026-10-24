import test from "node:test";
import assert from "node:assert/strict";
import { createRetailStreamSetupHandlers, retailSetupOrigin } from "../lib/retail-stream-setup-http.mjs";

const origin = "https://app.example.com";
const url = `${origin}/api/admin/organisations/org-retail/retail-stream`;
const context = { params: Promise.resolve({ organisationId: "org-retail" }) };
const safeSetup = () => ({ organisation: { id: "org-retail", name: "Retail pilot" }, canSaveDraft: true, blockedReason: null,
  entitlements: { maxBitrateKbps: 128, listenerLimit: 10, storageLimitGb: 1, stationLimit: 1, streamLimit: 1,
    siteLimit: null, displayLimit: null, digitalSignageDisplayLimit: 1 }, station: null, connection: null,
  canStart: false, probeEnabled: false, outboundAutoDjEnabled: false, publicPlayerEnabled: false,
  stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL", requiresPlanLimitReview: true });
function harness(options = {}) {
  const calls = [];
  const handlers = createRetailStreamSetupHandlers({
    canonicalOrigin: origin,
    getAdmin: async () => ({ ok: true, user: { id: "admin-1", role: "SUPER_ADMIN" } }),
    loadSetup: async args => { calls.push(["load", args]); return safeSetup(); },
    saveSetup: async args => { calls.push(["save", args]); return { saved: true, unchanged: false, setup: safeSetup() }; },
    ...options
  });
  return { calls, ...handlers };
}
function post(body = {}, headers = {}, raw = false) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", origin, ...headers }, body: raw ? body : JSON.stringify(body) });
}

test("setup GET requires Super Admin and returns uncached safe data", async () => {
  const h = harness(); const response = await h.GET(new Request(url), context);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { setup: safeSetup() });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.deepEqual(h.calls, [["load", { actorUserId: "admin-1", organisationId: "org-retail" }]]);
});
test("unauthenticated and non Super Admin actors never reach the service", async () => {
  for (const access of [{ ok: false, status: 401 }, { ok: false, status: 403 }, { ok: true, user: { id: "user-1", role: "ADMIN" } }, { ok: true, user: { id: "user-1", role: "OWNER" } }]) {
    const h = harness({ getAdmin: async () => access });
    assert.ok([401, 403].includes((await h.GET(new Request(url), context)).status));
    assert.ok([401, 403].includes((await h.POST(post(), context)).status));
    assert.deepEqual(h.calls, []);
  }
});
test("POST requires the configured exact origin and refuses cross site or missing origin", async () => {
  for (const headers of [{ origin: "https://attacker.example.com" }, { origin: "null" }, { origin: "" }, { "sec-fetch-site": "cross-site" }]) {
    const h = harness(); assert.equal((await h.POST(post({}, headers), context)).status, 403); assert.equal(h.calls.length, 0);
  }
  const h = harness({ canonicalOrigin: null }); assert.equal((await h.POST(post(), context)).status, 403);
});
test("request allowlist rejects limits, activation, tenant overrides and station IDs", async () => {
  for (const key of ["organisationId", "stationId", "outboundAutoDjEnabled", "probeEnabled", "plan", "entitlements", "siteLimit", "streamLimit", "adminPassword", "sourcePasswordEncrypted", "__proto__"]) {
    const h = harness(); const response = await h.POST(post({ [key]: "not-allowed" }), context);
    assert.equal(response.status, 400, key); assert.equal(h.calls.length, 0);
  }
});
test("password bytes pass unchanged to save and never enter the response", async () => {
  const h = harness(); const sourcePassword = "  Private exact bytes  ";
  const response = await h.POST(post({ sourcePassword, sourcePort: 8112 }), context);
  assert.equal(response.status, 200); assert.equal(h.calls[0][1].input.sourcePassword, sourcePassword);
  assert.deepEqual(await response.json(), { saved: true, setup: safeSetup() });
});
test("wrong content type, malformed and oversized streamed JSON are rejected without saving", async () => {
  for (const request of [post("{", {}, true), post([], {}), post(null), post({}, { "content-type": "text/plain" }), post({ sourcePassword: "x".repeat(4097) }), post({}, { "content-length": "4097" }), post({}, { "content-length": "unknown" })]) {
    const h = harness(); assert.equal((await h.POST(request, context)).status, 400); assert.equal(h.calls.length, 0);
  }
});
test("invalid IDs are rejected before a service query", async () => {
  for (const organisationId of ["", "org/other", null, "org\nother"]) {
    const h = harness(); const badContext = { params: Promise.resolve({ organisationId }) };
    assert.equal((await h.GET(new Request(url), badContext)).status, 400);
    assert.equal((await h.POST(post(), badContext)).status, 400); assert.equal(h.calls.length, 0);
  }
});
test("unexpected failures never reveal database errors or secret text", async () => {
  const problem = new Error("database credentials and secret PRIVATE_BYTES");
  const h = harness({ saveSetup: async () => { throw problem; }, loadSetup: async () => { throw problem; } });
  for (const response of [await h.GET(new Request(url), context), await h.POST(post(), context)]) {
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE_BYTES|database credentials/);
  }
});
test("both response boundaries project safe fields and reject foreign or enabled setup data", async () => {
  const extra = { ...safeSetup(), sourcePasswordEncrypted: "PRIVATE_BYTES", diagnostic: { secret: "PRIVATE_BYTES" } };
  const h = harness({ loadSetup: async () => extra, saveSetup: async () => ({ saved: true, setup: extra, sourcePassword: "PRIVATE_BYTES" }) });
  for (const response of [await h.GET(new Request(url), context), await h.POST(post(), context)]) {
    assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /PRIVATE_BYTES|diagnostic|Encrypted|sourcePassword/);
  }
  for (const bad of [{ ...safeSetup(), canStart: true }, { ...safeSetup(), organisation: { id: "foreign", name: "Other" } }]) {
    const blocked = harness({ loadSetup: async () => bad, saveSetup: async () => ({ saved: true, setup: bad }) });
    assert.equal((await blocked.GET(new Request(url), context)).status, 503);
    assert.equal((await blocked.POST(post(), context)).status, 503);
  }
});
test("origin configuration rejects URL credentials and only permits explicit local HTTP in development", () => {
  assert.equal(retailSetupOrigin("https://www.ruvanas.com/"), "https://www.ruvanas.com");
  for (const value of ["http://www.ruvanas.com", "https://a:b@www.ruvanas.com", "https://www.ruvanas.com/path", "https://www.ruvanas.com/?token=x", "https://www.ruvanas.com/#x", undefined, "null", "http://localhost:3000"]) assert.equal(retailSetupOrigin(value), null);
  assert.equal(retailSetupOrigin("http://localhost:3000", { allowLocalHttp: true }), "http://localhost:3000");
  assert.equal(retailSetupOrigin("http://attacker.example.com", { allowLocalHttp: true }), null);
});
