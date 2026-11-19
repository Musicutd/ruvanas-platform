import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as policy from "../lib/retail-commercial-policy.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const { renderToStaticMarkup } = require("react-dom/server");
const file = "app/admin/organisations/[organisationId]/retail-stream/RetailCommercialReviewPanel.js";
const endpoint = `/api/admin/organisations/${ORG}/retail-commercials`;
const firstId = `retail-commercial-${"a".repeat(40)}`, nextId = `retail-commercial-${"b".repeat(40)}`;
const approvalId = `retail-commercial-approval-${"c".repeat(40)}`;
const dto = () => ({ organisationId: ORG, stationId: STATION, canApprove: true, reviewOnly: true, adminApprovalRequired: true,
  baseApprovalId: approvalId, reviewHash: "d".repeat(64), warnings: [],
  spots: [{ id: "spot-a", name: "Welcome message", version: 1, durationSeconds: 20 }, { id: "spot-b", name: "Weekend offer", version: 1, durationSeconds: 30 }],
  approval: { id: approvalId, sequence: 1, draftId: firstId, draftVersion: 1, approvedAt: "2026-10-29T10:00:00Z" },
  draft: { id: nextId, version: 2, name: "Weekend messages", timezone: "Europe/Malta", savedAt: "2026-10-29T10:05:00Z",
    rules: [{ name: "Every three songs", mode: "EVERY_SONGS", spotIds: ["spot-b", "spot-a"], weekdays: [1, 2, 3, 4, 5], everySongs: 3 }] } });
const reply = body => ({ ok: true, json: async () => structuredClone(body) });
function harness() {
  const slots = []; let cursor = 0, effects = [], timers = [], cleanup;
  return { hooks: { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn) { effects.push(fn); }
  },
    setTimeout(fn, ms) { if (ms === 0) timers.push(fn); return timers.length; }, clearTimeout() {},
    render(Component, props = { organisationId: ORG }) { cursor = 0; effects = []; return Component(props); },
    async load() { cleanup = effects[0]?.(); timers.splice(0).forEach(fn => fn()); await new Promise(setImmediate); },
    unmount() { cleanup?.(); }
  };
}
async function component(fetch) {
  const h = harness(), source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, crypto: webcrypto,
    setTimeout: h.setTimeout, clearTimeout: h.clearTimeout,
    require: name => name === "react" ? h.hooks : name === "@/lib/retail-commercial-policy.mjs" ? policy : name.endsWith(".module.css")
      ? { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) }
      : require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name) });
  return { h, Component: module.exports.default };
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
function text(tree) { if (typeof tree === "string" || typeof tree === "number") return String(tree); return React.Children.toArray(tree?.props?.children).map(text).join(""); }
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node).includes(label));
const checkbox = tree => nodes(tree).find(node => node.type === "input" && node.props.type === "checkbox");
const render = m => m.h.render(m.Component);
function acknowledge(m) { checkbox(render(m)).props.onChange({ target: { checked: true } }); return render(m); }
async function open(m) { render(m); await m.h.load(); return render(m); }

test("opening commercial owner review only reads the exact Retail endpoint and shows approved v1 separately from pending v2", async () => {
  const calls = [], m = await component(async (url, options) => { calls.push({ url, options }); return reply(dto()); });
  const tree = await open(m);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, endpoint); assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined); assert.equal(calls[0].options.cache, "no-store"); assert.equal(calls[0].options.credentials, "same-origin");
  assert.match(text(tree), /Approved commercial draft: version 1/);
  assert.match(text(tree), /Draft 2: Weekend messages/); assert.match(text(tree), /Pending owner approval · these changes are not on air/);
  assert.match(text(tree), /Malta time/); assert.match(text(tree), /not confirmation of live playback/);
  assert.ok(text(tree).indexOf("Weekend offer") < text(tree).indexOf("Welcome message"));
  assert.equal(button(tree, "Approve commercial plan").props.disabled, true);
  assert.equal(nodes(tree).some(node => node.type === "audio" || node.props?.autoPlay), false);
  assert.doesNotMatch(renderToStaticMarkup(tree), /password|sourcePassword|storageKey|\/retail-playout|\/start/);
  if (process.env.RETAIL_COMMERCIAL_OWNER_UI_PREVIEW === "true") {
    const css = await readFile(new URL("../app/admin/organisations/[organisationId]/retail-stream/retail-stream.module.css", import.meta.url), "utf8");
    const output = new URL("../../../output/retail-commercial-playout-20261029/", import.meta.url);
    await mkdir(output, { recursive: true });
    const markup = renderToStaticMarkup(tree).replace(/<button(?![^>]*\bdisabled\b)/g, "<button disabled");
    await writeFile(new URL("owner-review-preview.html", output), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Retail commercial owner review — local preview</title><style>body{margin:0;background:#f1f5f9;font:15px/1.6 Arial,sans-serif}.preview{padding:12px 20px;background:#14253a;color:#fff;text-align:center;font-weight:700}${css}</style></head><body><header class="preview">LOCAL PREVIEW — sample commercial data — no network requests or live changes</header><main class="page">${markup}</main></body></html>`);
  }
  const foreignCalls = [], foreign = await component(async (...args) => { foreignCalls.push(args); return reply(dto()); });
  assert.equal(foreign.h.render(foreign.Component, { organisationId: "other" }), null); await foreign.h.load(); assert.equal(foreignCalls.length, 0);
});

test("approval needs current canApprove and acknowledgement, and sends only the reviewed commercial command", async () => {
  const calls = [], m = await component(async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, options, body });
    return reply(body ? { ...dto(), accepted: true, approvedDraftId: nextId, canApprove: false,
      approval: { ...dto().approval, draftId: nextId, draftVersion: 2, sequence: 2 } } : dto());
  });
  let tree = await open(m);
  await button(tree, "Approve commercial plan").props.onClick(); assert.equal(calls.length, 1);
  tree = acknowledge(m); assert.equal(button(tree, "Approve commercial plan").props.disabled, false);
  await button(tree, "Approve commercial plan").props.onClick();
  assert.equal(calls.length, 2); const sent = calls[1];
  assert.equal(sent.url, endpoint); assert.equal(sent.options.method, "POST"); assert.equal(sent.options.headers["Content-Type"], "application/json");
  assert.deepEqual(Object.keys(sent.body).sort(), ["acknowledged", "action", "baseApprovalId", "draftId", "requestId", "reviewHash"].sort());
  assert.equal(sent.body.action, "approve"); assert.equal(sent.body.draftId, nextId); assert.equal(sent.body.reviewHash, "d".repeat(64));
  assert.equal(sent.body.baseApprovalId, approvalId); assert.equal(sent.body.acknowledged, true); assert.match(sent.body.requestId, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(calls), /\/retail-playout|START|STOP|deploy|sourcePassword|cmvcnbwi/);
  tree = render(m); assert.match(text(tree), /Commercial approval saved/); assert.match(text(tree), /This version has owner approval/);
  assert.equal(button(tree, "Approve commercial plan").props.disabled, true);
  const unavailable = await component(async () => reply({ ...dto(), canApprove: false }));
  await open(unavailable); assert.equal(checkbox(render(unavailable)).props.disabled, true);
  assert.equal(button(acknowledge(unavailable), "Approve commercial plan").props.disabled, true);
});

test("a refresh invalidates an earlier acknowledgement and binds approval to the newly reviewed draft", async () => {
  let reads = 0; const calls = [];
  const m = await component(async (_url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body);
    const value = dto(); if (++reads > 1) { value.draft.id = "retail-commercial-" + "e".repeat(40); value.draft.version = 3; value.reviewHash = "f".repeat(64); }
    return reply(body ? { ...value, accepted: true, approvedDraftId: body.draftId, canApprove: false, approval: { ...value.approval, draftId: body.draftId, draftVersion: 3 } } : value);
  });
  await open(m); assert.equal(button(acknowledge(m), "Approve commercial plan").props.disabled, false);
  await button(render(m), "Refresh commercial review").props.onClick();
  assert.equal(checkbox(render(m)).props.checked, false); assert.equal(button(render(m), "Approve commercial plan").props.disabled, true);
  await button(acknowledge(m), "Approve commercial plan").props.onClick();
  assert.equal(calls.filter(Boolean).length, 1); assert.equal(calls.at(-1).draftId, "retail-commercial-" + "e".repeat(40));
  assert.equal(calls.at(-1).reviewHash, "f".repeat(64));
});

test("uncertain, foreign and mismatched approval responses block repeats until a successful read and new acknowledgement", async () => {
  for (const mode of ["timeout", "foreign", "wrong-approved-draft", "wrong-active-approval", "not-accepted", "conflict"]) {
    let mutations = 0, reads = 0;
    const m = await component(async (_url, options) => {
      if (!options.body) { reads++; return reply(dto()); }
      mutations++;
      if (mode === "timeout") throw Object.assign(new Error("synthetic timeout"), { name: "AbortError" });
      if (mode === "conflict") return { ok: false, json: async () => ({ error: "Review changed" }) };
      const result = { ...dto(), accepted: true, approvedDraftId: nextId, approval: { ...dto().approval, draftId: nextId, draftVersion: 2 } };
      if (mode === "foreign") result.stationId = "cmvcnbwi20008hr23sd76psi8";
      if (mode === "wrong-approved-draft") result.approvedDraftId = firstId;
      if (mode === "wrong-active-approval") result.approval.draftId = firstId;
      if (mode === "not-accepted") result.accepted = false;
      return reply(result);
    });
    await open(m); await button(acknowledge(m), "Approve commercial plan").props.onClick();
    let tree = render(m); assert.equal(button(tree, "Approve commercial plan").props.disabled, true, mode);
    assert.equal(checkbox(tree).props.disabled, true); assert.doesNotMatch(text(tree), /Commercial approval saved/);
    assert.ok(nodes(tree).some(node => node.props?.role === "alert"));
    await button(acknowledge(m), "Approve commercial plan").props.onClick(); assert.equal(mutations, 1);
    await button(render(m), "Refresh commercial review").props.onClick(); tree = render(m);
    assert.equal(reads, 2); assert.equal(checkbox(tree).props.disabled, false); assert.equal(checkbox(tree).props.checked, false);
    assert.equal(button(tree, "Approve commercial plan").props.disabled, true);
    assert.equal(button(acknowledge(m), "Approve commercial plan").props.disabled, false);
  }
});

test("an in-flight owner approval ignores duplicate clicks and contains no playback control", async () => {
  let finish, posts = 0; const m = await component(async (_url, options) => {
    if (!options.body) return reply(dto());
    posts++; await new Promise(resolve => { finish = resolve; });
    return reply({ ...dto(), accepted: true, approvedDraftId: nextId, canApprove: false, approval: { ...dto().approval, draftId: nextId, draftVersion: 2 } });
  });
  await open(m); const ready = acknowledge(m), first = button(ready, "Approve commercial plan").props.onClick();
  await button(ready, "Approve commercial plan").props.onClick(); assert.equal(posts, 1);
  assert.equal(button(render(m), "Refresh commercial review").props.disabled, true);
  finish(); await first; assert.equal(posts, 1); assert.match(text(render(m)), /Commercial approval saved/);
});

test("an empty commercial draft clearly approves stopping insertion rather than stopping the stream", async () => {
  const empty = dto(); empty.draft.rules = [];
  const m = await component(async () => reply(empty)), tree = await open(m);
  assert.match(text(tree), /Approving it removes commercial insertion; music continues/);
  assert.equal(button(tree, "Approve commercial plan").props.disabled, true);
  assert.equal(nodes(tree).filter(node => node.type === "button").length, 2);
});
