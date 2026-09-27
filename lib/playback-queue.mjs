export const MAX_OFFLINE_PLAYBACK_EVENTS = 500;

export function appendPlaybackEvent(queue, event, maximum = MAX_OFFLINE_PLAYBACK_EVENTS) {
  const withoutDuplicate = queue.filter((item) => item.eventId !== event.eventId);
  return [...withoutDuplicate, event].slice(-maximum);
}

export function removePlaybackEvents(queue, eventIds) {
  const sent = new Set(eventIds);
  return queue.filter((event) => !sent.has(event.eventId));
}

// A started insertion may be retried after preemption or browser reload. Only
// completed or failed playback should remain in the device's already-played list.
export function updatePlayedInsertionIds(ids, scheduleItemId, eventType, canResume = false, maximum = 500) {
  const previous = Array.isArray(ids) ? ids.filter((id) => id !== scheduleItemId) : [];
  if (eventType === "INTERRUPTED") return canResume ? previous : (Array.isArray(ids) ? ids : []);
  if (eventType === "STARTED" && canResume) return Array.isArray(ids) ? ids : [];
  if (eventType === "STARTED") return [...previous, scheduleItemId].slice(-maximum);
  if (eventType === "COMPLETED" || eventType === "FAILED") {
    return [...previous, scheduleItemId].slice(-maximum);
  }
  return Array.isArray(ids) ? ids : [];
}

// Manifest refreshes renew the listener token in mediaUrl. Keep the URL already
// loaded by the audio element until the actual programme/version changes, or
// React will restart a playing recording every time the manifest is polled.
export function stableInsertionMediaSource(previous, playbackKey, mediaUrl) {
  if (!playbackKey || !mediaUrl) return null;
  return previous?.playbackKey === playbackKey
    ? previous
    : { playbackKey, mediaUrl };
}
