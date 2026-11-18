import { createHash } from "node:crypto";
import { parseProgrammeScheduleInput, compileProgrammeScheduleHorizon, formatProgrammeScheduleTime, localMinuteToUtc } from "./advanced-scheduler.mjs";
import { normaliseGenreCode } from "./autodj-genre-entitlements.mjs";

export const CONTINUOUS_SCHEDULE = Object.freeze({ kind: "OWNER_TEST_RADIO_WEEKLY_V1", controlId: "test-radio-continuous-schedule-v1",
  maximumSources: 20, maximumTracks: 2000, maximumSourceTracks: 64, maximumVersions: 200, minimumLeadMs: 60_000, runtimeDays: 2, previewDays: 31 });
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const scheduleHash = value => createHash("sha256").update(canonical(value)).digest("hex");
export const scheduleError = code => Object.assign(new Error(code), { code });
export function scheduleFormItems(items) {
  return (items || []).map(item => ({ label: item.label, recurrence: item.recurrence, sourceType: item.sourceType,
    sourceId: item.musicModeId || item.sourceId, weekday: item.weekday, startTime: Number.isInteger(item.startMinute) ? formatProgrammeScheduleTime(item.startMinute) : null,
    startsAt: item.startsAt ? new Date(item.startsAt).toISOString() : null, durationMinutes: item.durationMinutes, priority: item.priority }));
}
export function parseContinuousSchedule(input) {
  const result = parseProgrammeScheduleInput(input);
  if (!result.ok || result.data.items.some(item => item.sourceType !== "MUSIC_MODE")) throw scheduleError("SCHEDULE_INPUT_INVALID");
  return result.data;
}
export function canonicalScheduleItems(items) {
  return (items || []).map(item => ({ id: item.id, position: item.position, label: item.label, recurrence: item.recurrence,
    sourceType: item.sourceType, weekday: item.weekday ?? null, startMinute: item.startMinute ?? null,
    startsAt: item.startsAt ? new Date(item.startsAt).toISOString() : null, durationMinutes: item.durationMinutes,
    priority: item.priority, musicModeId: item.musicModeId ?? null, radioClockId: item.radioClockId ?? null, schoolRundownId: item.schoolRundownId ?? null }));
}
export function simpleScheduleSource(mode) {
  const recipe = mode?.smartPlaylist;
  if (!mode || !["DRAFT", "ACTIVE"].includes(mode.status) || mode.source !== "SMART_PLAYLIST" ||
    !recipe || recipe.organisationId !== mode.organisationId || recipe.musicModeId !== mode.id ||
    !["DRAFT", "ACTIVE"].includes(recipe.status) || recipe.rightsUse !== "ONLINE_RADIO" ||
    !["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"].includes(recipe.simpleBuildMode) ||
    !Array.isArray(recipe.genreCodes) || !recipe.genreCodes.length || recipe.genreCodes.length > 48 ||
    recipe.genreCodes.some(code => typeof code !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(code))) return null;
  const genreCodes = recipe.genreCodes.map(normaliseGenreCode);
  return { id: mode.id, name: mode.name, buildMode: recipe.simpleBuildMode, genreCodes };
}
export function scheduleTrackDescriptor(entry) {
  return { trackId: entry.track.id, mediaAssetId: entry.track.mediaAssetId, fingerprint: entry.fingerprint,
    durationSeconds: entry.durationSeconds,
    genreCodes: [...new Set((entry.track.mediaAsset.genres || []).map(value => normaliseGenreCode(value.mediaGenre?.slug || "")).filter(Boolean))].sort() };
}
// Reuse the canonical timezone converter. A DST gap skips only that occurrence;
// it must not cancel all later programmes or stop the random fallback.
export function compileContinuousSchedule(version, { timezone, startsAt = new Date(), days = 7 } = {}) {
  let result;
  const warnings = [];
  try { result = compileProgrammeScheduleHorizon(version, { timezone, startsAt, days }); }
  catch (error) {
    if (!/does not exist/.test(error.message)) throw error;
    const base = compileProgrammeScheduleHorizon({ items: [] }, { timezone, startsAt, days });
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(base.startsAt).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const firstDate = `${parts.year}-${parts.month}-${parts.day}`;
    const found = new Map();
    for (const item of version.items) {
      for (let day = 0; day < days; day += 1) {
        try {
          const date = new Date(`${firstDate}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + day);
          // Step calendar dates, not elapsed24-hour windows from the caller's
          // clock: a short DST day can otherwise skip a whole requested day.
          const anchor = localMinuteToUtc(date.toISOString().slice(0, 10), 12 * 60, timezone);
          const part = compileProgrammeScheduleHorizon({ items: [item] }, { timezone, startsAt: anchor, days: 1 });
          for (const occurrence of part.occurrences) if (occurrence.endsAt > base.startsAt && occurrence.startsAt < base.endsAt)
            found.set(`${occurrence.position}:${occurrence.startsAt.toISOString()}`, occurrence);
        } catch (inner) {
          if (!/does not exist/.test(inner.message)) throw inner;
          warnings.push(`Skipped a nonexistent daylight-saving start for ${item.label}. Random AutoDJ continues instead.`);
        }
      }
    }
    const occurrences = [...found.values()].sort((a, b) => a.startsAt - b.startsAt || b.priority - a.priority || a.position - b.position);
    result = { ...base, occurrences, conflicts: [] };
    for (let i = 0; i < occurrences.length; i++) for (let j = i + 1; j < occurrences.length && occurrences[j].startsAt < occurrences[i].endsAt; j++) {
      const a = occurrences[i], b = occurrences[j];
      result.conflicts.push({ severity: a.priority === b.priority ? "BLOCKING" : "CONTROLLED_OVERRIDE" });
    }
  }
  if (result.conflicts.some(conflict => conflict.severity === "BLOCKING")) warnings.push("Programmes with the same priority overlap. Resolve these before approval.");
  if (result.conflicts.some(conflict => conflict.severity === "CONTROLLED_OVERRIDE")) warnings.push("Overlapping programmes use priority: the higher priority takes over exactly on time.");
  return { ...result, warnings: [...new Set(warnings)] };
}
export function buildContinuousScheduleSnapshot({ stationId, organisationId, channelId, schedule, version, sources, authorizedTracks }) {
  if (!version || !["DRAFT", "PUBLISHED"].includes(version.status) || version.organisationId !== organisationId || version.scheduleId !== schedule.id || !Array.isArray(version.items) ||
    !version.items.length || version.items.length > 200 || sources.length > CONTINUOUS_SCHEDULE.maximumSources || authorizedTracks.length > CONTINUOUS_SCHEDULE.maximumTracks)
    throw scheduleError("SCHEDULE_SCOPE_INVALID");
  const parsed = parseContinuousSchedule({ channelId, name: schedule.name, timezone: schedule.timezone, items: scheduleFormItems(version.items) });
  // Revalidation must not silently normalize corrupted canonical rows.
  const items = canonicalScheduleItems(version.items);
  if (items.some((item, index) => !item.id || item.position !== index || item.sourceType !== "MUSIC_MODE" || item.radioClockId || item.schoolRundownId ||
    scheduleHash({ ...item, id: undefined }) !== scheduleHash({ ...canonicalScheduleItems(parsed.items)[index], id: undefined }))) throw scheduleError("SCHEDULE_SCOPE_INVALID");
  const referenced = [...new Set(items.map(item => item.musicModeId))].sort();
  const frozenSources = referenced.map(id => {
    const source = sources.find(candidate => candidate.id === id);
    if (!source) throw scheduleError("SCHEDULE_SOURCE_UNAVAILABLE");
    const tracks = authorizedTracks.map(scheduleTrackDescriptor).filter(track => track.genreCodes.some(code => source.genreCodes.includes(code)))
      .sort((a, b) => a.trackId.localeCompare(b.trackId));
    if (!tracks.length) throw scheduleError("SCHEDULE_NO_APPROVED_MUSIC");
    if (tracks.length > CONTINUOUS_SCHEDULE.maximumSourceTracks) throw scheduleError("SCHEDULE_PLAYLIST_TOO_LARGE");
    return { ...source, tracks };
  });
  const snapshot = { stationId, organisationId, channelId, scheduleId: schedule.id, versionId: version.id, version: version.version,
    timezone: schedule.timezone, name: schedule.name, items, sources: frozenSources };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2 * 1024 * 1024) throw scheduleError("SCHEDULE_SCOPE_INVALID");
  return snapshot;
}
export function continuousScheduleLeadTime(snapshot, now = new Date()) {
  const effectiveAt = new Date(now.getTime() + CONTINUOUS_SCHEDULE.minimumLeadMs);
  const preview = compileContinuousSchedule(snapshot, { timezone: snapshot.timezone, startsAt: now, days: 2 });
  if (preview.occurrences.some(item => item.startsAt < effectiveAt && item.endsAt > now)) throw scheduleError("SCHEDULE_LEAD_TIME_REQUIRED");
  return effectiveAt;
}
