import { z } from "zod";
import { compileProgrammeScheduleHorizon, localMinuteToUtc } from "./advanced-scheduler.mjs";
import { normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { isValidIanaTimezone, parseLocalTime } from "./opening-hours.mjs";

export const SIMPLE_PLAYLIST_MODES = Object.freeze(["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"]);
const cuid = z.string().cuid();
const form = z.object({
  name: z.string().trim().min(2).max(120),
  durationValue: z.coerce.number().int().min(1).max(30),
  durationUnit: z.enum(["HOURS", "DAYS"]),
  buildMode: z.enum(SIMPLE_PLAYLIST_MODES),
  genreCodes: z.array(z.string().trim().min(1).max(80)).min(1).max(48)
});

export function parseSimplePlaylist(input, availableGenres) {
  const result = form.safeParse(input);
  if (!result.success) return { ok: false, error: result.error.issues[0]?.message || "Complete the playlist details." };
  const data = result.data;
  const codes = data.genreCodes.map(normaliseGenreCode);
  if (data.buildMode === "RANDOM_GENRE_POOL" && new Set(codes).size !== codes.length) {
    return { ok: false, error: "Choose each genre only once for a random mix." };
  }
  if (availableGenres && codes.some((code) => !availableGenres.has(code))) {
    return { ok: false, error: "Choose only genres available in your music library." };
  }
  return { ok: true, data: { name: data.name, durationMinutes: data.durationValue * (data.durationUnit === "DAYS" ? 1440 : 60), simpleBuildMode: data.buildMode, genreCodes: codes } };
}

export function parsePlaylistEvent(input) {
  const result = z.object({ channelId: cuid, playlistId: cuid, startsAt: z.string(), endsAt: z.string(), timezone: z.string() }).safeParse(input);
  if (!result.success) return { ok: false, error: "Choose a channel, playlist and start/end times." };
  const { channelId, playlistId, timezone } = result.data;
  if (!isValidIanaTimezone(timezone)) return { ok: false, error: "Choose a valid channel timezone." };
  const toInstant = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a local date and time.");
    const [date, time] = value.split("T");
    const minute = parseLocalTime(time);
    if (minute === null) throw new Error("Enter a valid time.");
    return localMinuteToUtc(date, minute, timezone);
  };
  try {
    const startsAt = toInstant(result.data.startsAt);
    const endsAt = toInstant(result.data.endsAt);
    if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 30 * 86400000) throw new Error("Choose an end after the start, within 30 days.");
    return { ok: true, data: { channelId, smartPlaylistId: playlistId, timezone, startsAt, endsAt } };
  } catch (error) { return { ok: false, error: error.message }; }
}

export function findPlaylistConflict(events, candidate, excludeId = null) {
  return (events || []).find((event) => event.id !== excludeId && !event.cancelledAt && event.startsAt < candidate.endsAt && candidate.startsAt < event.endsAt) || null;
}

export function findPublishedProgrammeConflict(version, candidate, timezone) {
  if (!version?.items?.length) return null;
  // An event is at most 30 days long; the 31-day horizon also includes the
  // channel-local midnight preceding its start.
  const horizon = compileProgrammeScheduleHorizon(version, { timezone, startsAt: candidate.startsAt, days: 31 });
  return horizon.occurrences.find((item) => item.startsAt < candidate.endsAt && candidate.startsAt < item.endsAt) || null;
}

function stableRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Entries have already passed the shared rights/availability gate. Reuse this
// selector for a scheduled template and a channel's Non-Stop genre pool.
export function buildGenreRotation({ entries, genreCodes = [], buildMode = "RANDOM_GENRE_POOL", durationMinutes = 60, seed = "rotation" }) {
  const pool = (entries || []).filter((entry) => Number(entry.track?.mediaAsset?.durationSeconds) > 0);
  const genres = genreCodes.map(normaliseGenreCode);
  if (!pool.length || (genres.length === 0 && buildMode === "GENRE_SEQUENCE")) return { entries: [], warnings: ["No eligible music is available."] };
  const random = stableRandom(seed);
  const result = [];
  const warnings = [];
  const recentTracks = [];
  const recentArtists = [];
  let seconds = 0;
  const target = Math.min(30 * 86400, Math.max(60, durationMinutes * 60));
  while (seconds < target && result.length < 1000) {
    const genre = buildMode === "GENRE_SEQUENCE" ? genres[result.length % genres.length] : null;
    const allowed = pool.filter((entry) => !genres.length || entry.genreCodes?.some((code) => genres.includes(code)));
    const preferred = genre ? allowed.filter((entry) => entry.genreCodes?.includes(genre)) : allowed;
    if (genre && !preferred.length && !warnings.includes(`No eligible ${genre} track; using another selected genre.`)) warnings.push(`No eligible ${genre} track; using another selected genre.`);
    const choices = preferred.length ? preferred : allowed;
    if (!choices.length) break;
    const fresh = choices.filter((entry) => !recentTracks.includes(entry.track.id) && !recentArtists.includes(entry.track.artist?.toLowerCase()));
    const withoutTrack = choices.filter((entry) => !recentTracks.includes(entry.track.id));
    const candidates = fresh.length ? fresh : withoutTrack.length ? withoutTrack : choices;
    const selected = candidates[Math.floor(random() * candidates.length)];
    result.push(selected);
    seconds += Number(selected.track.mediaAsset.durationSeconds);
    recentTracks.push(selected.track.id);
    recentArtists.push(selected.track.artist?.toLowerCase());
    if (recentTracks.length > Math.min(10, Math.max(1, pool.length - 1))) recentTracks.shift();
    if (recentArtists.length > Math.min(4, Math.max(1, pool.length - 1))) recentArtists.shift();
  }
  return { entries: result, warnings };
}
