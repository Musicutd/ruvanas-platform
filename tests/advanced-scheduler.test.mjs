import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertProgrammeSchedulePublishable,
  canAuthorProgrammeSchedule,
  canPublishProgrammeSchedule,
  compileProgrammeScheduleHorizon,
  parseProgrammeScheduleInput,
  programmeScheduleSourceId
} from "../lib/advanced-scheduler.mjs";

const weekly = (overrides = {}) => ({
  label: "Monday breakfast",
  recurrence: "WEEKLY",
  sourceType: "RADIO_CLOCK",
  weekday: 1,
  startTime: "09:00",
  durationMinutes: 60,
  priority: 50,
  sourceId: "clock-1",
  ...overrides
});

const parsedSchedule = (items) => {
  const parsed = parseProgrammeScheduleInput({ channelId: "cm12345678901234567890123", name: "Main station grid", timezone: "Europe/Malta", items });
  assert.equal(parsed.ok, true, parsed.error);
  return { items: parsed.data.items };
};

test("Advanced Scheduler roles separate authoring from publication", () => {
  assert.equal(canAuthorProgrammeSchedule("CONTENT_EDITOR"), true);
  assert.equal(canPublishProgrammeSchedule("CONTENT_EDITOR"), false);
  assert.equal(canPublishProgrammeSchedule("OWNER"), true);
  assert.equal(canPublishProgrammeSchedule("MANAGER"), true);
  assert.equal(canAuthorProgrammeSchedule("VIEWER"), false);
});

test("typed schedule input enforces recurrence and source contracts", () => {
  const parsed = parseProgrammeScheduleInput({ channelId: "cm12345678901234567890123", name: "Main station grid", timezone: "Europe/Malta", items: [weekly()] });
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.data.items[0].radioClockId, "clock-1");
  assert.equal(programmeScheduleSourceId(parsed.data.items[0]), "clock-1");
  assert.equal(parsed.data.items[0].startMinute, 540);

  assert.match(parseProgrammeScheduleInput({ channelId: "cm12345678901234567890123", name: "Bad clock", timezone: "Europe/Malta", items: [weekly({ durationMinutes: 59 })] }).error, /exactly 60/i);
  assert.equal(parseProgrammeScheduleInput({ channelId: "cm12345678901234567890123", name: "One off", timezone: "Europe/Malta", items: [weekly({ recurrence: "ONE_OFF", weekday: null, startTime: null, startsAt: "2026-09-08T10:00:00.000Z", sourceType: "MUSIC_MODE", durationMinutes: 90, sourceId: "mode-1" })] }).ok, true);
  assert.match(parseProgrammeScheduleInput({ channelId: "cm12345678901234567890123", name: "Timezone", timezone: "Mars/Base", items: [weekly()] }).error, /IANA timezone/i);
});

test("weekly programmes compile in the channel timezone", () => {
  const version = parsedSchedule([weekly()]);
  const preview = compileProgrammeScheduleHorizon(version, { timezone: "Europe/Malta", startsAt: new Date("2026-09-07T00:00:00.000Z"), days: 7 });
  assert.equal(preview.occurrences.length, 1);
  assert.equal(preview.occurrences[0].startsAt.toISOString(), "2026-09-07T07:00:00.000Z");
  assert.equal(preview.occurrences[0].endsAt.toISOString(), "2026-09-07T08:00:00.000Z");
  assert.throws(() => compileProgrammeScheduleHorizon(version, { timezone: "Europe/Malta", days: 32 }), /between 1 and 31/i);
});

test("equal-priority overlaps block publication while explicit priorities remain reviewable", () => {
  const blocked = parsedSchedule([weekly(), weekly({ label: "News hour", sourceId: "clock-2", startTime: "09:30" })]);
  const blockedPreview = compileProgrammeScheduleHorizon(blocked, { timezone: "Europe/Malta", startsAt: new Date("2026-09-07T00:00:00.000Z"), days: 7 });
  assert.equal(blockedPreview.conflicts[0].severity, "BLOCKING");
  assert.throws(() => assertProgrammeSchedulePublishable(blocked, { timezone: "Europe/Malta", startsAt: new Date("2026-09-07T00:00:00.000Z"), days: 7 }), /same priority/i);

  const controlled = parsedSchedule([weekly(), weekly({ label: "Priority news", sourceId: "clock-2", startTime: "09:30", priority: 90 })]);
  const controlledPreview = assertProgrammeSchedulePublishable(controlled, { timezone: "Europe/Malta", startsAt: new Date("2026-09-07T00:00:00.000Z"), days: 7 });
  assert.equal(controlledPreview.conflicts[0].severity, "CONTROLLED_OVERRIDE");
  assert.equal(controlledPreview.conflicts[0].winnerPosition, 1);
});

test("nonexistent daylight-saving local times fail closed", () => {
  const version = parsedSchedule([weekly({ weekday: 0, startTime: "02:30" })]);
  assert.throws(() => compileProgrammeScheduleHorizon(version, { timezone: "Europe/Malta", startsAt: new Date("2026-03-29T00:00:00.000Z"), days: 1 }), /does not exist/i);
});

test("the maximum schedule compiles across the bounded 31-day horizon", () => {
  const items = Array.from({ length: 200 }, (_, index) => {
    const startMinute = index * 5;
    return weekly({
      label: `Programme ${index + 1}`,
      sourceType: "MUSIC_MODE",
      sourceId: `mode-${index + 1}`,
      startTime: `${String(Math.floor(startMinute / 60)).padStart(2, "0")}:${String(startMinute % 60).padStart(2, "0")}`,
      durationMinutes: 1
    });
  });
  const version = parsedSchedule(items);
  const startedAt = performance.now();
  const preview = compileProgrammeScheduleHorizon(version, {
    timezone: "Europe/Malta",
    startsAt: new Date("2026-09-07T00:00:00.000Z"),
    days: 31
  });
  const elapsedMilliseconds = performance.now() - startedAt;

  assert.equal(preview.occurrences.length, 1000);
  assert.equal(preview.conflicts.length, 0);
  assert.ok(elapsedMilliseconds < 1000, `31-day compilation took ${elapsedMilliseconds.toFixed(1)} ms`);
});

test("Stage 19.5 keeps tenancy, versioning, active-state and compatibility boundaries explicit", async () => {
  const [schema, migration, service, route, publishRoute, page, component, rules, roadmap] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261007000000_stage_19_5_advanced_scheduler/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/advanced-scheduler-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/advanced-scheduler/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/advanced-scheduler/[scheduleId]/versions/[versionId]/publish/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/AdvancedSchedulerWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/advanced-scheduler.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-online-radio-index.md", import.meta.url), "utf8")
  ]);
  assert.match(schema, /model ProgrammeScheduleVersion/);
  assert.match(schema, /ProgrammeScheduleSourceType/);
  assert.match(migration, /ProgrammeScheduleVersion_one_active_key/);
  assert.match(migration, /ProgrammeScheduleItem_recurrence_check/);
  assert.match(service, /programmeScheduleCompatibilityWarnings/);
  assert.match(service, /musicSchedule\.count/);
  assert.match(service, /schoolBroadcastSlot\.count/);
  assert.match(route, /membership\.organisationId/);
  assert.doesNotMatch(route, /data\.organisationId/);
  assert.match(publishRoute, /canPublishProgrammeSchedule/);
  assert.match(page, /AdvancedSchedulerWorkspace/);
  assert.match(component, /SEVEN-DAY COMPILED PREVIEW/);
  assert.match(rules, /MAX_PROGRAMME_HORIZON_DAYS/);
  assert.match(roadmap, /19\.5 \| Advanced Scheduler \| DEPLOYED \| \[#104\]/);
});
