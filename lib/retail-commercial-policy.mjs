// Browser-safe draft planning only. This module never sends audio or changes a
// live schedule. Commercial insertion requires a separate reviewed worker path.
export const RETAIL_COMMERCIAL_LIMITS = Object.freeze({ maximumRules: 20, maximumSpotsPerRule: 20,
  maximumSpots: 100, maximumVersions: 100, maximumSpotSeconds: 600, maximumBreakSeconds: 600 });
export const RETAIL_COMMERCIAL_MODES = Object.freeze(["EVERY_SONGS", "EVERY_MINUTES", "SCHEDULED", "TOP_OF_HOUR"]);
const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_COMMERCIAL_${code}` }); };
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const exactKeys = (value, fields) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => fields.includes(key));
const text = value => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120 && !/[\u0000-\u001f\u007f]/.test(value);
const whole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const unique = values => new Set(values).size === values.length;
function date(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("DATE_INVALID");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail("DATE_INVALID");
  return value;
}
export function retailCommercialLocalDate(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("DATE_INVALID");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function normaliseRetailCommercialRule(rule) {
  if (!exactKeys(rule, ["name", "mode", "spotIds", "weekdays", "everySongs", "everyMinutes", "times", "hours", "startsOn", "endsOn"]) ||
      !text(rule.name) || !RETAIL_COMMERCIAL_MODES.includes(rule.mode) || !Array.isArray(rule.spotIds) ||
      !rule.spotIds.length || rule.spotIds.length > RETAIL_COMMERCIAL_LIMITS.maximumSpotsPerRule || !rule.spotIds.every(id) || !unique(rule.spotIds) ||
      !Array.isArray(rule.weekdays) || !rule.weekdays.length || rule.weekdays.length > 7 || !rule.weekdays.every(d => whole(d, 0, 6)) || !unique(rule.weekdays)) fail("RULE_INVALID");
  const startsOn = date(rule.startsOn), endsOn = date(rule.endsOn);
  if (startsOn && endsOn && endsOn < startsOn) fail("DATE_INVALID");
  const result = { name: rule.name.trim(), mode: rule.mode, spotIds: [...rule.spotIds], weekdays: [...rule.weekdays].sort((a, b) => a - b), startsOn, endsOn };
  if (rule.mode === "EVERY_SONGS") {
    if (!whole(rule.everySongs, 1, 50)) fail("FREQUENCY_INVALID");
    result.everySongs = rule.everySongs;
  } else if (rule.mode === "EVERY_MINUTES") {
    if (!whole(rule.everyMinutes, 1, 180)) fail("FREQUENCY_INVALID");
    result.everyMinutes = rule.everyMinutes;
  } else if (rule.mode === "SCHEDULED") {
    if (!Array.isArray(rule.times) || !rule.times.length || rule.times.length > 48 || !unique(rule.times) ||
        rule.times.some(t => typeof t !== "string" || !/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(t))) fail("TIME_INVALID");
    result.times = [...rule.times].sort();
  } else {
    if (!Array.isArray(rule.hours) || !rule.hours.length || rule.hours.length > 24 || !unique(rule.hours) || !rule.hours.every(h => whole(h, 0, 23))) fail("TIME_INVALID");
    result.hours = [...rule.hours].sort((a, b) => a - b);
  }
  return result;
}
export function normaliseRetailCommercialDraft(input) {
  if (!exactKeys(input, ["name", "timezone", "rules"]) || !text(input.name) || input.timezone !== "Europe/Malta" ||
      !Array.isArray(input.rules) || input.rules.length > RETAIL_COMMERCIAL_LIMITS.maximumRules) fail("DRAFT_INVALID");
  const rules = input.rules.map(normaliseRetailCommercialRule);
  if (!unique(rules.map(rule => rule.name.toLowerCase()))) fail("DUPLICATE_NAME");
  return { name: input.name.trim(), timezone: "Europe/Malta", rules };
}
export function retailCommercialRuleDescription(input) {
  const rule = normaliseRetailCommercialRule(input);
  const when = rule.mode === "EVERY_SONGS" ? `After every ${rule.everySongs} music ${rule.everySongs === 1 ? "song" : "songs"}` :
    rule.mode === "EVERY_MINUTES" ? `Every ${rule.everyMinutes} minutes, after the current song` :
    rule.mode === "TOP_OF_HOUR" ? `At the top of ${rule.hours.length === 24 ? "each hour" : "the selected hours"}` : `At ${rule.times.join(", ")}`;
  return `${when}; play ${rule.spotIds.length} ${rule.spotIds.length === 1 ? "spot" : "spots"} in the selected order, then return to music.`;
}
// This is an explanatory pattern, not the actual playlist or a proof of play.
// Song-based rules have ordinal positions; minute rules express nominal due
// times because the current song's actual end is deliberately unknown here.
export function simulateRetailCommercialRule(input, { songs = 6, minutes = 60, weekday = 1, startTime = "09:00", date: day = null, maxEvents = 20, spots = [] } = {}) {
  const rule = normaliseRetailCommercialRule(input);
  if (!whole(songs, 0, 1000) || !whole(minutes, 1, 1440) || !whole(weekday, 0, 6) || !whole(maxEvents, 1, 100) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)) fail("PREVIEW_INVALID");
  const localDate = date(day), start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  const durations = rule.spotIds.map(id => spots.find(spot => spot.id === id)?.durationSeconds);
  const breakSeconds = durations.every(value => Number.isFinite(value) && value > 0 && value <= RETAIL_COMMERCIAL_LIMITS.maximumSpotSeconds) ? durations.reduce((sum, seconds) => sum + seconds, 0) : null;
  const events = []; let total = 0, skippedOverlaps = 0, occupiedUntil = -Infinity;
  const emit = (data, nominalSeconds = null) => {
    if (nominalSeconds !== null && nominalSeconds < occupiedUntil) { skippedOverlaps++; return; }
    if (nominalSeconds !== null && breakSeconds !== null) occupiedUntil = nominalSeconds + breakSeconds;
    total++; if (events.length < maxEvents) events.push({ ...data, spotIds: [...rule.spotIds], durationSeconds: breakSeconds, returnsToMusic: true });
  };
  if (rule.weekdays.includes(weekday) && (!localDate || (!rule.startsOn || localDate >= rule.startsOn) && (!rule.endsOn || localDate <= rule.endsOn))) {
    if (rule.mode === "EVERY_SONGS") for (let count = rule.everySongs; count <= songs; count += rule.everySongs) emit({ afterSong: count });
    else if (rule.mode === "EVERY_MINUTES") for (let offset = rule.everyMinutes; offset <= minutes; offset += rule.everyMinutes) emit({ afterMinutes: offset, afterCurrentSong: true }, offset * 60);
    else {
      const times = rule.mode === "SCHEDULED" ? rule.times : rule.hours.map(hour => `${String(hour).padStart(2, "0")}:00`);
      for (const time of times) { const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
        if (minute >= start && minute < Math.min(1440, start + minutes)) emit({ at: time, exactTime: true }, (minute - start) * 60); }
    }
  }
  return { illustrationOnly: true, playbackConnected: false, events, truncated: total > events.length, skippedOverlaps,
    description: retailCommercialRuleDescription(rule), notice: "Pattern preview only. These draft rules do not change or insert live audio." };
}
