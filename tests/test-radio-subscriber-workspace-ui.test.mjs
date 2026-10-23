import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as weekly from "../lib/test-radio-weekly-planner-ui.mjs";
import * as desk from "../lib/test-radio-playlist-desk-ui.mjs";
import * as onlineUi from "../lib/online-radio-workspace.mjs";

const require = createRequire(import.meta.url), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"), babel = require("next/dist/compiled/babel/core");
const stationId = weekly.TEST_RADIO_PLANNER_STATION_ID, channelId = "c000000000000000000000001", sourceId = "c000000000000000000000002";
const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
const recipe = { sourceId, playlistId: "playlist", name: "Pop afternoon", version: 1, buildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"], durationMinutes: 30, eligibleTrackCount: 2, readyForSchedule: true };
const library = () => ({ stationId, recipes: [recipe], genres: [{ code: "POP", name: "Pop", eligibleTrackCount: 2 }], warnings: [] });
const state = () => ({ stationId, canEdit: true, canApprove: false, channels: [{ id: channelId, name: "Test Radio" }], sources: [{ id: sourceId, name: recipe.name }],
  schedule: { id: "plan", channelId, name: "Test Radio weekly plan", timezone: "Europe/Malta" }, approved: { enabled: true, version: 2, timezone: "Europe/Malta" }, warnings: [],
  draft: { id: "version3", version: 3, readyToApprove: true, reviewHash: "a".repeat(64), items: [{ label: "Afternoon", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId, weekday: 1, startTime: "09:00", startsAt: null, durationMinutes: 30, priority: 50 }],
    preview: { timezone: "Europe/Malta", startsAt: "2026-10-26T00:00:00Z", endsAt: "2026-11-02T00:00:00Z", days: 7,
      occurrences: [{ label: "Afternoon", sourceId, startsAt: "2026-10-26T08:00:00Z", endsAt: "2026-10-26T08:30:00Z", priority: 50 }], warnings: [] } } });

async function component(file, { hooks = React, fetch = () => { throw new Error("Unexpected fetch"); } } = {}) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, crypto: webcrypto, URLSearchParams,
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true }, require: name => {
      if (name === "react") return hooks;
      if (name === "@/lib/test-radio-weekly-planner-ui.mjs") return weekly;
      if (name === "@/lib/test-radio-playlist-desk-ui.mjs") return desk;
      if (name === "@/lib/online-radio-workspace.mjs") return onlineUi;
      if (name === "@/app/admin/stations/[stationId]/setup/TestRadioWeeklyPlanner") return { __esModule: true, default: props => React.createElement("div", { "data-subscriber-planner": String(props.draftOnly), "data-station": props.stationId }, "Draft weekly planner") };
      if (name === "./TestRadioPlaylistDesk") return { __esModule: true, default: props => React.createElement("div", { "data-draft-only": String(props.draftOnly) }, "Playlist desk") };
      if (name.endsWith(".module.css")) return css;
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
  return { ...module.exports, source };
}
function harness() {
  const slots = []; let cursor = 0, effects = [];
  return { slots, hooks: { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => { effects.push(fn); } },
    render(Component, props) { cursor = 0; effects = []; return Component(props); },
    async load() { effects[0]?.(); await new Promise(setImmediate); }
  };
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
function label(tree) { if (typeof tree === "string" || typeof tree === "number") return String(tree); return React.Children.toArray(tree?.props?.children).map(label).join(""); }
const button = (tree, text) => nodes(tree).find(node => node.type === "button" && label(node).includes(text));

test("subscriber shell and saved review contain no owner on-air controls while admin defaults remain", async () => {
  const module = await component("app/admin/stations/[stationId]/setup/TestRadioWeeklyPlanner.js");
  const subscriber = renderToStaticMarkup(React.createElement(module.default, { stationId, draftOnly: true }));
  assert.match(subscriber, /SUBSCRIBER PLANNING/); assert.match(subscriber, /administrator review/);
  assert.match(subscriber, /id="workspace-simple"/); assert.match(subscriber, /id="workspace-planner"/);
  assert.match(subscriber, /data-draft-only="true"/);
  assert.doesNotMatch(subscriber, /OWNER CONTROL|Disable scheduled takeovers|Approve version|I approve exact|href="\/admin|<audio|autoplay/i);
  const review = renderToStaticMarkup(React.createElement(module.TestRadioWeeklyReview, { state: state(), draftOnly: true }));
  assert.match(review, /administrator must separately review and approve/); assert.match(review, /current stream unchanged/);
  const admin = renderToStaticMarkup(React.createElement(module.default, { stationId }));
  assert.match(admin, /OWNER CONTROL/); assert.match(admin, /Disable scheduled takeovers/);
  assert.equal(renderToStaticMarkup(React.createElement(module.default, { stationId: "other", draftOnly: true })), "");
});

test("draft-only or server-denied approval cannot construct an on-air approval payload", () => {
  const current = state(), input = { state: current, form: weekly.testRadioWeeklyForm(current), reviewHash: current.draft.reviewHash, reviewed: true, overridesAcknowledged: true };
  assert.equal(weekly.testRadioWeeklyApprovalBody(input), null);
  current.canApprove = true;
  assert.equal(weekly.testRadioWeeklyApprovalBody({ ...input, draftOnly: true }), null);
  assert.equal(weekly.testRadioWeeklyApprovalBody(input).action, "approve");
});

test("subscriber planner reads and saves only the scoped draft endpoint even when response advertises owner approval", async () => {
  const h = harness(), calls = [], current = state(); current.canApprove = true;
  const module = await component("app/admin/stations/[stationId]/setup/TestRadioWeeklyPlanner.js", { hooks: h.hooks, fetch: async (url, options = {}) => {
    calls.push({ url, body: options.body && JSON.parse(options.body) }); return { ok: true, json: async () => ({ ...current, savedVersionId: current.draft.id }) };
  } });
  let tree = h.render(module.default, { stationId, draftOnly: true }); await h.load(); tree = h.render(module.default, { stationId, draftOnly: true });
  assert.equal(calls[0].url, "/api/programming/test-radio/schedule");
  assert.equal(button(tree, "Approve version"), undefined); assert.equal(button(tree, "Disable scheduled"), undefined);
  button(tree, "Review saved week").props.onClick(); tree = h.render(module.default, { stationId, draftOnly: true });
  assert.equal(button(tree, "Approve version"), undefined); assert.equal(button(tree, "Disable scheduled"), undefined);
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 2); assert.equal(calls[1].url, "/api/programming/test-radio/schedule"); assert.equal(calls[1].body.action, "save");
  assert.equal(calls[1].body.baseVersionId, "version3"); assert.match(calls[1].body.requestId, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(calls), /\/admin\/|disable|approve|publish|credentials|sourcePassword/);
});

test("subscriber uncertain weekly saves reuse the nonce and base version until a confirmed response", async () => {
  const h = harness(), calls = []; let attempts = 0;
  const module = await component("app/admin/stations/[stationId]/setup/TestRadioWeeklyPlanner.js", { hooks: h.hooks, fetch: async (_url, options = {}) => {
    if (options.body) {
      calls.push(JSON.parse(options.body)); attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("Timeout"), { name: "AbortError" });
      if (attempts === 2) return { ok: true, json: async () => state() }; // Ambiguous success without saved-version evidence.
    }
    return { ok: true, json: async () => ({ ...state(), savedVersionId: "version3" }) };
  } });
  h.render(module.default, { stationId, draftOnly: true }); await h.load();
  for (let attempt = 0; attempt < 3; attempt++) {
    const tree = h.render(module.default, { stationId, draftOnly: true });
    await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  }
  assert.equal(calls.length, 3); assert.deepEqual(calls[0], calls[1]); assert.deepEqual(calls[1], calls[2]);
  assert.equal(calls[0].baseVersionId, "version3");
  let tree = h.render(module.default, { stationId, draftOnly: true });
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.notEqual(calls[3].requestId, calls[0].requestId, "A confirmed save ends the previous idempotent attempt");
});

const catalogueResponse = () => ({ stationId, metadataOnly: true, territory: "MT", limit: 50, offset: 0, total: 1, genres: [{ code: "POP", name: "Pop" }], warnings: [],
  tracks: [{ id: "track-1", title: '<img src=x onerror="alert(1)">', artist: "Artist", mix: "Clean", album: "Album", durationSeconds: 179, bpm: 122, genreCodes: ["POP"], source: "Licensed catalogue", storageKey: "private/key", playbackUrl: "https://private.invalid/audio" }] });

test("catalogue wrapper uses metadata-only scope, safe durations and escapes song text without audio links", async () => {
  const module = await component("app/dashboard/programming/TestRadioSubscriberWorkspace.js");
  const body = catalogueResponse(), safe = module.testRadioCatalogueMetadata(body);
  assert.equal(safe.tracks[0].storageKey, undefined); assert.equal(safe.tracks[0].playbackUrl, undefined);
  assert.doesNotMatch(JSON.stringify(safe), /private\/key|private.invalid/);
  const result = renderToStaticMarkup(React.createElement(module.TestRadioSubscriberCatalogueResults, { catalogue: safe }));
  assert.match(result, /2:59/); assert.match(result, /&lt;img/); assert.doesNotMatch(result, /<img|<audio|href=|autoplay/i);
  const shell = renderToStaticMarkup(React.createElement(module.default, { stationId }));
  for (const anchor of ["workspace-library", "workspace-simple", "workspace-planner"]) assert.match(shell, new RegExp(`href="#${anchor}"`));
  assert.match(shell, /data-subscriber-planner="true"/); assert.match(shell, /live AutoDJ service/); assert.match(shell, /administrator/);
  assert.doesNotMatch(shell, /broadcasting (?:is|remains) off|<audio|href="\/admin/i);
  assert.equal(renderToStaticMarkup(React.createElement(module.default, { stationId: "other" })), "");
  for (const mutate of [b => { b.stationId = "other"; }, b => { b.metadataOnly = false; }, b => { b.territory = "GB"; }, b => { b.tracks[0].durationSeconds = 0; }, b => { b.tracks = Array(51).fill(b.tracks[0]); }, b => { b.offset = -1; }]) {
    const invalid = catalogueResponse(); mutate(invalid); assert.throws(() => module.testRadioCatalogueMetadata(invalid));
  }
});

test("catalogue search and paging stay on subscriber endpoint and reject foreign-station responses", async () => {
  const h = harness(), calls = [];
  const module = await component("app/dashboard/programming/TestRadioSubscriberWorkspace.js", { hooks: h.hooks, fetch: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ ...catalogueResponse(), stationId: "other" }) };
  } });
  h.render(module.TestRadioSubscriberCatalogue, { stationId }); await h.load();
  const tree = h.render(module.TestRadioSubscriberCatalogue, { stationId });
  assert.equal(calls[0].url, "/api/programming/test-radio/catalogue?limit=50&offset=0");
  assert.equal(calls[0].options.cache, "no-store"); assert.equal(calls[0].options.credentials, "same-origin");
  assert.match(label(tree), /response could not be verified/);
  assert.doesNotMatch(label(tree), /Artist/);
  assert.equal(module.testRadioCataloguePath({ query: " summer & sun ", genre: "POP", offset: 50 }), "/api/programming/test-radio/catalogue?limit=50&offset=50&q=summer+%26+sun&genre=POP");
  const foreign = harness(), foreignModule = await component("app/dashboard/programming/TestRadioSubscriberWorkspace.js", { hooks: foreign.hooks, fetch: async () => { throw new Error("Foreign station must never fetch"); } });
  assert.equal(foreign.render(foreignModule.TestRadioSubscriberCatalogue, { stationId: "other" }), null); await foreign.load();
});

test("subscriber playlist desk reads, generates and saves through the scoped library only", async () => {
  const h = harness(), calls = [];
  const module = await component("app/admin/stations/[stationId]/setup/TestRadioPlaylistDesk.js", { hooks: h.hooks, fetch: async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, body });
    return { ok: true, json: async () => body?.action === "preview" ? { stationId, preview: { items: [], requestedDurationSeconds: 1800, totalDurationSeconds: 0, liveOrderFixed: false, warnings: [], truncated: true } } : { ...library(), savedSourceId: sourceId } };
  } });
  let tree = h.render(module.default, { stationId, draftOnly: true }); await h.load(); h.slots[1] = desk.deskRecipeForm(recipe);
  tree = h.render(module.default, { stationId, draftOnly: true }); await button(tree, "Generate Playlist").props.onClick();
  tree = h.render(module.default, { stationId, draftOnly: true }); await button(tree, "Save as new playlist").props.onClick();
  assert.deepEqual(calls.map(call => call.url), Array(3).fill("/api/programming/test-radio/library"));
  assert.deepEqual(calls.slice(1).map(call => call.body.action), ["preview", "save"]); assert.ok(calls[2].body.requestId);
  assert.doesNotMatch(JSON.stringify(calls), /\/admin\/|disable|approve|publish|credentials|sourcePassword/);
});
