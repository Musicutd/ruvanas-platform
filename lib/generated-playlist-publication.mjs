function replacementConflict(message) {
  const error = new Error(message);
  error.code = "REPLACEMENT_CONFLICT";
  return error;
}

function sameInstant(left, right) {
  return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : null;
}

export function programmeItemData(item) {
  return {
    position: item.position, label: item.label, recurrence: item.recurrence, sourceType: item.sourceType,
    weekday: item.weekday, startMinute: item.startMinute, startsAt: item.startsAt,
    durationMinutes: item.durationMinutes, priority: item.priority, musicModeId: item.musicModeId,
    radioClockId: item.radioClockId, schoolRundownId: item.schoolRundownId
  };
}

// MusicModeTrack has a composite (mode, track) key. The full repeated running order
// remains in GeneratedPlaylistVersion.items; this mode is only its eligible track pool.
export function uniquePublishedModeTracks(items, musicModeId) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.trackId)) return false;
    seen.add(item.trackId);
    return true;
  }).map((item) => ({ musicModeId, trackId: item.trackId, weight: 100, position: item.position }));
}

export function assertFutureTimedReplacement(startsAt, instant = new Date()) {
  if (!(startsAt instanceof Date) || !Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= instant.getTime()) {
    throw replacementConflict("A timed block that has started cannot be replaced. Its published history remains unchanged.");
  }
}

export function replacePublishedProgrammeItem({ schedule, activeVersions, oldMusicModeId, newMusicModeId, startsAt, durationMinutes, timezone, name }) {
  if (!schedule || schedule.timezone !== timezone || activeVersions.length !== 1 || activeVersions[0].status !== "PUBLISHED") {
    throw replacementConflict("The published channel schedule changed. Review its current version before replacing this playlist.");
  }
  const items = [...activeVersions[0].items].sort((a, b) => a.position - b.position);
  const matches = items.filter((item) => item.musicModeId === oldMusicModeId && item.sourceType === "MUSIC_MODE" && item.recurrence === "ONE_OFF" && sameInstant(item.startsAt, startsAt) && item.durationMinutes === durationMinutes && item.priority === 50 && item.label === name);
  if (matches.length !== 1) {
    throw replacementConflict("The original timed block is missing or ambiguous in the published channel schedule. Nothing was replaced.");
  }
  return {
    activeVersionId: activeVersions[0].id,
    items: items.map((item, position) => ({ ...programmeItemData(item), position, musicModeId: item.id === matches[0].id ? newMusicModeId : item.musicModeId }))
  };
}

export function replacePublishedAreaSchedule({ schedules, oldMusicModeId, scheduledDate, startMinute, endMinute, timezone }) {
  const matches = schedules.filter((schedule) => schedule.status === "PUBLISHED" && schedule.timezone === timezone && dateKey(schedule.effectiveFrom) === dateKey(scheduledDate) && dateKey(schedule.effectiveTo) === dateKey(scheduledDate) && schedule.slots?.length === 1 && schedule.slots[0].musicModeId === oldMusicModeId && schedule.slots[0].weekday === scheduledDate.getUTCDay() && schedule.slots[0].startMinute === startMinute && schedule.slots[0].endMinute === endMinute && schedule.slots[0].priority === 50);
  if (matches.length !== 1 || schedules.length !== 1) {
    throw replacementConflict("The original listening-area schedule is missing, changed or ambiguous. Nothing was replaced.");
  }
  return matches[0].id;
}
