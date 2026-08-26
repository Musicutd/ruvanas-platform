import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLocationOpen,
  formatLocalTime,
  isValidIanaTimezone,
  normaliseOpeningHoursPayload,
  parseLocalTime
} from "../lib/opening-hours.mjs";

const weeklyHours = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  isClosed: false,
  opensAtMinute: 9 * 60,
  closesAtMinute: 18 * 60
}));

test("local times parse and format without a UTC conversion", () => {
  assert.equal(parseLocalTime("09:05"), 545);
  assert.equal(formatLocalTime(545), "09:05");
  assert.equal(parseLocalTime("24:00"), null);
});

test("payload validation requires seven unique weekdays and valid date exceptions", () => {
  const result = normaliseOpeningHoursPayload({
    weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, isClosed: weekday === 0, opensAt: "09:00", closesAt: "18:00" })),
    exceptions: [{ date: "2026-12-25", label: "Christmas", isClosed: true }]
  });
  assert.equal(result.weeklyHours.length, 7);
  assert.equal(result.weeklyHours[1].opensAtMinute, 540);
  assert.equal(result.exceptions[0].isClosed, true);
  assert.throws(() => normaliseOpeningHoursPayload({ weeklyHours: [], exceptions: [] }), /seven days/);
});

test("IANA timezone validation accepts real zones and rejects invented ones", () => {
  assert.equal(isValidIanaTimezone("Europe/Malta"), true);
  assert.equal(isValidIanaTimezone("Mars/Valletta"), false);
});

test("weekly hours use the location local clock through the spring DST change", () => {
  const sundayHours = weeklyHours.map((entry) => entry.weekday === 0 ? { ...entry, opensAtMinute: 60, closesAtMinute: 240 } : entry);
  const result = evaluateLocationOpen({
    instant: new Date("2026-03-29T01:30:00.000Z"),
    timezone: "Europe/Malta",
    weeklyHours: sundayHours
  });
  assert.equal(result.local.date, "2026-03-29");
  assert.equal(result.local.minute, 210);
  assert.equal(result.isOpen, true);
});

test("both repeated local times are treated consistently during the autumn DST change", () => {
  const sundayHours = weeklyHours.map((entry) => entry.weekday === 0 ? { ...entry, opensAtMinute: 120, closesAtMinute: 180 } : entry);
  for (const instant of ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]) {
    const result = evaluateLocationOpen({ instant: new Date(instant), timezone: "Europe/Malta", weeklyHours: sundayHours });
    assert.equal(result.local.minute, 150);
    assert.equal(result.isOpen, true);
  }
});

test("date exceptions override weekly hours and overnight windows carry into the next day", () => {
  const closed = evaluateLocationOpen({
    instant: new Date("2026-12-25T10:00:00.000Z"),
    timezone: "UTC",
    weeklyHours,
    exceptions: [{ date: "2026-12-25", isClosed: true, opensAtMinute: null, closesAtMinute: null }]
  });
  assert.equal(closed.isOpen, false);
  assert.equal(closed.source, "exception");

  const overnight = weeklyHours.map((entry) => entry.weekday === 6 ? { ...entry, opensAtMinute: 1320, closesAtMinute: 120 } : { ...entry, isClosed: true });
  const afterMidnight = evaluateLocationOpen({ instant: new Date("2026-08-30T01:00:00.000Z"), timezone: "UTC", weeklyHours: overnight });
  assert.equal(afterMidnight.isOpen, true);
  assert.equal(afterMidnight.source, "weekly-carry-over");
});
