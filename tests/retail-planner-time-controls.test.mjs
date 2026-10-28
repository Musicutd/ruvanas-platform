import test from "node:test";
import assert from "node:assert/strict";
import * as ui from "../lib/retail-weekly-planner-ui.mjs";
import * as desk from "../lib/retail-playlist-desk-ui.mjs";
import * as warnings from "../lib/test-radio-planner-warnings.mjs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const require = createRequire(import.meta.url), React = require("react");
const babel = require("next/dist/compiled/babel/core"), { renderToStaticMarkup } = require("react-dom/server");
const channelId = "c000000000000000000000001", sourceId = "c000000000000000000000002";
function harness() {
  const slots = []; let cursor = 0, effects = [];
  return { hooks: { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: fn => fn, useEffect: fn => effects.push(fn) },
    render(Component, props) { cursor = 0; effects = []; return Component(props); },
    async load() { effects[0]?.(); await new Promise(setImmediate); }
  };
}
function nodes(tree) { return tree && typeof tree === "object" ? [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)] : []; }
async function component(hooks, fetch) {
  const filename = "app/dashboard/programming/RetailWeeklyPlanner.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true }, require: name => {
      if (name === "react") return hooks;
      if (name === "@/lib/retail-weekly-planner-ui.mjs") return ui;
      if (name === "@/lib/retail-playlist-desk-ui.mjs") return desk;
      if (name === "@/lib/test-radio-planner-warnings.mjs") return warnings;
      if (name === "./RetailPlaylistDesk") return { __esModule: true, default: function PlaylistDesk() { return null; } };
      if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    }
  });
  return module.exports;
}

test("half-hour choices cover the whole day and preserve precise existing times", () => {
  const times = ui.retailHalfHourChoices();
  assert.equal(times.length, 48);
  assert.equal(times[0].value, "00:00");
  assert.equal(times.at(-1).value, "23:30");
  assert.deepEqual(times.slice(2, 5).map(time => time.value), ["01:00", "01:30", "02:00"]);
  const precise = ui.retailHalfHourChoices("09:17");
  assert.equal(precise.length, 49);
  assert.deepEqual(precise.slice(18, 21).map(time => time.value), ["09:00", "09:17", "09:30"]);
  assert.match(precise.find(time => time.value === "09:17").label, /current time/);
  assert.equal(ui.retailHalfHourChoices("09:30").length, 48);
  assert.equal(ui.retailHalfHourChoices("25:00").length, 48);
});

test("end-time selection supports same-day, overnight and full-day programmes", () => {
  assert.equal(ui.retailDurationToEnd("09:00", "09:30"), 30);
  assert.equal(ui.retailDurationToEnd("23:30", "01:00"), 90);
  assert.equal(ui.retailDurationToEnd("12:00", "12:00"), 1440);
  assert.equal(ui.retailDurationToEnd("09:17", "09:30"), 13);
  assert.throws(() => ui.retailDurationToEnd("9:00", "09:30"), /valid start/);
  assert.throws(() => ui.retailDurationToEnd("09:00", "24:00"), /valid start/);
});

test("programme end display preserves minute precision and marks the next day", () => {
  assert.deepEqual(ui.retailProgrammeTimes({ recurrence: "WEEKLY", startTime: "23:45", durationMinutes: 47 }),
    { startTime: "23:45", endTime: "00:32", nextDay: true, durationMinutes: 47 });
  assert.deepEqual(ui.retailProgrammeTimes({ recurrence: "ONE_OFF", startsAt: "2026-10-28T09:17", durationMinutes: 13 }),
    { startTime: "09:17", endTime: "09:30", nextDay: false, durationMinutes: 13 });
  assert.equal(ui.retailProgrammeTimes({ recurrence: "WEEKLY", startTime: "00:00", durationMinutes: 1440 }).nextDay, true);
  assert.equal(ui.retailProgrammeTimes({ startTime: "09:00", durationMinutes: "" }).durationMinutes, null);
  assert.equal(ui.retailProgrammeTimes({ startTime: "09:00", durationMinutes: 1441 }).endTime, "");
});

test("separate one-off date and time controls retain each other without timezone conversion", () => {
  const item = { startsAt: "2026-10-28T09:17" };
  assert.equal(ui.retailOneOffDateTime(item, { date: "2026-10-29" }), "2026-10-29T09:17");
  assert.equal(ui.retailOneOffDateTime(item, { time: "13:30" }), "2026-10-28T13:30");
  assert.equal(ui.retailOneOffDateTime({}, { date: "2026-10-29" }), "2026-10-29T09:00");
  assert.equal(ui.retailOneOffDateTime({}, { time: "13:30" }), "T13:30");
  assert.equal(ui.retailOneOffDateTime({ startsAt: "T13:30" }, { date: "2026-10-29" }), "2026-10-29T13:30");
  assert.equal(ui.retailOneOffDateTime(item, { date: "" }), "");
});

test("split one-off controls preserve a saved repeated-hour instant; changed ambiguous times are rejected", () => {
  const form = ui.retailWeeklyForm({ stationId: ui.RETAIL_PLANNER_STATION_ID,
    schedule: { channelId: "c000000000000000000000001", name: "Retail week", timezone: "Europe/Malta" },
    draft: { items: [{ label: "Morning", sourceId: "c000000000000000000000002", recurrence: "ONE_OFF", startsAt: "2026-10-25T01:30:15.000Z", durationMinutes: 30, priority: 50 }] } });
  form.items[0].startsAt = ui.retailOneOffDateTime(form.items[0], { time: "02:30" });
  assert.equal(ui.retailWeeklySaveBody(form).items[0].startsAt, "2026-10-25T01:30:15.000Z");
  form.items[0].startsAt = ui.retailOneOffDateTime(form.items[0], { time: "02:00" });
  assert.throws(() => ui.retailWeeklySaveBody(form), /repeats/);
});

test("genre summary uses source genres only, respecting named genres and playlist sequence", () => {
  assert.equal(ui.retailPlaylistGenreSummary({ genreCodes: ["POP", "R_N_B", "POP"] }, [{ code: "R_N_B", name: "R&B" }]), "Pop · R&B · Pop");
  assert.match(ui.retailPlaylistGenreSummary({ name: "Rock" }), /details will appear/);
});

test("time selectors have a labelled native scroll menu with the precise saved time selected", async () => {
  const module = await component(React, () => { throw new Error("No network expected"); });
  const markup = renderToStaticMarkup(React.createElement(module.RetailTimeSelect, { label: "Start time", value: "09:17", onChange() {} }));
  assert.match(markup, /<label>Start time<select required=""/);
  assert.equal((markup.match(/<option /g) || []).length, 49);
  assert.match(markup, /<option value="09:17" selected="">09:17 · current time/);
});

test("switching playlist/schedule views preserves unsaved times and saving stays draft-only", async () => {
  const h = harness(), calls = [], state = { stationId: ui.RETAIL_PLANNER_STATION_ID, canEdit: true,
    channels: [{ id: channelId, name: "Shared shops" }], sources: [{ id: sourceId, name: "Pop & Dance", genreCodes: ["POP", "DANCE"] }],
    schedule: { channelId, name: "Retail week", timezone: "Europe/Malta" }, warnings: [],
    draft: { id: "version1", version: 1, items: [{ label: "Morning music", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId, weekday: 1, startTime: "09:00", durationMinutes: 30, priority: 50 }] } };
  const module = await component(h.hooks, async (url, options = {}) => { calls.push({ url, body: options.body && JSON.parse(options.body) }); return { ok: true, json: async () => ({ ...state, savedVersionId: "version1" }) }; });
  const props = { stationId: ui.RETAIL_PLANNER_STATION_ID, view: "schedule" };
  h.render(module.default, props); await h.load();
  let tree = h.render(module.default, props);
  const select = (current, label) => nodes(current).find(node => node.type === module.RetailTimeSelect && node.props.label === label);
  select(tree, "End time").props.onChange("10:30");
  tree = h.render(module.default, props);
  select(tree, "Start time").props.onChange("23:30");
  tree = h.render(module.default, { ...props, view: "playlists" });
  assert.equal(nodes(tree).find(node => node.props.id === "workspace-planner").props.hidden, true);
  assert.equal(nodes(tree).find(node => node.props.id === "workspace-simple").props.hidden, false);
  tree = h.render(module.default, props);
  assert.equal(select(tree, "Start time").props.value, "23:30");
  assert.equal(select(tree, "End time").props.value, "01:00");
  assert.equal(nodes(tree).find(node => node.props.id === "workspace-simple").props.hidden, true);
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.action, "save");
  assert.equal(calls[1].body.items[0].startTime, "23:30");
  assert.equal(calls[1].body.items[0].durationMinutes, 90);
  assert.equal(calls[1].body.baseVersionId, "version1");
  assert.doesNotMatch(JSON.stringify(calls), /\/admin|\bapprove\b|\bpublish\b/);
});
