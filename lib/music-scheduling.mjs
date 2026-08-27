import {
  isValidIanaTimezone,
  localDateTimeParts,
  parseLocalTime
} from "./opening-hours.mjs";

export const MAX_SCHEDULE_SLOTS = 200;

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Effective dates must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Enter a real effective date.");
  }
  return value;
}

function expandedSegments(slot) {
  if (slot.endMinute > slot.startMinute) {
    return [{ weekday: slot.weekday, start: slot.startMinute, end: slot.endMinute }];
  }
  return [
    { weekday: slot.weekday, start: slot.startMinute, end: 1440 },
    { weekday: (slot.weekday + 1) % 7, start: 0, end: slot.endMinute }
  ];
}

export function normaliseSchedulePayload(body) {
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "";
  if (!isValidIanaTimezone(timezone)) throw new Error("Select a valid IANA timezone.");

  const effectiveFrom = validDate(body?.effectiveFrom);
  const effectiveTo = validDate(body?.effectiveTo);
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error("The effective end date cannot be before the start date.");
  }

  if (!Array.isArray(body?.slots) || body.slots.length === 0 || body.slots.length > MAX_SCHEDULE_SLOTS) {
    throw new Error(`Add between 1 and ${MAX_SCHEDULE_SLOTS} schedule slots.`);
  }

  const slots = body.slots.map((entry, index) => {
    const weekday = Number(entry?.weekday);
    const startMinute = parseLocalTime(entry?.startsAt);
    const endMinute = parseLocalTime(entry?.endsAt);
    const priority = Number(entry?.priority ?? 0);
    const musicModeId = typeof entry?.musicModeId === "string" ? entry.musicModeId.trim() : "";
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error(`Slot ${index + 1} has an invalid weekday.`);
    if (startMinute === null || endMinute === null || startMinute === endMinute) throw new Error(`Slot ${index + 1} needs different valid start and end times.`);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new Error(`Slot ${index + 1} priority must be from 0 to 100.`);
    if (!musicModeId) throw new Error(`Slot ${index + 1} needs a music mode.`);
    return { weekday, startMinute, endMinute, priority, musicModeId };
  });

  const segments = slots.flatMap((slot, slotIndex) => expandedSegments(slot).map((segment) => ({ ...segment, slotIndex })));
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const a = segments[left];
      const b = segments[right];
      if (a.slotIndex !== b.slotIndex && a.weekday === b.weekday && a.start < b.end && b.start < a.end) {
        throw new Error("Schedule slots cannot overlap, including overnight carry-over.");
      }
    }
  }

  return { timezone, effectiveFrom, effectiveTo, slots };
}

function dateValue(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function slotMatches(slot, weekday, minute) {
  if (slot.endMinute > slot.startMinute) {
    return slot.weekday === weekday && minute >= slot.startMinute && minute < slot.endMinute;
  }
  return (
    (slot.weekday === weekday && minute >= slot.startMinute) ||
    ((slot.weekday + 1) % 7 === weekday && minute < slot.endMinute)
  );
}

export function resolveMusicSchedule({ schedules = [], instant = new Date(), timezone, locationOpen = true }) {
  const local = localDateTimeParts(instant, timezone);
  if (!locationOpen) return { musicMode: null, reason: "LOCATION_CLOSED", local };

  const candidates = [];
  for (const schedule of schedules) {
    if (schedule.status !== "PUBLISHED") continue;
    const from = dateValue(schedule.effectiveFrom);
    const to = dateValue(schedule.effectiveTo);
    if ((from && local.date < from) || (to && local.date > to)) continue;
    for (const slot of schedule.slots || []) {
      if (slot.musicMode?.status !== "ACTIVE" || !slotMatches(slot, local.weekday, local.minute)) continue;
      candidates.push({ schedule, slot, specificity: schedule.zoneId ? 2 : 1 });
    }
  }

  candidates.sort((a, b) =>
    b.specificity - a.specificity ||
    b.slot.priority - a.slot.priority ||
    b.schedule.version - a.schedule.version ||
    String(a.schedule.id).localeCompare(String(b.schedule.id)) ||
    String(a.slot.id).localeCompare(String(b.slot.id))
  );

  const selected = candidates[0];
  if (!selected) return { musicMode: null, reason: "NO_MATCHING_SLOT", local };
  return {
    musicMode: selected.slot.musicMode,
    scheduleId: selected.schedule.id,
    scheduleVersion: selected.schedule.version,
    slotId: selected.slot.id,
    reason: selected.specificity === 2 ? "ZONE_SLOT" : "LOCATION_SLOT",
    local
  };
}
