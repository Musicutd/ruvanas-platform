import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, request as httpRequest } from "node:http";
import { EventEmitter, getEventListeners } from "node:events";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import {
  NEXT_MIDDLEWARE_PATCH_VERSION, NEXT_SERVER_ORIGINAL_SHA256,
  patchInstalledNext, patchNextMiddlewareSource, restoreNextMiddlewareSource
} from "../scripts/patch-next-middleware-finalize.mjs";
import { readCatalogueBulkFormData } from "../lib/catalogue-bulk-request.mjs";

const require = createRequire(import.meta.url);
const { getCloneableBody } = require("next/dist/server/body-streams");
const { NodeNextRequest } = require("next/dist/server/base-http/node");
const { NextRequestAdapter } = require("next/dist/server/web/spec-extension/adapters/next-request");
const installedSource = await readFile(require.resolve("next/dist/server/next-server"), "utf8");
const installedVersion = require("next/package.json").version;
const patched = patchNextMiddlewareSource(installedSource, installedVersion);
const pristineSource = restoreNextMiddlewareSource(installedSource, installedVersion).source;
// Execute the helper actually injected into the reviewed Next source, rather
// than a duplicate implementation. The source checksum is verified above.
const injectedStart = patched.source.indexOf("async function ruvanasFinalizeMiddlewareBody(");
const injectedEnd = patched.source.indexOf("\n// END RUVANAS NEXT", injectedStart);
const helperSource = patched.source.slice(injectedStart, injectedEnd);
const finalize = new Function(`${helperSource}\nreturn ruvanasFinalizeMiddlewareBody;`)();
const tick = () => new Promise(setImmediate);
const ownListenerNames = (wire) => ["aborted", "error", "end", "close"].flatMap((event) =>
  wire.rawListeners(event).map((listener) => (listener.listener || listener).name))
  .filter((name) => ["onAbort", "onError", "onEnd", "onClose"].includes(name));

async function multipartBytes() {
  const form = new FormData();
  form.set("archive", new File(["synthetic-not-imported"], "fixture.zip"));
  form.set("manifest", new File(["Artist,Title\nExample,Fixture\n"], "fixture.csv"));
  form.set("mode", "validate");
  const request = new Request("https://www.ruvanas.com/api/admin/catalogue/bulk-upload", { method: "POST", body: form });
  return { bytes: Buffer.from(await request.arrayBuffer()), type: request.headers.get("content-type") };
}

function fixture({ bytes, type }, { declaredLength = bytes.length, cloneLimit = bytes.length + 1 } = {}) {
  const wire = new PassThrough();
  wire.method = "POST";
  wire.url = "https://www.ruvanas.com/api/admin/catalogue/bulk-upload";
  wire.headers = { "content-type": type, "content-length": String(declaredLength) };
  const body = getCloneableBody(wire, cloneLimit);
  const middlewareBranch = body.cloneBodyStream();
  const controller = new AbortController();
  return { wire, body, middlewareBranch, controller,
    route: () => NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(wire), controller.signal) };
}

test("patch pins Next version, exact original SHA and the single await handoff", () => {
  assert.equal(installedVersion, NEXT_MIDDLEWARE_PATCH_VERSION);
  assert.equal(NEXT_SERVER_ORIGINAL_SHA256.length, 64);
  assert.equal(patched.source.split("await ruvanasFinalizeMiddlewareBody(requestData.body, requestData.signal, params.request.originalRequest);").length, 2);
  assert.equal(patched.source.includes("                    requestData.body.finalize();"), false);
});

test("patch is idempotent and rejects other versions, edits and partial patches", () => {
  assert.equal(patchNextMiddlewareSource(patched.source, installedVersion).changed, false);
  assert.throws(() => patchNextMiddlewareSource(installedSource, "15.5.28"), /unreviewed Next version/);
  assert.throws(() => patchNextMiddlewareSource(installedSource + "\n", installedVersion), /checksum/);
  assert.throws(() => patchNextMiddlewareSource(patched.source.replace("300_000", "900_000"), installedVersion), /checksum/);
  assert.throws(() => patchNextMiddlewareSource(patched.source.replace("await ruvanasFinalizeMiddlewareBody(requestData.body", "ruvanasFinalizeMiddlewareBody(requestData.body"), installedVersion), /patched call differs/);
});

test("installer changes only an isolated fixture and verifies an exact second install", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ruvanas-next-finalize-"));
  try {
    const nextRoot = path.join(root, "node_modules", "next");
    await mkdir(path.join(nextRoot, "dist", "server"), { recursive: true });
    await writeFile(path.join(nextRoot, "package.json"), JSON.stringify({ name: "next", version: installedVersion }));
    await writeFile(path.join(nextRoot, "dist", "server", "next-server.js"), pristineSource);
    assert.equal((await patchInstalledNext({ projectRoot: root })).status, "PATCHED");
    assert.equal((await patchInstalledNext({ projectRoot: root })).status, "ALREADY_PATCHED");
    assert.equal(await readFile(path.join(nextRoot, "dist", "server", "next-server.js"), "utf8"), patched.source);
    assert.equal((await patchInstalledNext({ projectRoot: root, restore: true })).status, "RESTORED");
    assert.equal((await patchInstalledNext({ projectRoot: root, restore: true })).status, "ALREADY_PRISTINE");
    assert.equal(await readFile(path.join(nextRoot, "dist", "server", "next-server.js"), "utf8"), pristineSource);
    await writeFile(path.join(nextRoot, "package.json"), JSON.stringify({ name: "next", version: "16.0.0" }));
    await assert.rejects(patchInstalledNext({ projectRoot: root }), /unreviewed Next version/);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("ruvanas-next-finalize-"));
    await rm(root, { recursive: true });
  }
});

test("restoration permits only the exact patch or pristine version", () => {
  const original = restoreNextMiddlewareSource(patched.source, installedVersion);
  assert.equal(original.sha256, NEXT_SERVER_ORIGINAL_SHA256);
  assert.equal(original.changed, true);
  assert.equal(restoreNextMiddlewareSource(original.source, installedVersion).changed, false);
  assert.throws(() => restoreNextMiddlewareSource(patched.source + "\n", installedVersion), /checksum/);
  assert.throws(() => restoreNextMiddlewareSource(patched.source, "16.0.0"), /unreviewed Next version/);
});

test("installed Next reproduces the old slow-upload crash and awaited handoff preserves complete multipart bytes", async () => {
  const source = await multipartBytes();
  const h = fixture(source);
  const split = Math.floor(source.bytes.length / 2);
  h.wire.write(source.bytes.subarray(0, split));
  await tick();
  assert.equal(Readable.isDisturbed(h.wire), true);
  assert.throws(h.route, /Response body object should not be disturbed or locked/);
  let settled = false;
  const pending = finalize(h.body, h.controller.signal, h.wire, 1000).then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, "must not hand off before the last upload chunk");
  h.wire.end(source.bytes.subarray(split));
  await pending;
  assert.equal(Readable.isDisturbed(h.wire), false);
  const form = await readCatalogueBulkFormData(h.route());
  assert.equal(form.get("mode"), "validate");
  assert.equal(await form.get("archive").text(), "synthetic-not-imported");
  assert.equal(form.get("manifest").name, "fixture.csv");
  h.middlewareBranch.destroy();
});

test("fast complete uploads still finalize and reach the existing bounded multipart reader", async () => {
  const source = await multipartBytes();
  const h = fixture(source);
  h.wire.end(source.bytes);
  await tick();
  await finalize(h.body, h.controller.signal, h.wire, 1000);
  const form = await readCatalogueBulkFormData(h.route());
  assert.equal(form.get("mode"), "validate");
  h.middlewareBranch.destroy();
});

test("interrupted source rejects finalization without handing a partial stream to a route", async () => {
  const source = await multipartBytes();
  const h = fixture(source);
  h.wire.write(source.bytes.subarray(0, 10));
  await tick();
  const pending = finalize(h.body, h.controller.signal, h.wire, 1000);
  h.wire.destroy(new Error("synthetic upload interruption"));
  await assert.rejects(pending, /synthetic upload interruption/);
  assert.deepEqual(ownListenerNames(h.wire), []);
  assert.equal(getEventListeners(h.controller.signal, "abort").length, 0);
  h.middlewareBranch.destroy();
});

for (const event of ["aborted", "close"]) {
  test(`original request ${event} without end cannot hang finalization`, async () => {
    const source = await multipartBytes();
    const h = fixture(source);
    h.wire.write(source.bytes.subarray(0, 10));
    await tick();
    const pending = finalize(h.body, h.controller.signal, h.wire, 1000);
    if (event === "close") h.wire.destroy();
    else h.wire.emit(event);
    await assert.rejects(pending, { code: "RUVANAS_MIDDLEWARE_BODY_ABORTED", statusCode: 408 });
    assert.deepEqual(ownListenerNames(h.wire), []);
    assert.equal(getEventListeners(h.controller.signal, "abort").length, 0);
    await tick();
    h.middlewareBranch.destroy();
  });
}

test("an ended original body is never destroyed if finalization itself stalls", async () => {
  const h = fixture(await multipartBytes());
  let destroys = 0;
  h.wire.end();
  await tick();
  h.wire.destroy = () => { destroys++; return h.wire; };
  await assert.rejects(finalize({ finalize: () => new Promise(() => {}) }, h.controller.signal, h.wire, 10),
    { code: "RUVANAS_MIDDLEWARE_BODY_TIMEOUT" });
  assert.equal(destroys, 0);
  h.middlewareBranch.destroy();
});

for (const alreadyAborted of [false, true]) {
  test(`request cancellation is bounded and observes the clone failure (already aborted: ${alreadyAborted})`, async () => {
    const source = await multipartBytes();
    const h = fixture(source);
    h.wire.write(source.bytes.subarray(0, 10));
    await tick();
    if (alreadyAborted) h.controller.abort();
    const pending = finalize(h.body, h.controller.signal, h.wire, 1000);
    if (!alreadyAborted) h.controller.abort();
    await assert.rejects(pending, { code: "RUVANAS_MIDDLEWARE_BODY_ABORTED" });
    assert.equal(h.wire.destroyed, true);
    assert.deepEqual(ownListenerNames(h.wire), []);
    assert.equal(getEventListeners(h.controller.signal, "abort").length, 0);
    await tick();
    h.middlewareBranch.destroy();
  });
}

test("a stalled upload times out, closes the source and leaves no unhandled finalize rejection", async () => {
  const source = await multipartBytes();
  const h = fixture(source);
  h.wire.write(source.bytes.subarray(0, 10));
  await tick();
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    await assert.rejects(finalize(h.body, h.controller.signal, h.wire, 10), { code: "RUVANAS_MIDDLEWARE_BODY_TIMEOUT" });
    assert.equal(h.wire.destroyed, true);
    assert.deepEqual(ownListenerNames(h.wire), []);
    assert.equal(getEventListeners(h.controller.signal, "abort").length, 0);
    await tick(); await tick();
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
    h.middlewareBranch.destroy();
  }
});

test("handoff does not bypass actual-byte limits or accept Next's truncated clones", async () => {
  const source = await multipartBytes();
  const h = fixture(source);
  h.wire.end(source.bytes);
  await finalize(h.body, h.controller.signal, h.wire, 1000);
  await assert.rejects(readCatalogueBulkFormData(h.route(), { maxBytes: source.bytes.length - 1 }), { status: 413 });
  h.middlewareBranch.destroy();

  const truncated = fixture(source, { cloneLimit: 20 });
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    truncated.wire.end(source.bytes);
    await finalize(truncated.body, truncated.controller.signal, truncated.wire, 1000);
    await assert.rejects(readCatalogueBulkFormData(truncated.route()), { status: 400 });
  } finally {
    console.warn = oldWarn;
    truncated.middlewareBranch.destroy();
  }
});

test("bounded helper rejects unsafe deadline overrides and observes synchronous finalize errors", async () => {
  const h = fixture(await multipartBytes());
  for (const timeoutMs of [0, -1, 300_001, Infinity]) {
    await assert.rejects(finalize(h.body, h.controller.signal, h.wire, timeoutMs), /Invalid bounded/);
  }
  await assert.rejects(finalize({ finalize() { throw new Error("synthetic finalize failure"); } }, h.controller.signal, h.wire, 1000), /synthetic finalize failure/);
  h.wire.end();
  h.middlewareBranch.destroy();
});

test("production lifecycle applies the pinned correction before install, build, dev and web start", async () => {
  const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of ["postinstall", "build", "dev", "start:web"]) {
    assert.ok(metadata.scripts[name].startsWith("node scripts/patch-next-middleware-finalize.mjs && "), name);
  }
  assert.equal(metadata.dependencies.next, NEXT_MIDDLEWARE_PATCH_VERSION);
});

test("helper clears the exact deadline timer and removes listeners on success and thrown finalization", async () => {
  for (const fail of [false, true]) {
    const scheduled = [];
    const cleared = [];
    const scopedFinalize = new Function("setTimeout", "clearTimeout", `${helperSource}\nreturn ruvanasFinalizeMiddlewareBody;`)(
      (callback, milliseconds) => { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
      (timer) => cleared.push(timer));
    const original = new EventEmitter();
    let destroys = 0;
    original.destroy = () => { destroys++; };
    const controller = new AbortController();
    const body = { finalize() { if (fail) throw new Error("synthetic synchronous error"); } };
    if (fail) await assert.rejects(scopedFinalize(body, controller.signal, original), /synthetic synchronous error/);
    else await scopedFinalize(body, controller.signal, original);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].milliseconds, 300_000);
    assert.deepEqual(cleared, scheduled);
    assert.equal(destroys, 0);
    assert.equal(original.eventNames().length, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

async function localHttpUpload(source, { abort = false } = {}) {
  let resolveFirstChunk;
  const firstChunk = new Promise((resolve) => { resolveFirstChunk = resolve; });
  let resolveOutcome;
  const outcome = new Promise((resolve) => { resolveOutcome = resolve; });
  const server = createServer(async (wire, response) => {
    const body = getCloneableBody(wire, source.bytes.length + 1);
    const middlewareBranch = body.cloneBodyStream();
    const controller = new AbortController();
    const route = () => NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(wire), controller.signal);
    wire.once("data", () => {
      assert.throws(route, /Response body object should not be disturbed or locked/);
      resolveFirstChunk();
    });
    try {
      await finalize(body, controller.signal, wire, 1000);
      const form = await readCatalogueBulkFormData(route());
      resolveOutcome({ mode: form.get("mode"), archive: await form.get("archive").text() });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    } catch (error) {
      resolveOutcome({ code: error.code, statusCode: error.statusCode });
      if (!response.destroyed) { response.statusCode = error.statusCode || 500; response.end(); }
    } finally {
      middlewareBranch.destroy();
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  let client;
  try {
    const response = new Promise((resolve, reject) => {
      client = httpRequest({ hostname: "127.0.0.1", port: server.address().port,
        path: "/api/admin/catalogue/bulk-upload", method: "POST",
        headers: { "Content-Type": source.type, "Content-Length": source.bytes.length } }, (result) => {
        result.resume(); result.on("end", () => resolve(result.statusCode)); result.on("error", reject);
      });
      client.on("error", (error) => { if (abort) resolve("client-aborted"); else reject(error); });
    });
    const split = Math.floor(source.bytes.length / 2);
    client.write(source.bytes.subarray(0, split));
    await firstChunk;
    if (abort) client.destroy();
    else client.end(source.bytes.subarray(split));
    return { result: await outcome, responseStatus: await response };
  } finally {
    client?.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("actual localhost HTTP IncomingMessage waits for a slow multipart upload before route construction", { timeout: 5000 }, async () => {
  const result = await localHttpUpload(await multipartBytes());
  assert.equal(result.responseStatus, 200);
  assert.deepEqual(result.result, { mode: "validate", archive: "synthetic-not-imported" });
});

test("actual localhost HTTP disconnect rejects the handoff without entering the catalogue parser", { timeout: 5000 }, async () => {
  const result = await localHttpUpload(await multipartBytes(), { abort: true });
  assert.equal(result.responseStatus, "client-aborted");
  assert.equal(result.result.code, "RUVANAS_MIDDLEWARE_BODY_ABORTED");
  assert.equal(result.result.statusCode, 408);
});
