import { compileProgrammeScheduleHorizon } from "./advanced-scheduler.mjs";
import { musicModeIsPlayable } from "./music-mode-playback.mjs";
import { PLAYOUT_SOURCE_PRIORITIES } from "./playout-resolver.mjs";
import { showItemDurationMs, showItemNeedsSource } from "./show-builder.mjs";
import { playableLiveMusicModeEntries } from "./music-mode-playback.mjs";
import { genreCodesForTrack } from "./autodj-genre-entitlements.mjs";
import { buildGenreRotation } from "./subscriber-playlists.mjs";

function syntheticTrackMode({ organisationId, sourceId, name, track }) {
  return {
    id: `resolved-${sourceId}`,
    organisationId,
    name,
    slug: `resolved-${sourceId}`,
    status: "ACTIVE",
    tracks: [{ weight: 100, track }]
  };
}

export function currentClockMode(clock, occurrence, instant, organisationId, eligibilityOptions = {}) {
  if (!clock || clock.status !== "PUBLISHED" || clock.version !== clock.publishedVersion) {
    return { musicMode: null, unavailableReason: "RADIO_CLOCK_NOT_CURRENT" };
  }
  const elapsedSeconds = Math.max(0, Math.floor((instant.getTime() - occurrence.startsAt.getTime()) / 1000));
  const item = (clock.items || []).find((candidate) =>
    candidate.type !== "MARKER" &&
    elapsedSeconds >= candidate.offsetSeconds &&
    elapsedSeconds < candidate.offsetSeconds + candidate.durationSeconds
  );
  if (!item) return { musicMode: null, unavailableReason: "RADIO_CLOCK_GAP" };
  const validUntil = new Date(occurrence.startsAt.getTime() + (item.offsetSeconds + item.durationSeconds) * 1000);
  if (item.type === "MUSIC_MODE" && musicModeIsPlayable(item.musicMode, instant, { organisationId, requiredUse: "ONLINE_RADIO", ...eligibilityOptions })) {
    return {
      musicMode: item.musicMode,
      liveAnchorAt: new Date(occurrence.startsAt.getTime() + item.offsetSeconds * 1000),
      validUntil,
      sourceLabel: `${clock.name} · ${item.label}`
    };
  }
  if (item.type === "MUSIC_TRACK") {
    const mode = syntheticTrackMode({ organisationId, sourceId: item.id, name: `${clock.name} · ${item.label}`, track: item.track });
    if (musicModeIsPlayable(mode, instant, { organisationId, requiredUse: "ONLINE_RADIO", ...eligibilityOptions })) return {
      musicMode: mode,
      liveAnchorAt: new Date(occurrence.startsAt.getTime() + item.offsetSeconds * 1000),
      validUntil,
      sourceLabel: mode.name
    };
  }
  return { musicMode: null, validUntil, unavailableReason: `RADIO_CLOCK_${item.type}_ADAPTER_UNAVAILABLE` };
}

export function currentRundownMode(rundown, occurrence, instant, organisationId, eligibilityOptions = {}) {
  if (!rundown || rundown.status !== "APPROVED" || rundown.revision !== rundown.approvedRevision) {
    return { musicMode: null, unavailableReason: "SHOW_RUNDOWN_NOT_CURRENT" };
  }
  const elapsedMs = Math.max(0, instant.getTime() - occurrence.startsAt.getTime());
  let cursor = 0;
  for (const item of [...(rundown.items || [])].sort((left, right) => left.position - right.position)) {
    if (item.type === "HARD_TIME" && Number.isInteger(item.cueOffsetMs)) {
      cursor = Math.max(cursor, item.cueOffsetMs);
      continue;
    }
    if (!showItemNeedsSource(item.type)) continue;
    const durationMs = showItemDurationMs(item);
    const startMs = cursor;
    const endMs = startMs + durationMs;
    cursor += Math.max(1000, durationMs - (item.transitionPreset === "CROSSFADE" ? 1000 : 0));
    if (elapsedMs < startMs || elapsedMs >= endMs) continue;
    const validUntil = new Date(occurrence.startsAt.getTime() + endMs);
    if (item.type === "MUSIC_TRACK") {
      const mode = syntheticTrackMode({ organisationId, sourceId: item.id, name: `${rundown.episode?.title || "Show"} · ${item.label}`, track: item.sourceTrack });
      if (musicModeIsPlayable(mode, instant, { organisationId, requiredUse: "ONLINE_RADIO", ...eligibilityOptions })) return {
        musicMode: mode,
        liveAnchorAt: new Date(occurrence.startsAt.getTime() + startMs),
        validUntil,
        sourceLabel: mode.name
      };
    }
    return { musicMode: null, validUntil, unavailableReason: `SHOW_RUNDOWN_${item.type}_ADAPTER_UNAVAILABLE` };
  }
  return { musicMode: null, unavailableReason: "SHOW_RUNDOWN_GAP" };
}

export function advancedProgrammeCandidates(schedule, instant, organisationId, channelId, eligibilityOptions = {}) {
  const version = schedule?.versions?.[0];
  if (!version) return [];
  const compiled = compileProgrammeScheduleHorizon(version, { timezone: schedule.timezone, startsAt: instant, days: 2 });
  return compiled.occurrences
    .filter((occurrence) => occurrence.startsAt <= instant && occurrence.endsAt > instant)
    .map((occurrence) => {
      const item = version.items.find((candidate) => candidate.id === occurrence.itemId || candidate.position === occurrence.position);
      let adapted = { musicMode: null, unavailableReason: "PROGRAMME_SOURCE_UNAVAILABLE" };
      if (item?.sourceType === "MUSIC_MODE") {
        adapted = musicModeIsPlayable(item.musicMode, instant, { organisationId, requiredUse: "ONLINE_RADIO", ...eligibilityOptions })
          ? { musicMode: item.musicMode, liveAnchorAt: occurrence.startsAt, sourceLabel: item.label }
          : { musicMode: null, unavailableReason: "MUSIC_MODE_NOT_PLAYABLE" };
      } else if (item?.sourceType === "RADIO_CLOCK") {
        adapted = currentClockMode(item.radioClock, occurrence, instant, organisationId, eligibilityOptions);
      } else if (item?.sourceType === "SHOW_RUNDOWN") {
        adapted = currentRundownMode(item.schoolRundown, occurrence, instant, organisationId, eligibilityOptions);
      }
      const programmingSource = item?.sourceType === "RADIO_CLOCK"
        ? "PROGRAMME_RADIO_CLOCK"
        : item?.sourceType === "SHOW_RUNDOWN"
          ? "PROGRAMME_SHOW_RUNDOWN"
          : "PROGRAMME_MUSIC_MODE";
      const sourceType = item?.sourceType === "SHOW_RUNDOWN" ? "SCHOOL_PROGRAMMING" : "PROGRAMME_SCHEDULE";
      return {
        organisationId,
        channelId,
        sourceType,
        sourceId: item?.id || `${version.id}:${occurrence.position}`,
        sourceRevision: `${schedule.id}:${version.version}:${item?.id || occurrence.position}`,
        label: adapted.sourceLabel || item?.label || "Scheduled programme",
        priority: PLAYOUT_SOURCE_PRIORITIES[sourceType] + (item?.priority || 0),
        available: Boolean(adapted.musicMode),
        unavailableReason: adapted.unavailableReason || null,
        validFrom: occurrence.startsAt,
        validUntil: adapted.validUntil && adapted.validUntil < occurrence.endsAt ? adapted.validUntil : occurrence.endsAt,
        proofClassification: sourceType === "SCHOOL_PROGRAMMING" ? "SCHOOL" : "SCHEDULED",
        payload: adapted.musicMode ? { resolution: {
          musicMode: adapted.musicMode,
          scheduleId: schedule.id,
          scheduleVersion: version.version,
          slotId: item?.id || null,
          reason: programmingSource,
          sourceLabel: adapted.sourceLabel || item?.label || "Scheduled programme",
          fallbackCause: null,
          liveAnchorAt: adapted.liveAnchorAt || occurrence.startsAt
        } } : null
      };
    });
}

export function musicResolutionCandidate(resolution, { organisationId, channelId, instant }) {
  const sourceType = resolution?.reason;
  const musicMode = resolution?.musicMode;
  if (!sourceType || !musicMode) return null;
  return {
    organisationId,
    channelId,
    sourceType,
    sourceId: resolution.slotId || musicMode.id,
    sourceRevision: `${resolution.scheduleId || sourceType}:${resolution.scheduleVersion || 0}:${musicMode.id}`,
    label: resolution.sourceLabel || musicMode.name,
    priority: PLAYOUT_SOURCE_PRIORITIES[sourceType] || 0,
    available: true,
    validFrom: instant,
    validUntil: new Date(instant.getTime() + 5 * 60 * 1000),
    proofClassification: sourceType.includes("AUTODJ") ? "AUTODJ" : "SCHEDULED",
    payload: { resolution }
  };
}

export function autoDjCandidates(policy, { organisationId, channelId, instant, locationOpen, local, licensedCatalogueLevel = null }) {
  if (!policy?.enabled || policy.state === "PAUSED" || policy.state === "BLOCKED") return [];
  const permittedByHours = locationOpen || policy.playbackPolicy === "RUN_24_7";
  return [
    { sourceType: "DEFAULT_AUTODJ", musicMode: policy.defaultMusicMode, fallbackCause: "SCHEDULE_GAP" },
    { sourceType: "BACKUP_AUTODJ", musicMode: policy.backupMusicMode, fallbackCause: "DEFAULT_AUTODJ_UNAVAILABLE" }
  ].filter((candidate) => candidate.musicMode?.id).map((candidate) => {
    const playable = permittedByHours && musicModeIsPlayable(candidate.musicMode, instant, { organisationId, requiredUse: policy.rightsUse || null, territory: policy.territory || null, licensedCatalogueLevel, selectedGenreCodes: policy.selectedGenreCodes || null });
    return {
      organisationId,
      channelId,
      sourceType: candidate.sourceType,
      sourceId: candidate.musicMode.id,
      sourceRevision: `${candidate.sourceType}:${candidate.musicMode.id}`,
      label: candidate.musicMode.name || candidate.sourceType.replaceAll("_", " "),
      priority: PLAYOUT_SOURCE_PRIORITIES[candidate.sourceType],
      available: playable,
      unavailableReason: permittedByHours ? "NO_PLAYABLE_TRACKS" : "LOCATION_CLOSED",
      validFrom: instant,
      validUntil: new Date(instant.getTime() + 5 * 60 * 1000),
      proofClassification: "AUTODJ",
      payload: playable ? { resolution: {
        musicMode: candidate.musicMode,
        scheduleId: null,
        scheduleVersion: null,
        slotId: null,
        reason: candidate.sourceType,
        sourceLabel: candidate.musicMode.name || candidate.sourceType.replaceAll("_", " "),
        fallbackCause: candidate.fallbackCause,
        local
      } } : null
    };
  });
}

export function subscriberPlaylistCandidate(event, { organisationId, channelId, instant, licensedCatalogueLevel = null }) {
  const playlist = event?.smartPlaylist;
  const mode = playlist?.musicMode;
  if (!event || event.organisationId !== organisationId || event.channelId !== channelId || event.cancelledAt || playlist?.organisationId !== organisationId || playlist?.status !== "ACTIVE" || !mode || mode.status !== "ACTIVE") return null;
  const playable = playableLiveMusicModeEntries(mode, instant, { organisationId, requiredUse: playlist.rightsUse, territory: playlist.territory, licensedCatalogueLevel });
  const sequence = buildGenreRotation({
    entries: playable.map((entry) => ({ ...entry, genreCodes: genreCodesForTrack(entry.track) })),
    genreCodes: Array.isArray(playlist.genreCodes) ? playlist.genreCodes : [],
    buildMode: playlist.simpleBuildMode,
    durationMinutes: Math.min(playlist.durationMinutes || 60, 360),
    seed: `${event.id}:${playlist.version}`
  });
  const selectedMode = { ...mode, source: "GENERATED_PLAYLIST", tracks: sequence.entries.slice(0, 100).map((entry, position) => ({ ...entry, position })) };
  return {
    organisationId, channelId, sourceType: "SUBSCRIBER_PLAYLIST", sourceId: event.id,
    sourceRevision: `${playlist.id}:${playlist.version}:${event.startsAt.toISOString()}`,
    label: playlist.musicMode.name, priority: PLAYOUT_SOURCE_PRIORITIES.SUBSCRIBER_PLAYLIST,
    available: selectedMode.tracks.length > 0, unavailableReason: "NO_RIGHTS_APPROVED_AUDIO",
    validFrom: event.startsAt, validUntil: event.endsAt, proofClassification: "SCHEDULED",
    payload: selectedMode.tracks.length ? { resolution: { musicMode: selectedMode, scheduleId: event.id, scheduleVersion: playlist.version, slotId: event.id, reason: "SUBSCRIBER_PLAYLIST", sourceLabel: playlist.musicMode.name, fallbackCause: null, liveAnchorAt: event.startsAt, validUntil: event.endsAt } } : null
  };
}
