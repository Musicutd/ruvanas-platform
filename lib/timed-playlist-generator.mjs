import crypto from "node:crypto";
import { z } from "zod";
import { isValidIanaTimezone, parseLocalTime } from "./opening-hours.mjs";
import { genreCodesForTrack, licensedGenresForLevel, normaliseGenreCode, sourceScopeForTrack } from "./autodj-genre-entitlements.mjs";
import { musicTrackEligibility } from "./media-library-pro.mjs";

export const MAX_TIMED_PLAYLIST_WINDOW_MINUTES = 12 * 60;
export const MAX_TIMED_PLAYLIST_CANDIDATES = 750;
export const TIMED_PLAYLIST_TOLERANCE_SECONDS = 180;
export const TIMED_PLAYLIST_CROSSFADE_SECONDS = 2;

const inputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  targetType: z.enum(["LOCATION", "ZONE", "SCHOOL", "CHANNEL", "HEALTH_CHANNEL", "FAITH_CHANNEL"]),
  targetId: z.string().trim().min(1).max(120),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string(),
  endTime: z.string(),
  selectedGenreCodes: z.array(z.string()).min(1).max(24),
  sourceScopes: z.array(z.string()).min(1).max(3),
  territory: z.string().trim().max(80).optional().nullable()
});

export function parseTimedPlaylistInput(input, { timezone, rightsUse }) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Enter valid playlist settings." };
  const startMinute = parseLocalTime(parsed.data.startTime);
  const endMinute = parseLocalTime(parsed.data.endTime);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) return { ok: false, error: "End time must be later than start time on the selected date." };
  if (endMinute - startMinute > MAX_TIMED_PLAYLIST_WINDOW_MINUTES) return { ok: false, error: "A generated playlist can cover at most 12 hours." };
  if (!isValidIanaTimezone(timezone)) return { ok: false, error: "The selected target does not have a valid timezone." };
  return { ok: true, data: { ...parsed.data, startMinute, endMinute, timezone, rightsUse, selectedGenreCodes: parsed.data.selectedGenreCodes.map(normaliseGenreCode) } };
}

function score(seed, trackId, cycle) {
  return crypto.createHash("sha256").update(`${seed}:${cycle}:${trackId}`).digest("hex");
}

function primaryGenre(track, selected) {
  return genreCodesForTrack(track).find((code) => selected.has(code)) || null;
}

export function eligibleTimedPlaylistCandidates(tracks, config, instant = new Date()) {
  const selected = new Set(config.selectedGenreCodes.map(normaliseGenreCode));
  const scopes = new Set(config.sourceScopes);
  return (tracks || []).filter((track) => {
    if (config.rightsUse === "SCHOOL_RADIO" && track.isExplicit === true) return false;
    const sourceScope = sourceScopeForTrack(track);
    if (!scopes.has(sourceScope) || !primaryGenre(track, selected)) return false;
    return musicTrackEligibility(track, {
      organisationId: config.organisationId,
      requiredUse: config.rightsUse,
      territory: config.territory,
      instant,
      licensedCatalogueLevel: config.catalogueLevel,
      selectedGenreCodes: config.selectedGenreCodes
    }).playable;
  });
}

export function generateTimedPlaylist({ tracks, config, seed, instant = new Date() }) {
  const requestedDurationSeconds = (config.endMinute - config.startMinute) * 60;
  const selected = new Set(config.selectedGenreCodes.map(normaliseGenreCode));
  const candidates = eligibleTimedPlaylistCandidates(tracks, config, instant).slice(0, MAX_TIMED_PLAYLIST_CANDIDATES);
  const warnings = [];
  if (!candidates.length) return { seed, requestedDurationSeconds, generatedDurationSeconds: 0, varianceSeconds: -requestedDurationSeconds, items: [], genreDistribution: {}, warnings: ["No rights-safe tracks match this target, source and genre selection."] };
  if (candidates.length < Math.max(6, config.selectedGenreCodes.length * 2)) warnings.push("The eligible music pool is small, so repetition may be noticeable.");
  if (candidates.some((track) => !Number.isInteger(track.mediaAsset?.durationSeconds) || track.mediaAsset.durationSeconds <= 0)) warnings.push("Tracks without a verified duration were excluded.");

  const usable = candidates.filter((track) => Number.isInteger(track.mediaAsset?.durationSeconds) && track.mediaAsset.durationSeconds > TIMED_PLAYLIST_CROSSFADE_SECONDS);
  const items = [];
  let elapsed = 0;
  let cycle = 0;
  let previousTrackId = null;
  let previousArtist = null;
  let previousGenre = null;
  const maximumItems = Math.min(500, Math.ceil(requestedDurationSeconds / 30));

  while (elapsed < requestedDurationSeconds - TIMED_PLAYLIST_TOLERANCE_SECONDS && items.length < maximumItems) {
    const ranked = usable
      .filter((track) => track.id !== previousTrackId)
      .map((track) => ({ track, genreCode: primaryGenre(track, selected), key: score(seed, track.id, cycle) }))
      .sort((left, right) => {
        const artistPenaltyLeft = String(left.track.artist).toLowerCase() === String(previousArtist).toLowerCase() ? 1 : 0;
        const artistPenaltyRight = String(right.track.artist).toLowerCase() === String(previousArtist).toLowerCase() ? 1 : 0;
        if (artistPenaltyLeft !== artistPenaltyRight) return artistPenaltyLeft - artistPenaltyRight;
        const genrePenaltyLeft = left.genreCode === previousGenre ? 1 : 0;
        const genrePenaltyRight = right.genreCode === previousGenre ? 1 : 0;
        return genrePenaltyLeft - genrePenaltyRight || left.key.localeCompare(right.key);
      });
    if (!ranked.length) break;
    const remaining = requestedDurationSeconds - elapsed;
    const fitting = ranked.find(({ track }) => track.mediaAsset.durationSeconds - (items.length ? TIMED_PLAYLIST_CROSSFADE_SECONDS : 0) <= remaining + TIMED_PLAYLIST_TOLERANCE_SECONDS);
    const selectedTrack = fitting || ranked[0];
    const transitionSeconds = items.length ? TIMED_PLAYLIST_CROSSFADE_SECONDS : 0;
    const durationSeconds = selectedTrack.track.mediaAsset.durationSeconds;
    const startOffsetSeconds = Math.max(0, elapsed - transitionSeconds);
    const endOffsetSeconds = startOffsetSeconds + durationSeconds;
    items.push({
      trackId: selectedTrack.track.id,
      position: items.length,
      startOffsetSeconds,
      endOffsetSeconds,
      durationSeconds,
      genreCode: selectedTrack.genreCode,
      sourceScope: sourceScopeForTrack(selectedTrack.track),
      explanation: `${selectedTrack.genreCode.replaceAll("_", " ")} · rights and target checks passed`,
      track: selectedTrack.track
    });
    elapsed = endOffsetSeconds;
    previousTrackId = selectedTrack.track.id;
    previousArtist = selectedTrack.track.artist;
    previousGenre = selectedTrack.genreCode;
    cycle += 1;
    if (cycle > usable.length * 3 && Math.abs(requestedDurationSeconds - elapsed) <= TIMED_PLAYLIST_TOLERANCE_SECONDS) break;
  }
  const genreDistribution = items.reduce((summary, item) => ({ ...summary, [item.genreCode]: (summary[item.genreCode] || 0) + 1 }), {});
  const varianceSeconds = elapsed - requestedDurationSeconds;
  if (Math.abs(varianceSeconds) > TIMED_PLAYLIST_TOLERANCE_SECONDS) warnings.push(`Generated duration differs from the requested window by ${Math.abs(varianceSeconds)} seconds.`);
  const seen = new Set();
  if (items.some((item) => seen.has(item.trackId) || !seen.add(item.trackId))) warnings.push("The requested duration requires some track repetition.");
  return { seed, requestedDurationSeconds, generatedDurationSeconds: elapsed, varianceSeconds, items, genreDistribution, warnings };
}

export function invalidationForCatalogueDowngrade(playlist, currentLevel, configuredGenres = []) {
  if (!["DRAFT", "PUBLISHED"].includes(playlist?.status)) return null;
  const allowed = new Set(licensedGenresForLevel(currentLevel, configuredGenres).map((genre) => genre.code));
  const restricted = (playlist.selectedGenreCodes || []).map(normaliseGenreCode).filter((code) => !allowed.has(code));
  return (playlist.sourceScopes || []).includes("LICENSED_CATALOGUE") && restricted.length
    ? `Plan change removed access to: ${restricted.join(", ")}. Review before future playback.`
    : null;
}
