import test from "node:test";
import assert from "node:assert/strict";
import { RETAIL_COMMERCIAL_UPLOAD_LIMITS as LIMITS, readRetailCommercialUpload, retailCommercialUploadRequestBoundary,
  withRetailCommercialUploadAdmission, retailCommercialUploadError } from "../lib/retail-commercial-upload-request.mjs";

const URL = "https://www.ruvanas.com/api/programming/test-retail/commercial-audio";
function request(extra = {}) {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("ID3abcdefghijklm")], { type: "audio/mpeg" }), "announcement.mp3");
  form.append("name", "Opening hours"); form.append("mediaType", "ANNOUNCEMENT");
  form.append("requestId", "31400821-cc19-4c1d-bd7a-c723b8d35415"); form.append("rightsConfirmed", "true");
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return new Request(URL, { method: "POST", headers: { origin: "https://www.ruvanas.com" }, body: form });
}
test("multipart commercial input is bounded and excludes tenant/duration/approval parameters", async () => {
  const value = await readRetailCommercialUpload(request());
  assert.equal(value.fileName, "announcement.mp3"); assert.equal(value.buffer.toString(), "ID3abcdefghijklm");
  for (const field of ["organisationId", "durationSeconds", "approved", "storageKey", "name"])
    await assert.rejects(readRetailCommercialUpload(request({ [field]: "foreign" })), { code: "RETAIL_COMMERCIAL_UPLOAD_REQUEST_INVALID" });
});
test("same origin and no-query boundaries reject before body is read", async () => {
  for (const origin of ["https://evil.test", "null", ""]) {
    const r = request(); r.headers.set("origin", origin);
    await assert.rejects(readRetailCommercialUpload(r), { code: "RETAIL_COMMERCIAL_UPLOAD_ACCESS_DENIED" }); assert.equal(r.bodyUsed, false);
  }
  assert.throws(() => retailCommercialUploadRequestBoundary(new Request(`${URL}?organisationId=foreign`)), { code: "RETAIL_COMMERCIAL_UPLOAD_REQUEST_INVALID" });
  const crossSite = request(); crossSite.headers.set("sec-fetch-site", "cross-site");
  await assert.rejects(readRetailCommercialUpload(crossSite), { code: "RETAIL_COMMERCIAL_UPLOAD_ACCESS_DENIED" });
});
test("declared, actual chunked and file-size limits are enforced", async () => {
  const r = request(); r.headers.set("content-length", String(LIMITS.maxRequestBytes + 1));
  await assert.rejects(readRetailCommercialUpload(r), { code: "RETAIL_COMMERCIAL_UPLOAD_FILE_TOO_LARGE" }); assert.equal(r.bodyUsed, false);
  const form = new FormData(); form.append("file", new Blob([Buffer.alloc(LIMITS.maxFileBytes + 1)]), "large.mp3");
  await assert.rejects(readRetailCommercialUpload(new Request(URL, { method: "POST", headers: { origin: "https://www.ruvanas.com" }, body: form })), { code: "RETAIL_COMMERCIAL_UPLOAD_FILE_TOO_LARGE" });
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(LIMITS.maxRequestBytes + 1)); }, cancel() { cancelled = true; } });
  const huge = new Request(URL, { method: "POST", headers: { origin: "https://www.ruvanas.com", "content-type": "multipart/form-data; boundary=test" }, body, duplex: "half" });
  await assert.rejects(readRetailCommercialUpload(huge), { code: "RETAIL_COMMERCIAL_UPLOAD_FILE_TOO_LARGE" }); assert.equal(cancelled, true);
});
test("slow request times out and upload admission slots are released on failure", async () => {
  const body = new ReadableStream({});
  const r = new Request(URL, { method: "POST", headers: { origin: "https://www.ruvanas.com", "content-type": "multipart/form-data; boundary=test" }, body, duplex: "half" });
  await assert.rejects(readRetailCommercialUpload(r, { timeoutMs: 10 }));
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const a = withRetailCommercialUploadAdmission(() => gate), b = withRetailCommercialUploadAdmission(() => gate);
  await assert.rejects(withRetailCommercialUploadAdmission(async () => {}), { code: "RETAIL_COMMERCIAL_UPLOAD_BUSY" });
  finish(); await Promise.all([a, b]);
  await assert.rejects(withRetailCommercialUploadAdmission(async () => { throw Error("failure"); }));
  await withRetailCommercialUploadAdmission(async () => {});
});
test("public error mapping does not expose provider or database details", () => {
  const value = retailCommercialUploadError(new Error("postgres://credential@private"));
  assert.equal(value.status, 503); assert.equal(JSON.stringify(value).includes("credential"), false);
  assert.equal(retailCommercialUploadError({ code: "RETAIL_COMMERCIAL_UPLOAD_STORAGE_LIMIT" }).status, 413);
});
