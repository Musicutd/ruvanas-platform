import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertRadioClockPublishable,
  canAuthorRadioClock,
  canPublishRadioClock,
  expandRadioClock,
  formatClockOffset,
  parseRadioClockInput,
  radioClockSlug,
  radioClockTimeline
} from "../lib/radio-clocks.mjs";

const exactHour = {
  name: "Daytime hour",
  description: "Reusable contemporary format",
  items: [
    { type: "MUSIC_MODE", label: "Opening music", durationSeconds: 1800, transition: "CLEAN", transitionSeconds: 0, sourceId: "mode-1" },
    { type: "PROMO", label: "Station ident", durationSeconds: 30, transition: "CROSSFADE", transitionSeconds: 2, sourceId: "promo-1" },
    { type: "SHOW_RUNDOWN", label: "Feature block", durationSeconds: 1772, transition: "CLEAN", transitionSeconds: 0, sourceId: "rundown-1" }
  ]
};

test("Radio Clock roles separate editing from publication", () => {
  assert.equal(canAuthorRadioClock("CONTENT_EDITOR"), true);
  assert.equal(canPublishRadioClock("CONTENT_EDITOR"), false);
  assert.equal(canPublishRadioClock("OWNER"), true);
  assert.equal(canPublishRadioClock("MANAGER"), true);
  assert.equal(canAuthorRadioClock("VIEWER"), false);
});

test("clock input binds one source per item and reuses studio transition rules", () => {
  const parsed = parseRadioClockInput(exactHour);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.items[0].musicModeId, "mode-1");
  assert.equal(parsed.data.items[1].promoVersionId, "promo-1");
  assert.equal(parsed.data.items[2].schoolRundownId, "rundown-1");
  assert.equal(parsed.timeline.readyToPublish, true);
  assert.equal(radioClockSlug("Café Drive Hour"), "cafe-drive-hour");

  assert.match(parseRadioClockInput({ ...exactHour, items: [{ ...exactHour.items[0], sourceId: "" }] }).error, /source/i);
  assert.match(parseRadioClockInput({ ...exactHour, items: [{ type: "MARKER", label: "Top of hour", durationSeconds: 2, transition: "CLEAN", transitionSeconds: 0 }] }).error, /zero duration/i);
  assert.match(parseRadioClockInput({ ...exactHour, items: [{ ...exactHour.items[0], transition: "CROSSFADE", transitionSeconds: 0 }] }).error, /transition length/i);
});

test("approved voice-track segues bind as first-class clock sources", () => {
  const parsed = parseRadioClockInput({ name: "Voice tracked hour", items: [
    { type: "VOICE_TRACK", label: "Presenter link", durationSeconds: 20, transition: "DUCK_VOICE", transitionSeconds: 2, sourceId: "segue-1" },
    { type: "MUSIC_MODE", label: "Music sweep", durationSeconds: 3580, transition: "CLEAN", transitionSeconds: 0, sourceId: "mode-1" }
  ] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.items[0].voiceTrackSegueId, "segue-1");
  assert.equal(parsed.timeline.readyToPublish, true);
});

test("timeline offsets account for overlap and require an exact hour", () => {
  const parsed = parseRadioClockInput(exactHour);
  const timeline = radioClockTimeline(parsed.data.items);
  assert.equal(timeline.items[0].offsetSeconds, 0);
  assert.equal(timeline.items[1].offsetSeconds, 1798);
  assert.equal(timeline.items[2].offsetSeconds, 1828);
  assert.equal(timeline.plannedSeconds, 3600);
  assert.equal(formatClockOffset(1798), "29:58");
  assert.doesNotThrow(() => assertRadioClockPublishable({ items: parsed.data.items, durationSeconds: 3600 }));

  const short = parseRadioClockInput({ ...exactHour, items: [{ ...exactHour.items[0], durationSeconds: 3599 }] });
  assert.equal(short.ok, true);
  assert.throws(() => assertRadioClockPublishable({ items: short.data.items, durationSeconds: 3600 }), /exactly one hour/i);
  assert.match(parseRadioClockInput({ ...exactHour, items: [{ ...exactHour.items[0], durationSeconds: 3600 }, { ...exactHour.items[1], transition: "CLEAN", transitionSeconds: 0 }] }).error, /overruns/i);
});

test("a published clock expands deterministically across a full week", () => {
  const parsed = parseRadioClockInput(exactHour);
  const expanded = expandRadioClock({ items: parsed.data.items, durationSeconds: 3600 }, { startsAt: new Date("2026-09-07T00:00:00.000Z"), occurrences: 168 });
  assert.equal(expanded.length, 168);
  assert.equal(expanded[0].items[1].startsAt.toISOString(), "2026-09-07T00:29:58.000Z");
  assert.equal(expanded[167].startsAt.toISOString(), "2026-09-13T23:00:00.000Z");
  assert.throws(() => expandRadioClock({ items: parsed.data.items }, { occurrences: 169 }), /between 1 and 168/i);
});

test("Stage 19.4 keeps schema, routes, UI and shared scheduling primitives explicit", async () => {
  const [schema, migration, route, publishRoute, service, page, component, rules] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261006000000_stage_19_4_radio_clocks/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/radio-clocks/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/radio-clocks/[radioClockId]/publish/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/radio-clock-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/RadioClocksWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/radio-clocks.mjs", import.meta.url), "utf8")
  ]);
  assert.match(schema, /model RadioClock/);
  assert.match(schema, /model RadioClockItem/);
  assert.match(migration, /RadioClockItem_type_source_check/);
  assert.match(route, /membership\.organisationId/);
  assert.doesNotMatch(route, /data\.organisationId/);
  assert.match(publishRoute, /canPublishRadioClock/);
  assert.match(service, /musicTrackEligibility/);
  assert.match(service, /musicModeIsPlayable/);
  assert.match(page, /RadioClocksWorkspace/);
  assert.match(component, /ONE-HOUR PREVIEW/);
  assert.match(rules, /SHOW_TRANSITIONS/);
});
