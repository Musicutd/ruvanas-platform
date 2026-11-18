import test from "node:test";
import assert from "node:assert/strict";
import { createRetailCommercialOwnerHandlers } from "../lib/retail-commercial-owner-http.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "../lib/retail-subscriber-access.mjs";

const origin = "https://www.ruvanas.com", url = `${origin}/api/admin/organisations/${ORG}/retail-commercials`;
const context = { params: Promise.resolve({ organisationId: ORG }) };
const body = { action: "approve", draftId: "draft", reviewHash: "a".repeat(64), baseApprovalId: null, requestId: "request", acknowledged: true };
function fixture() {
  const calls = [], state = { access: { ok: true, user: { id: "owner", role: "SUPER_ADMIN" } } };
  const handlers = createRetailCommercialOwnerHandlers({ getAdmin: async () => state.access, canonicalOrigin: origin,
    review: async options => { calls.push(["review", options]); return { draft: null }; },
    approve: async options => { calls.push(["approve", options]); return { approvedDraftId: options.draftId }; } });
  return { state, calls, handlers };
}
const request = (value = body, headers = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
test("commercial review requires current owner and exact Retail scope before reading", async () => {
  const f = fixture();
  for (const access of [{ ok: false, status: 401 }, { ok: true, user: { id: "subscriber", role: "OWNER" } }]) {
    f.state.access = access; assert.ok([401,403].includes((await f.handlers.GET(new Request(url), context)).status));
  }
  f.state.access = { ok: true, user: { id: "owner", role: "SUPER_ADMIN" } };
  assert.equal((await f.handlers.GET(new Request(url), { params: Promise.resolve({ organisationId: "other" }) })).status, 404);
  assert.equal((await f.handlers.GET(new Request(`${url}?stationId=other`), context)).status, 400);
  assert.equal(f.calls.length, 0);
  const response = await f.handlers.GET(new Request(url), context); assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(f.calls[0], ["review", { actorUserId: "owner", organisationId: ORG }]);
});
test("cross-origin, missing acknowledgement, extra fields and subscriber approvals are rejected", async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(request(body, { origin: "https://evil.invalid" }), context)).status, 403);
  assert.equal((await f.handlers.POST(request(body, { "sec-fetch-site": "cross-site" }), context)).status, 403);
  for (const bad of [{ ...body, acknowledged: false }, { ...body, stationId: "foreign" }, { ...body, baseApprovalId: undefined }, { ...body, action: "start" }])
    assert.equal((await f.handlers.POST(request(bad), context)).status, 400);
  f.state.access = { ok: true, user: { id: "subscriber", role: "OWNER" } };
  assert.equal((await f.handlers.POST(request(), context)).status, 403); assert.equal(f.calls.length, 0);
});
test("confirmed command carries server owner and organisation only, and strips browser acknowledgement", async () => {
  const f = fixture(), response = await f.handlers.POST(request(), context);
  assert.equal(response.status, 200); assert.equal((await response.json()).accepted, true);
  assert.deepEqual(f.calls[0], ["approve", { actorUserId: "owner", organisationId: ORG, draftId: body.draftId,
    reviewHash: body.reviewHash, baseApprovalId: null, requestId: body.requestId }]);
});
test("internal errors never leak private diagnostic details to the owner response", async () => {
  const handlers = createRetailCommercialOwnerHandlers({ getAdmin: async () => ({ ok:true,user:{id:"owner",role:"SUPER_ADMIN"} }), canonicalOrigin:origin,
    review: async () => { throw new Error("postgres://private-password"); } });
  const response = await handlers.GET(new Request(url), context);
  assert.equal(response.status, 409); assert.doesNotMatch(await response.text(), /postgres|password/);
});
