import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { File } from "node:buffer";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as weekly from "../lib/retail-weekly-planner-ui.mjs";
import * as ui from "../lib/retail-commercial-upload-ui.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const stationId = weekly.RETAIL_PLANNER_STATION_ID, endpoint = ui.RETAIL_COMMERCIAL_UPLOAD_ENDPOINT;
const limits = { maxFileBytes: 20 * 1024 * 1024, maxDurationSeconds: 300, maxUploads: 50 };
const recording = (patch = {}) => ({ id: "version-1", promoAssetId: "promo-1", name: "Weekend offer", mediaType: "COMMERCIAL", version: 1,
  status: "IN_REVIEW", qcStatus: "PENDING", durationSeconds: 31, sizeBytes: 150000, submittedAt: "2026-10-30T16:00:00Z", reviewedAt: null, ...patch });
const dto = (uploads = []) => ({ stationId, canUpload: true, adminApprovalRequired: true, playbackConnected: false, uploads, limits, usedBytes: 0, storageLimitBytes: 100 * 1024 * 1024 });
const reply = (body, ok = true) => ({ ok, json: async () => structuredClone(body) });
const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
function harness() {
  const slots = []; let cursor = 0, effects = [];
  return { slots, hooks: { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn) { effects.push(fn); } },
    render(Component, props = { stationId }) { cursor = 0; effects = []; return Component(props); },
    async load() { effects[0]?.(); await new Promise(setImmediate); }
  };
}
async function component(h, fetch) {
  const file = "app/dashboard/programming/RetailCommercialUpload.js", source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, FormData, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    require: name => {
      if (name === "react") return h.hooks;
      if (name === "@/lib/retail-weekly-planner-ui.mjs") return weekly;
      if (name === "@/lib/retail-commercial-upload-ui.mjs") return ui;
      if (name.endsWith(".module.css")) return css;
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
  return module.exports.default;
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
function text(tree) { if (typeof tree === "string" || typeof tree === "number") return String(tree); return React.Children.toArray(tree?.props?.children).map(text).join(""); }
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node).includes(label));
const field = (tree, label, type = "input") => nodes(nodes(tree).find(node => node.type === "label" && text(node).startsWith(label))).find(node => node.type === type);
const fileField = tree => nodes(tree).find(node => node.type === "input" && node.props.type === "file");
const submit = tree => nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
function fill(h, Component, file = new File([new Uint8Array(24)], "offer.mp3", { type: "audio/mpeg" })) {
  field(h.render(Component), "Recording name").props.onChange({ target: { value: "Weekend offer" } });
  field(h.render(Component), "Recording type", "select").props.onChange({ target: { value: "COMMERCIAL" } });
  fileField(h.render(Component)).props.onChange({ target: { files: [file] } });
  field(h.render(Component), "I have permission").props.onChange({ target: { checked: true } });
  return file;
}

test("opening subscriber uploads only reads the exact Retail endpoint and exposes no audio player", async () => {
  const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return reply(dto()); });
  h.render(Component); await h.load();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, endpoint); assert.equal(calls[0].options.body, undefined); assert.equal(calls[0].options.cache, "no-store");
  const tree = h.render(Component); assert.match(text(tree), /Upload a commercial or announcement/); assert.match(text(tree), /Music catalogue uploads remain managed by Ruvanas/);
  assert.equal(button(tree, "Upload for approval").props.disabled, true); assert.equal(nodes(tree).some(node => node.type === "audio" || node.props?.autoPlay), false);
  assert.equal(h.render(Component, { stationId: "other" }), null); await h.load(); assert.equal(calls.length, 1);
});

test("upload DTO strips private paths and rejects foreign scope or expanded capability", () => {
  const data = dto([recording({ storageKey: "private/audio", playbackUrl: "https://secret.invalid", sourcePassword: "secret" })]);
  data.credentials = "secret"; const safe = ui.retailCommercialUploadView(data);
  assert.doesNotMatch(JSON.stringify(safe), /private\/audio|secret/);
  for (const patch of [{ stationId: "other" }, { adminApprovalRequired: false }, { playbackConnected: true }, { uploads: [recording(), recording()] },
    { limits: { ...limits, maxFileBytes: 50 * 1024 * 1024 } }, { uploads: [recording({ reviewedAt: "not-a-date" })] },
    { uploads: [recording({ status: "PUBLISHED" })] }, { usedBytes: -1 }]) assert.throws(() => ui.retailCommercialUploadView({ ...data, ...patch }));
});

test("subscriber sends only file and declared commercial details, then waits for administrator approval", async () => {
  const h = harness(), calls = [], Component = await component(h, async (url, options = {}) => {
    calls.push({ url, options }); return reply(options.body ? { ...dto([recording()]), uploadedId: "version-1", duplicate: false } : dto());
  });
  h.render(Component); await h.load(); fill(h, Component); await submit(h.render(Component));
  const post = calls[1]; assert.equal(post.url, endpoint); assert.equal(post.options.method, "POST"); assert.equal(post.options.credentials, "same-origin");
  assert.equal(post.options.headers, undefined, "browser must set multipart boundary");
  assert.deepEqual([...post.options.body.keys()].sort(), ["file", "languageCode", "mediaType", "name", "requestId", "rightsConfirmed"]);
  assert.equal(post.options.body.get("name"), "Weekend offer"); assert.equal(post.options.body.get("mediaType"), "COMMERCIAL");
  assert.equal(post.options.body.get("rightsConfirmed"), "true"); assert.equal(post.options.body.get("file").name, "offer.mp3");
  assert.match(post.options.body.get("requestId"), /^[a-f0-9-]{36}$/);
  const tree = h.render(Component); assert.match(text(tree), /Uploaded for administrator approval/); assert.match(text(tree), /Awaiting approval/);
  assert.equal(field(tree, "Recording name").props.value, ""); assert.equal(field(tree, "I have permission").props.checked, false);
  assert.equal(button(tree, "Upload for approval").props.disabled, true);
  assert.equal(nodes(tree).some(node => node.type === "button" && /Approve|Start|Play|Publish/.test(text(node))), false);
});

test("invalid files and missing permission never create upload requests", async () => {
  for (const file of [new File(["text"], "script.js"), new File([], "empty.mp3"), { name: "too-big.wav", size: limits.maxFileBytes + 1 }]) {
    const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return reply(dto()); });
    h.render(Component); await h.load(); fill(h, Component, file); await submit(h.render(Component)); assert.equal(calls.length, 1);
  }
  const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return reply(dto()); });
  h.render(Component); await h.load(); fill(h, Component);
  field(h.render(Component), "I have permission").props.onChange({ target: { checked: false } }); await submit(h.render(Component)); assert.equal(calls.length, 1);
});

test("uncertain uploads preserve the same retry key and file; duplicate results do not create another upload", async () => {
  const h = harness(), posts = []; let attempts = 0;
  const Component = await component(h, async (_url, options = {}) => {
    if (!options.body) return reply(dto()); posts.push(options.body);
    if (++attempts === 1) throw Object.assign(new Error("timeout"), { name: "AbortError" });
    return reply({ ...dto([recording()]), uploadedId: "version-1", duplicate: true });
  });
  h.render(Component); await h.load(); const file = fill(h, Component);
  await submit(h.render(Component)); assert.match(text(h.render(Component)), /Keep the same file and retry/);
  await submit(h.render(Component)); assert.equal(posts.length, 2); assert.equal(posts[0].get("requestId"), posts[1].get("requestId"));
  assert.equal(posts[1].get("file"), file); assert.match(text(h.render(Component)), /already in your audio library/);
});

test("in-flight upload blocks duplicate clicks, shows progress and keeps the existing music separate", async () => {
  const h = harness(), calls = []; let finish;
  const Component = await component(h, async (url, options = {}) => {
    if (!options.body) return reply(dto()); calls.push(url); await new Promise(resolve => { finish = resolve; });
    return reply({ ...dto([recording()]), uploadedId: "version-1", duplicate: false });
  });
  h.render(Component); await h.load(); fill(h, Component);
  const first = submit(h.render(Component)); await submit(h.render(Component));
  assert.equal(calls.length, 1); assert.ok(nodes(h.render(Component)).some(node => node.type === "progress"));
  assert.match(text(h.render(Component)), /Keep this page open/); finish(); await first;
});

test("refreshing upload approval status keeps an unsent file and form intact", async () => {
  const h = harness(); let reads = 0;
  const Component = await component(h, async (_url, options = {}) => { assert.equal(options.body, undefined); return reply(++reads > 1 ? dto([recording({ status: "APPROVED", qcStatus: "PASSED", reviewedAt: "2026-10-30T16:10:00Z" })]) : dto()); });
  h.render(Component); await h.load(); fill(h, Component);
  await button(h.render(Component), "Refresh upload status").props.onClick(); await new Promise(setImmediate);
  const tree = h.render(Component); assert.equal(field(tree, "Recording name").props.value, "Weekend offer"); assert.equal(field(tree, "I have permission").props.checked, true);
  assert.match(text(tree), /Approved for planning/); assert.equal(button(tree, "Upload for approval").props.disabled, false);
});

test("upload allowance and approval statuses do not silently grant on-air access", async () => {
  assert.equal(ui.retailCommercialUploadStatus(recording({ status: "APPROVED", qcStatus: "PENDING" })).label, "Awaiting approval");
  assert.equal(ui.retailCommercialUploadStatus(recording({ status: "REJECTED" })).label, "Not approved");
  assert.equal(ui.retailCommercialUploadStatus(recording({ status: "SUPERSEDED" })).label, "Replaced");
  const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return reply({ ...dto(), canUpload: false }); });
  h.render(Component); await h.load(); fill(h, Component); await submit(h.render(Component)); assert.equal(calls.length, 1);
  assert.match(text(h.render(Component)), /New uploads are currently unavailable/); assert.equal(button(h.render(Component), "Upload for approval").props.disabled, true);
});
