// Pure planning only. The caller supplies a currently authorised snapshot and
// verified decoded frame counts. No catalogue seconds are used as a clock.
const RATE = 48000, MAX_ENTRIES = 12000;
const fail = code => Object.assign(new Error(code), { code });
// Subtract only the precision of a current-era UTC double (<0.02 sample).
// Without this tolerance, subtracting large epoch values can round an exact
// fractional-millisecond track boundary up to the following PCM sample.
const frameAt = milliseconds => Math.max(0, Math.ceil(milliseconds * RATE / 1000 - .02));
function randomFor(seed) {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function buildSubscriberScheduleTimeline(snapshot, frameLengths) {
  const warnings = [], occurrences = []; let entriesRemaining = MAX_ENTRIES;
  if (!snapshot?.enabled) return { warnings, planAt: () => ({ phase: 'RANDOM', nextBoundaryAtMs: null }), occurrences };
  if (!Array.isArray(snapshot.occurrences) || snapshot.occurrences.length > 400 || !(frameLengths instanceof Map)) throw fail('SUBSCRIBER_AUDIO_SCHEDULE_INVALID');
  const effectiveAt = Date.parse(snapshot.effectiveAt), validUntil = Date.parse(snapshot.validUntil);
  if (!Number.isFinite(effectiveAt) || !Number.isFinite(validUntil)) throw fail('SUBSCRIBER_AUDIO_SCHEDULE_INVALID');
  for (const occurrence of snapshot.occurrences) {
    const startsAtMs = Date.parse(occurrence.startsAt), endsAtMs = Date.parse(occurrence.endsAt);
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs || !Array.isArray(occurrence.tracks) || !occurrence.tracks.length || occurrence.tracks.length > 2000) {
      warnings.push({ occurrenceId: occurrence.id, code: 'SUBSCRIBER_AUDIO_SCHEDULE_INVALID' }); continue;
    }
    const tracks = occurrence.tracks.map(track => ({ ...track, frames: frameLengths.get(track.fingerprint) }));
    if (tracks.some(track => !Number.isSafeInteger(track.frames) || track.frames < RATE / 4 || track.frames > 3602 * RATE)) {
      warnings.push({ occurrenceId: occurrence.id, code: 'SUBSCRIBER_AUDIO_SCHEDULE_MEDIA_NOT_READY' }); continue;
    }
    const random = randomFor(`${snapshot.revisionFingerprint}:${occurrence.id}`), entries = [], recent = [];
    const genres = occurrence.config?.genreCodes || [], genreSequence = occurrence.config?.buildMode === 'GENRE_SEQUENCE';
    const needed = frameAt(endsAtMs - startsAtMs); let endFrame = 0, bag = new Set();
    while (endFrame < needed && entries.length < 4000 && entriesRemaining > 0) {
      const genre = genreSequence && genres.length ? genres[entries.length % genres.length] : null;
      const all = tracks.filter(track => !genres.length || track.genreCodes?.some(code => genres.includes(code)));
      const preferred = genre ? all.filter(track => track.genreCodes?.includes(genre)) : all;
      const allowed = preferred.length ? preferred : all;
      if (!allowed.length) break;
      let available = allowed.filter(track => !bag.has(track.trackId));
      if (!available.length) { bag = new Set(); available = allowed; }
      const fresh = available.filter(track => !recent.includes(track.trackId));
      if (fresh.length) available = fresh;
      const track = available[Math.floor(random() * available.length)];
      entries.push({ track, startFrame: endFrame, endFrame: endFrame + track.frames });
      entriesRemaining--; endFrame += track.frames; bag.add(track.trackId); recent.push(track.trackId);
      if (recent.length > Math.min(2, Math.max(0, tracks.length - 1))) recent.shift();
    }
    if (endFrame < needed) { warnings.push({ occurrenceId: occurrence.id, code: 'SUBSCRIBER_AUDIO_SCHEDULE_TOO_LARGE' }); continue; }
    occurrences.push({ ...occurrence, startsAtMs, endsAtMs, entries });
  }
  return {
    warnings, occurrences,
    planAt(atMs) {
      if (!Number.isFinite(atMs)) throw fail('SUBSCRIBER_AUDIO_CLOCK_INVALID');
      const boundaries = occurrences.flatMap(item => [item.startsAtMs, item.endsAtMs]).filter(value => value > atMs + 1e-6);
      let nextBoundaryAtMs = boundaries.length ? Math.min(...boundaries) : null;
      if (atMs >= validUntil) return { phase: 'RANDOM', nextBoundaryAtMs: null };
      if (atMs < effectiveAt) return { phase: 'RANDOM', nextBoundaryAtMs: Math.min(nextBoundaryAtMs ?? Infinity, effectiveAt, validUntil) };
      nextBoundaryAtMs = Math.min(nextBoundaryAtMs ?? Infinity, validUntil);
      const active = occurrences.filter(item => item.startsAtMs <= atMs + 1e-6 && atMs < item.endsAtMs - 1e-6)
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
      if (!active.length || active.length > 1 && active[0].priority === active[1].priority) return { phase: 'RANDOM', nextBoundaryAtMs };
      const selected = active[0], elapsed = frameAt(atMs - selected.startsAtMs);
      let lo = 0, hi = selected.entries.length;
      while (lo < hi) { const middle = (lo + hi) >>> 1; if (selected.entries[middle].endFrame <= elapsed) lo = middle + 1; else hi = middle; }
      const entry = selected.entries[lo];
      if (!entry) return { phase: 'RANDOM', nextBoundaryAtMs };
      // Eligibility can shrink between refreshes. Include the exact recording
      // and start-frame identity so a changed rotation cannot masquerade as the
      // same warmed decoder merely because its array index stayed unchanged.
      return { phase: 'SCHEDULED', key: `${selected.id}:${lo}:${entry.track.trackId}:${entry.track.fingerprint}:${entry.startFrame}`, occurrenceId: selected.id,
        programmeLabel: selected.label, scheduleRevision: snapshot.revisionFingerprint,
        trackId: entry.track.trackId, mediaAssetId: entry.track.mediaAssetId, fingerprint: entry.track.fingerprint,
        totalFrames: entry.track.frames, offsetFrames: elapsed - entry.startFrame,
        occurrenceEndsAtMs: selected.endsAtMs,
        nextBoundaryAtMs: Math.min(nextBoundaryAtMs, selected.startsAtMs + entry.endFrame * 1000 / RATE) };
    }
  };
}
