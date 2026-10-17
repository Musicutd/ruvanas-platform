import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nonStopSettingsChanged, summariseChannelPlaylistPlan } from "../lib/subscriber-autodj-workspace.mjs";

const event = (id, start, end, channelId = "channel-a") => ({ id, channelId, playlistName: id, startsAt: `2026-10-17T${start}:00Z`, endsAt: `2026-10-17T${end}:00Z` });

test("channel playlist summary is ordered, scoped, half-open and excludes invalid or cancelled slots", () => {
  const events = [event("later", "13:00", "14:00"), event("other channel", "11:00", "13:00", "channel-b"), event("current", "12:00", "13:00"), event("finished", "11:00", "12:00"), { ...event("cancelled", "12:10", "13:30"), cancelledAt: "2026-10-16T12:00:00Z" }, event("next", "12:30", "13:00"), event("reversed", "14:00", "13:00"), { ...event("invalid", "12:00", "14:00"), startsAt: "invalid" }];
  const summary = summariseChannelPlaylistPlan(events, "channel-a", "2026-10-17T12:00:00Z");
  assert.deepEqual(summary.current.map((slot) => slot.id), ["current"]);
  assert.equal(summary.next.id, "next");
  assert.deepEqual(summary.upcoming.map((slot) => slot.id), ["current", "next", "later"]);
  assert.equal(events[0].id, "later", "never mutates API data");
});

test("overlaps remain visible, missing plan is not invented as actual playback", () => {
  const summary = summariseChannelPlaylistPlan([event("one", "11:00", "13:00"), event("two", "11:30", "14:00")], "channel-a", "2026-10-17T12:00:00Z");
  assert.equal(summary.current.length, 2);
  assert.equal(summary.next, null);
  assert.deepEqual(summariseChannelPlaylistPlan([], "channel-a"), { current: [], next: null, upcoming: [] });
  assert.deepEqual(summariseChannelPlaylistPlan([event("one", "11:00", "13:00")], "channel-a", "invalid"), { current: [], next: null, upcoming: [] });
  assert.equal(summariseChannelPlaylistPlan([event("one", "11:00", "13:00")], "channel-a", "2026-10-17T13:00:00Z").current.length, 0);
});

test("staged AutoDJ settings compare saved enabled state and genre sets", () => {
  const saved = { enabled: true, genreCodes: ["POP", "DANCE"] };
  assert.equal(nonStopSettingsChanged(saved, true, ["DANCE", "POP"]), false);
  assert.equal(nonStopSettingsChanged(saved, true, ["POP", "DANCE", "POP"]), false);
  assert.equal(nonStopSettingsChanged(saved, false, ["POP", "DANCE"]), true);
  assert.equal(nonStopSettingsChanged(saved, true, []), true);
  assert.equal(nonStopSettingsChanged(undefined, false, []), false);
});

test("subscriber UI explicitly stages AutoDJ, labels planned output and exposes weekly planner separately", async () => {
  const [simple, page] = await Promise.all([
    readFile(new URL("../app/dashboard/programming/SimplePlaylistWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8")
  ]);
  assert.match(simple, /onChange=\{\(event\) => setNonStopEnabled\(event\.target\.checked\)\}/);
  assert.doesNotMatch(simple, /saveNonStop\(event\.target\.checked\)/);
  assert.match(simple, /onClick=\{saveNonStop\}/);
  assert.match(simple, /!data\.canManage \|\| busy \|\| !channel\?\.rightsUse \|\| !unsavedNonStop/);
  assert.match(simple, /not confirmation of what is audible/);
  assert.match(simple, /creates an active time slot immediately/);
  assert.match(simple, /Discard your unsaved AutoDJ changes and switch channel/);
  assert.match(simple, /beforeunload/);
  assert.match(simple, /timeZone: channel\?\.timezone/);
  assert.match(page, /id: "planner", label: "Weekly planner"/);
  assert.equal((page.match(/<AdvancedSchedulerWorkspace\s*\/>/g) || []).length, 1);
  assert.match(page, /<AutoDjExpansionWorkspace \/><SmartPlaylistsWorkspace \/><RadioClocksWorkspace \/>/);
});
