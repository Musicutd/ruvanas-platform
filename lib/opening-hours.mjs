export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

export function isValidIanaTimezone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function parseLocalTime(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatLocalTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function validDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normaliseWindow(entry, label) {
  const isClosed = Boolean(entry?.isClosed);
  if (isClosed) return { isClosed: true, opensAtMinute: null, closesAtMinute: null };
  const opensAtMinute = parseLocalTime(entry?.opensAt);
  const closesAtMinute = parseLocalTime(entry?.closesAt);
  if (opensAtMinute === null || closesAtMinute === null || opensAtMinute === closesAtMinute) {
    throw new Error(`${label} needs different valid opening and closing times.`);
  }
  return { isClosed: false, opensAtMinute, closesAtMinute };
}

export function normaliseOpeningHoursPayload(body) {
  if (!Array.isArray(body?.weeklyHours) || body.weeklyHours.length !== 7) {
    throw new Error("Opening hours must include all seven days.");
  }
  const seenWeekdays = new Set();
  const weeklyHours = body.weeklyHours.map((entry) => {
    const weekday = Number(entry?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seenWeekdays.has(weekday)) {
      throw new Error("Opening hours contain an invalid or repeated weekday.");
    }
    seenWeekdays.add(weekday);
    return { weekday, ...normaliseWindow(entry, WEEKDAYS[weekday]) };
  }).sort((a, b) => a.weekday - b.weekday);

  if (!Array.isArray(body?.exceptions) || body.exceptions.length > 100) {
    throw new Error("Date exceptions must be a list of at most 100 dates.");
  }
  const seenDates = new Set();
  const exceptions = body.exceptions.map((entry) => {
    const date = typeof entry?.date === "string" ? entry.date : "";
    if (!validDateString(date) || seenDates.has(date)) {
      throw new Error("Date exceptions contain an invalid or repeated date.");
    }
    seenDates.add(date);
    const label = typeof entry?.label === "string" ? entry.label.trim().slice(0, 120) : "";
    return { date, label: label || null, ...normaliseWindow(entry, date) };
  }).sort((a, b) => a.date.localeCompare(b.date));

  return { weeklyHours, exceptions };
}

export function localDateTimeParts(instant, timezone) {
  if (!isValidIanaTimezone(timezone)) throw new Error("Invalid IANA timezone.");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, weekday, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function previousDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function isWindowOpen(window, minute, carryOver = false) {
  if (!window || window.isClosed) return false;
  if (window.closesAtMinute > window.opensAtMinute) {
    return !carryOver && minute >= window.opensAtMinute && minute < window.closesAtMinute;
  }
  return carryOver ? minute < window.closesAtMinute : minute >= window.opensAtMinute;
}

export function evaluateLocationOpen({ instant = new Date(), timezone, weeklyHours = [], exceptions = [] }) {
  const local = localDateTimeParts(instant, timezone);
  const exceptionMap = new Map(exceptions.map((entry) => [entry.date instanceof Date ? entry.date.toISOString().slice(0, 10) : entry.date, entry]));
  const currentException = exceptionMap.get(local.date);
  if (currentException) {
    return { isOpen: isWindowOpen(currentException, local.minute), source: "exception", local };
  }
  const weeklyMap = new Map(weeklyHours.map((entry) => [entry.weekday, entry]));
  if (isWindowOpen(weeklyMap.get(local.weekday), local.minute)) {
    return { isOpen: true, source: "weekly", local };
  }
  const previous = previousDate(local.date);
  const previousException = exceptionMap.get(previous);
  const previousWindow = previousException || weeklyMap.get((local.weekday + 6) % 7);
  return { isOpen: isWindowOpen(previousWindow, local.minute, true), source: previousException ? "exception-carry-over" : "weekly-carry-over", local };
}
