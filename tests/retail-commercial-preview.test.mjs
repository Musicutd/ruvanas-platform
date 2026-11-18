import test from "node:test";
import assert from "node:assert/strict";
import { retailPreviewRequest, retailPreviewRange, retailPreviewHeaders, boundedRetailPreviewBody } from "../lib/retail-commercial-preview.mjs";

const url = "https://www.ruvanas.com/api/programming/test-retail/commercial-audio/preview?versionId=our-recording";
test("private preview validates only one recording identifier and rejects cross-site access", () => {
  assert.equal(retailPreviewRequest(new Request(url, { headers: { "sec-fetch-site": "same-origin" } })), "our-recording");
  assert.equal(retailPreviewRequest(new Request(url, { method: "HEAD", headers: { origin: "https://www.ruvanas.com" } })), "our-recording");
  for (const bad of [url + "&versionId=another", url + "&organisationId=other", url.replace("our-recording", "%2Fprivate%2Ffile"), url.split("?")[0]])
    assert.throws(() => retailPreviewRequest(new Request(bad)), { code: "RETAIL_RECORDING_REVIEW_INVALID" });
  assert.throws(() => retailPreviewRequest(new Request(url, { method: "POST" })), { code: "RETAIL_RECORDING_REVIEW_INVALID" });
  for (const headers of [{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }])
    assert.throws(() => retailPreviewRequest(new Request(url, { headers })), { code: "RETAIL_RECORDING_REVIEW_ACCESS_DENIED" });
});

test("preview ranges support bounded seek and suffix requests while rejecting malformed or oversized media", () => {
  assert.equal(retailPreviewRange(null, 20), null);
  assert.deepEqual(retailPreviewRange("bytes=0-9", 20), { start: 0, end: 9 });
  assert.deepEqual(retailPreviewRange("bytes=10-", 20), { start: 10, end: 19 });
  assert.deepEqual(retailPreviewRange("bytes=-5", 20), { start: 15, end: 19 });
  assert.deepEqual(retailPreviewRange("bytes=-100", 20), { start: 0, end: 19 });
  assert.deepEqual(retailPreviewRange("bytes=3-99", 20), { start: 3, end: 19 });
  for (const header of ["bytes=", "bytes=-", "bytes=-0", "bytes=8-2", "bytes=20-", "bytes=0-1,4-8", "bytes=1.5-4", "items=0-5", "bytes=-99999999999999999"])
    assert.equal(retailPreviewRange(header, 20), "invalid");
  for (const total of [0, -1, NaN, Infinity, 4.5, 20 * 1024 * 1024 + 1])
    assert.throws(() => retailPreviewRange(null, total), { code: "RETAIL_RECORDING_REVIEW_VALIDATION_REQUIRED" });
});

test("preview response headers are private and never expose a storage URL or cross-origin permission", () => {
  const headers = retailPreviewHeaders({ mimeType: "audio/mpeg", sizeBytes: 1234 }, { start: 5, end: 24 });
  assert.equal(headers.get("cache-control"), "private, no-store, max-age=0"); assert.equal(headers.get("vary"), "Cookie");
  assert.equal(headers.get("cross-origin-resource-policy"), "same-origin"); assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("content-type"), "audio/mpeg"); assert.equal(headers.get("content-length"), "20");
  assert.equal(headers.get("content-range"), "bytes 5-24/1234"); assert.equal(headers.get("content-disposition"), "inline");
  assert.equal(headers.has("access-control-allow-origin"), false); assert.equal(headers.has("location"), false);
});

function source(chunks, { open = false } = {}) {
  const state = { cancelled: false, reason: null };
  const body = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk)); if (!open) controller.close(); },
    cancel(reason) { state.cancelled = true; state.reason = reason; } });
  return { body, state };
}
test("bounded preview delivers exact synthetic bytes and cancels overflow before exposing excess bytes", async () => {
  const good = source([[1, 2], [3, 4]]), result = await new Response(boundedRetailPreviewBody({ transformToWebStream: () => good.body }, 4)).arrayBuffer();
  assert.deepEqual([...new Uint8Array(result)], [1, 2, 3, 4]);
  const overflow = source([[1, 2], [3, 4, 5]], { open: true });
  await assert.rejects(new Response(boundedRetailPreviewBody(overflow.body, 4)).arrayBuffer(), /Invalid preview length/);
  assert.equal(overflow.state.cancelled, true);
  const short = source([[1, 2]]);
  await assert.rejects(new Response(boundedRetailPreviewBody(short.body, 4)).arrayBuffer(), /Incomplete preview/);
});

test("preview cancels provider bodies on client cancellation or deadline and sanitizes source errors", async () => {
  const stopped = source([], { open: true }), stream = boundedRetailPreviewBody(stopped.body, 4);
  await stream.cancel("listener closed"); assert.equal(stopped.state.cancelled, true); assert.equal(stopped.state.reason, "listener closed");
  const slow = source([], { open: true });
  await assert.rejects(new Response(boundedRetailPreviewBody(slow.body, 4, { timeoutMs: 5 })).arrayBuffer(), /Preview timed out/);
  assert.equal(slow.state.cancelled, true);
  const error = new ReadableStream({ pull() { throw Error("private provider diagnostics"); } });
  await assert.rejects(new Response(boundedRetailPreviewBody(error, 4)).arrayBuffer(), /Preview unavailable/);
  assert.throws(() => boundedRetailPreviewBody({}, 4), { code: "RETAIL_RECORDING_REVIEW_VALIDATION_REQUIRED" });
  for (const invalid of [0, -1, NaN, Infinity, 1.5, 20 * 1024 * 1024 + 1])
    assert.throws(() => boundedRetailPreviewBody(source([]).body, invalid), { code: "RETAIL_RECORDING_REVIEW_VALIDATION_REQUIRED" });
});
