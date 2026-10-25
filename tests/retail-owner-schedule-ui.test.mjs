import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as ui from "../lib/retail-schedule-review-ui.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const { renderToStaticMarkup } = require("react-dom/server");
const file = "app/admin/organisations/[organisationId]/retail-stream/RetailScheduleReviewPanel.js";
const organisationId = ui.RETAIL_REVIEW_ORGANISATION_ID, stationId = ui.RETAIL_REVIEW_STATION_ID;
const now = new Date("2026-10-25T10:00:00Z"), channelId = "retailchannel", sourceId = "retailplaylist";
const dto = () => ({ organisationId, stationId, channelId, highestVersionId: "version3", canApprove: true, canPrepareTest: true,
  sources: [{ id: sourceId, name: "Retail pop mix", eligibleTrackCount: 36 }],
  schedule: { id: "retailweek", channelId, name: "Test Retail weekly plan", timezone: "Europe/Malta" }, warnings: [],
  approved: { enabled: true, versionId: "version2", version: 2, channelId, publishedAt: "2026-10-24T08:00:00Z", effectiveAt: "2026-10-24T08:01:00Z" },
  observation: { state: "STREAMING", phase: "RANDOM", fresh: true, observedAt: now.toISOString(), checkedAt: now.toISOString(), track: { id: "track", title: "Current track", artist: "Artist" } },
  draft: { id: "version3", version: 3, readyToApprove: true, reviewHash: "a".repeat(64), diagnostic: false,
    items: [{ label: "Shop opening mix", sourceType: "MUSIC_MODE", sourceId, recurrence: "WEEKLY", weekday: 1, startTime: "10:00", startsAt: null, durationMinutes: 60, priority: 50 }],
    preview: { timezone: "Europe/Malta", startsAt: "2026-10-25T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", days: 7, warnings: [],
      occurrences: [{ label: "Shop opening mix", sourceId, startsAt: "2026-10-26T09:00:00Z", endsAt: "2026-10-26T10:00:00Z", priority: 50 }] } } });
const safe = raw => ui.retailScheduleReviewView(raw, organisationId);
const review = value => ({ versionId: value.draft.id, reviewHash: value.draft.reviewHash });

function harness() {
  const slots = []; let cursor = 0, effects = [], timers = [], clock;
  return { slots, hooks: { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect) { effects.push(effect); }
  },
    setTimeout(fn, ms) { if (ms === 0) timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval(fn) { clock = fn; return 1; }, clearInterval() {},
    render(Component, props = { organisationId }) { cursor = 0; effects = []; return Component(props); },
    async load() { effects[0]?.(); timers.splice(0).forEach(fn => fn()); await new Promise(setImmediate); }, tick() { clock?.(); }
  };
}
async function component({ h = harness(), fetch = () => { throw new Error("unexpected network"); } } = {}) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, crypto: webcrypto,
    setTimeout: h.setTimeout, clearTimeout: h.clearTimeout, setInterval: h.setInterval, clearInterval: h.clearInterval,
    require: name => name === "react" ? h.hooks : name === "@/lib/retail-schedule-review-ui.mjs" ? ui : name.endsWith(".module.css")
      ? { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) }
      : require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name) });
  return { ...module.exports, h, source };
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
function text(tree) { if (typeof tree === "string" || typeof tree === "number") return String(tree); return React.Children.toArray(tree?.props?.children).map(text).join(""); }
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node).includes(label));
function acknowledge(module) {
  let tree = module.h.render(module.default); button(tree, "Review saved version").props.onClick();
  tree = module.h.render(module.default); nodes(tree).find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
  return module.h.render(module.default);
}

test("review rejects other stations and strips secret fields from every displayed projection", () => {
  const raw = dto(); raw.sourcePassword = "SECRET"; raw.draft.preview.mediaUrl = "https://secret.invalid"; raw.sources[0].sourcePassword = "SECRET";
  assert.doesNotMatch(JSON.stringify(safe(raw)), /SECRET|secret.invalid/);
  assert.throws(() => safe({ ...raw, stationId: "cmvcnbwi20008hr23sd76psi8" }));
  assert.throws(() => ui.retailScheduleReviewView(raw, "anotherorg"));
  assert.throws(() => safe({ ...raw, approved: { ...raw.approved, channelId: "otherchannel" } }));
});

test("approval binds exact reviewed ID and content hash, not version number or stale acknowledgement", () => {
  const value = safe(dto());
  assert.equal(ui.retailReviewedApproval(value, null, true, "request"), null);
  assert.equal(ui.retailReviewedApproval(value, review(value), false, "request"), null);
  assert.equal(ui.retailReviewedApproval(value, { ...review(value), versionId: "other" }, true, "request"), null);
  assert.equal(ui.retailReviewedApproval(value, { ...review(value), reviewHash: "b".repeat(64) }, true, "request"), null);
  assert.equal(ui.retailReviewedApproval({ ...value, canApprove: false }, review(value), true, "request"), null);
  assert.deepEqual(ui.retailReviewedApproval(value, review(value), true, "request"), { action: "approve", versionId: "version3", reviewHash: "a".repeat(64), requestId: "request", overridesAcknowledged: true });
  assert.equal(ui.retailReviewedApproval({ ...value, approved: { enabled: true, versionId: "version3" } }, review(value), true, "request"), null);
});

test("opening owner panel reads only; approval requires explicit review and acknowledgement", async () => {
  const calls = [];
  const module = await component({ fetch: async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, body });
    return { ok: true, json: async () => body ? { ...dto(), accepted: true, action: "approve", approvedVersionId: "version3", draft: null,
      approved: { ...dto().approved, versionId: "version3", version: 3 } } : dto() };
  } });
  module.h.render(module.default); await module.h.load();
  assert.equal(calls.length, 1); assert.equal(calls[0].body, undefined);
  let tree = module.h.render(module.default);
  assert.equal(button(tree, "Approve version"), undefined);
  button(tree, "Review saved version").props.onClick(); tree = module.h.render(module.default);
  assert.equal(button(tree, "Approve version").props.disabled, true);
  tree = acknowledge(module); assert.equal(button(tree, "Approve version").props.disabled, false);
  await button(tree, "Approve version").props.onClick();
  assert.equal(calls.length, 2); assert.equal(calls[1].url, `/api/admin/organisations/${organisationId}/retail-schedule`);
  assert.equal(calls[1].body.versionId, "version3"); assert.equal(calls[1].body.reviewHash, "a".repeat(64));
  assert.match(calls[1].body.requestId, /^[a-f0-9-]{36}$/);
  assert.match(text(module.h.render(module.default)), /Version 3 has administrator approval/);
  assert.doesNotMatch(JSON.stringify(calls), /\/retail-playout|START|STOP|sourcePassword|cmvcnbwi/);
});

test("stale approval errors remove review authority and require a fresh read before retry", async () => {
  let reads = 0; const calls = [];
  const module = await component({ fetch: async (_url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body);
    if (body) return { ok: false, json: async () => ({ code: "RETAIL_SCHEDULE_REVIEW_CHANGED" }) };
    const raw = dto(); if (++reads > 1) { raw.draft.id = "version4"; raw.draft.version = 4; raw.highestVersionId = "version4"; raw.draft.reviewHash = "b".repeat(64); }
    return { ok: true, json: async () => raw };
  } });
  module.h.render(module.default); await module.h.load();
  await button(acknowledge(module), "Approve version").props.onClick();
  let tree = module.h.render(module.default);
  assert.match(text(tree), /saved plan or its music changed/); assert.equal(button(tree, "Approve version"), undefined);
  assert.equal(button(tree, "Review saved version").props.disabled, true);
  assert.equal(button(tree, "Prepare test draft").props.disabled, true);
  await button(tree, "Refresh saved week").props.onClick(); tree = module.h.render(module.default);
  assert.equal(button(tree, "Approve version"), undefined); assert.ok(button(tree, "Review saved version 4"));
  assert.equal(calls.filter(Boolean).length, 1);
});

test("uncertain mutation and foreign success responses never report approval or silently retry", async () => {
  for (const mode of ["timeout", "foreign", "wrong-version"]) {
    let mutations = 0;
    const module = await component({ fetch: async (_url, options) => {
      if (!options.body) return { ok: true, json: async () => dto() };
      mutations++;
      if (mode === "timeout") throw Object.assign(new Error("timeout"), { name: "AbortError" });
      return { ok: true, json: async () => ({ ...dto(), accepted: true, action: "approve", approvedVersionId: "wrong-version",
        ...(mode === "foreign" ? { stationId: "cmvcnbwi20008hr23sd76psi8" } : {}) }) };
    } });
    module.h.render(module.default); await module.h.load(); await button(acknowledge(module), "Approve version").props.onClick();
    const tree = module.h.render(module.default); assert.equal(button(tree, "Approve version"), undefined);
    assert.equal(button(tree, "Prepare test draft").props.disabled, true); assert.doesNotMatch(text(tree), /has administrator approval/); assert.equal(mutations, 1);
  }
});

test("short-test preparation uses highest saved version and a bounded future instant across the Malta clock change", () => {
  const value = safe({ ...dto(), highestVersionId: "diagnosticVersion9" });
  const form = ui.retailTestDraftForm(value, now), request = ui.retailTestDraftRequest(value, form, "request", now);
  assert.equal(request.baseVersionId, "diagnosticVersion9"); assert.equal(request.startsAt, "2026-10-25T10:05:00.000Z"); assert.equal(request.durationMinutes, 2);
  assert.throws(() => ui.retailTestDraftRequest(value, { ...form, durationMinutes: "6" }, "request", now));
  assert.throws(() => ui.retailTestDraftRequest(value, { ...form, sourceId: "other" }, "request", now));
  assert.throws(() => ui.retailTestDraftRequest(value, { ...form, startsAt: "2026-10-25T11:01" }, "request", now), /2 and 60/);
  assert.throws(() => ui.retailTestDraftRequest(value, { ...form, startsAt: "2026-10-25T12:01" }, "request", now), /2 and 60/);
  const beforeRollback = new Date("2026-10-25T01:20:00Z"), rollback = ui.retailTestDraftForm(value, beforeRollback);
  assert.equal(ui.retailTestDraftRequest(value, rollback, "request", beforeRollback).startsAt, "2026-10-25T01:25:00.000Z");
  assert.throws(() => ui.retailTestDraftRequest(value, { ...rollback, startsAt: "2026-10-25T02:26" }, "request", beforeRollback), /repeats/);
});

test("preparing a test remains a draft action with no implicit approval", async () => {
  const calls = [];
  const module = await component({ fetch: async (_url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body);
    const raw = dto(); if (body) { raw.draft.diagnostic = true; raw.draft.preservedDraftVersionId = "subscriberVersion1"; raw.savedVersionId = raw.draft.id; raw.accepted = true; raw.action = "prepare-test"; }
    return { ok: true, json: async () => raw };
  } });
  module.h.render(module.default); await module.h.load();
  const form = nodes(module.h.render(module.default)).find(node => node.type === "form");
  form.props.onSubmit({ preventDefault() {} }); await new Promise(setImmediate);
  assert.equal(calls[1].action, "prepare-test"); assert.equal(calls[1].baseVersionId, "version3"); assert.equal(calls.length, 2);
  const tree = module.h.render(module.default); assert.match(text(tree), /approve it separately/); assert.equal(button(tree, "Approve version"), undefined);
});

test("source mode expires independently from configured approval and saved song titles", () => {
  const value = safe(dto());
  assert.equal(ui.retailReviewSource(value, now).label, "Source report: random AutoDJ");
  const late = ui.retailReviewSource(value, new Date(now.getTime() + 15001));
  assert.equal(late.fresh, false); assert.match(late.label, /unverified/);
  assert.equal(late.timing, null);
  assert.doesNotMatch(late.detail, /Current track/);
  assert.match(ui.retailReviewSource({ ...value, observation: { ...value.observation, phase: "SCHEDULED", programme: { label: "Shop opening mix" } } }, now).label, /Shop opening mix/);
});

test("source timing preserves bounded delay and occurrence details only while evidence is fresh", async () => {
  const module = await component(), raw = dto();
  Object.assign(raw.observation, { phase: "SCHEDULED", presentationAt: "2026-10-25T10:00:00.000Z", sourceLatenessMs: 15.25,
    programme: { label: "Short handover test", startsAt: "2026-10-25T10:00:00.000Z", endsAt: "2026-10-25T10:02:00.000Z",
      occurrenceId: "b".repeat(64), scheduleRevision: "c".repeat(64) } });
  const value = safe(raw), report = ui.retailReviewSource(value, now);
  const html = renderToStaticMarkup(React.createElement(module.RetailSourceTiming, { report, timezone: "Europe/Malta" }));
  assert.match(html, /11:00:00\.000/); assert.match(html, /15\.25 ms/); assert.match(html, new RegExp("b".repeat(64)));
  assert.match(html, /do not measure listener buffering/);
  assert.equal(renderToStaticMarkup(React.createElement(module.RetailSourceTiming, { report: ui.retailReviewSource(value, new Date(now.getTime() + 15001)), timezone: "Europe/Malta" })), "");
  for (const sourceLatenessMs of [-1, 3_600_001, Infinity, "15"]) assert.throws(() => safe({ ...raw, observation: { ...raw.observation, sourceLatenessMs } }));
  assert.throws(() => safe({ ...raw, observation: { ...raw.observation, presentationAt: "invalid" } }));
  assert.throws(() => safe({ ...raw, observation: { ...raw.observation, programme: { ...raw.observation.programme, occurrenceId: "too-long".repeat(100) } } }));
});

test("saved-week SSR escapes metadata, includes every saved programme and keeps listener claims qualified", async () => {
  const module = await component(), raw = dto(); raw.draft.items[0].label = "<script>alert(1)</script>";
  raw.draft.items.push({ ...raw.draft.items[0], label: "Later one-off", recurrence: "ONE_OFF", startsAt: "2027-01-01T09:00:00Z", weekday: null, startTime: null });
  raw.draft.diagnostic = true; raw.draft.preservedDraftVersionId = "subscriberVersion1";
  const html = renderToStaticMarkup(React.createElement(module.RetailOwnerSavedWeek, { view: safe(raw) }));
  assert.match(html, /&lt;script/); assert.doesNotMatch(html, /<script|<audio|autoplay|undefined/); assert.match(html, /Later one-off/);
  assert.match(html, /does not approve that draft/); assert.match(html, /10:00–11:00/); assert.match(html, /does not confirm what listeners can hear/);
  assert.equal(module.h.render(module.default, { organisationId: "anotherorg" }), null);
});
