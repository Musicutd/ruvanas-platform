import assert from "node:assert/strict";
import test from "node:test";
import {
  normaliseSchedulePayload,
  resolveMusicSchedule
} from "../lib/music-scheduling.mjs";

const activeMode = (id) => ({ id, name: id, status: "ACTIVE" });
const schedule = (overrides = {}) => ({
  id: "schedule-location",
  locationId: "location-1",
  zoneId: null,
  status: "PUBLISHED",
  version: 1,
  effectiveFrom: null,
  effectiveTo: null,
  slots: [],
  ...overrides
});

test("normalises valid weekly slots and rejects overlaps", () => {
  const valid = normaliseSchedulePayload({
    timezone: "Europe/Malta",
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-12-31",
    slots: [{ weekday: 1, startsAt: "09:00", endsAt: "12:00", musicModeId: "mode-1", priority: 20 }]
  });
  assert.deepEqual(valid.slots[0], { weekday: 1, startMinute: 540, endMinute: 720, musicModeId: "mode-1", priority: 20 });
  assert.throws(() => normaliseSchedulePayload({
    timezone: "Europe/Malta",
    slots: [
      { weekday: 1, startsAt: "22:00", endsAt: "02:00", musicModeId: "mode-1" },
      { weekday: 2, startsAt: "01:00", endsAt: "03:00", musicModeId: "mode-2" }
    ]
  }), /overlap/i);
});

test("zone schedule wins over a location schedule", () => {
  const instant = new Date("2026-08-31T08:30:00.000Z");
  const result = resolveMusicSchedule({
    instant,
    timezone: "Europe/Malta",
    schedules: [
      schedule({ slots: [{ id: "slot-location", weekday: 1, startMinute: 600, endMinute: 720, priority: 100, musicMode: activeMode("location-mode") }] }),
      schedule({ id: "schedule-zone", zoneId: "zone-1", locationId: null, slots: [{ id: "slot-zone", weekday: 1, startMinute: 600, endMinute: 720, priority: 0, musicMode: activeMode("zone-mode") }] })
    ]
  });
  assert.equal(result.musicMode.id, "zone-mode");
  assert.equal(result.reason, "ZONE_SLOT");
});

test("overnight slots carry into the following local day", () => {
  const result = resolveMusicSchedule({
    instant: new Date("2026-09-01T00:30:00.000Z"),
    timezone: "Europe/Malta",
    schedules: [schedule({ slots: [{ id: "overnight", weekday: 1, startMinute: 1320, endMinute: 180, priority: 0, musicMode: activeMode("late-mode") }] })]
  });
  assert.equal(result.musicMode.id, "late-mode");
});

test("resolver uses local wall-clock time across European DST changes", () => {
  const dstSchedule = schedule({ slots: [{ id: "sunday", weekday: 0, startMinute: 180, endMinute: 240, priority: 0, musicMode: activeMode("morning-mode") }] });
  const spring = resolveMusicSchedule({ instant: new Date("2026-03-29T01:30:00.000Z"), timezone: "Europe/Malta", schedules: [dstSchedule] });
  const autumn = resolveMusicSchedule({ instant: new Date("2026-10-25T02:30:00.000Z"), timezone: "Europe/Malta", schedules: [dstSchedule] });
  assert.equal(spring.local.minute, 210);
  assert.equal(autumn.local.minute, 210);
  assert.equal(spring.musicMode.id, "morning-mode");
  assert.equal(autumn.musicMode.id, "morning-mode");
});

test("closed locations and inactive modes never resolve", () => {
  const closed = resolveMusicSchedule({ instant: new Date(), timezone: "UTC", locationOpen: false, schedules: [] });
  assert.equal(closed.reason, "LOCATION_CLOSED");
  const inactive = resolveMusicSchedule({
    instant: new Date("2026-08-31T10:00:00.000Z"), timezone: "UTC",
    schedules: [schedule({ slots: [{ id: "inactive", weekday: 1, startMinute: 0, endMinute: 1439, priority: 0, musicMode: { id: "draft", status: "DRAFT" } }] })]
  });
  assert.equal(inactive.reason, "NO_MATCHING_SLOT");
});

test("scheduled programming overrides AutoDJ and gaps use the default", () => {
  const policy = {
    enabled: true,
    playbackPolicy: "RUN_24_7",
    defaultMusicMode: activeMode("default"),
    backupMusicMode: activeMode("backup")
  };
  const scheduled = resolveMusicSchedule({
    instant: new Date("2026-08-31T10:00:00.000Z"),
    timezone: "UTC",
    schedules: [schedule({ slots: [{ id: "slot", weekday: 1, startMinute: 540, endMinute: 720, priority: 0, musicMode: activeMode("scheduled") }] })],
    autoDjPolicy: policy
  });
  assert.equal(scheduled.reason, "LOCATION_SLOT");
  assert.equal(scheduled.musicMode.id, "scheduled");

  const gap = resolveMusicSchedule({
    instant: new Date("2026-08-31T13:00:00.000Z"),
    timezone: "UTC",
    schedules: [],
    autoDjPolicy: policy
  });
  assert.equal(gap.reason, "DEFAULT_AUTODJ");
  assert.equal(gap.fallbackCause, "SCHEDULE_GAP");
  assert.equal(gap.alert, null);
});

test("24/7 policy runs while closed but opening-hours policy does not", () => {
  const defaultMusicMode = activeMode("default");
  const closed = resolveMusicSchedule({
    instant: new Date("2026-08-31T23:00:00.000Z"), timezone: "UTC", locationOpen: false, schedules: [],
    autoDjPolicy: { enabled: true, playbackPolicy: "FOLLOW_LOCATION_HOURS", defaultMusicMode }
  });
  assert.equal(closed.reason, "LOCATION_CLOSED");

  const continuous = resolveMusicSchedule({
    instant: new Date("2026-08-31T23:00:00.000Z"), timezone: "UTC", locationOpen: false, schedules: [],
    autoDjPolicy: { enabled: true, playbackPolicy: "RUN_24_7", defaultMusicMode }
  });
  assert.equal(continuous.reason, "DEFAULT_AUTODJ");
});

test("an unavailable scheduled mode fails over and raises a warning", () => {
  const result = resolveMusicSchedule({
    instant: new Date("2026-08-31T10:00:00.000Z"),
    timezone: "UTC",
    schedules: [schedule({ slots: [{ id: "slot", weekday: 1, startMinute: 0, endMinute: 1439, priority: 0, musicMode: activeMode("broken") }] })],
    autoDjPolicy: { enabled: true, playbackPolicy: "RUN_24_7", defaultMusicMode: activeMode("default") },
    musicModeAvailable: (mode) => mode.id !== "broken"
  });
  assert.equal(result.reason, "DEFAULT_AUTODJ");
  assert.equal(result.fallbackCause, "SCHEDULED_MODE_UNAVAILABLE");
  assert.equal(result.alert.code, "SCHEDULED_MODE_UNAVAILABLE");
});
