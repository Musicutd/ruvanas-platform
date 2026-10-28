import test from "node:test";
import assert from "node:assert/strict";
import { retailCommercialCommand, retailCommercialQuery, retailCommercialErrorStatus } from "../lib/retail-commercial-request.mjs";
const body = { action: "save", requestId: "31400821-cc19-4c1d-bd7a-c723b8d35415", baseVersionId: null, name: "Week", timezone: "Europe/Malta", rules: [] };
const request = (value = body, headers = {}) => new Request("https://www.ruvanas.com/api/programming/test-retail/commercials", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://www.ruvanas.com", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(value) });
test("commercial commands permit only exact same-origin draft saves", async () => {
  assert.deepEqual(await retailCommercialCommand(request()), body);
  for (const value of [{ ...body, action: "approve" }, { ...body, stationId: "foreign" }, { ...body, startsAudio: true }, [], null])
    await assert.rejects(retailCommercialCommand(request(value)), { code: "RETAIL_COMMERCIAL_BODY_INVALID" });
  await assert.rejects(retailCommercialCommand(request(body, { origin: "https://evil.example" })), { code: "RETAIL_COMMERCIAL_ORIGIN_INVALID" });
  await assert.rejects(retailCommercialCommand(request(body, { "sec-fetch-site": "cross-site" })), { code: "RETAIL_COMMERCIAL_ORIGIN_INVALID" });
});
test("query overrides, oversized streams and unsupported content types are rejected", async () => {
  assert.throws(() => retailCommercialQuery(new Request("https://www.ruvanas.com/api/programming/test-retail/commercials?organisationId=foreign")), { code: "RETAIL_COMMERCIAL_QUERY_INVALID" });
  await assert.rejects(retailCommercialCommand(request({ ...body, name: "x".repeat(50000) })), { code: "RETAIL_COMMERCIAL_BODY_INVALID" });
  await assert.rejects(retailCommercialCommand(request(body, { "content-type": "text/plain" })), { code: "RETAIL_COMMERCIAL_BODY_INVALID" });
  assert.equal(retailCommercialErrorStatus("RETAIL_COMMERCIAL_DRAFT_CHANGED"), 409);
  assert.equal(retailCommercialErrorStatus("RETAIL_COMMERCIAL_ACCESS_DENIED"), 403);
});
