import { localMinuteToUtc } from "./advanced-scheduler.mjs";
import { firstInvalidTimedPublicationItem } from "./generated-playlist-publication.mjs";
import { TIMED_PLAYLIST_CROSSFADE_SECONDS, TIMED_PLAYLIST_TOLERANCE_SECONDS } from "./timed-playlist-generator.mjs";

function unavailable(reason) {
  return { ready: false, reason, listenerVerified: false, commandIssued: false };
}

// This consumes a trusted, same-snapshot database projection. It is a dry-run
// encoder plan, not an output command. In particular, never substitute a
// MusicMode's deduplicated track pool for this frozen published version.
export function planPublishedTimedChannelSequence({
  playlist, channel, schedule, organisationId, channelId, catalogueLevel,
  configuredGenres = [], instant = new Date()
}) {
  if (!organisationId || !channelId || !(instant instanceof Date) || Number.isNaN(instant.valueOf()) ||
      channel?.id !== channelId || channel.organisationId !== organisationId || channel.status !== "ACTIVE" || !channel.stationId ||
      channel.station?.id !== channel.stationId || channel.station.organisationId !== organisationId ||
      channel.station.productFamily !== "ONLINE") {
    return unavailable("SEQUENCE_SCOPE_INVALID");
  }
  if (playlist?.organisationId !== organisationId || playlist.targetType !== "CHANNEL" || playlist.targetId !== channelId ||
      !["DRAFT", "PUBLISHED"].includes(playlist.status) || !playlist.musicModeId ||
      !Number.isInteger(playlist.publishedVersion) || playlist.publishedVersion < 1 ||
      !Number.isInteger(playlist.currentVersion) || playlist.currentVersion < playlist.publishedVersion ||
      playlist.rightsUse !== "ONLINE_RADIO") {
    return unavailable("SEQUENCE_NOT_PUBLISHED_FOR_CHANNEL");
  }
  const published = Array.isArray(playlist.versions)
    ? playlist.versions.filter((version) => version?.version === playlist.publishedVersion) : [];
  if (published.length !== 1 || !published[0].publishedAt || !Array.isArray(published[0].items) || !published[0].items.length ||
      published[0].items.length > 2500) {
    return unavailable("SEQUENCE_VERSION_MISSING");
  }
  const version = published[0];
  if (!(playlist.scheduledDate instanceof Date) || Number.isNaN(playlist.scheduledDate.valueOf()) ||
      !Number.isInteger(playlist.startMinute) || !Number.isInteger(playlist.endMinute) ||
      playlist.startMinute < 0 || playlist.endMinute > 1440 || playlist.endMinute <= playlist.startMinute ||
      playlist.endMinute - playlist.startMinute > 720) {
    return unavailable("SEQUENCE_WINDOW_INVALID");
  }
  let startsAt;
  try {
    startsAt = localMinuteToUtc(playlist.scheduledDate.toISOString().slice(0, 10), playlist.startMinute, playlist.timezone);
  } catch {
    return unavailable("SEQUENCE_WINDOW_INVALID");
  }
  const active = schedule?.organisationId === organisationId && schedule.channelId === channelId && schedule.timezone === playlist.timezone
    ? (Array.isArray(schedule.versions) ? schedule.versions.filter((candidate) => candidate?.status === "PUBLISHED" && candidate.isActive) : []) : [];
  if (active.length !== 1 || !Array.isArray(active[0].items) || active[0].items.length !== 1) {
    return unavailable("SEQUENCE_PROGRAMME_ARBITRATION_NOT_READY");
  }
  const block = active[0].items[0];
  if (block.sourceType !== "MUSIC_MODE" || block.recurrence !== "ONE_OFF" ||
      block.musicModeId !== playlist.musicModeId || block.label !== playlist.name || block.priority !== 50 ||
      block.durationMinutes !== playlist.endMinute - playlist.startMinute ||
      !(block.startsAt instanceof Date) || block.startsAt.getTime() !== startsAt.getTime()) {
    return unavailable("SEQUENCE_PROGRAMME_MISMATCH");
  }
  const items = version.items;
  let previousEnd = 0;
  for (const [index, item] of items.entries()) {
    const expectedStart = index === 0 ? 0 : previousEnd - TIMED_PLAYLIST_CROSSFADE_SECONDS;
    if (item.position !== index || item.startOffsetSeconds !== expectedStart ||
        !Number.isInteger(item.endOffsetSeconds) || item.endOffsetSeconds <= previousEnd ||
        !item.trackId || item.track?.id !== item.trackId || !item.track.mediaAsset?.id ||
        typeof item.track.mediaAsset.storageKey !== "string" || !item.track.mediaAsset.storageKey) {
      return unavailable("SEQUENCE_FROZEN_ORDER_INVALID");
    }
    if (item.track.mediaAsset.licensedCatalogue) return unavailable("SEQUENCE_LICENSED_CATALOGUE_OUTPUT_NOT_READY");
    previousEnd = item.endOffsetSeconds;
  }
  const requestedSeconds = (playlist.endMinute - playlist.startMinute) * 60;
  if (Math.abs(previousEnd - requestedSeconds) > TIMED_PLAYLIST_TOLERANCE_SECONDS ||
      version.generatedDurationSeconds !== previousEnd || version.requestedDurationSeconds !== requestedSeconds) {
    return unavailable("SEQUENCE_DURATION_INVALID");
  }
  if (instant.getTime() >= startsAt.getTime() + previousEnd * 1000) return unavailable("SEQUENCE_WINDOW_ELAPSED");
  let invalid;
  try {
    invalid = firstInvalidTimedPublicationItem(items, {
      startsAt, organisationId, rightsUse: playlist.rightsUse, territory: playlist.territory,
      catalogueLevel, selectedGenreCodes: playlist.selectedGenreCodes,
      sourceScopes: playlist.sourceScopes, configuredGenres, instant
    });
  } catch {
    return unavailable("SEQUENCE_RIGHTS_CHECK_FAILED");
  }
  if (invalid) return unavailable(`SEQUENCE_RIGHTS_${invalid.reason}`);
  return {
    ready: true, reason: "FROZEN_SEQUENCE_PLANNED_NOT_ON_AIR", listenerVerified: false, commandIssued: false,
    playlistId: playlist.id, version: version.version, organisationId, channelId,
    startsAt, endsAt: new Date(startsAt.getTime() + previousEnd * 1000),
    items: items.map((item) => ({
      position: item.position, trackId: item.trackId, mediaAssetId: item.track.mediaAsset.id,
      storageKey: item.track.mediaAsset.storageKey, startOffsetSeconds: item.startOffsetSeconds,
      endOffsetSeconds: item.endOffsetSeconds, durationSeconds: item.durationSeconds
    }))
  };
}
