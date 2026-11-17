import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as ui from "../lib/test-radio-playlist-desk-ui.mjs";
const stationId = ui.PLAYLIST_DESK_STATION_ID;
const requestId = "c5e510a1-1d25-4b43-8ebc-dcfe0adcfed0";
const recipe = () => ({ sourceId: "mode-id", playlistId: "playlist-id", name: "Morning energy", version: 1, buildMode: "GENRE_SEQUENCE", genreCodes: ["POP", "POP", "ROCK"], durationMinutes: 60, eligibleTrackCount: 24, readyForSchedule: true });
const library = () => ({ stationId, recipes: [recipe()], genres: [{ code: "POP", name: "Pop", eligibleTrackCount: 20 }, { code: "ROCK", name: "Rock", eligibleTrackCount: 4 }], warnings: [] });

test("template commands preserve repeated genre slots and only preview or create a new recipe", () => {
  const form = ui.deskRecipeForm(recipe());
  assert.deepEqual(ui.deskRecipeCommand(form, { action: "preview" }), { action: "preview", name: "Morning energy", buildMode: "GENRE_SEQUENCE", genreCodes: ["POP", "POP", "ROCK"], durationMinutes: 60 });
  const saved = ui.deskRecipeCommand(form, { action: "save", requestId });
  assert.equal(saved.requestId, requestId);
  assert.doesNotMatch(JSON.stringify(saved), /sourceId|playlistId|publish|enabled|audio|approve|budget/);
  for (const action of ["start", "approve", "delete", "update"]) assert.throws(() => ui.deskRecipeCommand(form, { action, requestId }));
  assert.throws(() => ui.deskRecipeCommand(form, { action: "save", requestId: "bad" }));
});

test("invalid durations, names and unavailable genres cannot be sent by the desk", () => {
  const form = ui.deskRecipeForm(recipe());
  for (const change of [{ durationMinutes: 0 }, { durationMinutes: 181 }, { durationMinutes: 1.5 }, { name: "a" }, { name: "unsafe\nname" }, { genreCodes: [] }, { genreCodes: Array(49).fill("POP") }, { buildMode: "FIXED_QUEUE" }]) {
    assert.throws(() => ui.deskRecipeCommand({ ...form, ...change }, { action: "preview" }));
  }
  assert.throws(() => ui.deskRecipeCommand(form, { action: "preview", genres: [{ code: "POP" }] }));
  assert.throws(() => ui.deskRecipeCommand({ ...form, buildMode: "RANDOM_GENRE_POOL" }, { action: "preview" }));
  assert.equal(ui.deskRecipeCommand({ ...form, durationMinutes: "30" }, { action: "preview" }).durationMinutes, 30);
});

test("library responses are exact-station, bounded and metadata-only", () => {
  const input = library(); input.recipes[0].secretUrl = "https://secret.invalid";
  const safe = ui.deskLibrary(input);
  assert.equal(safe.recipes[0].sourceId, "mode-id"); assert.equal(safe.recipes[0].secretUrl, undefined);
  for (const mutate of [body => body.stationId = "other", body => body.recipes.push(recipe()), body => body.genres.push(body.genres[0]), body => body.recipes[0].eligibleTrackCount = 65, body => body.recipes[0].durationMinutes = null]) {
    const body = library(); mutate(body); assert.throws(() => ui.deskLibrary(body));
  }
  const older = library(); older.recipes[0].durationMinutes = 240;
  assert.equal(ui.deskLibrary(older).recipes[0].durationMinutes, 240, "Existing recipe length is not silently rewritten");
  assert.equal(ui.deskRecipeProgramme(older.recipes[0]), null);
});

test("loaded recipe editing is independent and name/genre search stays local", () => {
  const saved = recipe(), form = ui.deskRecipeForm(saved);
  form.genreCodes.push("DANCE"); form.name = "Edited copy";
  assert.deepEqual(saved.genreCodes, ["POP", "POP", "ROCK"]); assert.equal(saved.name, "Morning energy");
  assert.equal(ui.filterDeskRecipes([saved], "rock").length, 1);
  assert.equal(ui.filterDeskRecipes([saved], "MORNING").length, 1);
  assert.equal(ui.filterDeskRecipes([saved], "not here").length, 0);
  assert.equal(ui.deskRecipeSnapshot({ ...form, durationMinutes: "60" }), ui.deskRecipeSnapshot({ ...form, durationMinutes: 60 }));
});

test("new source choices merge without replacing saved or unsaved weekly content", () => {
  const draft = { version: 3, items: [{ label: "Keep this programme" }] }, approved = { version: 2, enabled: true };
  const state = { stationId, draft, approved, sources: [{ id: "old", name: "Old recipe" }] };
  const next = ui.mergeDeskRecipeSources(state, [recipe()]);
  assert.equal(next.draft, draft); assert.equal(next.approved, approved); assert.equal(state.sources.length, 1);
  assert.deepEqual(next.sources.map(value => value.id), ["old", "mode-id"]);
  assert.equal(ui.mergeDeskRecipeSources({ stationId: "other" }, [recipe()]).sources, undefined);
  const programme = ui.deskRecipeProgramme(recipe());
  assert.equal(programme.sourceId, "mode-id"); assert.equal(programme.sourceType, "MUSIC_MODE"); assert.equal(programme.durationMinutes, 60);
  assert.equal(ui.deskRecipeProgramme({ ...recipe(), readyForSchedule: false }), null);
});

const previewResponse = () => ({ stationId, preview: { requestedDurationSeconds: 60, totalDurationSeconds: 179, liveOrderFixed: false, truncated: false, warnings: [], items: [{ position: 0, trackId: "track", title: '<img src=x onerror="alert(1)">', artist: "Example artist", durationSeconds: 179 }] } });
test("preview uses relative metadata times, not a fixed live queue", () => {
  const safe = ui.deskPreview(previewResponse());
  assert.equal(safe.items[0].startSeconds, 0); assert.equal(safe.items[0].position, 1); assert.equal(ui.deskDuration(179), "2:59");
  for (const mutate of [body => body.stationId = "other", body => body.preview.liveOrderFixed = true, body => body.preview.items[0].durationSeconds = 0, body => body.preview.items = Array(201).fill(body.preview.items[0])]) {
    const response = previewResponse(); mutate(response); assert.throws(() => ui.deskPreview(response));
  }
});

test("real desk renders original actions and escaped metadata without audio or broadcasting controls", async () => {
  const require = createRequire(import.meta.url), React = require("react"), { renderToStaticMarkup } = require("react-dom/server"), babel = require("next/dist/compiled/babel/core");
  const filename = "app/admin/stations/[stationId]/setup/TestRadioPlaylistDesk.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === "@/lib/test-radio-playlist-desk-ui.mjs") return ui;
    if (name === "./test-radio-planner.module.css") return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
  } });
  const shell = renderToStaticMarkup(React.createElement(module.exports.default, { stationId }));
  for (const label of ["Generate Playlist", "Load Playlist", "Template Builder", "Save as new playlist", "Add saved playlist to week"]) assert.match(shell, new RegExp(label));
  assert.match(shell, /never overwrites a loaded playlist/);
  assert.equal(renderToStaticMarkup(React.createElement(module.exports.default, { stationId: "other" })), "");
  const preview = renderToStaticMarkup(React.createElement(module.exports.TestRadioPlaylistPreview, { preview: ui.deskPreview(previewResponse()), name: "Sample" }));
  assert.match(preview, /Example rotation, not the live queue/); assert.match(preview, /&lt;img/); assert.match(preview, /2:59/);
  assert.doesNotMatch(preview, /<img|<audio|autoplay/i);
  assert.doesNotMatch(source, /\/continuous-autodj|action: "start"|action: "approve"|\.play\(|autoPlay|\/publish/);
  assert.match(source, /AbortController/); assert.match(source, /saveAttempt/); assert.match(source, /beforeunload/);
});
