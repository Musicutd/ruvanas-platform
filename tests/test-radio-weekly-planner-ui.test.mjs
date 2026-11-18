import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as ui from "../lib/test-radio-weekly-planner-ui.mjs";
import * as deskUi from "../lib/test-radio-playlist-desk-ui.mjs";
import * as plannerWarnings from "../lib/test-radio-planner-warnings.mjs";
const CHANNEL_ID = "c000000000000000000000001", PLAYLIST_ID = "c000000000000000000000002";

function fixture() {
  return { stationId: ui.TEST_RADIO_PLANNER_STATION_ID, canEdit: true,
    channels: [{ id: CHANNEL_ID, name: "Test Radio", status: "ACTIVE" }], sources: [{ id: PLAYLIST_ID, name: "My saved mix", buildMode: "GENRE_ROTATION", genreCodes: ["POP"] }],
    schedule: { id: "plan", channelId: CHANNEL_ID, name: "Existing weekly plan", timezone: "Europe/Malta" },
    draft: { id: "version-three", version: 3, reviewHash: "a".repeat(64), readyToApprove: true,
      items: [{ label: "Morning show", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId: PLAYLIST_ID, weekday: 1, startTime: "09:00", startsAt: null, durationMinutes: 60, priority: 50 }],
      preview: { timezone: "Europe/Malta", startsAt: "2026-10-26T00:00:00Z", endsAt: "2026-11-02T00:00:00Z", days: 7,
        occurrences: [{ label: "Morning show", startsAt: "2026-10-26T08:00:00Z", endsAt: "2026-10-26T09:00:00Z", sourceId: PLAYLIST_ID, priority: 50 }], warnings: [] } },
    approved: null, warnings: [] };
}
const approval = (state, extra = {}) => ui.testRadioWeeklyApprovalBody({ state, form: ui.testRadioWeeklyForm(state), reviewHash: state.draft?.reviewHash, reviewed: true, overridesAcknowledged: true, ...extra });

test("draft status distinguishes approval from unsaved edits and a newer saved draft without changing authority", () => {
  const state = fixture();
  assert.match(ui.testRadioWeeklyDraftStatus(state).label, /awaiting admin approval/);
  state.approved = { enabled: true, versionId: state.draft.id, version: 3, channelId: CHANNEL_ID };
  assert.equal(ui.testRadioWeeklySavedApproved(state), true);
  assert.equal(ui.testRadioWeeklyDraftStatus(state).label, "Approved version 3");
  assert.match(ui.testRadioWeeklyDraftStatus(state).detail, /not proof of live audio/);
  assert.equal(ui.testRadioWeeklyDraftStatus(state, true).label, "Unsaved changes");
  assert.equal(approval(state, { draftOnly: true }), null);
  for (const override of [{ enabled: false }, { versionId: "different-id" }, { channelId: "different-channel" }]) {
    assert.equal(ui.testRadioWeeklySavedApproved({ ...state, approved: { ...state.approved, ...override } }), false);
  }
  assert.equal(ui.testRadioWeeklySavedApproved({ ...state, stationId: "other" }), false);
  assert.equal(ui.testRadioWeeklyDraftStatus({ ...state, draft: null }).label, "No saved draft");
  assert.equal(ui.testRadioWeeklyDraftStatus(null).label, "No saved draft");
});

test("loads the latest saved canonical draft without replacing it with a blank plan", () => {
  const state = fixture(), form = ui.testRadioWeeklyForm(state);
  assert.equal(form.name, "Existing weekly plan"); assert.equal(form.channelId, CHANNEL_ID); assert.equal(form.timezone, "Europe/Malta");
  assert.equal(form.items[0].label, "Morning show"); assert.equal(form.items[0].sourceId, PLAYLIST_ID);
  assert.equal(form.items[0].durationMinutes, 60); assert.equal(form.items[0].weekday, 1);
  assert.equal(ui.testRadioWeeklyForm({ ...state, stationId: "other-station" }).channelId, "");
  assert.equal(ui.testRadioWeeklyForm({ ...state, schedule: null, draft: null, channels: [{ id: "one" }, { id: "two" }] }).channelId, "");
  assert.equal(ui.testRadioWeeklyForm({ ...state, schedule: null, draft: null, channels: [{ id: "one" }, { id: "two" }] }, "two").channelId, "two");
});

test("save is the narrow draft API contract and never activates a channel or publishes", () => {
  const state = fixture(), body = ui.testRadioWeeklySaveBody(ui.testRadioWeeklyForm(state));
  assert.deepEqual(body, { action: "save", channelId: CHANNEL_ID, name: "Existing weekly plan", timezone: "Europe/Malta", items: state.draft.items });
  assert.doesNotMatch(JSON.stringify(body), /publish|enabled|active|audio|budget/);
  const changed = ui.testRadioWeeklyForm(state); changed.items[0].durationMinutes = "30"; changed.items[0].priority = "70";
  assert.equal(ui.testRadioWeeklySaveBody(changed).items[0].durationMinutes, 30);
  assert.equal(ui.testRadioWeeklySaveBody(changed).items[0].priority, 70);
  for (const [key, value] of [["durationMinutes", 0], ["durationMinutes", 1441], ["priority", 101], ["startTime", "25:00"], ["sourceId", ""], ["sourceType", "RADIO_CLOCK"]]) {
    const form = ui.testRadioWeeklyForm(state); form.items[0][key] = value;
    assert.throws(() => ui.testRadioWeeklySaveBody(form), undefined, key);
  }
});

test("one-off dates use the plan zone, preserve saved repeated-hour instants and reject new ambiguity", () => {
  const state = fixture();
  state.draft.items[0] = { ...state.draft.items[0], recurrence: "ONE_OFF", weekday: null, startTime: null, startsAt: "2026-10-25T01:30:15.000Z" };
  const form = ui.testRadioWeeklyForm(state);
  assert.equal(form.items[0].startsAt, "2026-10-25T02:30");
  assert.equal(ui.testRadioWeeklySaveBody(form).items[0].startsAt, "2026-10-25T01:30:15.000Z");
  form.items[0].startsAt = "2026-10-25T02:45";
  assert.throws(() => ui.testRadioWeeklySaveBody(form), /repeats/);
  form.items[0].startsAt = "2027-03-28T02:30";
  assert.throws(() => ui.testRadioWeeklySaveBody(form), /does not exist/);
  form.items[0].startsAt = "2026-10-26T09:00";
  assert.equal(ui.testRadioWeeklySaveBody(form).items[0].startsAt, "2026-10-26T08:00:00.000Z");
});

test("approval binds the reviewed saved version and rejects dirty, unready, foreign or unreviewed state", () => {
  const state = fixture();
  assert.deepEqual(approval(state), { action: "approve", channelId: CHANNEL_ID, versionId: "version-three", reviewHash: "a".repeat(64), overridesAcknowledged: true });
  for (const extra of [{ reviewed: false }, { overridesAcknowledged: false }, { reviewHash: "b".repeat(64) }, { reviewHash: null }]) assert.equal(approval(state, extra), null);
  for (const mutate of [s => { s.stationId = "other"; }, s => { s.canEdit = false; }, s => { s.draft.readyToApprove = false; }, s => { delete s.draft.readyToApprove; },
    s => { s.draft.reviewHash = null; }, s => { s.draft.preview.timezone = "UTC"; }, s => { s.draft.preview.endsAt = s.draft.preview.startsAt; }, s => { s.draft.preview = null; }]) {
    const changed = fixture(); mutate(changed); assert.equal(approval(changed), null);
  }
  for (const change of [f => { f.name = "New name"; }, f => { f.items[0].durationMinutes = 30; }, f => { f.channelId = "other"; }, f => { f.items.push(ui.testRadioWeeklyEmptyItem()); }]) {
    const form = ui.testRadioWeeklyForm(state); change(form); assert.equal(approval(state, { form }), null);
  }
});

test("weekly review uses actual compiled saved occurrences and does not fabricate live state", () => {
  const state = fixture(), days = ui.testRadioWeeklyDays(state);
  assert.equal(days.length, 7); assert.equal(days[0].items[0].startLabel, "09:00"); assert.equal(days[0].items[0].endLabel, "10:00");
  assert.equal(days[1].items.length, 0);
  assert.deepEqual(ui.testRadioWeeklyDays({ ...state, stationId: "another-station" }), []);
  state.draft.preview.startsAt = "invalid"; assert.deepEqual(ui.testRadioWeeklyDays(state), []);
});

test("real UI renders truthful review, escapes catalogue text, offers safe stop and remains Test Radio-only", async () => {
  const require = createRequire(import.meta.url), React = require("react"), { renderToStaticMarkup } = require("react-dom/server"), babel = require("next/dist/compiled/babel/core");
  const filename = "app/admin/stations/[stationId]/setup/TestRadioWeeklyPlanner.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === "@/lib/test-radio-weekly-planner-ui.mjs") return ui;
    if (name === "@/lib/test-radio-planner-warnings.mjs") return plannerWarnings;
    if (name === "@/app/dashboard/programming/TestRadioNowNext") return { __esModule: true, default: () => React.createElement("div", null, "Read-only Now & Next") };
    if (name === "@/lib/test-radio-playlist-desk-ui.mjs") return deskUi;
    if (name === "./TestRadioPlaylistDesk") return { __esModule: true, default: () => React.createElement("div", null, "Playlist desk") };
    if (name === "./test-radio-planner.module.css") return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
  } });
  const state = fixture(); state.draft.preview.occurrences[0].label = '<img src=x onerror="alert(1)">'; state.draft.preview.warnings = ["Priority override needs review"];
  const review = renderToStaticMarkup(React.createElement(module.exports.TestRadioWeeklyReview, { state }));
  assert.match(review, /Review saved version 3/); assert.match(review, /09:00–10:00/); assert.match(review, /My saved mix/);
  assert.match(review, /not proof of live audio/); assert.match(review, /Priority override needs review/); assert.match(review, /No scheduled programme/);
  assert.match(review, /next seven days/); assert.match(review, /next 31 days/);
  assert.match(review, /&lt;img/); assert.doesNotMatch(review, /<img|<audio|autoplay/i);
  state.approved = { enabled: true, versionId: state.draft.id, channelId: CHANNEL_ID };
  const approvedReview = renderToStaticMarkup(React.createElement(module.exports.TestRadioWeeklyReview, { state, draftOnly: true }));
  assert.match(approvedReview, /already has administrator approval/);
  assert.doesNotMatch(approvedReview, /must separately review and approve/);
  const shell = renderToStaticMarkup(React.createElement(module.exports.default, { stationId: ui.TEST_RADIO_PLANNER_STATION_ID }));
  assert.match(shell, /Disable scheduled takeovers — keep AutoDJ/); assert.match(shell, /Listeners may hear the change/); assert.match(shell, /US\$15/);
  assert.match(shell, /Saving or previewing never puts a new version on air/); assert.match(shell, /draft-only access/);
  assert.equal(renderToStaticMarkup(React.createElement(module.exports.default, { stationId: "another-station" })), "");
  assert.match(source, /20_000/); assert.match(source, /AbortController/); assert.match(source, /Discard these unsaved/);
  assert.match(source, /if \(action === "disable" && state\) setState\(body\)/, "Disable cannot discard unsaved edits");
  assert.doesNotMatch(source, /autoPlay|\.play\(|\/continuous-autodj|action: "start"|\/publish/);
});

test("real API route accepts UI save/approve/disable contracts and rejects foreign scope, untrusted origins and extra commands", async () => {
  const require = createRequire(import.meta.url), babel = require("next/dist/compiled/babel/core");
  const filename = "app/api/admin/stations/[stationId]/continuous-schedule/route.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} }, state = fixture(), calls = [], owner = { userId: "owner" };
  let signedIn = true;
  const services = {
    continuousScheduleDashboard: async (_db, options) => { calls.push({ action: "read", options }); return state; },
    saveContinuousScheduleDraft: async (_db, options) => { calls.push({ action: "save", options }); return state; },
    approveContinuousSchedule: async (_db, options) => { calls.push({ action: "approve", options }); return state; },
    disableContinuousSchedule: async (_db, options) => { calls.push({ action: "disable", options }); },
    scheduleMessage: () => "Safe failure"
  };
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, TextDecoder, Date, URL,
    require: name => {
      if (name === "next/server") return { NextResponse: { json: (body, init) => ({ body, ...init }) } };
      if (name === "@/lib/prisma") return { prisma: {} };
      if (name === "@/lib/auth") return { getCurrentSession: async () => signedIn ? owner : null };
      if (name === "@/lib/catalogue-test-service.mjs") return { catalogueTestOwnerSessionValid: session => session === owner };
      if (name === "@/lib/test-radio-continuous-policy.mjs") return { TEST_RADIO_CONTINUOUS: { stationId: state.stationId, origin: "https://www.ruvanas.com" } };
      if (name === "@/lib/test-radio-continuous-schedule-service.mjs") return services;
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
  const request = (body, origin = "https://www.ruvanas.com") => new Request(`https://www.ruvanas.com/api/admin/stations/${state.stationId}/continuous-schedule`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body)
  });
  const params = { params: Promise.resolve({ stationId: state.stationId }) };
  const save = ui.testRadioWeeklySaveBody(ui.testRadioWeeklyForm(state));
  assert.equal((await module.exports.POST(request(save), params)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).options.input)), save);
  assert.equal((await module.exports.POST(request(approval(state)), params)).status, 200);
  assert.equal(calls.at(-1).action, "approve"); assert.equal(calls.at(-1).options.versionId, state.draft.id);
  assert.equal((await module.exports.POST(request({ action: "disable" }), params)).status, 200);
  assert.deepEqual(calls.slice(-2).map(call => call.action), ["disable", "read"]);
  const length = calls.length;
  assert.equal((await module.exports.POST(request(save, "https://evil.example"), params)).status, 403);
  assert.equal((await module.exports.POST(request(save), { params: Promise.resolve({ stationId: "another-station" }) })).status, 404);
  assert.equal((await module.exports.POST(request({ ...save, enabled: true }), params)).status, 400);
  assert.equal((await module.exports.POST(request({ action: "publish" }), params)).status, 400);
  assert.equal((await module.exports.POST(request({ ...save, name: "x".repeat(140_000) }), params)).status, 400);
  signedIn = false;
  assert.equal((await module.exports.POST(request(save), params)).status, 403);
  assert.equal(calls.length, length, "Denied requests cannot reach any data operation");
});
