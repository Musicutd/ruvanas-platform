import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as ui from "../lib/test-radio-now-next-ui.mjs";
import * as weekly from "../lib/test-radio-weekly-planner-ui.mjs";

const snapshot = () => ({ stationId: weekly.TEST_RADIO_PLANNER_STATION_ID, checkedAt: "2026-10-24T07:59:50Z", timezone: "Europe/Malta",
  source: { confirmed: true, phase: "RANDOM", label: "Random AutoDJ", track: { title: "Example Song", artist: "Example Artist", secret: "DO_NOT_LEAK" }, observedAt: "2026-10-24T07:59:49Z", expiresInMs: 9000 },
  plan: { enabled: true, next: { kind: "PROGRAMME", label: "Saturday Dance & Pop Mix", startsAt: "2026-10-24T08:00:00Z", endsAt: "2026-10-24T09:00:00Z" } }, warnings: [] });
test("source expiration and failed reads never keep stale titles or imply AutoDJ stopped", () => {
  const s = snapshot(); assert.equal(ui.testRadioNowNextView(s).track.title, "Example Song");
  assert.equal(ui.testRadioNowNextView(s, 9000).track, null);
  assert.equal(ui.testRadioNowNextView({ ...s, requestAgeMs: 2000 }, 7000).confirmed, false);
  for (const view of [ui.testRadioNowNextView(s, 0, true), ui.testRadioNowNextView(null), ui.testRadioNowNextView({ ...s, stationId: "foreign" }), ui.testRadioNowNextView(s, NaN)]) {
    assert.equal(view.confirmed, false); assert.equal(view.track, null); assert.doesNotMatch(view.label, /stopped|disabled/i);
  }
  assert.doesNotMatch(JSON.stringify(ui.testRadioNowNextView(s)), /DO_NOT_LEAK/);
});
test("a passed planned handover is hidden and never promoted to actual source audio", () => {
  const s = snapshot(), view = ui.testRadioNowNextView(s, 10_000);
  assert.equal(view.next, null); assert.equal(view.confirmed, false); assert.match(view.planMessage, /handover may have occurred/);
  assert.match(ui.testRadioNowNextView({ ...s, plan: { enabled: true, next: null } }).planMessage, /next two calendar days/);
  assert.match(ui.testRadioNowNextView({ ...s, plan: { enabled: false, next: null } }).planMessage, /Draft programmes are not on air/);
});

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
async function component({ hooks = React, fetch = () => { throw new Error("Unexpected network call"); } } = {}) {
  const file = "app/dashboard/programming/TestRadioNowNext.js", source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code, module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, performance,
    require: name => name === "react" ? hooks : name === "@/lib/test-radio-weekly-planner-ui.mjs" ? weekly : name === "@/lib/test-radio-now-next-ui.mjs" ? ui : name.endsWith(".module.css")
      ? { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } : require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name) });
  return module.exports;
}
test("Now & Next presents evidence boundaries and has no player, owner controls or automatic fetching", async () => {
  const m = await component(), { renderToStaticMarkup } = require("react-dom/server");
  const html = renderToStaticMarkup(React.createElement(m.TestRadioNowNextCards, { view: ui.testRadioNowNextView(snapshot()) }));
  assert.match(html, /Now · source report/); assert.match(html, /Next · approved plan/); assert.match(html, /10:00:00/);
  assert.match(html, /not a confirmed handover/); assert.match(html, /not proof that a listener heard/);
  assert.doesNotMatch(html, /<audio|autoplay|Approve|Stop stream|sourcePassword|DO_NOT_LEAK/);
  assert.equal(renderToStaticMarkup(React.createElement(m.default, { stationId: "foreign", snapshot: snapshot() })), "");
});
test("manual refresh uses GET only, handles failure and never replaces or saves the planner draft", async () => {
  const slots = []; let cursor = 0;
  const hooks = { ...React, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; }, useEffect() {} };
  let fail = false; const calls = [];
  const m = await component({ hooks, fetch: async (url, options) => { calls.push({ url, options }); if (fail) throw new Error("offline"); return { ok: true, json: async () => ({ stationId: snapshot().stationId, nowNext: snapshot(), draft: { shouldNotBeApplied: true } }) }; } });
  const render = () => { cursor = 0; return m.default({ stationId: snapshot().stationId, snapshot: snapshot() }); };
  const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
  await nodes(render()).find(node => node.type === "button").props.onClick();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/programming/test-radio/schedule"); assert.equal(calls[0].options.method, undefined); assert.equal(calls[0].options.body, undefined);
  assert.equal(Object.hasOwn(slots[0], "draft"), false);
  fail = true; await nodes(render()).find(node => node.type === "button").props.onClick();
  assert.equal(slots[0], null); assert.match(slots[3], /unsaved draft is unchanged/);
});
