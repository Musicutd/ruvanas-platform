import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as weekly from "../lib/retail-weekly-planner-ui.mjs";
import * as desk from "../lib/retail-playlist-desk-ui.mjs";
import * as onlineUi from "../lib/online-radio-workspace.mjs";
import * as plannerWarnings from "../lib/test-radio-planner-warnings.mjs";

const require = createRequire(import.meta.url), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"), babel = require("next/dist/compiled/babel/core");
const stationId = weekly.RETAIL_PLANNER_STATION_ID, channelId = "c000000000000000000000001", sourceId = "c000000000000000000000002";
const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
const recipe = { sourceId, playlistId: "playlist", name: "Shop morning mix", version: 1, buildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"], durationMinutes: 30, eligibleTrackCount: 2, readyForSchedule: true };
const library = () => ({ stationId, recipes: [recipe], genres: [{ code: "POP", name: "Pop", eligibleTrackCount: 2 }], warnings: [] });
const workspace = (prepared = false) => ({ stationId, draftOnly: true, canPrepare: !prepared, channelId: prepared ? channelId : null, channels: prepared ? [{ id: channelId, name: "Shared Retail programme", status: "DRAFT" }] : [], ...(prepared ? { preparedChannelId: channelId } : {}) });
const state = () => ({ stationId, canEdit: true, canApprove: false, channels: [{ id: channelId, name: "Shared Retail programme" }], sources: [{ id: sourceId, name: recipe.name }],
  schedule: { id: "plan", channelId, name: "Retail weekly plan", timezone: "Europe/Malta" }, approved: null, warnings: [],
  draft: { id: "version3", version: 3, readyToApprove: false, reviewHash: "a".repeat(64), items: [{ label: "Morning music", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId, weekday: 1, startTime: "09:00", startsAt: null, durationMinutes: 30, priority: 50 }],
    preview: { timezone: "Europe/Malta", startsAt: "2026-10-26T00:00:00Z", endsAt: "2026-11-02T00:00:00Z", days: 7,
      occurrences: [{ label: "Morning music", sourceId, startsAt: "2026-10-26T08:00:00Z", endsAt: "2026-10-26T08:30:00Z", priority: 50 }], warnings: [] } } });

async function component(file, { hooks = React, fetch = () => { throw new Error("Unexpected fetch"); } } = {}) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, crypto: webcrypto, URLSearchParams,
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true }, require: name => {
      if (name === "react") return hooks;
      if (name === "@/lib/retail-weekly-planner-ui.mjs") return weekly;
      if (name === "@/lib/retail-playlist-desk-ui.mjs") return desk;
      if (name === "@/lib/online-radio-workspace.mjs") return onlineUi;
      if (name === "@/lib/test-radio-planner-warnings.mjs") return plannerWarnings;
      if (name === "./RetailWeeklyPlanner") return { __esModule: true, default: props => React.createElement("div", { "data-retail-planner": props.stationId }, "Draft weekly planner") };
      if (name === "./RetailPlaylistDesk") return { __esModule: true, default: () => React.createElement("div", null, "Playlist desk") };
      if (name === "./RetailCommercialDesk") return { __esModule: true, default: () => React.createElement("div", null, "Commercial draft desk") };
      if (name === "next/link") return { __esModule: true, default: props => React.createElement("a", props) };
      if (name.endsWith(".module.css")) return css;
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
  return { ...module.exports, source };
}
function harness() {
  const slots = []; let cursor = 0, effects = [];
  return { slots, hooks: { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => { effects.push(fn); } },
    render(Component, props) { cursor = 0; effects = []; return Component(props); },
    async load() { effects[0]?.(); await new Promise(setImmediate); }
  };
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
function label(tree) { if (typeof tree === "string" || typeof tree === "number") return String(tree); return React.Children.toArray(tree?.props?.children).map(label).join(""); }
const button = (tree, text) => nodes(tree).find(node => node.type === "button" && label(node).includes(text));

test("Retail library strips private fields, escapes catalogue text and keeps durations in seconds", async () => {
  const module = await component("app/dashboard/programming/RetailSubscriberWorkspace.js");
  const body = { stationId, metadataOnly: true, territory: "MT", total: 1, offset: 0, limit: 50, genres: [{ code: "POP", name: "Pop" }], warnings: [], tracks: [{ id: "track", title: "<script>unsafe</script>", artist: "Artist", durationSeconds: 179, genreCodes: ["POP"], storageKey: "private/key", playbackUrl: "https://private.invalid/audio" }] };
  const safe = module.retailCatalogueMetadata(body);
  assert.doesNotMatch(JSON.stringify(safe), /private\/key|private.invalid/);
  const markup = renderToStaticMarkup(React.createElement(module.RetailSubscriberCatalogueResults, { catalogue: safe }));
  assert.match(markup, /2:59/); assert.match(markup, /&lt;script/); assert.doesNotMatch(markup, /<script|<audio|href=|autoplay/i);
  assert.equal(module.retailCataloguePath({ query: " summer & sun ", genre: "POP", offset: 50 }), "/api/programming/test-retail/catalogue?limit=50&offset=50&q=summer+%26+sun&genre=POP");
  assert.throws(() => module.retailCatalogueMetadata({ ...body, stationId: "cmvcnbwi20008hr23sd76psi8" }));
  assert.equal(renderToStaticMarkup(React.createElement(module.default, { stationId: "other" })), "");
});

test("opening Retail planning performs only a read; preparation is an explicit idempotent draft action", async () => {
  const h = harness(), calls = []; let attempts = 0;
  const module = await component("app/dashboard/programming/RetailSubscriberWorkspace.js", { hooks: h.hooks, fetch: async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, body });
    if (body && ++attempts === 1) throw Object.assign(new Error("synthetic timeout"), { name: "AbortError" });
    return { ok: true, json: async () => workspace(Boolean(body)) };
  } });
  h.render(module.RetailPlanningWorkspace, { stationId }); await h.load();
  assert.equal(calls.length, 1); assert.equal(calls[0].body, undefined);
  let tree = h.render(module.RetailPlanningWorkspace, { stationId });
  await button(tree, "Prepare my planner").props.onClick();
  tree = h.render(module.RetailPlanningWorkspace, { stationId }); await button(tree, "Prepare my planner").props.onClick();
  assert.deepEqual(calls[1].body, calls[2].body); assert.equal(calls[1].body.action, "prepare");
  assert.match(calls[1].body.requestId, /^[a-f0-9-]{36}$/);
  assert.ok(calls.every(call => call.url === "/api/programming/test-retail/workspace"));
  assert.doesNotMatch(JSON.stringify(calls), /\/admin|START|streaming|sourcePassword|approve|publish/);
  tree = h.render(module.RetailPlanningWorkspace, { stationId }); assert.equal(tree.props.stationId, stationId);
  assert.throws(() => module.retailPlanningWorkspace({ ...workspace(true), stationId: "other" }));
});

test("subscriber weekly planner only saves drafts even if a response claims approval capability", async () => {
  const h = harness(), calls = [], current = state(); current.canApprove = true;
  const module = await component("app/dashboard/programming/RetailWeeklyPlanner.js", { hooks: h.hooks, fetch: async (url, options = {}) => {
    calls.push({ url, body: options.body && JSON.parse(options.body) }); return { ok: true, json: async () => ({ ...current, savedVersionId: current.draft.id }) };
  } });
  h.render(module.default, { stationId }); await h.load(); let tree = h.render(module.default, { stationId });
  assert.equal(button(tree, "Approve version"), undefined); assert.equal(button(tree, "Disable scheduled"), undefined);
  assert.match(label(tree), /Live schedule status is managed separately/);
  button(tree, "Review saved week").props.onClick(); tree = h.render(module.default, { stationId });
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(calls[1].url, "/api/programming/test-retail/schedule"); assert.equal(calls[1].body.action, "save");
  assert.equal(calls[1].body.baseVersionId, "version3"); assert.match(calls[1].body.requestId, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(calls), /\/admin\/|disable|approve|publish|sourcePassword|START/);
  const review = renderToStaticMarkup(React.createElement(module.RetailWeeklyReview, { state: state() }));
  assert.match(review, /09:00–09:30/); assert.match(review, /not proof of live audio/);
  assert.equal(renderToStaticMarkup(React.createElement(module.default, { stationId: "other" })), "");
});

test("uncertain weekly saves reuse their request and base version", async () => {
  const h = harness(), calls = []; let attempts = 0;
  const module = await component("app/dashboard/programming/RetailWeeklyPlanner.js", { hooks: h.hooks, fetch: async (_url, options = {}) => {
    if (options.body) { calls.push(JSON.parse(options.body)); if (++attempts === 1) throw Object.assign(new Error("Timeout"), { name: "AbortError" }); }
    return { ok: true, json: async () => ({ ...state(), savedVersionId: "version3" }) };
  } });
  h.render(module.default, { stationId }); await h.load();
  for (let attempt = 0; attempt < 2; attempt++) await nodes(h.render(module.default, { stationId })).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].baseVersionId, "version3");
});

test("playlist generation and saving use only Retail draft endpoints", async () => {
  const h = harness(), calls = [];
  const module = await component("app/dashboard/programming/RetailPlaylistDesk.js", { hooks: h.hooks, fetch: async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, body });
    return { ok: true, json: async () => body?.action === "preview" ? { stationId, preview: { items: [], requestedDurationSeconds: 1800, totalDurationSeconds: 0, liveOrderFixed: false, warnings: [], truncated: true } } : { ...library(), savedSourceId: sourceId } };
  } });
  h.render(module.default, { stationId }); await h.load(); h.slots[1] = desk.deskRecipeForm(recipe);
  await button(h.render(module.default, { stationId }), "Generate Playlist").props.onClick();
  await button(h.render(module.default, { stationId }), "Save as new playlist").props.onClick();
  assert.deepEqual(calls.map(call => call.url), Array(3).fill("/api/programming/test-retail/library"));
  assert.deepEqual(calls.slice(1).map(call => call.body.action), ["preview", "save"]);
  assert.throws(() => desk.deskLibrary({ ...library(), stationId: "cmvcnbwi20008hr23sd76psi8" }));
});

test("Retail weekly times preserve saved DST instants and reject ambiguous new times", () => {
  const current = state(); current.draft.items[0] = { ...current.draft.items[0], recurrence: "ONE_OFF", weekday: null, startTime: null, startsAt: "2026-10-25T01:30:15.000Z" };
  const form = weekly.retailWeeklyForm(current); assert.equal(form.items[0].startsAt, "2026-10-25T02:30");
  assert.equal(weekly.retailWeeklySaveBody(form).items[0].startsAt, "2026-10-25T01:30:15.000Z");
  form.items[0].startsAt = "2026-10-25T02:45"; assert.throws(() => weekly.retailWeeklySaveBody(form), /repeats/);
  assert.equal(weekly.retailWeeklyForm({ ...current, stationId: "other" }).channelId, "");
});

test("exact Retail planning home has library, playlists and week entry points instead of shop prerequisites", async () => {
  const module = await component("app/dashboard/retail/RetailPlanningHome.js");
  const markup = renderToStaticMarkup(React.createElement(module.default, { stationName: "Test Retail" }));
  for (const anchor of ["workspace-library", "workspace-simple", "workspace-planner"]) assert.match(markup, new RegExp(`/dashboard/programming\\?product=RETAIL#${anchor}`));
  assert.match(markup, /One music plan for all your shops/); assert.match(markup, /administrator/);
  assert.doesNotMatch(markup, /first shop ready|Listen live|Set up AutoDJ|<audio|\/admin\//);
});
