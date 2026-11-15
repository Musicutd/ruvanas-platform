import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { schedulerPayloadItem } from "../lib/scheduler-form-time.mjs";
import { scopeStationScheduleData } from "../lib/station-schedule-scope.mjs";

const source = await readFile(new URL("../app/dashboard/programming/AdvancedSchedulerWorkspace.js", import.meta.url), "utf8");
const sandbox = { schedulerPayloadItem, Intl };
vm.runInNewContext(source.slice(0, source.indexOf("export default function"))
  .replace(/^import .*;\r?$/gm, "").replace(/export function /g, "function ")
  + "\nglobalThis.helpers = { plannerFormSnapshot, plannerFormIssues, scopePlannerChannels };", sandbox);
const { plannerFormSnapshot, plannerFormIssues, scopePlannerChannels } = sandbox.helpers;
const form = {
  channelId: "channel-a", name: "My station week", timezone: "Europe/Malta",
  items: [{ label: "Morning music", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", weekday: 1,
    startTime: "09:00", startsAt: "", durationMinutes: 60, priority: 50, sourceId: "mode-a" }]
};

test("planner dirty comparison covers all editable schedule and programme fields", () => {
  const original = plannerFormSnapshot(form);
  for (const [field, value] of Object.entries({ channelId: "channel-b", name: "Another week", timezone: "UTC" })) {
    assert.notEqual(plannerFormSnapshot({ ...form, [field]: value }), original, field);
  }
  for (const [field, value] of Object.entries({ label: "Afternoon", recurrence: "ONE_OFF", sourceType: "RADIO_CLOCK", weekday: 2,
    startTime: "10:00", startsAt: "2026-10-19T10:00", durationMinutes: 120, priority: 60, sourceId: "mode-b" })) {
    assert.notEqual(plannerFormSnapshot({ ...form, items: [{ ...form.items[0], [field]: value }] }), original, field);
  }
  assert.notEqual(plannerFormSnapshot({ ...form, items: [...form.items, { ...form.items[0] }] }), original);
});

test("numeric input representations and form-only instant history do not create false dirty state", () => {
  const equivalent = { ...form, items: [{ ...form.items[0], weekday: "1", durationMinutes: "60", priority: "50",
    originalStartsAt: "2026-10-19T07:00:00.000Z", originalTimezone: "Europe/Malta" }] };
  assert.equal(plannerFormSnapshot(equivalent), plannerFormSnapshot(form));
});

test("planner validation explains missing details before attempting a save", () => {
  assert.equal(plannerFormIssues(form).length, 0);
  const issues = plannerFormIssues({ ...form, channelId: "", name: "", timezone: "Invalid/Zone",
    items: [{ ...form.items[0], sourceId: "", durationMinutes: "", priority: 101, startTime: "25:00" }] });
  assert.match(issues.join(" "), /Choose the channel/);
  assert.match(issues.join(" "), /plan a name/);
  assert.match(issues.join(" "), /valid planner time zone/);
  assert.match(issues.join(" "), /Programme 1: choose a saved/);
  assert.match(issues.join(" "), /length/);
  assert.match(issues.join(" "), /overlap priority/);
  assert.match(issues.join(" "), /valid start time/);
  const save = source.slice(source.indexOf("async function save("), source.indexOf("async function previewVersion("));
  assert.ok(save.indexOf("if (formIssues.length)") < save.indexOf("await fetch("));
});

test("one-off form feedback preserves clock-change safeguards and original saved instants", () => {
  const oneOff = { ...form, items: [{ ...form.items[0], recurrence: "ONE_OFF", startsAt: "2026-10-25T02:30" }] };
  assert.match(plannerFormIssues(oneOff).join(" "), /repeats when clocks change/);
  assert.equal(plannerFormIssues({ ...oneOff, items: [{ ...oneOff.items[0], originalStartsAt: "2026-10-25T00:30:00.000Z", originalTimezone: "Europe/Malta" }] }).length, 0);
});

test("planner makes saved versus unsaved review explicit without automatic publication", () => {
  assert.match(source, /Weekly planner steps/);
  assert.match(source, /Prepare a draft/);
  assert.match(source, /Review the saved week/);
  assert.match(source, /Unsaved form changes/);
  assert.match(source, /beforeunload/);
  assert.match(source, /Discard your unsaved weekly planner changes/);
  assert.match(source, /Preview saved version/);
  assert.match(source, /disabled=\{hasUnsavedChanges \|\| busy !== ""\}/);
  assert.match(source, /const canPublish = data\?\.canPublish === true && !sandboxDraftOnly/);
  assert.match(source, /async function publish\(scheduleId, versionId\) \{\s*if \(!canPublish\) return;\s*if \(hasUnsavedChanges\)/);
  const save = source.slice(source.indexOf("async function save("), source.indexOf("async function previewVersion("));
  assert.doesNotMatch(save, /\/publish|await publish\(/);
  const preview = source.slice(source.indexOf("async function previewVersion("), source.indexOf("async function publish("));
  assert.doesNotMatch(preview, /setForm|setEditingId|\/publish/);
});

test("seven-day preview exposes date anchors, named conflicts, and empty-day meaning", () => {
  assert.match(source, /Jump to a day in the saved week/);
  assert.match(source, /href=\{`#planner-day-\$\{day\.date\}`\}/);
  assert.match(source, /id=\{`planner-day-\$\{day\.date\}`\}/);
  assert.match(source, /previewDays\[0\]\?\.label/);
  assert.match(source, /previewDays\.at\(-1\)\?\.label/);
  assert.match(source, /preview\.version\.items\.find\(\(item\) => item\.position === conflict\.leftPosition\)/);
  assert.match(source, /No programme is saved for this day/);
  assert.match(source, /not a live audio or on-air status monitor/);
  assert.match(source, /Try loading again/);
});

test("trusted Online channel IDs narrow presentation and empty IDs fail closed without mutating generic data", () => {
  const payload = { sources: { channels: [{ id: "online-a", stationId: "station-a" }, { id: "retail-a", stationId: null }], musicModes: [{ id: "mode-a" }] },
    schedules: [{ id: "schedule-online", channel: { id: "online-a", station: { id: "station-a" } } }, { id: "schedule-retail", channel: { id: "retail-a", station: null } }] };
  assert.equal(scopePlannerChannels(payload, null), payload);
  const online = scopePlannerChannels(payload, ["online-a"]);
  assert.deepEqual(Array.from(online.sources.channels, (channel) => channel.id), ["online-a"]);
  assert.deepEqual(Array.from(online.schedules, (schedule) => schedule.id), ["schedule-online"]);
  assert.equal(online.sources.musicModes, payload.sources.musicModes);
  assert.equal(scopePlannerChannels(payload, []).sources.channels.length, 0);
  assert.equal(scopePlannerChannels(payload, []).schedules.length, 0);
  assert.equal(scopePlannerChannels(payload, "ONLINE").sources.channels.length, 0);
  const stationOnly = scopePlannerChannels(scopeStationScheduleData(payload, "station-a"), ["retail-a"]);
  assert.equal(stationOnly.sources.channels.length, 0);
  assert.equal(stationOnly.schedules.length, 0);
  assert.equal(payload.sources.channels.length, 2);
});

test("initial Online scope chooses an eligible channel without resetting dirty form on data refresh", async () => {
  const writes = [];
  const payload = { sources: { channels: [{ id: "configured-online", configured: true }, { id: "new-online", configured: false }, { id: "retail-a", configured: false }] }, schedules: [] };
  const loadSandbox = {
    fetch: async () => ({ ok: true, json: async () => payload }), stationId: null,
    channelScopeKey: JSON.stringify(["configured-online", "new-online"]), loadedScope: { current: undefined },
    scopeStationScheduleData, scopePlannerChannels,
    schedulerFormTimezone: () => "Europe/Malta", plannerFormSnapshot,
    EMPTY_FORM: { ...form, channelId: "", name: "" }, EMPTY_ITEM: form.items[0],
    setData: () => {}, setForm: (value) => writes.push(value), setFormBaseline: () => {}, setError: assert.fail, setBusy: () => {}
  };
  const loadSource = source.slice(source.indexOf("const load = useCallback(async () => {"), source.indexOf("  const refreshChoices ="))
    .replace("const load = useCallback(async () => {", "async function load() {")
    .replace("}, [stationId, channelScopeKey]);", "}");
  vm.runInNewContext(loadSource + "\nglobalThis.load = load;", loadSandbox);
  await loadSandbox.load();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].channelId, "new-online");
  writes[0].name = "My unsaved station week";
  await loadSandbox.load();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, "My unsaved station week");
});

test("sandbox presentation never labels legacy active, archived or empty schedules as drafts", () => {
  const draft = { id: "private-draft", versions: [{ status: "DRAFT", isActive: false }] };
  const mixed = [draft,
    { id: "published", activeVersion: { status: "PUBLISHED" }, versions: [{ status: "DRAFT" }] },
    { id: "legacy-active", versions: [{ status: "DRAFT", isActive: true }] },
    { id: "archived", versions: [{ status: "DRAFT" }, { status: "ARCHIVED" }] },
    { id: "empty", versions: [] }
  ];
  const payload = { sandboxDraftOnly: true, sources: { channels: [] }, schedules: mixed };
  assert.deepEqual(Array.from(scopePlannerChannels(payload).schedules, (schedule) => schedule.id), ["private-draft"]);
  assert.equal(scopePlannerChannels({ ...payload, sandboxDraftOnly: false }).schedules, mixed);
  assert.equal(payload.schedules.length, 5);
});

test("playlist refresh events and manual refresh remain read-only and preserve form state", () => {
  assert.match(source, /window\.addEventListener\("ruvanas:playlists-changed", refresh\)/);
  assert.match(source, /window\.removeEventListener\("ruvanas:playlists-changed", refresh\)/);
  assert.match(source, /choicesRefreshPending\.current = true/);
  assert.match(source, /onClick=\{refreshChoices\}/);
  assert.match(source, /Refresh playlist choices/);
  const refresh = source.slice(source.indexOf("const refreshChoices ="), source.indexOf("  useEffect(() => { load();"));
  assert.match(refresh, /await load\(\)/);
  assert.doesNotMatch(refresh, /setForm|setEditingId|setFormBaseline|confirm|POST|PUT|publish/);
  assert.match(source, /Saved version \$\{loadedFormVersion/);
});
