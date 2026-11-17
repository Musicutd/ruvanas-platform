import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  catalogueBulkFileSizeError, catalogueRequestSizePolicy, MAX_CATALOGUE_ARCHIVE_SIZE_BYTES,
  MAX_CATALOGUE_MANIFEST_SIZE_BYTES, MAX_CATALOGUE_BULK_REQUEST_BYTES
} from "../lib/catalogue-request-limits.mjs";
import {
  acquireCatalogueBulkRequest, CatalogueBulkRequestError, readCatalogueBulkFormData
} from "../lib/catalogue-bulk-request.mjs";
import { CatalogueBulkImportError, MAX_CATALOGUE_BATCH_TRACKS, MAX_CATALOGUE_UNCOMPRESSED_BYTES,
  MAX_CATALOGUE_ARCHIVE_SIZE_BYTES as parserArchiveLimit, MAX_CATALOGUE_MANIFEST_SIZE_BYTES as parserManifestLimit
} from "../lib/catalogue-bulk-import.mjs";
import { MAX_CATALOGUE_FILE_SIZE_BYTES } from "../lib/catalogue-upload.mjs";

const MIB = 1024 * 1024;
const routeSource = await readFile(new URL("../app/api/admin/catalogue/bulk-upload/route.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../app/admin/catalogue/CatalogueBulkUploadForm.js", import.meta.url), "utf8");

test("request size allowances apply only to the two exact upload paths", () => {
  for (const [path, megabytes] of [["/api/admin/catalogue/bulk-upload", 165], ["/api/admin/catalogue/upload", 55],
    ["/api/admin/catalogue/bulk-upload/", 10], ["/api/admin/catalogue/bulk-upload/other", 10],
    ["/api/admin/catalogue/upload-other", 10], ["/api/admin/catalogue/metadata-preview", 10], ["/api/auth/login", 10], ["/", 10]]) {
    const policy = catalogueRequestSizePolicy(path);
    assert.equal(policy.maxBytes, megabytes * MIB, path);
  }
  assert.equal(MAX_CATALOGUE_BULK_REQUEST_BYTES, 165 * MIB);
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "post"]) {
    assert.equal(catalogueRequestSizePolicy("/api/admin/catalogue/bulk-upload", method).maxBytes, 10 * MIB, method);
  }
  assert.equal(catalogueRequestSizePolicy("/api/admin/catalogue/bulk-upload", "POST").maxBytes, 165 * MIB);
});

test("ZIP, manifest, audio, count and extraction limits remain unchanged", () => {
  assert.equal(parserArchiveLimit, MAX_CATALOGUE_ARCHIVE_SIZE_BYTES);
  assert.equal(parserManifestLimit, MAX_CATALOGUE_MANIFEST_SIZE_BYTES);
  assert.equal(parserArchiveLimit, 150 * MIB);
  assert.equal(parserManifestLimit, 10 * MIB);
  assert.equal(MAX_CATALOGUE_FILE_SIZE_BYTES, 50 * MIB);
  assert.equal(MAX_CATALOGUE_BATCH_TRACKS, 100);
  assert.equal(MAX_CATALOGUE_UNCOMPRESSED_BYTES, 200 * MIB);
  assert.equal(catalogueBulkFileSizeError({ size: parserArchiveLimit }, { size: parserManifestLimit }), null);
  assert.match(catalogueBulkFileSizeError({ size: parserArchiveLimit + 1 }, { size: 1 }), /ZIP.*150 MB/);
  assert.match(catalogueBulkFileSizeError({ size: 1 }, { size: parserManifestLimit + 1 }), /spreadsheet.*10 MB/);
});

async function multipartFixture(archiveBytes = "synthetic ZIP") {
  const form = new FormData();
  form.set("archive", new File([archiveBytes], "batch.zip"));
  form.set("manifest", new File(["Artist,Title\nArtist,Title\n"], "batch.csv"));
  form.set("mode", "validate");
  const encoded = new Request("https://example.invalid/", { method: "POST", body: form });
  return { bytes: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get("content-type") };
}

function streamedRequest(fixture, declared, chunkSize = 17) {
  let offset = 0;
  const state = { canceled: false, readBytes: 0 };
  const headers = new Headers({ "content-type": fixture.contentType });
  if (declared !== undefined) headers.set("content-length", String(declared));
  const body = new ReadableStream({
    pull(controller) {
      if (offset === fixture.bytes.length) { controller.close(); return; }
      const chunk = fixture.bytes.subarray(offset, Math.min(offset + chunkSize, fixture.bytes.length));
      offset += chunk.byteLength; state.readBytes += chunk.byteLength; controller.enqueue(chunk);
    },
    cancel() { state.canceled = true; }
  }, { highWaterMark: 0 });
  return { request: { headers, body }, state };
}

test("counted multipart parsing accepts an exact declared total boundary", async () => {
  const fixture = await multipartFixture();
  const { request } = streamedRequest(fixture, fixture.bytes.length);
  const form = await readCatalogueBulkFormData(request, { maxBytes: fixture.bytes.length });
  assert.equal(form.get("archive").name, "batch.zip");
  assert.equal(await form.get("manifest").text(), "Artist,Title\nArtist,Title\n");
  assert.equal(form.get("mode"), "validate");
});

test("a synthetic 11 MiB multipart file passes the production bulk cap above the old 10 MiB default", async () => {
  // Memory-only non-audio fixture; this test does not send any request.
  const fixture = await multipartFixture(new Uint8Array(11 * MIB));
  const { request } = streamedRequest(fixture, fixture.bytes.length, 64 * 1024);
  const parsed = await readCatalogueBulkFormData(request);
  assert.equal(parsed.get("archive").size, 11 * MIB);
  assert.equal(parsed.get("manifest").name, "batch.csv");
});

for (const declared of ["1", "70"]) {
  test(`counted multipart parsing rejects actual overflow with lying ${declared} Content-Length`, async () => {
    const fixture = await multipartFixture();
    const { request, state } = streamedRequest(fixture, declared);
    await assert.rejects(readCatalogueBulkFormData(request, { maxBytes: 70 }), (error) => error instanceof CatalogueBulkRequestError && error.status === 413);
    assert.equal(state.canceled, true);
    assert.ok(state.readBytes < fixture.bytes.length, "stop consuming at the limit, not after buffering the whole request");
  });
}

test("missing or invalid Content-Length is rejected before reading a cloned body", async () => {
  const fixture = await multipartFixture();
  for (const [declared, status] of [[undefined, 411], ["", 400], ["not-a-length", 400], ["0", 400], ["-1", 400], ["1.5", 400], ["9007199254740992", 400]]) {
    const { request, state } = streamedRequest(fixture, declared);
    await assert.rejects(readCatalogueBulkFormData(request), { status });
    assert.equal(state.readBytes, 0); assert.equal(state.canceled, true);
  }
});

test("an advertised oversized request is rejected without reading its body", async () => {
  const fixture = await multipartFixture();
  const { request, state } = streamedRequest(fixture, fixture.bytes.length);
  await assert.rejects(readCatalogueBulkFormData(request, { maxBytes: 70 }), { status: 413 });
  assert.equal(state.readBytes, 0);
  assert.equal(state.canceled, true);
});

test("framework clone truncation above the real cap cannot hide actual overflow", async () => {
  const fixture = await multipartFixture();
  // Scale the real 165/166 MiB relationship down; the upstream clone silently
  // ends at its ceiling, while the application must stop at its smaller cap.
  const actualLimit = 70;
  const cloneLimit = 71;
  fixture.bytes = fixture.bytes.subarray(0, cloneLimit);
  const { request } = streamedRequest(fixture, actualLimit, cloneLimit);
  await assert.rejects(readCatalogueBulkFormData(request, { maxBytes: actualLimit }), { status: 413 });
});

test("valid multipart prefixes cannot hide missing epilogue bytes or lying declared lengths", async () => {
  const fixture = await multipartFixture();
  // Next can drop an entire large crossing chunk, leaving a parseable complete
  // form but losing its trailing epilogue. The consumed-length check must fail.
  const truncated = streamedRequest(fixture, fixture.bytes.length + 5);
  await assert.rejects(readCatalogueBulkFormData(truncated.request, { maxBytes: fixture.bytes.length + 10 }),
    (error) => error.status === 400 && /did not match/.test(error.message));
  const lying = streamedRequest(fixture, 1);
  await assert.rejects(readCatalogueBulkFormData(lying.request, { maxBytes: fixture.bytes.length + 10 }),
    (error) => error.status === 400 && /did not match/.test(error.message));
});

test("malformed multipart and interrupted streams fail safely", async () => {
  await assert.rejects(readCatalogueBulkFormData({ headers: new Headers({ "content-type": "application/json", "content-length": "1" }), body: null }), { status: 400 });
  const broken = { headers: new Headers({ "content-type": "multipart/form-data; boundary=test", "content-length": "1" }),
    body: new ReadableStream({ pull(controller) { controller.error(new Error("synthetic transport failure")); } }) };
  await assert.rejects(readCatalogueBulkFormData(broken), (error) => error.status === 400 && !error.message.includes("transport failure"));
});

function stalledRequest(signal) {
  const state = { canceled: false };
  return { state, request: { headers: new Headers({ "content-type": "multipart/form-data; boundary=test", "content-length": "10" }), signal,
    body: new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { state.canceled = true; } }, { highWaterMark: 0 }) } };
}

test("a never-resolving multipart reader hits its bounded deadline and cancels without waiting", async () => {
  const { request, state } = stalledRequest();
  await assert.rejects(readCatalogueBulkFormData(request, { timeoutMs: 10 }),
    (error) => error.status === 408 && /took too long/.test(error.message));
  assert.equal(state.canceled, true);
});

test("request abort interrupts a stalled multipart reader and cancels its source", async () => {
  const controller = new AbortController();
  const { request, state } = stalledRequest(controller.signal);
  const reading = readCatalogueBulkFormData(request, { timeoutMs: 1000 });
  controller.abort();
  await assert.rejects(reading, (error) => error.status === 408 && /interrupted/.test(error.message));
  assert.equal(state.canceled, true);
});

test("an already-aborted multipart request fails immediately", async () => {
  const controller = new AbortController(); controller.abort();
  const { request, state } = stalledRequest(controller.signal);
  await assert.rejects(readCatalogueBulkFormData(request, { timeoutMs: 1000 }), { status: 408 });
  assert.equal(state.canceled, true);
});

test("bulk lease is exclusive and an old release cannot free a newer request", () => {
  const first = acquireCatalogueBulkRequest();
  assert.equal(typeof first, "function");
  assert.equal(acquireCatalogueBulkRequest(), null);
  first();
  const second = acquireCatalogueBulkRequest();
  assert.equal(typeof second, "function");
  first();
  assert.equal(acquireCatalogueBulkRequest(), null);
  second();
});

class CatalogueTrackStorageError extends Error {}
function fakeFile(name, size = 1) {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  file.reads = 0;
  file.arrayBuffer = async () => { file.reads++; return new ArrayBuffer(1); };
  return file;
}

// Execute the actual POST body with local dependencies, never a database,
// supplier endpoint, R2 object, uploaded music, or live HTTP request.
function routeHarness(overrides = {}) {
  const state = { auth: 0, reads: 0, genres: 0, extracts: 0, storage: 0 };
  const archive = fakeFile("batch.zip");
  const manifest = fakeFile("batch.csv");
  const form = new FormData();
  // A tiny map preserves the deliberately synthetic File.size boundary.
  const fields = new Map([["archive", archive], ["manifest", manifest], ["mode", "validate"]]);
  const data = { get: (name) => fields.get(name) ?? form.get(name), getAll: (name) => form.getAll(name) };
  const deps = {
    crypto, NextResponse: Response, File, CatalogueBulkImportError, CatalogueTrackStorageError, CatalogueBulkRequestError,
    requirePlatformAdmin: async () => { state.auth++; return { ok: true, user: { role: "SUPER_ADMIN", id: "synthetic-admin" } }; },
    accessDenied: () => Response.json({ error: "Denied" }, { status: 401 }),
    acquireCatalogueBulkRequest, catalogueBulkFileSizeError,
    readCatalogueBulkFormData: async () => { state.reads++; return data; },
    catalogueTerritoriesFromForm: () => ({ ok: true, codes: ["MT"] }),
    parseCatalogueBatchSettings: () => ({ ok: true, data: {} }),
    prisma: { mediaGenre: { findMany: async () => { state.genres++; return []; } }, auditLog: { create: async () => { throw new Error("No audit write expected"); } } },
    parseCatalogueManifest: async () => [],
    extractCatalogueArchive: async () => { state.extracts++; return []; },
    matchManifestRowsToAudio: () => [], metadataForBulkRow: () => { throw new Error("No rows expected"); },
    findExistingCatalogueChecksums: async () => new Set(), inspectCatalogueAudio: () => { throw new Error("No audio expected"); },
    storeCatalogueTrack: async () => { state.storage++; throw new Error("No storage expected"); }, securityLog: () => {}, ...overrides
  };
  const executable = routeSource.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export const.*$/gm, "")
    .replace("export async function POST", "async function POST");
  const post = new Function(...Object.keys(deps), `${executable}\nreturn POST;`)(...Object.values(deps));
  return { post, state, archive, manifest, fields };
}

test("actual bulk handler authenticates and checks Super Admin before reading or leasing", async () => {
  for (const access of [{ ok: false }, { ok: true, user: { role: "ADMIN" } }]) {
    const h = routeHarness({ requirePlatformAdmin: async () => access,
      acquireCatalogueBulkRequest: () => { throw new Error("Must not acquire before permission"); } });
    assert.equal((await h.post({})).status, access.ok ? 403 : 401);
    assert.equal(h.state.reads, 0);
    assert.equal(h.state.genres, 0);
  }
});

for (const [name, limit] of [["archive", MAX_CATALOGUE_ARCHIVE_SIZE_BYTES], ["manifest", MAX_CATALOGUE_MANIFEST_SIZE_BYTES]]) {
  test(`actual bulk handler rejects oversized ${name} before any File.arrayBuffer or genre DB access`, async () => {
    const h = routeHarness();
    h.fields.set(name, fakeFile(name, limit + 1));
    const response = await h.post({});
    assert.equal(response.status, 413);
    assert.equal(h.state.genres, 0);
    assert.equal(h.archive.reads, 0);
    assert.equal(h.manifest.reads, 0);
    assert.equal(h.fields.get(name).reads, 0);
    const released = acquireCatalogueBulkRequest();
    assert.equal(typeof released, "function"); released();
  });
}

test("actual bulk handler accepts exact per-file boundaries in validate mode without storing", async () => {
  const h = routeHarness();
  h.fields.set("archive", fakeFile("batch.zip", MAX_CATALOGUE_ARCHIVE_SIZE_BYTES));
  h.fields.set("manifest", fakeFile("batch.csv", MAX_CATALOGUE_MANIFEST_SIZE_BYTES));
  const response = await h.post({});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).preview.ready, true);
  assert.equal(h.state.genres, 1);
  assert.equal(h.state.extracts, 1);
  assert.equal(h.state.storage, 0);
});

test("actual bulk handler returns busy without parsing a second request and releases after parsing failure", async () => {
  let failFirst;
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve, reject) => { failFirst = reject; });
  const h = routeHarness({ readCatalogueBulkFormData: async () => { entered(); return pending; } });
  const first = h.post({});
  await ready;
  const second = routeHarness();
  const busy = await second.post({});
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("retry-after"), "5");
  assert.equal(second.state.reads, 0);
  assert.equal(acquireCatalogueBulkRequest(), null);
  failFirst(new CatalogueBulkRequestError("Synthetic overflow", 413));
  assert.equal((await first).status, 413);
  assert.equal((await second.post({})).status, 200);
});

test("actual bulk handler releases on validation returns and unexpected failures", async () => {
  const bad = routeHarness(); bad.fields.delete("archive");
  assert.equal((await bad.post({})).status, 400);
  const broken = routeHarness({ parseCatalogueBatchSettings: () => { throw new Error("synthetic failure"); } });
  assert.equal((await broken.post({})).status, 500);
  assert.equal((await routeHarness().post({})).status, 200);
});

test("actual bulk handler releases its processing lease after a stalled upload deadline", async () => {
  const h = routeHarness({ readCatalogueBulkFormData: (request) => readCatalogueBulkFormData(request, { timeoutMs: 10 }) });
  const { request } = stalledRequest();
  assert.equal((await h.post(request)).status, 408);
  assert.equal((await routeHarness().post({})).status, 200);
});

test("actual bulk handler releases its processing lease after request abort", async () => {
  const h = routeHarness({ readCatalogueBulkFormData: (request) => readCatalogueBulkFormData(request, { timeoutMs: 1000 }) });
  const controller = new AbortController();
  const { request } = stalledRequest(controller.signal);
  const response = h.post(request); controller.abort();
  assert.equal((await response).status, 408);
  assert.equal((await routeHarness().post({})).status, 200);
});

function clientHarness(archiveSize = 1, manifestSize = 1, responseOverride) {
  const state = { working: "", error: "", preview: { stale: true }, result: null, fetches: 0, refreshes: 0 };
  const files = new Map([["archive", fakeFile("batch.zip", archiveSize)], ["manifest", fakeFile("batch.csv", manifestSize)]]);
  class SyntheticFormData extends Map { constructor() { super(files); } }
  const setters = Object.fromEntries(["Working", "Error", "Preview", "Result"].map((name) =>
    [`set${name}`, (value) => { state[name[0].toLowerCase() + name.slice(1)] = value; }]));
  const body = clientSource.slice(clientSource.indexOf("  async function processBatch(mode) {"), clientSource.indexOf("\n  return ("));
  const run = new Function("formRef", "FormData", "catalogueBulkFileSizeError", "catalogueRequestSizePolicy", "fetch", "router", ...Object.keys(setters),
    `${body}\nreturn processBatch;`)({ current: { reset() { throw new Error("Validation must not reset"); } } }, SyntheticFormData,
    catalogueBulkFileSizeError, catalogueRequestSizePolicy, async (url, options) => { state.fetches++; assert.equal(url, "/api/admin/catalogue/bulk-upload");
      assert.equal(options.body.get("mode"), "validate");
      return responseOverride || { ok: true, json: async () => ({ preview: { ready: true } }) }; },
    { refresh() { state.refreshes++; } }, ...Object.values(setters));
  return { run, state };
}

for (const [archiveSize, manifestSize, message] of [[MAX_CATALOGUE_ARCHIVE_SIZE_BYTES + 1, 1, /ZIP.*150 MB/],
  [1, MAX_CATALOGUE_MANIFEST_SIZE_BYTES + 1, /spreadsheet.*10 MB/]]) {
  test(`actual bulk client rejects ${message} before fetch and clears stale preview`, async () => {
    const h = clientHarness(archiveSize, manifestSize); await h.run("validate");
    assert.equal(h.state.fetches, 0); assert.equal(h.state.working, "");
    assert.equal(h.state.preview, null); assert.match(h.state.error, message);
  });
}

test("actual bulk client permits exact file-size boundaries to validate without import", async () => {
  const h = clientHarness(MAX_CATALOGUE_ARCHIVE_SIZE_BYTES, MAX_CATALOGUE_MANIFEST_SIZE_BYTES);
  await h.run("validate"); assert.equal(h.state.fetches, 1); assert.equal(h.state.working, "");
  assert.equal(h.state.preview.ready, true); assert.equal(h.state.refreshes, 0);
});

for (const [status, message] of [[413, /165 MB total request limit/], [502, /temporarily unavailable/],
  [503, /temporarily unavailable/], [500, /readable result/]]) {
  test(`actual bulk client turns non-JSON ${status} into a safe message, not raw HTML`, async () => {
    const h = clientHarness(1, 1, { ok: false, status,
      json: async () => { throw new SyntaxError("Unexpected token '<', '<!DOCTYPE private upstream details' is not valid JSON"); } });
    await h.run("validate");
    assert.match(h.state.error, message); assert.doesNotMatch(h.state.error, /DOCTYPE|private upstream|Unexpected token/);
    assert.equal(h.state.working, ""); assert.equal(h.state.fetches, 1);
  });
}

test("actual bulk client preserves the API's ordinary JSON error and busy message", async () => {
  const h = clientHarness(1, 1, { ok: false, status: 429, json: async () => ({ error: "Another catalogue batch is being checked." }) });
  await h.run("validate"); assert.equal(h.state.error, "Another catalogue batch is being checked.");
  assert.equal(h.state.working, "");
});

test("middleware and Next cloning ceiling use the bounded route policy", async () => {
  const middleware = await readFile(new URL("../middleware.js", import.meta.url), "utf8");
  assert.match(middleware, /catalogueRequestSizePolicy\(request\.nextUrl\.pathname, request\.method\)/);
  assert.match(middleware, /contentLength > requestSizePolicy\.maxBytes/);
  const { default: config } = await import("../next.config.mjs");
  assert.equal(config.experimental.middlewareClientMaxBodySize, "166mb");
  assert.ok(Number.parseInt(config.experimental.middlewareClientMaxBodySize, 10) * MIB > MAX_CATALOGUE_BULK_REQUEST_BYTES);
  assert.match(clientSource, /uncompressed total maximum 200 MB/);
  assert.match(clientSource, /CSV or XLSX maximum 10 MB/);
});

test("actual middleware accepts exact route boundaries and rejects the next byte for POST and other methods", async () => {
  const source = await readFile(new URL("../middleware.js", import.meta.url), "utf8");
  const executable = source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
  const next = { next: () => new Response(null, { status: 204 }), json: Response.json };
  const middleware = new Function("NextResponse", "publicRequestOrigin", "readPrivatePreviewPolicy", "catalogueRequestSizePolicy", "crypto",
    `${executable}\nreturn middleware;`)(next, () => "https://www.ruvanas.com", () => ({ enabled: false }), catalogueRequestSizePolicy, crypto);
  for (const [path, method, maxBytes] of [["/api/admin/catalogue/bulk-upload", "POST", 165 * MIB],
    ["/api/admin/catalogue/bulk-upload", "GET", 10 * MIB], ["/api/admin/catalogue/bulk-upload", "PUT", 10 * MIB],
    ["/api/admin/catalogue/upload", "POST", 55 * MIB], ["/api/admin/catalogue/bulk-upload/", "POST", 10 * MIB],
    ["/api/admin/catalogue/metadata-preview", "POST", 10 * MIB]]) {
    const request = (size) => ({ method, nextUrl: new URL(`https://www.ruvanas.com${path}`),
      headers: new Headers({ "content-length": String(size), origin: "https://www.ruvanas.com", "x-request-id": "synthetic-request" }) });
    assert.equal((await middleware(request(maxBytes))).status, 204, `${method} ${path} exact limit`);
    const oversized = await middleware(request(maxBytes + 1));
    assert.equal(oversized.status, 413, `${method} ${path} overflow`);
    assert.equal((await oversized.json()).error, catalogueRequestSizePolicy(path, method).error);
  }
});
