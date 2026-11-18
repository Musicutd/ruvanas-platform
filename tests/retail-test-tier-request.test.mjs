import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readRetailTestTierCommand, validateRetailTestTierQuery, retailTestTierPublicError } from "../lib/retail-test-tier-service.mjs";

const url = "https://www.ruvanas.com/api/account/test-tier";
const request = (body, { origin = "https://www.ruvanas.com", type = "application/json", query = "", extra = {} } = {}) => new Request(`${url}${query}`, {
  method: "POST", headers: { origin, "content-type": type, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body)
});
const body = { planCode: "RETAIL_ENTERPRISE", confirmed: true, expectedRevision: null };
test("tier command accepts only bounded explicit same-origin selection", async () => {
  assert.deepEqual(await readRetailTestTierCommand(request(body)), body);
  for (const options of [{ origin: "https://evil.example" }, { extra: { "sec-fetch-site": "cross-site" } }]) {
    await assert.rejects(readRetailTestTierCommand(request(body, options)), e => e.code === "RETAIL_TEST_TIER_ORIGIN_INVALID");
  }
  for (const options of [{ query: "?organisationId=other" }, { type: "text/plain" }, { extra: { "content-length": "4097" } }]) {
    await assert.rejects(readRetailTestTierCommand(request(body, options)), e => e.code === "RETAIL_TEST_TIER_REQUEST_INVALID");
  }
  for (const invalid of [{ ...body, confirmed: "true" }, { ...body, expectedRevision: "bad" }, { ...body, userId: "other" },
    { ...body, billingContract: {} }, { ...body, subscriberTestingEnabled: true }, [], null, "{" , " ".repeat(4097)]) {
    await assert.rejects(readRetailTestTierCommand(request(invalid)), e => e.code === "RETAIL_TEST_TIER_REQUEST_INVALID");
  }
  assert.throws(() => validateRetailTestTierQuery(new Request(`${url}?planCode=RETAIL_START`)), e => e.code === "RETAIL_TEST_TIER_REQUEST_INVALID");
  assert.doesNotThrow(() => validateRetailTestTierQuery(new Request(url)));
});

test("route dispatches authenticated context, retains no-store headers and hides unknown errors", async () => {
  const source = await readFile(new URL("../app/api/account/test-tier/route.js", import.meta.url), "utf8");
  const executable = source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const calls = [], context = { private: "trusted context" };
  const dependencies = { NextResponse: { json: (value, options) => Response.json(value, options) }, prisma: {},
    getActiveOrganisationContext: async () => context, RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE: {},
    headers: { "cache-control": "private, no-store" }, readRetailTestTierCommand, validateRetailTestTierQuery, retailTestTierPublicError,
    getRetailTestTiers: async (_db, options) => { calls.push(options); return { ok: true, freeTest: true }; },
    selectRetailTestTier: async (_db, options) => { calls.push(options); return { ok: true, freeTest: true }; } };
  const route = new Function(...Object.keys(dependencies), `${executable}\nreturn {GET,POST};`)(...Object.values(dependencies));
  const get = await route.GET(new Request(url)); assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "private, no-store"); assert.equal(calls[0].context, context);
  const post = await route.POST(request(body)); assert.equal(post.status, 200);
  assert.deepEqual(calls[1], { context, input: body });
  const denied = await route.POST(request({ ...body, organisationId: "foreign" }));
  assert.equal(denied.status, 400); assert.equal(calls.length, 2);
  assert.deepEqual(retailTestTierPublicError(new Error("database credentials or source details")), {
    status: 503, body: { error: "The Retail test tier could not be saved or verified. Refresh before trying again.", code: "RETAIL_TEST_TIER_REQUEST_FAILED" }
  });
});
