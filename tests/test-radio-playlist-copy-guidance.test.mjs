import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as ui from "../lib/test-radio-playlist-desk-ui.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const stationId = ui.PLAYLIST_DESK_STATION_ID;
const recipe = { sourceId: "original", playlistId: "playlist", name: "Dance and Pop", buildMode: "RANDOM_GENRE_POOL",
  genreCodes: ["DANCE", "POP"], durationMinutes: 60, eligibleTrackCount: 12, readyForSchedule: true };
const library = (count = 1) => ({ stationId, recipes: Array.from({ length: count }, (_, index) => ({ ...recipe, sourceId: index ? `original-${index}` : recipe.sourceId })),
  genres: [{ code: "DANCE", name: "Dance", eligibleTrackCount: 6 }, { code: "POP", name: "Pop", eligibleTrackCount: 6 }], limits: { maximumRecipes: 20 }, warnings: [] });

async function load({ hooks = React, fetch = () => { throw new Error("Unexpected fetch"); } } = {}) {
  const filename = "app/admin/stations/[stationId]/setup/TestRadioPlaylistDesk.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true }, require: name => {
      if (name === "react") return hooks;
      if (name === "@/lib/test-radio-playlist-desk-ui.mjs") return ui;
      if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
  return module.exports;
}
function harness() {
  const slots = []; let cursor = 0, effects = [];
  return { slots, hooks: { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => { effects.push(fn); } },
    render(Component, props = {}) { cursor = 0; effects = []; return Component({ stationId, draftOnly: true, canAddToWeek: true, ...props }); },
    async load() { effects[0]?.(); await new Promise(setImmediate); }
  };
}
function nodes(tree) { return !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
function text(tree) { return typeof tree === "string" || typeof tree === "number" ? String(tree) : React.Children.toArray(tree?.props?.children).map(text).join(""); }
const button = (tree, name) => nodes(tree).find(node => node.type === "button" && text(node) === name);
const response = body => ({ ok: true, json: async () => body });

test("unchanged loaded recipes and formatting-only edits cannot create duplicate copies", async () => {
  const { playlistSaveGuidance } = await load();
  for (const change of [{}, { name: "  Dance and Pop  " }, { durationMinutes: "60" }, { genreCodes: ["POP", "DANCE"] }]) {
    const result = playlistSaveGuidance({ form: { ...ui.deskRecipeForm(recipe), ...change }, selected: recipe, library: library() });
    assert.equal(result.unchanged, true); assert.equal(result.canSave, false); assert.match(result.copyHint, /Already saved/);
  }
});

test("intentional copy edits stay new-recipe operations and genre-sequence order remains significant", async () => {
  const { playlistSaveGuidance } = await load();
  for (const change of [{ name: "Evening Dance and Pop" }, { durationMinutes: 30 }, { genreCodes: ["POP"] }, { buildMode: "GENRE_SEQUENCE" }]) {
    const form = { ...ui.deskRecipeForm(recipe), ...change }, before = JSON.stringify(recipe);
    const result = playlistSaveGuidance({ form, selected: recipe, library: library() });
    assert.equal(result.canSave, true); assert.equal(JSON.stringify(recipe), before); assert.match(result.copyHint, /separate copy/);
    const payload = ui.deskRecipeCommand(form, { action: "save", requestId: "c5e510a1-1d25-4b43-8ebc-dcfe0adcfed0" });
    assert.equal(payload.action, "save"); assert.equal(payload.sourceId, undefined); assert.equal(payload.playlistId, undefined);
  }
  const sequence = { ...recipe, buildMode: "GENRE_SEQUENCE" };
  assert.equal(playlistSaveGuidance({ form: { ...ui.deskRecipeForm(sequence), genreCodes: ["POP", "DANCE"] }, selected: sequence, library: library() }).canSave, true);
});

test("inline validation uses the existing command rules and enforces the known library allowance", async () => {
  const { playlistSaveGuidance } = await load();
  for (const change of [{ name: "" }, { durationMinutes: 181 }, { genreCodes: [] }, { genreCodes: ["MISSING"] }]) {
    const result = playlistSaveGuidance({ form: { ...ui.deskRecipeForm(recipe), ...change }, selected: null, library: library() });
    assert.equal(result.canSave, false); assert.ok(result.issues.length);
  }
  const input = { form: { ...ui.deskRecipeForm(recipe), name: "New copy" }, selected: recipe };
  assert.equal(playlistSaveGuidance({ ...input, library: null }).canSave, false);
  assert.equal(playlistSaveGuidance({ ...input, library: library(19) }).remaining, 1);
  assert.equal(playlistSaveGuidance({ ...input, library: library(20) }).canSave, false);
  assert.equal(playlistSaveGuidance({ ...input, library: library(21) }).remaining, 0);
  assert.equal(playlistSaveGuidance({ ...input, library: library(20), retryingSave: true }).canSave, true, "An uncertain original save must remain recoverable with the same request ID");
});

test("real desk disables unchanged loaded save and blocks its handler without a network write", async () => {
  const h = harness(), calls = [];
  const component = await load({ hooks: h.hooks, fetch: async (url, options = {}) => { calls.push({ url, ...options }); return response(library()); } });
  h.render(component.default); await h.load();
  let tree = h.render(component.default); button(tree, "Load playlist").props.onClick(); tree = h.render(component.default);
  const save = button(tree, "Save as new playlist"); assert.equal(save.props.disabled, true);
  assert.match(save.props["aria-describedby"], /desk-copy-guidance/); assert.match(text(tree), /19 of 20/);
  assert.equal(button(tree, "Add saved playlist to week ↓").props.disabled, false);
  await save.props.onClick(); assert.equal(calls.length, 1); assert.equal(calls[0].method, undefined);
});

test("canonical-only desk edits still add the original saved recipe without saving a duplicate", async () => {
  for (const edit of ["whitespace", "numeric format", "random pool order"]) {
    const h = harness(), calls = [], added = [];
    const component = await load({ hooks: h.hooks, fetch: async (url, options = {}) => { calls.push({ url, ...options }); return response(library()); } });
    const render = () => h.render(component.default, { onAddToWeek: saved => added.push(saved) });
    render(); await h.load(); let tree = render(); button(tree, "Load playlist").props.onClick(); tree = render();
    if (edit === "whitespace") nodes(tree).find(node => node.type === "input" && node.props.placeholder === "e.g. Morning energy").props.onChange({ target: { value: "  Dance and Pop  " } });
    if (edit === "numeric format") nodes(tree).find(node => node.type === "input" && node.props.type === "number").props.onChange({ target: { value: "060" } });
    if (edit === "random pool order") {
      button(tree, "Dance (6)").props.onClick(); tree = render(); button(tree, "Dance (6)").props.onClick();
    }
    tree = render();
    assert.equal(button(tree, "Save as new playlist").props.disabled, true, `${edit}: saving a duplicate stays disabled`);
    assert.equal(button(tree, "Add saved playlist to week ↓").props.disabled, false, `${edit}: adding the saved recipe stays available`);
    button(tree, "Add saved playlist to week ↓").props.onClick();
    assert.equal(added.length, 1); assert.equal(added[0].sourceId, recipe.sourceId); assert.equal(added[0].name, recipe.name);
    assert.deepEqual([...added[0].genreCodes], recipe.genreCodes); assert.equal(added[0].durationMinutes, 60);
    assert.equal(calls.length, 1); assert.equal(calls[0].method, undefined);
  }
});

test("save retries preserve the original request ID even when a refresh reaches the limit", async () => {
  const h = harness(), writes = []; let count = 19;
  const component = await load({ hooks: h.hooks, fetch: async (_url, options = {}) => {
    if (!options.body) return response(library(count));
    writes.push(JSON.parse(options.body));
    if (writes.length === 1) { count = 20; throw Object.assign(new Error("Timeout"), { name: "AbortError" }); }
    const saved = { ...recipe, sourceId: "new-copy", name: "Evening mix" };
    return response({ ...library(19), recipes: [...library(19).recipes, saved], savedSourceId: saved.sourceId });
  } });
  h.render(component.default); await h.load();
  let tree = h.render(component.default); button(tree, "Load playlist").props.onClick(); tree = h.render(component.default);
  nodes(tree).find(node => node.type === "input" && node.props.placeholder === "e.g. Morning energy").props.onChange({ target: { value: "Evening mix" } });
  tree = h.render(component.default); assert.equal(button(tree, "Save as new playlist").props.disabled, false);
  await button(tree, "Save as new playlist").props.onClick(); tree = h.render(component.default);
  await button(tree, "Refresh library").props.onClick(); tree = h.render(component.default);
  assert.equal(button(tree, "Save as new playlist").props.disabled, false);
  await button(tree, "Save as new playlist").props.onClick(); assert.deepEqual(writes[0], writes[1]);
  tree = h.render(component.default); assert.equal(button(tree, "Save as new playlist").props.disabled, true);
  assert.match(text(tree), /Already saved/);
});

test("library refresh invalidates stale previews, and blank templates expose inline help", async () => {
  const h = harness();
  const component = await load({ hooks: h.hooks, fetch: async (_url, options = {}) => response(options.body
    ? { stationId, preview: { requestedDurationSeconds: 3600, totalDurationSeconds: 180, liveOrderFixed: false, warnings: [], items: [{ position: 1, trackId: "song", title: "Song", artist: "Artist", durationSeconds: 180 }] } }
    : library()) });
  h.render(component.default); await h.load(); let tree = h.render(component.default);
  assert.match(text(tree), /Complete your template to continue/); assert.equal(button(tree, "Generate Playlist").props.disabled, true);
  button(tree, "Load playlist").props.onClick(); tree = h.render(component.default);
  await button(tree, "Generate Playlist").props.onClick(); tree = h.render(component.default);
  assert.ok(nodes(tree).find(node => node.type === component.TestRadioPlaylistPreview).props.preview);
  await button(tree, "Refresh library").props.onClick(); tree = h.render(component.default);
  assert.equal(nodes(tree).find(node => node.type === component.TestRadioPlaylistPreview).props.preview, null);
});
