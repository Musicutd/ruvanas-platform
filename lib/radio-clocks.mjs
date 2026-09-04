import { z } from "zod";
import { SHOW_TRANSITIONS } from "./show-builder.mjs";

export const RADIO_CLOCK_DURATION_SECONDS = 3600;
export const MAX_RADIO_CLOCK_ITEMS = 100;
export const MAX_RADIO_CLOCK_EXPANSIONS = 168;
export const RADIO_CLOCK_ITEM_TYPES = Object.freeze([
  "MUSIC_MODE", "MUSIC_TRACK", "PROMO", "SHOW_RUNDOWN", "MARKER"
]);
export const RADIO_CLOCK_TRANSITIONS = Object.freeze([...SHOW_TRANSITIONS]);

const SOURCE_FIELD = Object.freeze({
  MUSIC_MODE: "musicModeId",
  MUSIC_TRACK: "trackId",
  PROMO: "promoVersionId",
  SHOW_RUNDOWN: "schoolRundownId"
});

const itemSchema = z.object({
  type: z.enum(RADIO_CLOCK_ITEM_TYPES),
  label: z.string().trim().min(2).max(160),
  durationSeconds: z.coerce.number().int().min(0).max(RADIO_CLOCK_DURATION_SECONDS),
  transition: z.enum(RADIO_CLOCK_TRANSITIONS).default("CLEAN"),
  transitionSeconds: z.coerce.number().int().min(0).max(30).default(0),
  sourceId: z.string().trim().max(120).optional().nullable()
});

const clockSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  items: z.array(itemSchema).min(1).max(MAX_RADIO_CLOCK_ITEMS)
});

export function canAuthorRadioClock(role) {
  return ["OWNER", "MANAGER", "CONTENT_EDITOR"].includes(role);
}

export function canPublishRadioClock(role) {
  return ["OWNER", "MANAGER"].includes(role);
}

export function radioClockSlug(name) {
  const slug = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  if (!slug) throw new Error("Enter a clock name that contains letters or numbers.");
  return slug;
}

function normalizeItem(item, position) {
  const sourceField = SOURCE_FIELD[item.type] || null;
  const sourceId = item.sourceId || null;
  if (sourceField && !sourceId) throw new Error(`Item ${position + 1} needs a ${item.type.toLowerCase().replaceAll("_", " ")} source.`);
  if (!sourceField && sourceId) throw new Error(`Item ${position + 1} is a marker and cannot have an audio source.`);
  if (item.type === "MARKER" && item.durationSeconds !== 0) throw new Error(`Item ${position + 1} markers must have a zero duration.`);
  if (item.type !== "MARKER" && item.durationSeconds < 1) throw new Error(`Item ${position + 1} needs a positive duration.`);
  const overlapTransition = new Set(["CROSSFADE", "DUCK_VOICE"]).has(item.transition);
  if (overlapTransition && item.transitionSeconds < 1) throw new Error(`Item ${position + 1} needs a transition length.`);
  if (!overlapTransition && item.transitionSeconds !== 0) throw new Error(`Item ${position + 1} only supports a transition length for crossfade or voice ducking.`);
  if (item.transitionSeconds >= item.durationSeconds && item.type !== "MARKER") throw new Error(`Item ${position + 1} transition must be shorter than its duration.`);
  return {
    position,
    type: item.type,
    label: item.label,
    durationSeconds: item.durationSeconds,
    transition: item.transition,
    transitionSeconds: item.transitionSeconds,
    musicModeId: sourceField === "musicModeId" ? sourceId : null,
    trackId: sourceField === "trackId" ? sourceId : null,
    promoVersionId: sourceField === "promoVersionId" ? sourceId : null,
    schoolRundownId: sourceField === "schoolRundownId" ? sourceId : null
  };
}

export function radioClockTimeline(items = [], durationSeconds = RADIO_CLOCK_DURATION_SECONDS) {
  let cursor = 0;
  const timeline = [...items]
    .sort((left, right) => left.position - right.position)
    .map((item, position) => {
      if (item.type === "MARKER") return { ...item, position, offsetSeconds: cursor, endsAtSeconds: cursor };
      const overlap = new Set(["CROSSFADE", "DUCK_VOICE"]).has(item.transition) ? item.transitionSeconds : 0;
      const offsetSeconds = Math.max(0, cursor - overlap);
      const endsAtSeconds = offsetSeconds + item.durationSeconds;
      cursor = endsAtSeconds;
      return { ...item, position, offsetSeconds, endsAtSeconds };
    });
  return {
    items: timeline,
    plannedSeconds: cursor,
    remainingSeconds: durationSeconds - cursor,
    readyToPublish: timeline.some((item) => item.type !== "MARKER") && cursor === durationSeconds
  };
}

export function parseRadioClockInput(input) {
  const parsed = clockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Enter valid radio-clock settings." };
  try {
    const items = parsed.data.items.map(normalizeItem);
    const timeline = radioClockTimeline(items);
    if (timeline.plannedSeconds > RADIO_CLOCK_DURATION_SECONDS) {
      return { ok: false, error: `This clock overruns the hour by ${timeline.plannedSeconds - RADIO_CLOCK_DURATION_SECONDS} seconds.` };
    }
    return {
      ok: true,
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        durationSeconds: RADIO_CLOCK_DURATION_SECONDS,
        items: timeline.items.map(({ endsAtSeconds: _endsAtSeconds, ...item }) => item)
      },
      timeline
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function assertRadioClockPublishable(clock) {
  const timeline = radioClockTimeline(clock?.items || [], clock?.durationSeconds || RADIO_CLOCK_DURATION_SECONDS);
  if (!timeline.readyToPublish) {
    const difference = Math.abs(timeline.remainingSeconds);
    const direction = timeline.remainingSeconds > 0 ? "short" : "over";
    throw new Error(`The clock must fill exactly one hour. It is ${difference} seconds ${direction}.`);
  }
  return timeline;
}

export function radioClockSourceId(item) {
  const field = SOURCE_FIELD[item?.type];
  return field ? item?.[field] || item?.sourceId || null : null;
}

export function expandRadioClock(clock, { startsAt = new Date(), occurrences = 1 } = {}) {
  if (!Number.isInteger(occurrences) || occurrences < 1 || occurrences > MAX_RADIO_CLOCK_EXPANSIONS) {
    throw new Error(`Expand between 1 and ${MAX_RADIO_CLOCK_EXPANSIONS} clock hours.`);
  }
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(start.valueOf())) throw new Error("Choose a valid clock expansion start time.");
  const timeline = assertRadioClockPublishable(clock);
  return Array.from({ length: occurrences }, (_, occurrence) => {
    const hourStartsAt = new Date(start.valueOf() + occurrence * RADIO_CLOCK_DURATION_SECONDS * 1000);
    return {
      occurrence,
      startsAt: hourStartsAt,
      endsAt: new Date(hourStartsAt.valueOf() + RADIO_CLOCK_DURATION_SECONDS * 1000),
      items: timeline.items.map((item) => ({
        ...item,
        startsAt: new Date(hourStartsAt.valueOf() + item.offsetSeconds * 1000),
        endsAt: new Date(hourStartsAt.valueOf() + item.endsAtSeconds * 1000)
      }))
    };
  });
}

export function formatClockOffset(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
