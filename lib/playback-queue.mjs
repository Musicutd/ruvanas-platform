export const MAX_OFFLINE_PLAYBACK_EVENTS = 500;

export function appendPlaybackEvent(queue, event, maximum = MAX_OFFLINE_PLAYBACK_EVENTS) {
  const withoutDuplicate = queue.filter((item) => item.eventId !== event.eventId);
  return [...withoutDuplicate, event].slice(-maximum);
}

export function removePlaybackEvents(queue, eventIds) {
  const sent = new Set(eventIds);
  return queue.filter((event) => !sent.has(event.eventId));
}
