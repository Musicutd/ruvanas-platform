import { localMinuteToUtc } from "./advanced-scheduler.mjs";
import { isValidIanaTimezone, parseLocalTime } from "./opening-hours.mjs";

export function schedulerFormTimezone(channel, fallback = "Europe/Malta") {
  if (isValidIanaTimezone(channel?.timezone)) return channel.timezone;
  if (!isValidIanaTimezone(fallback)) throw new Error("Choose a valid planner time zone.");
  return fallback;
}

function dateTimeParts(instant, timezone) {
  if (!isValidIanaTimezone(timezone)) throw new Error("Choose a valid planner time zone.");
  const date = new Date(instant);
  if (Number.isNaN(date.valueOf())) throw new Error("Enter a valid programme time.");
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function schedulerLocalInput(instant, timezone) {
  if (!instant) return "";
  const parts = dateTimeParts(instant, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function validDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function offsetAt(instant, timezone) {
  const parts = dateTimeParts(instant, timezone);
  const represented = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00.000Z`).valueOf();
  return represented - Math.floor(instant / 60_000) * 60_000;
}

function matchingLocalInstants(value, timezone, instant) {
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) offsets.add(offsetAt(instant.valueOf() + hours * 3600_000, timezone));
  const represented = new Date(`${value}:00.000Z`).valueOf();
  return [...new Set([...offsets].map((offset) => represented - offset).filter((candidate) => schedulerLocalInput(candidate, timezone) === value))];
}

export function schedulerOneOffInstant(value, timezone, { originalStartsAt = null, originalTimezone = null } = {}) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a one-off start date and time.");
  const [date, time] = value.split("T");
  const minute = parseLocalTime(time);
  if (!validDate(date) || minute === null) throw new Error("Enter a valid one-off start date and time.");
  if (!isValidIanaTimezone(timezone)) throw new Error("Choose a valid planner time zone.");

  // Keep an existing absolute instant, including either side of a repeated
  // clock-change hour and any seconds not represented by datetime-local.
  if (originalStartsAt && originalTimezone === timezone && schedulerLocalInput(originalStartsAt, timezone) === value) return new Date(originalStartsAt).toISOString();

  // Share the scheduler's conversion and spring-forward gap rejection. The
  // form has no offset selector, so fail closed if a newly entered time could
  // identify two instants rather than silently choosing a repeated hour.
  const instant = localMinuteToUtc(date, minute, timezone);
  if (matchingLocalInstants(value, timezone, instant).length > 1) throw new Error(`Local time ${value.replace("T", " ")} repeats when clocks change in ${timezone}. Choose a time outside the repeated hour.`);
  return instant.toISOString();
}

export function schedulerPayloadItem(item, timezone) {
  const { originalStartsAt, originalTimezone, ...payload } = item;
  return { ...payload, startsAt: item.recurrence === "ONE_OFF" ? schedulerOneOffInstant(item.startsAt, timezone, { originalStartsAt, originalTimezone }) : null };
}

function nextDate(date, amount) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function localDayBoundary(date, timezone, skippedDays = 0) {
  // A valid compiled horizon can contain an internal day whose clock starts at
  // 01:00 (for example Santiago). Find its first existing wall-clock minute;
  // do not impose a midnight constraint that the scheduling engine does not.
  for (let minute = 0; minute < 1440; minute += 1) {
    let instant;
    try {
      instant = localMinuteToUtc(date, minute, timezone);
    } catch (error) {
      if (!error.message.includes("does not exist")) throw error;
      continue;
    }
    const value = `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    return Math.min(...matchingLocalInstants(value, timezone, instant));
  }
  // A wholly skipped local date has a zero-length display day. Use the next
  // existing date's boundary for both ends instead of inventing an instant.
  if (skippedDays >= 2) throw new Error(`Unable to display calendar days in ${timezone}.`);
  return localDayBoundary(nextDate(date, 1), timezone, skippedDays + 1);
}

export function schedulerPreviewDays(preview) {
  const timezone = preview.schedule?.timezone || preview.timezone;
  const firstDate = schedulerLocalInput(preview.startsAt, timezone).slice(0, 10);
  const dayCount = Math.max(1, Math.min(31, Number(preview.days) || 7));
  const boundaries = Array.from({ length: dayCount + 1 }, (_, index) => localDayBoundary(nextDate(firstDate, index), timezone));
  return Array.from({ length: dayCount }, (_, index) => {
    const date = nextDate(firstDate, index);
    const startsAt = boundaries[index];
    const endsAt = boundaries[index + 1];
    const startOfDayLabel = schedulerLocalInput(startsAt, timezone).slice(11);
    const items = (preview.occurrences || []).filter((item) => startsAt < endsAt && new Date(item.startsAt).valueOf() < endsAt && new Date(item.endsAt).valueOf() > startsAt).map((item) => ({
      ...item,
      startLabel: new Date(item.startsAt).valueOf() < startsAt ? `${startOfDayLabel} · continues` : schedulerLocalInput(item.startsAt, timezone).slice(11),
      endLabel: new Date(item.endsAt).valueOf() >= endsAt ? "24:00" : schedulerLocalInput(item.endsAt, timezone).slice(11),
      continuesAfterDay: new Date(item.endsAt).valueOf() > endsAt
    }));
    return {
      date,
      label: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00.000Z`)),
      items
    };
  });
}
