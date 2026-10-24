import test from "node:test";
import assert from "node:assert/strict";
import { createRetailPlayoutHandlers } from "../lib/retail-stream-playout-http.mjs";

const origin = "https://app.example.com", org = "org-retail", url = `${origin}/api/admin/organisations/${org}/retail-playout`;
const context = { params: Promise.resolve({ organisationId: org }) };
const safe = () => ({ organisation: { id: org, name: "Retail pilot" }, station: { id: "retail-station", status: "DRAFT" }, connectionSaved: true,
  prepared: null, availableGenres: [{ code: "pop", name: "Pop" }], eligibleTrackCount: 0, canPrepare: true, canStart: false, enabled: false,
  blockers: ["RETAIL_PLAYOUT_CAPACITY_REQUIRED"], capacity: { assigned: false, monthlyBudgetUsd: null, estimatedMonthlyUsd: null, bitrateKbps: 128 }, observation: null });
function harness(overrides = {}) {
  const calls = [];
  const handlers = createRetailPlayoutHandlers({
    getAdmin: async () => ({ ok: true, user: { id: "admin-1", role: "SUPER_ADMIN" } }), canonicalOrigin: origin,
    loadReadiness: async args => { calls.push(["read", args]); return safe(); },
    prepare: async args => { calls.push(["prepare", args]); return { prepared: true, stationId: "retail-station" }; },
    start: async args => { calls.push(["start", args]); return { enabled: true, grantId: "PRIVATE_GRANT" }; },
    stop: async args => { calls.push(["stop", args]); return { enabled: false, status: "STOP_REQUESTED" }; },
    ...overrides
  });
  return { calls, ...handlers };
}
function post(body = { action: "prepare", territory: "MT", genreCodes: [] }, headers = {}, raw = false) {
  return new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: raw ? body : JSON.stringify(body) });
}

test("GET performs only an owner-scoped read and returns no secrets or grant IDs", async () => {
  const h = harness({ loadReadiness: async args => { h.calls.push(["read", args]); return { ...safe(), grant: { id: "PRIVATE_GRANT" }, sourcePassword: "PRIVATE_SECRET" }; } });
  const response = await h.GET(new Request(url), context);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { readiness: safe() });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(h.calls, [["read", { actorUserId: "admin-1", organisationId: org }]]);
});
test("all operations require a current Super Admin before reading the organisation", async () => {
  for (const access of [{ ok: false, status: 401 }, { ok: false, status: 403 }, { ok: true, user: { id: "owner", role: "OWNER" } }, { ok: true, user: { id: "support", role: "SUPPORT" } }]) {
    const h = harness({ getAdmin: async () => access });
    for (const response of [await h.GET(new Request(url), context), await h.POST(post(), context)]) assert.ok([401, 403].includes(response.status));
    assert.equal(h.calls.length, 0);
  }
});
test("mutations require the exact configured origin and reject cross-site requests", async () => {
  for (const headers of [{ origin: "" }, { origin: "null" }, { origin: "https://other.example.com" }, { "sec-fetch-site": "cross-site" }]) {
    const h = harness(); assert.equal((await h.POST(post(undefined, headers), context)).status, 403); assert.equal(h.calls.length, 0);
  }
  assert.equal((await harness({ canonicalOrigin: null }).POST(post(), context)).status, 403);
});
test("prepare is a separate non-starting action and response contains refreshed public readiness only", async () => {
  const h = harness(), response = await h.POST(post(), context);
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [["prepare", { actorUserId: "admin-1", organisationId: org, territory: "MT", genreCodes: [] }], ["read", { actorUserId: "admin-1", organisationId: org }]]);
  assert.deepEqual(await response.json(), { action: "prepare", accepted: true, readiness: safe() });
});
test("start requires explicit exposure acknowledgement and numeric monthly approval", async () => {
  for (const body of [{ action: "start" }, { action: "start", monthlyBudgetUsd: 15, publicExposureAccepted: false },
    { action: "start", monthlyBudgetUsd: "15", publicExposureAccepted: true }, { action: "start", monthlyBudgetUsd: -1, publicExposureAccepted: true }]) {
    const h = harness(); assert.equal((await h.POST(post(body), context)).status, 400); assert.equal(h.calls.length, 0);
  }
  const h = harness(), response = await h.POST(post({ action: "start", monthlyBudgetUsd: 15, publicExposureAccepted: true }), context);
  assert.equal(response.status, 200); assert.deepEqual(h.calls[0], ["start", { actorUserId: "admin-1", organisationId: org, monthlyBudgetUsd: 15, publicExposureAccepted: true }]);
  assert.doesNotMatch(await response.text(), /PRIVATE_GRANT/);
});
test("clients cannot supply another tenant, station, worker, secret, plan or capacity assignment", async () => {
  for (const key of ["organisationId", "stationId", "workerId", "env", "capacity", "slot", "plan", "sourcePassword", "sourcePasswordEncrypted", "outputEnabled", "__proto__"]) {
    const h = harness(); assert.equal((await h.POST(post({ action: "stop", [key]: "foreign" }), context)).status, 400, key); assert.equal(h.calls.length, 0);
  }
  for (const body of [{ action: "stop", territory: "MT" }, { action: "prepare", territory: "MT", genreCodes: [], monthlyBudgetUsd: 15 }, { action: "start", territory: "MT", monthlyBudgetUsd: 15, publicExposureAccepted: true }, { action: "constructor" }]) {
    const h = harness(); assert.equal((await h.POST(post(body), context)).status, 400); assert.equal(h.calls.length, 0);
  }
});
test("stop needs no music or cost approval and cannot return control secrets", async () => {
  const h = harness(), response = await h.POST(post({ action: "stop" }), context);
  assert.equal(response.status, 200); assert.deepEqual(h.calls[0], ["stop", { actorUserId: "admin-1", organisationId: org }]);
});
test("stop acknowledgement survives unavailable readiness without claiming disconnection", async () => {
  const h = harness({ loadReadiness: async () => { throw new Error("PRIVATE_SOURCE_ERROR"); } });
  const response = await h.POST(post({ action: "stop" }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { action: "stop", accepted: true, status: "STOP_REQUESTED", readiness: null });
});
test("malformed, oversized and non-JSON requests never execute mutations", async () => {
  for (const req of [post("{", {}, true), post(null), post([]), post({}, { "content-type": "text/plain" }), post({}, { "content-length": "4097" }),
    post({ action: "prepare", territory: "MT", genreCodes: ["x".repeat(4097)] }), post({ action: "prepare", territory: "MT", genreCodes: ["pop", "pop"] })]) {
    const h = harness(); assert.equal((await h.POST(req, context)).status, 400); assert.equal(h.calls.length, 0);
  }
});
test("foreign organisation responses and malformed readiness fail closed after a write", async () => {
  for (const value of [{ ...safe(), organisation: { id: "other", name: "Other" } }, { ...safe(), canStart: true }]) {
    const h = harness({ loadReadiness: async () => value });
    assert.equal((await h.GET(new Request(url), context)).status, 503);
    assert.equal((await h.POST(post(), context)).status, 503);
  }
});
test("unknown errors are redacted; known service refusal is mapped without raw diagnostics", async () => {
  const h = harness({ start: async () => { throw new Error("DATABASE_PRIVATE_SECRET"); } });
  const response = await h.POST(post({ action: "start", monthlyBudgetUsd: 15, publicExposureAccepted: true }), context);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /DATABASE_PRIVATE_SECRET/);
  const blocked = harness({ prepare: async () => { throw Object.assign(new Error("PRIVATE_SECRET"), { code: "RETAIL_PLAYOUT_OUTPUT_NOT_PERMITTED", status: 409 }); }, publicFailure: error => error });
  const denied = await blocked.POST(post(), context);
  assert.equal(denied.status, 409); const body = await denied.text(); assert.match(body, /current plan does not permit/); assert.doesNotMatch(body, /PRIVATE_SECRET/);
});
