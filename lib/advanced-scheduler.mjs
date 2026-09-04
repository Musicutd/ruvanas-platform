import { z } from "zod";
import { isValidIanaTimezone, parseLocalTime } from "./opening-hours.mjs";

export const PROGRAMME_SCHEDULE_SOURCE_TYPES = Object.freeze(["MUSIC_MODE", "RADIO_CLOCK", "SHOW_RUNDOWN"]);
export const PROGRAMME_SCHEDULE_RECURRENCES = Object.freeze(["WEEKLY", "ONE_OFF"]);
export const MAX_PROGRAMME_SCHEDULE_ITEMS = 200;
export const MAX_PROGRAMME_HORIZON_DAYS = 31;
export const MAX_PROGRAMME_OCCURRENCES = 5000;

const itemSchema = z.object({
  label: z.string().trim().min(2).max(160),
  recurrence: z.enum(PROGRAMME_SCHEDULE_RECURRENCES),
  sourceType: z.enum(PROGRAMME_SCHEDULE_SOURCE_TYPES),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  startsAt: z.string().trim().optional().nullable(),
  startTime: z.string().trim().optional().nullable(),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  priority: z.coerce.number().int().min(0).max(100).default(0),
  sourceId: z.string().trim().min(1).max(120)
});

const scheduleSchema = z.object({
  channelId: z.string().cuid(),
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(1).max(100),
  items: z.array(itemSchema).min(1).max(MAX_PROGRAMME_SCHEDULE_ITEMS)
});

const SOURCE_FIELD = Object.freeze({
  MUSIC_MODE: "musicModeId",
  RADIO_CLOCK: "radioClockId",
  SHOW_RUNDOWN: "schoolRundownId"
});

export function canAuthorProgrammeSchedule(role) {
  return ["OWNER", "MANAGER", "CONTENT_EDITOR"].includes(role);
}

export function canPublishProgrammeSchedule(role) {
  return ["OWNER", "MANAGER"].includes(role);
}

export function programmeScheduleSourceId(item) {
  const field = SOURCE_FIELD[item?.sourceType];
  return field ? item?.[field] || item?.sourceId || null : null;
}

function normaliseItem(item, position) {
  const sourceField = SOURCE_FIELD[item.sourceType];
  const result = {
    position,
    label: item.label,
    recurrence: item.recurrence,
    sourceType: item.sourceType,
    weekday: null,
    startMinute: null,
    startsAt: null,
    durationMinutes: item.durationMinutes,
    priority: item.priority,
    musicModeId: sourceField === "musicModeId" ? item.sourceId : null,
    radioClockId: sourceField === "radioClockId" ? item.sourceId : null,
    schoolRundownId: sourceField === "schoolRundownId" ? item.sourceId : null
  };
  if (item.sourceType === "RADIO_CLOCK" && item.durationMinutes !== 60) {
    throw new Error(`Item ${position + 1} uses a Radio Clock and must reserve exactly 60 minutes.`);
  }
  if (item.recurrence === "WEEKLY") {
    const startMinute = parseLocalTime(item.startTime);
    if (!Number.isInteger(item.weekday) || startMinute === null) throw new Error(`Item ${position + 1} needs a weekday and valid local start time.`);
    result.weekday = item.weekday;
    result.startMinute = startMinute;
  } else {
    const startsAt = new Date(item.startsAt || "");
    if (Number.isNaN(startsAt.valueOf())) throw new Error(`Item ${position + 1} needs a valid one-off start time.`);
    result.startsAt = startsAt;
  }
  return result;
}

export function parseProgrammeScheduleInput(input) {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Enter valid schedule settings." };
  if (!isValidIanaTimezone(parsed.data.timezone)) return { ok: false, error: "Select a valid IANA timezone." };
  try {
    return {
      ok: true,
      data: {
        channelId: parsed.data.channelId,
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        items: parsed.data.items.map(normaliseItem)
      }
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function addUtcDays(date, amount) {
  const next = new Date(`${date}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

function createLocalDateTimeReader(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  return (instant) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
  };
}

function localMinuteToUtc(date, minute, timezone, readLocal) {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;
  const desired = Date.UTC(year, month - 1, day, hour, minuteOfHour, 0, 0);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = readLocal(new Date(guess));
    const [localYear, localMonth, localDay] = local.date.split("-").map(Number);
    const represented = Date.UTC(localYear, localMonth - 1, localDay, Math.floor(local.minute / 60), local.minute % 60, 0, 0);
    const difference = desired - represented;
    if (difference === 0) break;
    guess += difference;
  }
  const verified = readLocal(new Date(guess));
  if (verified.date !== date || verified.minute !== minute) throw new Error(`Local time ${date} ${String(hour).padStart(2, "0")}:${String(minuteOfHour).padStart(2, "0")} does not exist in ${timezone}.`);
  return new Date(guess);
}

function sourceSummary(item) {
  if (item.musicMode) return { id: item.musicMode.id, name: item.musicMode.name, status: item.musicMode.status };
  if (item.radioClock) return { id: item.radioClock.id, name: item.radioClock.name, status: item.radioClock.status, version: item.radioClock.publishedVersion };
  if (item.schoolRundown) return { id: item.schoolRundown.id, name: item.schoolRundown.episode?.title || "Approved rundown", status: item.schoolRundown.status, version: item.schoolRundown.approvedRevision };
  return { id: programmeScheduleSourceId(item), name: item.label, status: "UNKNOWN" };
}

export function compileProgrammeScheduleHorizon(version, { timezone, startsAt = new Date(), days = 7 } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_PROGRAMME_HORIZON_DAYS) throw new Error(`Preview between 1 and ${MAX_PROGRAMME_HORIZON_DAYS} days.`);
  if (!isValidIanaTimezone(timezone)) throw new Error("Select a valid IANA timezone.");
  const readLocal = createLocalDateTimeReader(timezone);
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(start.valueOf())) throw new Error("Choose a valid preview start.");
  const localStart = readLocal(start);
  const firstDate = localStart.date;
  const horizonStart = localMinuteToUtc(firstDate, 0, timezone, readLocal);
  const endDate = addUtcDays(firstDate, days);
  const horizonEnd = localMinuteToUtc(endDate, 0, timezone, readLocal);
  const occurrences = [];

  for (const item of version?.items || []) {
    if (item.recurrence === "ONE_OFF") {
      const occurrenceStart = item.startsAt instanceof Date ? item.startsAt : new Date(item.startsAt);
      const occurrenceEnd = new Date(occurrenceStart.valueOf() + item.durationMinutes * 60_000);
      if (occurrenceEnd > horizonStart && occurrenceStart < horizonEnd) occurrences.push({ item, startsAt: occurrenceStart, endsAt: occurrenceEnd });
      continue;
    }
    for (let offset = 0; offset < days; offset += 1) {
      const date = addUtcDays(firstDate, offset);
      if (new Date(`${date}T12:00:00.000Z`).getUTCDay() !== item.weekday) continue;
      const occurrenceStart = localMinuteToUtc(date, item.startMinute, timezone, readLocal);
      occurrences.push({ item, startsAt: occurrenceStart, endsAt: new Date(occurrenceStart.valueOf() + item.durationMinutes * 60_000) });
    }
  }
  if (occurrences.length > MAX_PROGRAMME_OCCURRENCES) throw new Error("This schedule produces too many preview occurrences.");
  occurrences.sort((left, right) => left.startsAt - right.startsAt || right.item.priority - left.item.priority || left.item.position - right.item.position);
  const conflicts = [];
  for (let index = 0; index < occurrences.length; index += 1) {
    for (let other = index + 1; other < occurrences.length && occurrences[other].startsAt < occurrences[index].endsAt; other += 1) {
      const left = occurrences[index];
      const right = occurrences[other];
      conflicts.push({
        leftPosition: left.item.position,
        rightPosition: right.item.position,
        startsAt: right.startsAt,
        endsAt: new Date(Math.min(left.endsAt.valueOf(), right.endsAt.valueOf())),
        severity: left.item.priority === right.item.priority ? "BLOCKING" : "CONTROLLED_OVERRIDE",
        winnerPosition: left.item.priority === right.item.priority ? null : (left.item.priority > right.item.priority ? left.item.position : right.item.position)
      });
    }
  }
  return {
    timezone,
    startsAt: horizonStart,
    endsAt: horizonEnd,
    days,
    occurrences: occurrences.map(({ item, startsAt: occurrenceStart, endsAt }) => ({
      itemId: item.id || null,
      position: item.position,
      label: item.label,
      recurrence: item.recurrence,
      sourceType: item.sourceType,
      sourceId: programmeScheduleSourceId(item),
      source: sourceSummary(item),
      priority: item.priority,
      startsAt: occurrenceStart,
      endsAt
    })),
    conflicts
  };
}

export function assertProgrammeSchedulePublishable(version, options = {}) {
  if (!version?.items?.length) throw new Error("Add at least one programme before publishing.");
  const preview = compileProgrammeScheduleHorizon(version, options);
  const blocking = preview.conflicts.filter((conflict) => conflict.severity === "BLOCKING");
  if (blocking.length) throw new Error("Resolve schedule overlaps that have the same priority before publishing.");
  return preview;
}

export function formatProgrammeScheduleTime(minute) {
  const value = Math.max(0, Math.min(1439, Number(minute) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
