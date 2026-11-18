import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileProgrammeScheduleHorizon, localMinuteToUtc, parseProgrammeScheduleInput } from "../lib/advanced-scheduler.mjs";
import { schedulerFormTimezone, schedulerLocalInput, schedulerOneOffInstant, schedulerPayloadItem, schedulerPreviewDays } from "../lib/scheduler-form-time.mjs";

test("planner uses an explicit available channel timezone and never guesses the browser zone", () => {
  assert.equal(schedulerFormTimezone({ timezone: "America/New_York" }), "America/New_York");
  assert.equal(schedulerFormTimezone({}), "Europe/Malta");
  assert.equal(schedulerFormTimezone({ timezone: "Invalid/Zone" }, "Asia/Tokyo"), "Asia/Tokyo");
  assert.throws(() => schedulerFormTimezone(null, "Invalid/Zone"), /valid planner time zone/);
});

test("one-off local inputs use the planner zone in winter and summer", () => {
  assert.equal(schedulerOneOffInstant("2026-01-12T09:00", "Europe/Malta"), "2026-01-12T08:00:00.000Z");
  assert.equal(schedulerOneOffInstant("2026-07-12T09:00", "Europe/Malta"), "2026-07-12T07:00:00.000Z");
  assert.equal(schedulerLocalInput("2026-07-12T07:00:00.000Z", "Europe/Malta"), "2026-07-12T09:00");
  assert.equal(schedulerOneOffInstant("2026-07-12T09:00", "Asia/Kathmandu"), "2026-07-12T03:15:00.000Z");
});

test("one-off conversion and preview are independent of the computer timezone", () => {
  const helperUrl = new URL("../lib/scheduler-form-time.mjs", import.meta.url).href;
  const source = `import { schedulerOneOffInstant, schedulerLocalInput } from ${JSON.stringify(helperUrl)}; process.stdout.write(JSON.stringify([schedulerOneOffInstant("2026-10-17T09:00", "Europe/Malta"), schedulerLocalInput("2026-10-17T07:00:00.000Z", "Europe/Malta")]));`;
  const results = ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map((timezone) => execFileSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", env: { ...process.env, TZ: timezone } }));
  assert.equal(new Set(results).size, 1);
  assert.deepEqual(JSON.parse(results[0]), ["2026-10-17T07:00:00.000Z", "2026-10-17T09:00"]);
});

test("missing spring-forward times reuse the existing scheduler rejection", () => {
  assert.throws(() => schedulerOneOffInstant("2026-03-29T02:30", "Europe/Malta"), /does not exist in Europe\/Malta/);
  assert.throws(() => localMinuteToUtc("2026-03-29", 150, "Europe/Malta"), /does not exist/);
});

test("new repeated-hour times fail clearly while either saved occurrence is preserved", () => {
  assert.throws(() => schedulerOneOffInstant("2026-10-25T02:30", "Europe/Malta"), /repeats when clocks change.*Europe\/Malta/);
  for (const originalStartsAt of ["2026-10-25T00:30:37.000Z", "2026-10-25T01:30:00.000Z"]) {
    assert.equal(schedulerOneOffInstant("2026-10-25T02:30", "Europe/Malta", { originalStartsAt, originalTimezone: "Europe/Malta" }), originalStartsAt);
  }
  assert.throws(() => schedulerOneOffInstant("2026-11-01T01:30", "America/New_York"), /repeats when clocks change/);
  assert.throws(() => schedulerOneOffInstant("2026-04-05T01:45", "Australia/Lord_Howe"), /repeats when clocks change/);
});

test("editing a local time or timezone converts it instead of preserving a stale instant", () => {
  const original = { originalStartsAt: "2026-10-17T07:00:00.000Z", originalTimezone: "Europe/Malta" };
  assert.equal(schedulerOneOffInstant("2026-10-17T10:00", "Europe/Malta", original), "2026-10-17T08:00:00.000Z");
  assert.equal(schedulerOneOffInstant("2026-10-17T09:00", "America/New_York", original), "2026-10-17T13:00:00.000Z");
});

test("invalid dates, times and zones fail before saving", () => {
  for (const value of ["", "2026-02-30T09:00", "2026-13-01T09:00", "2026-10-17T24:00", "2026-10-17T09:70", "2026-10-17T09:00:00Z"]) assert.throws(() => schedulerOneOffInstant(value, "Europe/Malta"), /valid|Enter/);
  assert.throws(() => schedulerOneOffInstant("2026-10-17T09:00", "Wrong/Zone"), /valid planner time zone/);
});

test("payload helper keeps the existing absolute-instant API and strips form-only history", () => {
  const item = { label: "Music hour", recurrence: "ONE_OFF", sourceType: "MUSIC_MODE", startsAt: "2026-10-17T09:00", durationMinutes: 60, priority: 50, sourceId: "mode-1", originalStartsAt: null, originalTimezone: null };
  const payload = schedulerPayloadItem(item, "Europe/Malta");
  assert.equal(payload.startsAt, "2026-10-17T07:00:00.000Z");
  assert.equal("originalStartsAt" in payload, false);
  assert.equal("originalTimezone" in payload, false);
  const parsed = parseProgrammeScheduleInput({ channelId: "cm12345678901234567890123", name: "Station week", timezone: "Europe/Malta", items: [payload] });
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.data.items[0].startsAt.toISOString(), payload.startsAt);
  assert.equal(schedulerPayloadItem({ ...item, recurrence: "WEEKLY" }, "Europe/Malta").startsAt, null);
});

test("saved-plan preview groups every day in the schedule timezone, including empty days", () => {
  const days = schedulerPreviewDays({ schedule: { timezone: "Asia/Tokyo" }, timezone: "UTC", startsAt: "2026-10-16T15:00:00.000Z", days: 7, occurrences: [
    { position: 0, label: "Tokyo breakfast", startsAt: "2026-10-16T23:00:00.000Z", endsAt: "2026-10-17T00:00:00.000Z" }
  ] });
  assert.equal(days.length, 7);
  assert.equal(days[0].date, "2026-10-17");
  assert.equal(days[0].label, "Saturday 17 Oct");
  assert.equal(days[0].items[0].startLabel, "08:00");
  assert.equal(days[0].items[0].endLabel, "09:00");
  assert.equal(days[1].items.length, 0);
  assert.equal(days[6].date, "2026-10-23");
});

test("overnight saved programmes appear on both local days without changing their instants", () => {
  const occurrence = { position: 0, startsAt: "2026-10-17T21:00:00.000Z", endsAt: "2026-10-17T23:00:00.000Z" };
  const days = schedulerPreviewDays({ schedule: { timezone: "Europe/Malta" }, startsAt: "2026-10-16T22:00:00.000Z", days: 2, occurrences: [occurrence] });
  assert.equal(days[0].items[0].startLabel, "23:00");
  assert.equal(days[0].items[0].endLabel, "24:00");
  assert.equal(days[0].items[0].continuesAfterDay, true);
  assert.equal(days[1].items[0].startLabel, "00:00 · continues");
  assert.equal(days[1].items[0].endLabel, "01:00");
  assert.equal(days[1].items[0].startsAt, occurrence.startsAt);
});

test("compiled preview keeps local calendar days across the fall-back clock change", () => {
  const days = schedulerPreviewDays({ schedule: { timezone: "Europe/Malta" }, startsAt: "2026-10-24T22:00:00.000Z", days: 3, occurrences: [] });
  assert.deepEqual(days.map((day) => day.date), ["2026-10-25", "2026-10-26", "2026-10-27"]);
});

test("actual compiled Santiago preview survives an internal missing midnight and preserves overnight display", () => {
  const timezone = "America/Santiago";
  const parsed = parseProgrammeScheduleInput({ channelId: "cm12345678901234567890123", name: "Santiago week", timezone, items: [
    { label: "Friday lunch", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", weekday: 5, startTime: "12:00", durationMinutes: 60, priority: 50, sourceId: "mode-1" },
    { label: "Clock-change music", recurrence: "ONE_OFF", sourceType: "MUSIC_MODE", startsAt: "2026-09-06T03:30:00.000Z", durationMinutes: 60, priority: 50, sourceId: "mode-1" }
  ] });
  assert.equal(parsed.ok, true, parsed.error);
  const compiled = compileProgrammeScheduleHorizon({ items: parsed.data.items }, { timezone, startsAt: new Date("2026-09-04T16:00:00.000Z"), days: 7 });
  // Mirror the preview route's JSON-serialized compiler + schedule envelope.
  const payload = JSON.parse(JSON.stringify({ ...compiled, schedule: { name: "Santiago week", timezone, channel: { name: "Santiago" } } }));
  const days = schedulerPreviewDays(payload);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((day) => day.date), ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]);
  assert.equal(days[0].items[0].startLabel, "12:00");
  assert.equal(days[1].items[0].startLabel, "23:30");
  assert.equal(days[1].items[0].endLabel, "24:00");
  assert.equal(days[2].items[0].startLabel, "01:00 · continues");
  assert.equal(days[2].items[0].endLabel, "01:30");
  assert.equal(days[2].items[0].startsAt, "2026-09-06T03:30:00.000Z");
  assert.equal(days[3].items.length, 0);
});

test("a fully skipped internal local date remains an empty day instead of inventing playback", () => {
  const timezone = "Pacific/Apia";
  const compiled = compileProgrammeScheduleHorizon({ items: [] }, { timezone, startsAt: new Date("2011-12-28T22:00:00.000Z"), days: 7 });
  const payload = JSON.parse(JSON.stringify({ ...compiled, schedule: { timezone } }));
  const days = schedulerPreviewDays(payload);
  assert.equal(days.length, 7);
  assert.equal(days[2].date, "2011-12-30");
  assert.equal(days[2].items.length, 0);
  assert.equal(days[3].date, "2011-12-31");
});

test("read-only preview cannot retarget the editor to a different schedule", async () => {
  const source = await readFile(new URL("../app/dashboard/programming/AdvancedSchedulerWorkspace.js", import.meta.url), "utf8");
  const previewAction = source.slice(source.indexOf("async function previewVersion("), source.indexOf("async function publish("));
  assert.match(previewAction, /setPreview\(payload\.preview\)/);
  assert.doesNotMatch(previewAction, /setEditingId|setForm/);
  assert.match(source, /function edit\(schedule\) \{[\s\S]*?setEditingId\(schedule\.id\)/);
  assert.match(source, /publish\(preview\.schedule\.id, preview\.version\.id\)/);
});

test("scheduler UI keeps saved timezone, explicit preview meaning and publication permissions", async () => {
  const source = await readFile(new URL("../app/dashboard/programming/AdvancedSchedulerWorkspace.js", import.meta.url), "utf8");
  assert.match(source, /timezone: schedule\.timezone/);
  assert.match(source, /schedulerLocalInput\(item\.startsAt, schedule\.timezone\)/);
  assert.match(source, /schedulerPayloadItem\(item, form\.timezone\)/);
  assert.match(source, /Planner time zone/);
  assert.match(source, /readOnly=\{Boolean\(editingId\)\}/);
  assert.match(source, /Time zone is fixed for an existing schedule so a draft cannot retime the active programme/);
  assert.match(source, /not your computer/);
  assert.match(source, /preview of the saved plan, not a live audio or on-air status monitor/);
  assert.match(source, /const canPublish = data\?\.canPublish === true && !sandboxDraftOnly/);
  assert.match(source, /canPublish && preview\.version\.status === "DRAFT"/);
  assert.match(source, /!preview\.readyToPublish \|\| busy !== ""/);
  assert.match(source, /conflictsAcknowledged: acknowledged/);
  assert.doesNotMatch(source, /getTimezoneOffset|new Date\(item\.startsAt\)\.toISOString/);
});

test("weekly planner starts with an approved music mix and keeps optional priority controls disclosed", async () => {
  const source = await readFile(new URL("../app/dashboard/programming/AdvancedSchedulerWorkspace.js", import.meta.url), "utf8");
  assert.match(source, /const EMPTY_ITEM = \{ label: "Music programme", recurrence: "WEEKLY", sourceType: "MUSIC_MODE"/);
  assert.match(source, /WEEKLY PLANNER/);
  assert.match(source, /Plan your station week/);
  assert.match(source, /Weekly programme planner/);
  assert.match(source, /\["MUSIC_MODE", "Music mix"\]/);
  assert.match(source, /\["RADIO_CLOCK", "Radio clock"\]/);
  assert.match(source, /\["SHOW_RUNDOWN", "Approved show"\]/);
  assert.match(source, /<span>Repeat<\/span>/);
  assert.match(source, /<span>Start time<\/span>/);
  assert.match(source, /<span>Length \(minutes\)<\/span>/);
  assert.match(source, /<details className=\{previewStyles\.priority\}><summary>Advanced: overlap priority<\/summary>/);
  assert.match(source, /higher number wins[\s\S]*?overrides require review before publishing/);
  assert.match(source, /durationMinutes: value === "RADIO_CLOCK" \? 60 : item\.durationMinutes/);
});
