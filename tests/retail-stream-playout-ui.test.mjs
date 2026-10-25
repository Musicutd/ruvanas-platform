import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as ui from "../lib/retail-stream-playout-ui.mjs";

const ORG = "org-retail", SECRET = "PRIVATE_SECRET_123";
const readiness = (ready = false) => ({ organisation: { id: ORG, name: "Retail <pilot>" }, station: { id: "station-retail", status: "DRAFT" },
  connectionSaved: true, prepared: { territory: "MT", genreCodes: [], preparedAt: "2026-10-24T12:00:00.000Z" },
  availableGenres: [{ code: "pop", name: "Pop" }, { code: "dance", name: "Dance" }], eligibleTrackCount: 20,
  canPrepare: true, canStart: ready, enabled: false, blockers: ready ? [] : ["RETAIL_PLAYOUT_CAPACITY_REQUIRED", "RETAIL_PLAYOUT_OUTPUT_NOT_PERMITTED"],
  capacity: { assigned: ready, monthlyBudgetUsd: ready ? 15 : null, estimatedMonthlyUsd: ready ? 13.5 : null, bitrateKbps: 128 }, observation: null });

test("safe projection never includes runtime grants, source credentials or worker configuration", () => {
  const v = readiness();
  v.grant = { sourcePassword: SECRET }; v.assignment = { workerId: SECRET }; v.organisation.token = SECRET;
  v.capacity.credentials = SECRET; v.station.sourcePasswordEncrypted = SECRET;
  assert.deepEqual(ui.safeRetailPlayoutView(v, ORG), readiness());
  assert.doesNotMatch(JSON.stringify(ui.safeRetailPlayoutView(v, ORG)), /PRIVATE_SECRET|Encrypted|credentials|grant|workerId/);
});
test("start readiness must match the tenant, programme, costs and all approval gates", () => {
  for (const mutate of [v => { v.organisation.id = "foreign"; }, v => { v.station = null; }, v => { v.prepared = null; },
    v => { v.eligibleTrackCount = 1; }, v => { v.capacity.assigned = false; }, v => { v.capacity.estimatedMonthlyUsd = 16; },
    v => { v.capacity.monthlyBudgetUsd = null; }, v => { v.blockers = ["RETAIL_PLAYOUT_OUTPUT_NOT_PERMITTED"]; }, v => { v.enabled = true; }]) {
    const v = readiness(true); mutate(v); assert.throws(() => ui.safeRetailPlayoutView(v, ORG), /could not be verified/);
  }
});
test("music request and explicit start approval contain no runtime or tenant authority", () => {
  assert.deepEqual(ui.retailMusicRequest({ territory: " mt ", genreCodes: ["pop"], stationId: "other" }), { action: "prepare", territory: "MT", genreCodes: ["pop"] });
  for (const input of [{ territory: "", genreCodes: [] }, { territory: "Malta", genreCodes: [] }, { territory: "MT", genreCodes: ["pop", "pop"] }, { territory: "MT", genreCodes: ["<script>"] }]) assert.throws(() => ui.retailMusicRequest(input));
  assert.deepEqual(ui.retailStartRequest(readiness(true), true), { action: "start", monthlyBudgetUsd: 15, publicExposureAccepted: true });
  assert.throws(() => ui.retailStartRequest(readiness(true), false)); assert.throws(() => ui.retailStartRequest(readiness(), true));
});
test("saved plans and old reports do not masquerade as live audio", () => {
  const v = readiness(true); v.enabled = true; v.canStart = false;
  assert.match(ui.retailSourceSummary(v).label, /waiting for fresh audio evidence/);
  v.observation = { state: "STREAMING", fresh: true, observedAt: "2026-10-24T12:00:00.000Z", phase: "RANDOM", track: { id: "track-one", artist: "Artist", title: "Song" } };
  assert.equal(ui.retailSourceSummary(v, new Date("2026-10-24T12:00:10Z")).label, "Source sending audio");
  assert.equal(ui.retailSourceSummary(v, new Date("2026-10-24T12:00:16Z")).fresh, false);
  assert.equal(ui.retailSourceSummary(v, new Date("2026-10-24T11:59:59Z")).fresh, false);
  assert.doesNotMatch(ui.retailPlayoutNotice(SECRET), /PRIVATE_SECRET/);
});

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const { renderToStaticMarkup } = require("react-dom/server"), h = React.createElement;
const file = "app/admin/organisations/[organisationId]/retail-stream/RetailStreamPlayoutPanel.js";
const compiled = babel.transformSync(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
  filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
}).code;
function load({ hooks = React, fetch = () => { throw new Error("Unexpected network action"); } } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, Date,
    require: name => {
      if (name === "react") return hooks;
      if (name === "@/lib/retail-stream-playout-ui.mjs") return ui;
      if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    }
  });
  return module.exports.default;
}
function hooksFor(value) {
  let cursor = 0;
  const effects = [];
  const slots = [value, false, null, value?.prepared?.territory || "", value?.prepared?.genreCodes || [], false, false, new Date(), false];
  const hooks = { ...React, useEffect(fn, dependencies) { effects.push({ fn, dependencies }); }, useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; }, useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; } };
  return { slots, hooks, effects, reset: () => { cursor = 0; effects.length = 0; } };
}
const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
function fixture(value, fetch) {
  const state = hooksFor(value), Panel = load({ hooks: state.hooks, fetch });
  const render = (props = {}) => { state.reset(); return Panel({ organisationId: ORG, ...props }); };
  return { ...state, render, html: () => renderToStaticMarkup(render()), button: text => nodes(render()).find(node => node.type === "button" && node.props.children === text) };
}

test("actual panel shows saved connection, missing hosting and plan limitations without pretending to be live", () => {
  const state = fixture(readiness()), html = state.html();
  assert.match(html, /Centova details saved/); assert.match(html, /Music selection saved/); assert.match(html, /current plan does not permit audio output/);
  assert.match(html, /No approved hosting capacity/); assert.match(html, /Retail audio not enabled/);
  assert.equal(state.button("Start this Retail stream").props.disabled, true);
  assert.doesNotMatch(html, /type="password"|<audio|autoplay|PRIVATE_SECRET/);
});
test("rendering the owner panel sends no mutation and start stays disabled until separately acknowledged", async () => {
  let calls = 0; const state = fixture(readiness(true), async () => { calls++; throw new Error("Unexpected request"); });
  state.render(); assert.equal(calls, 0); assert.equal(state.button("Start this Retail stream").props.disabled, true);
  state.slots[5] = true; assert.equal(state.button("Start this Retail stream").props.disabled, false);
  state.slots[4] = ["pop"]; assert.equal(state.button("Start this Retail stream").props.disabled, true);
  assert.match(state.html(), /Save the changed music selection/);
});
test("save music calls only prepare and never chains a start", async () => {
  const calls = [], state = fixture(readiness(), async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ action: "prepare", accepted: true, readiness: readiness() }) }; });
  await nodes(state.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  // The form starts a promise intentionally; wait for the response handling.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(calls[0].url, `/api/admin/organisations/${ORG}/retail-playout`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: "prepare", territory: "MT", genreCodes: [] });
  assert.equal(state.slots[5], false); assert.match(state.slots[2].text, /has not been started/);
});
test("explicit start sends only the reviewed allowance and exposure consent, never credentials", async () => {
  const calls = [], running = { ...readiness(true), enabled: true, canStart: false };
  const state = fixture(readiness(true), async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ action: "start", accepted: true, readiness: running, grantId: SECRET }) }; });
  state.slots[5] = true; await state.button("Start this Retail stream").props.onClick();
  assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(calls[0].options.body), { action: "start", monthlyBudgetUsd: 15, publicExposureAccepted: true });
  assert.equal(state.slots[0].enabled, true); assert.doesNotMatch(JSON.stringify(state.slots.slice(0, 8)), /PRIVATE_SECRET/);
  assert.match(state.html(), /waiting for fresh audio evidence/);
});
test("uncertain start is not retried and all changes wait for a successful read refresh", async () => {
  let calls = 0;
  const state = fixture(readiness(true), async () => { calls++; throw new Error(SECRET); });
  state.slots[5] = true; await state.button("Start this Retail stream").props.onClick();
  assert.equal(calls, 1); assert.equal(state.slots[6], true); assert.equal(state.button("Start this Retail stream").props.disabled, true);
  assert.doesNotMatch(state.slots[2].text, /PRIVATE_SECRET/); assert.match(state.slots[2].text, /may already have completed/);
  await state.button("Start this Retail stream").props.onClick(); assert.equal(calls, 1);
});
test("error payload and foreign readiness never enter rendered state", async () => {
  for (const response of [{ ok: false, json: async () => ({ error: SECRET, code: "UNKNOWN" }) }, { ok: true, json: async () => ({ readiness: { ...readiness(), organisation: { id: "foreign", name: SECRET } } }) }]) {
    const state = fixture(readiness(), async () => response);
    await state.button("Refresh streaming status").props.onClick();
    assert.equal(state.slots[6], true); assert.equal(state.slots[0].organisation.id, ORG); assert.doesNotMatch(state.html(), /PRIVATE_SECRET/);
  }
});
test("stop remains usable after an uncertain start and a receipt never claims audio stopped", async () => {
  const calls = [], state = fixture(readiness(true), async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ action: "stop", accepted: true, status: "STOP_REQUESTED", readiness: null }) };
  });
  state.slots[6] = true;
  assert.equal(state.button("Stop this Retail stream").props.disabled, true);
  state.slots[8] = true;
  assert.equal(state.button("Stop this Retail stream").props.disabled, false);
  await state.button("Stop this Retail stream").props.onClick();
  assert.deepEqual(calls, [{ action: "stop" }]);
  assert.match(state.slots[2].text, /disconnection is not yet confirmed/);
  assert.equal(state.slots[6], true);
  assert.equal(state.slots[8], false);
});
test("Stop remains reachable after initial readiness fails, requires confirmation and sends only the scoped stop action", async () => {
  const calls = [], state = fixture(null, async (url, options) => {
    calls.push({ url, options });
    return options.method === "GET"
      ? { ok: false, json: async () => ({ code: "RETAIL_PLAYOUT_SERVICE_INACTIVE", error: SECRET }) }
      : { ok: true, json: async () => ({ action: "stop", accepted: true, status: "STOP_REQUESTED", readiness: null }) };
  });
  assert.equal(state.button("Stop this Retail stream").props.disabled, true);
  await state.button("Refresh streaming status").props.onClick();
  assert.equal(state.slots[0], null); assert.equal(state.slots[6], true);
  assert.match(state.html(), /I confirm stopping only this Retail stream/);
  assert.equal(state.button("Start this Retail stream"), undefined);
  await state.button("Stop this Retail stream").props.onClick(); assert.equal(calls.length, 1);
  const confirmation = nodes(state.render()).find(node => node.type === "input" && node.props.type === "checkbox");
  confirmation.props.onChange({ target: { checked: true } });
  assert.equal(state.button("Stop this Retail stream").props.disabled, false);
  await state.button("Stop this Retail stream").props.onClick();
  assert.equal(calls.length, 2); assert.equal(calls[1].url, `/api/admin/organisations/${ORG}/retail-playout`);
  assert.equal(calls[1].options.method, "POST"); assert.deepEqual(JSON.parse(calls[1].options.body), { action: "stop" });
  assert.match(state.slots[2].text, /Stop request accepted/); assert.match(state.slots[2].text, /disconnection is not yet confirmed/);
  assert.doesNotMatch(state.html(), /PRIVATE_SECRET|audio stopped/);
  assert.equal(state.button("Stop this Retail stream").props.disabled, true);
});

test("pilot access approval refreshes only readiness and preserves an unsaved music selection", async () => {
  const calls = [], state = fixture(readiness(), async (url, options) => { calls.push({ url, options });
    return { ok: true, json: async () => ({ readiness: readiness(true) }) }; });
  state.slots[3] = "GB"; state.slots[4] = ["dance"]; state.slots[5] = true;
  state.render({ accessRevision: 1 }); state.effects.find(effect => effect.dependencies?.length === 1 && effect.dependencies[0] === 1).fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, "GET"); assert.equal(calls[0].options.body, undefined);
  assert.equal(state.slots[3], "GB"); assert.deepEqual(state.slots[4], ["dance"]); assert.equal(state.slots[5], false);
  assert.equal(state.button("Start this Retail stream").props.disabled, true);
});
