import test from "node:test";
import assert from "node:assert/strict";
import { RETAIL_PILOT_ACCESS as P, RetailPilotAccessError } from "../lib/retail-stream-pilot-access.mjs";
import { createRetailPilotAccessHandlers, safeRetailPilotAccessView } from "../lib/retail-stream-pilot-access-http.mjs";
const ORIGIN = "https://www.ruvanas.com", path = `${ORIGIN}/api/admin/organisations/${P.organisationId}/retail-access`;
const context = { params: Promise.resolve({ organisationId: P.organisationId }) };
const view = approved => ({ eligible: true, approved, canApprove: !approved, canRevoke: approved, territory: "MT", catalogueLevel: "FOCUSED",
  sourceScopes: [...P.sourceScopes], eligibleTrackCount: 24, expiresAt: "2026-11-23T12:00:00.000Z", blocker: null });
function fixture(overrides = {}) {
  const calls = [];
  const handlers = createRetailPilotAccessHandlers({ getAdmin: async () => ({ ok: true, user: { id: "owner-id", role: "SUPER_ADMIN" } }),
    canonicalOrigin: ORIGIN, proposal: async scope => { calls.push(["read", scope]); return view(false); },
    change: async input => { calls.push(["change", input]); return { accepted: true, action: input.action, access: view(input.action === "approve") }; },
    ...overrides });
  return { calls, handlers };
}
const post = (body = { action: "approve", confirmed: true }, headers = {}) => new Request(path, { method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
test("GET is read-only, owner-scoped, no-store and projects no internal data", async () => {
  const f = fixture({ proposal: async () => ({ ...view(false), secret: "private-value", sourcePassword: "private-value" }) });
  const response = await f.handlers.GET(new Request(path), context); assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/); assert.deepEqual(await response.json(), { access: view(false) });
  assert.equal(f.calls.length, 0);
});
test("anonymous and non-owner sessions cannot inspect or approve pilot access", async () => {
  for (const access of [{ ok: false, status: 401 }, { ok: true, user: { id: "tester", role: "OWNER" } }, { ok: true, user: { id: "admin", role: "ADMIN" } }]) {
    const f = fixture({ getAdmin: async () => access });
    assert.ok([401, 403].includes((await f.handlers.GET(new Request(path), context)).status));
    assert.ok([401, 403].includes((await f.handlers.POST(post(), context)).status)); assert.equal(f.calls.length, 0);
  }
});
test("exact Retail pilot only; cross-origin and future broad fields are rejected", async () => {
  const f = fixture(), foreign = { params: Promise.resolve({ organisationId: "other-org" }) };
  assert.equal((await f.handlers.GET(new Request(path), foreign)).status, 404);
  assert.equal((await f.handlers.POST(post(), foreign)).status, 404);
  for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }])
    assert.equal((await f.handlers.POST(post(undefined, headers), context)).status, 403);
  for (const field of ["organisationId", "stationId", "catalogueLevel", "plan", "outputEnabled", "sourceScopes", "monthlyBudgetUsd", "workerId", "expiresAt"])
    assert.equal((await f.handlers.POST(post({ action: "approve", confirmed: true, [field]: "anything" }), context)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("approval and revocation require exact action and explicit confirmation; never start", async () => {
  for (const body of [{ action: "start", confirmed: true }, { action: "approve", confirmed: false }, { action: "approve" }, { action: "revoke", confirmed: "true" }]) {
    const f = fixture(); assert.equal((await f.handlers.POST(post(body), context)).status, 400); assert.equal(f.calls.length, 0);
  }
  for (const action of ["approve", "revoke"]) {
    const f = fixture(), response = await f.handlers.POST(post({ action, confirmed: true }), context);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: true, action, access: view(action === "approve") });
    assert.deepEqual(f.calls, [["change", { actorUserId: "owner-id", organisationId: P.organisationId, action, confirmed: true }]]);
  }
});
test("service failures, wrong acknowledgement and malformed views do not imply access saved", async () => {
  const blocked = fixture({ change: async () => { throw new RetailPilotAccessError("STOP_REQUIRED"); } });
  const blockedResponse = await blocked.handlers.POST(post(), context); assert.equal(blockedResponse.status, 409);
  assert.equal((await blockedResponse.json()).code, "RETAIL_PILOT_ACCESS_STOP_REQUIRED");
  for (const result of [{ accepted: false, action: "approve", access: view(true) }, { accepted: true, action: "start", access: view(true) },
    { accepted: true, action: "approve", access: { ...view(true), catalogueLevel: "PREMIUM" } }]) {
    const f = fixture({ change: async () => result }); assert.equal((await f.handlers.POST(post(), context)).status, 503);
  }
  const failed = fixture({ proposal: async () => { throw new Error("secret database details"); } });
  const response = await failed.handlers.GET(new Request(path), context); assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret database details/);
});
test("public projection rejects contradictions but permits revoking a now-invalid previous grant", () => {
  const expired = { ...view(false), eligible: false, canApprove: false, canRevoke: true, expiresAt: null, blocker: "RETAIL_PILOT_ACCESS_TESTER_UNAVAILABLE" };
  assert.deepEqual(safeRetailPilotAccessView(expired), expired);
  for (const changes of [{ canApprove: true }, { expiresAt: null }, { eligible: false }, { eligibleTrackCount: -1 }, { sourceScopes: ["SUBSCRIBER_LIBRARY"] }])
    assert.throws(() => safeRetailPilotAccessView({ ...view(true), ...changes }));
});
