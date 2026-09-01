export const LIVE_CHANNEL_CROSSFADE_SECONDS = 2;
export const LIVE_CHANNEL_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function safeDuration(item) {
  const duration = Number(item?.track?.mediaAsset?.durationSeconds ?? item?.durationSeconds);
  return Number.isFinite(duration) ? duration : 0;
}

export function liveCapableEntries(entries, crossfadeSeconds = LIVE_CHANNEL_CROSSFADE_SECONDS) {
  return (entries || []).filter((entry) => safeDuration(entry) > crossfadeSeconds + 0.25);
}

export function buildLiveChannelClock({
  playlist = [],
  streamId,
  instant = new Date(),
  crossfadeSeconds = LIVE_CHANNEL_CROSSFADE_SECONDS,
  epochMs = LIVE_CHANNEL_EPOCH_MS
}) {
  if (!streamId || typeof streamId !== "string") {
    throw new Error("A stable stream ID is required for live channel playback.");
  }

  const entries = playlist.map((item, index) => {
    const durationSeconds = safeDuration(item);
    if (durationSeconds <= crossfadeSeconds + 0.25) {
      throw new Error(`Live playlist item ${index + 1} is too short or has no duration.`);
    }
    return {
      index,
      durationSeconds,
      stepSeconds: durationSeconds - crossfadeSeconds
    };
  });

  if (!entries.length) return null;

  const cycleDurationSeconds = entries.reduce((total, item) => total + item.stepSeconds, 0);
  const elapsedSeconds = (instant.getTime() - epochMs) / 1000;
  const positionSeconds = positiveModulo(elapsedSeconds, cycleDurationSeconds);
  const cycleNumber = Math.floor(elapsedSeconds / cycleDurationSeconds);

  let cursor = 0;
  let current = entries[0];
  for (const entry of entries) {
    if (positionSeconds < cursor + entry.stepSeconds) {
      current = entry;
      break;
    }
    cursor += entry.stepSeconds;
  }

  const currentOffsetSeconds = positionSeconds - cursor;
  const currentStartedAtMs = instant.getTime() - currentOffsetSeconds * 1000;
  const previous = entries[(current.index - 1 + entries.length) % entries.length];
  const next = entries[(current.index + 1) % entries.length];
  const inIncomingCrossfade = currentOffsetSeconds < crossfadeSeconds;

  return {
    streamId,
    serverTime: instant.toISOString(),
    epochAt: new Date(epochMs).toISOString(),
    crossfadeSeconds,
    cycleDurationSeconds,
    cycleNumber,
    positionSeconds,
    current: {
      index: current.index,
      offsetSeconds: currentOffsetSeconds,
      startedAt: new Date(currentStartedAtMs).toISOString()
    },
    previous: inIncomingCrossfade ? {
      index: previous.index,
      offsetSeconds: previous.durationSeconds - crossfadeSeconds + currentOffsetSeconds,
      gain: Math.max(0, 1 - currentOffsetSeconds / crossfadeSeconds)
    } : null,
    currentGain: inIncomingCrossfade
      ? Math.min(1, currentOffsetSeconds / crossfadeSeconds)
      : 1,
    next: {
      index: next.index,
      startsAt: new Date(currentStartedAtMs + current.stepSeconds * 1000).toISOString(),
      startsInSeconds: current.stepSeconds - currentOffsetSeconds
    }
  };
}
