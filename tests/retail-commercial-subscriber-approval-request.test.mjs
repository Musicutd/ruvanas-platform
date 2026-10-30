import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { retailSubscriberCommercialApprovalQuery, retailSubscriberCommercialApprovalCommand } from "../lib/retail-commercial-subscriber-approval-request.mjs";
import * as approval from "../lib/retail-commercial-approval.mjs";
import * as access from "../lib/retail-subscriber-access.mjs";
import * as privateHeaders from "../lib/private-preview-request.mjs";
import * as requests from "../lib/retail-commercial-subscriber-approval-request.mjs";

const URL = "https://www.ruvanas.com/api/programming/test-retail/commercials/approve";
const input = { draftId: "retail-commercial-" + "a".repeat(40), reviewHash: "b".repeat(64), baseApprovalId: null,
  requestId: "31400821-cc19-4c1d-bd7a-c723b8d35415", responsibilityConfirmed: true };
const request = (body = input, extraHeaders = {}) => new Request(URL, { method: "POST", headers: {
  origin: "https://www.ruvanas.com", "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body) });

test("subscriber schedule approval accepts only a bounded same-origin review tuple", async () => {
  assert.deepEqual(await retailSubscriberCommercialApprovalCommand(request()), input);
  for (const field of ["actorUserId", "organisationId", "stationId", "rules", "approvalAuthority", "action"]) {
    await assert.rejects(retailSubscriberCommercialApprovalCommand(request({ ...input, [field]: "forged" })), { code: "RETAIL_COMMERCIAL_REQUEST_INVALID" });
  }
  for (const value of [null, [], "string"]) await assert.rejects(retailSubscriberCommercialApprovalCommand(request(value)), { code: "RETAIL_COMMERCIAL_REQUEST_INVALID" });
  assert.throws(() => retailSubscriberCommercialApprovalQuery(new Request(`${URL}?organisationId=other`)), { code: "RETAIL_COMMERCIAL_REQUEST_INVALID" });
});

test("cross-site or oversized schedule approvals fail before body consumption", async () => {
  for (const headers of [{ origin: "https://other.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }]) {
    const r = request(input, headers);
    await assert.rejects(retailSubscriberCommercialApprovalCommand(r), { code: "RETAIL_COMMERCIAL_ACCESS_DENIED" }); assert.equal(r.bodyUsed, false);
  }
  for (const headers of [{ "content-length": "4097" }, { "content-length": "invalid" }, { "content-type": "text/plain" }]) {
    const r = request(input, headers);
    await assert.rejects(retailSubscriberCommercialApprovalCommand(r), { code: "RETAIL_COMMERCIAL_REQUEST_INVALID" }); assert.equal(r.bodyUsed, false);
  }
  await assert.rejects(retailSubscriberCommercialApprovalCommand(request(input, { "content-length": "1" })), { code: "RETAIL_COMMERCIAL_REQUEST_INVALID" });
});

test("chunked and stalled approval bodies are bounded without changing saved state", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4097)); }, cancel() { cancelled = true; } });
  const r = new Request(URL, { method: "POST", headers: { origin: "https://www.ruvanas.com", "content-type": "application/json" }, body, duplex: "half" });
  await assert.rejects(retailSubscriberCommercialApprovalCommand(r), { code: "RETAIL_COMMERCIAL_REQUEST_INVALID" }); assert.equal(cancelled, true);
  const slow = new Request(URL, { method: "POST", headers: { origin: "https://www.ruvanas.com", "content-type": "application/json" }, body: new ReadableStream({}), duplex: "half" });
  await assert.rejects(retailSubscriberCommercialApprovalCommand(slow, { timeoutMs: 10 }), { code: "RETAIL_COMMERCIAL_REQUEST_INVALID" });
});

test("compiled subscriber approval route rejects unauthenticated requests before reading their body", async () => {
  const require = createRequire(import.meta.url), babel = require("next/dist/compiled/babel/core");
  const file = "app/api/programming/test-retail/commercials/approve/route.js";
  const source = await readFile(new globalThis.URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === "next/server") return { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } };
    if (name === "@/lib/prisma") return { prisma: new Proxy({}, { get() { throw Error("Unauthenticated database read"); } }) };
    if (name === "@/lib/auth") return { getActiveOrganisationContext: async () => null };
    if (name === "@/lib/retail-subscriber-access.mjs") return access;
    if (name === "@/lib/private-preview-request.mjs") return privateHeaders;
    if (name === "@/lib/retail-commercial-approval.mjs") return approval;
    if (name === "@/lib/retail-commercial-subscriber-approval-request.mjs") return requests;
    return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
  } });
  const r = request(), response = await module.exports.POST(r);
  assert.equal(response.status, 403); assert.equal(r.bodyUsed, false);
  assert.equal((await response.json()).code, "RETAIL_COMMERCIAL_ACCESS_DENIED");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await module.exports.GET(new Request(URL))).status, 403);
});
