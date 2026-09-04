export const AUTODJ_PLAYBACK_POLICIES = Object.freeze([
  "FOLLOW_LOCATION_HOURS",
  "RUN_24_7"
]);

export const AUTODJ_SOURCE_LABELS = Object.freeze({
  ZONE_SLOT: "Zone programme",
  LOCATION_SLOT: "Location programme",
  DEFAULT_AUTODJ: "Continuous AutoDJ",
  BACKUP_AUTODJ: "Backup AutoDJ",
  LOCATION_CLOSED: "Outside configured hours",
  NO_PROGRAMMING: "No playable programming"
});

export function normalizeAutoDjPolicyInput(input = {}) {
  const enabled = input.enabled === true;
  const defaultMusicModeId = typeof input.defaultMusicModeId === "string" && input.defaultMusicModeId.trim()
    ? input.defaultMusicModeId.trim()
    : null;
  const backupMusicModeId = typeof input.backupMusicModeId === "string" && input.backupMusicModeId.trim()
    ? input.backupMusicModeId.trim()
    : null;
  const playbackPolicy = String(input.playbackPolicy || "FOLLOW_LOCATION_HOURS").toUpperCase();
  if (!AUTODJ_PLAYBACK_POLICIES.includes(playbackPolicy)) {
    throw new Error("Choose whether AutoDJ follows location hours or runs continuously.");
  }
  if (enabled && !defaultMusicModeId) {
    throw new Error("Choose a default music mode before enabling Continuous AutoDJ.");
  }
  if (defaultMusicModeId && backupMusicModeId === defaultMusicModeId) {
    throw new Error("Choose a different backup music mode.");
  }
  return { enabled, defaultMusicModeId, backupMusicModeId, playbackPolicy };
}

export function autoDjRunsWhileClosed(policy) {
  return policy?.enabled === true && policy.playbackPolicy === "RUN_24_7";
}

export function resolveAutoDjFallback({ policy, musicModeAvailable = (mode) => mode?.status === "ACTIVE", scheduledModeUnavailable = false }) {
  if (!policy?.enabled) {
    return {
      musicMode: null,
      reason: "NO_PROGRAMMING",
      alert: scheduledModeUnavailable ? {
        code: "SCHEDULED_MODE_UNAVAILABLE",
        severity: "CRITICAL",
        message: "The scheduled music mode has no playable audio and Continuous AutoDJ is disabled."
      } : null
    };
  }

  if (musicModeAvailable(policy.defaultMusicMode)) {
    return {
      musicMode: policy.defaultMusicMode,
      reason: "DEFAULT_AUTODJ",
      alert: scheduledModeUnavailable ? {
        code: "SCHEDULED_MODE_UNAVAILABLE",
        severity: "WARNING",
        message: "The scheduled music mode is unavailable. Continuous AutoDJ is keeping the channel playing."
      } : null
    };
  }

  if (musicModeAvailable(policy.backupMusicMode)) {
    return {
      musicMode: policy.backupMusicMode,
      reason: "BACKUP_AUTODJ",
      alert: {
        code: "DEFAULT_AUTODJ_UNAVAILABLE",
        severity: "WARNING",
        message: "The default AutoDJ mode is unavailable. The backup AutoDJ mode is active."
      }
    };
  }

  return {
    musicMode: null,
    reason: "NO_PROGRAMMING",
    alert: {
      code: "AUTODJ_UNAVAILABLE",
      severity: "CRITICAL",
      message: "Continuous AutoDJ has no playable default or backup music mode."
    }
  };
}

function expandedPreviewSegments(slot) {
  const start = Number(slot.startMinute);
  const end = Number(slot.endMinute);
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(slot.weekday)) return [];
  if (end > start) return [{ weekday: slot.weekday, startMinute: start, endMinute: end, slot }];
  return [
    { weekday: slot.weekday, startMinute: start, endMinute: 1440, slot },
    { weekday: (slot.weekday + 1) % 7, startMinute: 0, endMinute: end, slot }
  ];
}

export function buildContinuousProgrammingWeek(slots = [], policy = null) {
  const days = Array.from({ length: 7 }, (_, weekday) => ({ weekday, segments: [] }));
  const scheduled = slots.flatMap(expandedPreviewSegments);
  for (const day of days) {
    const entries = scheduled
      .filter((entry) => entry.weekday === day.weekday)
      .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
    let cursor = 0;
    for (const entry of entries) {
      if (policy?.enabled && entry.startMinute > cursor) {
        day.segments.push({ startMinute: cursor, endMinute: entry.startMinute, source: "DEFAULT_AUTODJ", musicMode: policy.defaultMusicMode || null });
      }
      day.segments.push({ startMinute: entry.startMinute, endMinute: entry.endMinute, source: "SCHEDULED", slot: entry.slot });
      cursor = Math.max(cursor, entry.endMinute);
    }
    if (policy?.enabled && cursor < 1440) {
      day.segments.push({ startMinute: cursor, endMinute: 1440, source: "DEFAULT_AUTODJ", musicMode: policy.defaultMusicMode || null });
    }
  }
  return days;
}
