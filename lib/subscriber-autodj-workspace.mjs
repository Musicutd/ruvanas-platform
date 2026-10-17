// Read-only summaries of the simple playlist plan, never an on-air assertion.
export function summariseChannelPlaylistPlan(events, channelId, instant = new Date()) {
  const now = new Date(instant).getTime();
  if (!channelId || !Number.isFinite(now)) return { current: [], next: null, upcoming: [] };
  const upcoming = (Array.isArray(events) ? events : []).filter((event) => {
    const startsAt = new Date(event.startsAt).getTime();
    const endsAt = new Date(event.endsAt).getTime();
    return event.channelId === channelId && !event.cancelledAt && Number.isFinite(startsAt)
      && Number.isFinite(endsAt) && endsAt > startsAt && endsAt > now;
  }).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt) || String(a.id).localeCompare(String(b.id)));
  return {
    current: upcoming.filter((event) => new Date(event.startsAt).getTime() <= now),
    next: upcoming.find((event) => new Date(event.startsAt).getTime() > now) || null,
    upcoming
  };
}

export function nonStopSettingsChanged(saved, enabled, genreCodes) {
  const genres = (values) => [...new Set(values || [])].sort();
  return (saved?.enabled === true) !== enabled
    || JSON.stringify(genres(saved?.genreCodes)) !== JSON.stringify(genres(genreCodes));
}
