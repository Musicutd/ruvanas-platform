// Pure, Retail-only commercial arbitration. It never reads storage, changes a
// schedule or authorises audio. The worker supplies a short-lived approval and
// decoded PCM frame counts; a stale/unavailable approval returns the music plan.
import { normaliseRetailCommercialRule, RETAIL_COMMERCIAL_LIMITS as LIMITS } from "./retail-commercial-policy.mjs";

const RATE = 48000, HALF_HOUR = 1800000, DAY = 86400000, EPSILON = 1e-4;
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const revision = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const milliseconds = value => typeof value === "number" ? value : value instanceof Date ? value.getTime() : NaN;
const frameAt = value => Math.max(0, Math.ceil(value * RATE / 1000 - .02));
const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const localMinutes = new Map();
function local(atMs) {
  const minute = Math.floor(atMs / 60000) * 60000;
  if (localMinutes.has(minute)) return localMinutes.get(minute);
  const parts = Object.fromEntries(formatter.formatToParts(new Date(minute)).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const result = { date, time: `${parts.hour}:${parts.minute}`, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
  if (localMinutes.size >= 256) localMinutes.delete(localMinutes.keys().next().value);
  localMinutes.set(minute, result); return result;
}
function applies(rule, atMs) {
  const day = local(atMs);
  return rule.weekdays.includes(day.weekday) && (!rule.startsOn || day.date >= rule.startsOn) && (!rule.endsOn || day.date <= rule.endsOn);
}
function intersects(left, right) { return left.startMs < right.endMs - EPSILON && right.startMs < left.endMs - EPSILON; }

/**
 * planAt is lookahead-safe: it does not consume a break or count a song.
 * Only musicStarted/musicFinished advance frequency rules. The audio feeder
 * calls musicFinished once after a complete music item, before its next plan.
 * A predicted frequency plan has afterMusic:true and must not interrupt music.
 * The feeder may warm it, then use the same key at the actual EOF (offset zero).
 * Timed rules take priority over frequency rules; approved order breaks ties.
 */
export function createRetailCommercialTimeline({ now = Date.now } = {}) {
  if (typeof now !== "function") throw new TypeError("Retail commercial clock is required.");
  let snapshot = null, rules = [], spots = new Map(), timed = [], warnings = [], floor = Infinity;
  let currentMusic = null, serial = 0, frequencies = new Map(), committed = [], refused = new Map(), calendarKey = null;
  const clock = () => milliseconds(now());
  const fresh = () => snapshot && Number.isFinite(clock()) && clock() >= snapshot.effectiveAt && clock() < snapshot.validUntil;
  const warn = (code, ruleName = null, occurrenceId = null) => { if (warnings.length < 100) warnings.push({ code, ruleName, occurrenceId }); };
  function clear() {
    snapshot = null; rules = []; spots = new Map(); timed = []; floor = Infinity; calendarKey = null;
    currentMusic = null; frequencies = new Map(); committed = []; refused = new Map();
  }
  function collect(atMs) {
    committed = committed.filter(item => item.endMs > atMs - EPSILON);
    for (const [key, until] of refused) if (until < atMs - DAY) refused.delete(key);
    // At most one frequency event per completed song is retained. This cap is
    // defensive, not a pending queue: expired and collided events never replay.
    if (committed.length > LIMITS.maximumRules || refused.size > 2048) { clear(); warn("RETAIL_COMMERCIAL_STATE_LIMIT"); }
  }
  function eventFor(rule, index, startMs, id, afterMusic = false, predicted = false) {
    let endFrame = 0;
    const entries = [];
    for (const id of rule.spotIds) {
      const spot = spots.get(id);
      if (!spot) return null;
      entries.push({ spot, startFrame: endFrame, endFrame: endFrame + spot.frames }); endFrame += spot.frames;
    }
    if (!endFrame || endFrame > LIMITS.maximumBreakSeconds * RATE) return null;
    const endMs = startMs + endFrame * 1000 / RATE;
    if (rule.endsOn && local(endMs - .01).date > rule.endsOn) return null;
    return { id, ruleName: rule.name, index, startMs, endMs, entries, afterMusic, predicted };
  }
  function buildCalendar(atMs) {
    const first = Math.floor(atMs / DAY) * DAY - DAY, key = `${snapshot.revision}:${first}`;
    if (calendarKey === key) return;
    calendarKey = key; timed = [];
    const seen = new Set(), candidates = [];
    // Iterating real UTC instants naturally omits spring's nonexistent times.
    // Repeated autumn wall times use the FIRST occurrence only, even when the
    // process starts between those two instants; no second copy is queued.
    for (let instant = first; instant < first + 4 * DAY; instant += HALF_HOUR) {
      const day = local(instant), wallKey = `${day.date}:${day.time}`;
      if (seen.has(wallKey)) continue;
      seen.add(wallKey);
      if (instant < floor - EPSILON) continue;
      for (let index = 0; index < rules.length; index++) {
        const rule = rules[index];
        if (!rule.weekdays.includes(day.weekday) || rule.startsOn && day.date < rule.startsOn || rule.endsOn && day.date > rule.endsOn) continue;
        const matches = rule.mode === "SCHEDULED" ? rule.times.includes(day.time) : rule.mode === "TOP_OF_HOUR" && day.time.endsWith(":00") && rule.hours.includes(Number(day.time.slice(0, 2)));
        if (!matches) continue;
        const item = eventFor(rule, index, instant, `retail-commercial:${snapshot.revision}:${index}:${day.date}:${day.time}`);
        if (item) candidates.push(item);
      }
    }
    candidates.sort((a, b) => a.startMs - b.startMs || a.index - b.index);
    for (const item of candidates) {
      if (timed.some(previous => intersects(previous, item))) { warn("RETAIL_COMMERCIAL_COLLISION_SKIPPED", item.ruleName, item.id); continue; }
      timed.push(item);
    }
  }
  function programmeAllows(item, music) {
    // Music track boundaries and approval-refresh deadlines are NOT programme
    // boundaries. A commercial may replace music within a weekly programme,
    // but it cannot delay either the programme's start or the return to AutoDJ.
    const boundaries = [music.previousProgrammeBoundaryAtMs, music.nextProgrammeBoundaryAtMs, music.occurrenceStartsAtMs];
    return !boundaries.some(value => Number.isFinite(value) && value >= item.startMs - EPSILON && value < item.endMs - EPSILON);
  }
  function candidateFrequency(atMs, predicted) {
    if (!currentMusic || currentMusic.finished || currentMusic.partial || !fresh()) return { item: null, due: [] };
    const due = [];
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index], state = frequencies.get(index);
      if (!state || !applies(rule, atMs)) continue;
      if (rule.mode === "EVERY_SONGS" && state.songs + 1 >= rule.everySongs ||
          rule.mode === "EVERY_MINUTES" && atMs >= state.since + rule.everyMinutes * 60000 - EPSILON) due.push(index);
    }
    const index = due[0];
    const item = index === undefined ? null : eventFor(rules[index], index, atMs,
      `retail-commercial:${snapshot.revision}:frequency:${currentMusic.serial}:${index}`, true, predicted);
    return { item, due };
  }
  const available = (item, music) => item && !refused.has(item.id) && programmeAllows(item, music) &&
    (!item.afterMusic || !timed.some(other => intersects(other, item)));
  const background = (atMs, music, candidates) => {
    const next = candidates.filter(item => item.startMs > atMs + EPSILON && available(item, music)).map(item => item.startMs);
    if (!next.length) return music;
    return { ...music, nextBoundaryAtMs: Math.min(Number.isFinite(music.nextBoundaryAtMs) ? music.nextBoundaryAtMs : Infinity, ...next) };
  };
  function update(input, frameLengths) {
    warnings = [];
    const instant = clock();
    if (!input?.enabled) { clear(); return; }
    try {
      const effectiveAt = Date.parse(input.effectiveAt), validUntil = Date.parse(input.validUntil);
      if (!Number.isFinite(instant) || !revision(input.revisionFingerprint) || input.timezone !== "Europe/Malta" ||
          !Number.isFinite(effectiveAt) || !Number.isFinite(validUntil) || validUntil <= instant || validUntil > instant + 15000 || effectiveAt >= validUntil ||
          !Array.isArray(input.rules) || input.rules.length > LIMITS.maximumRules || !Array.isArray(input.spots) || input.spots.length > LIMITS.maximumSpots || !(frameLengths instanceof Map)) throw new Error();
      const normalized = input.rules.map(normaliseRetailCommercialRule);
      if (new Set(normalized.map(rule => rule.name.toLowerCase())).size !== normalized.length) throw new Error();
      if (snapshot?.revision === input.revisionFingerprint &&
          (JSON.stringify(normalized) !== JSON.stringify(rules) || effectiveAt !== snapshot.effectiveAt)) throw new Error();
      const nextSpots = new Map();
      for (const spot of input.spots) {
        const frames = frameLengths.get(spot?.fingerprint), track = spot?.track;
        if (!identifier(spot?.id) || !identifier(track?.id) || spot.id !== track.id || !identifier(track.mediaAssetId || track.mediaAsset?.id) || !revision(spot.fingerprint) || nextSpots.has(spot.id)) throw new Error();
        if (!Number.isSafeInteger(frames) || frames < RATE / 4 || frames > LIMITS.maximumSpotSeconds * RATE) continue;
        nextSpots.set(spot.id, { id: spot.id, trackId: track.id, mediaAssetId: track.mediaAssetId || track.mediaAsset.id, fingerprint: spot.fingerprint, frames });
      }
      const changed = snapshot?.revision !== input.revisionFingerprint;
      // A failed/expired refresh cannot rejoin a partly elapsed break on a later
      // refresh. Nor may a new approval catch up a slot already missed.
      if (changed) { clear(); floor = Math.max(instant, effectiveAt); }
      else if (!fresh()) { floor = Math.max(floor, instant); currentMusic = null; committed = []; frequencies = new Map(); calendarKey = null; }
      const mediaChanged = JSON.stringify([...spots]) !== JSON.stringify([...nextSpots]);
      snapshot = { revision: input.revisionFingerprint, effectiveAt, validUntil };
      rules = normalized; spots = nextSpots;
      if (changed || mediaChanged) calendarKey = null;
      for (const rule of rules) {
        if (!rule.spotIds.every(id => spots.has(id))) warn("RETAIL_COMMERCIAL_MEDIA_NOT_READY", rule.name);
        else if (rule.spotIds.reduce((sum, id) => sum + spots.get(id).frames, 0) > LIMITS.maximumBreakSeconds * RATE) warn("RETAIL_COMMERCIAL_BREAK_TOO_LONG", rule.name);
      }
      collect(instant); if (snapshot) buildCalendar(instant);
    } catch { clear(); warn("RETAIL_COMMERCIAL_SNAPSHOT_INVALID"); }
  }
  function musicStarted(event) {
    if (!fresh() || event?.contentKind === "COMMERCIAL" || !identifier(event?.trackId) || !Number.isFinite(event.atMs) || !Number.isFinite(event.expectedEndAtMs) || event.expectedEndAtMs <= event.atMs) return;
    collect(event.atMs); if (!snapshot) return;
    const day = local(event.atMs).date;
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];
      if (!applies(rule, event.atMs) || !["EVERY_SONGS", "EVERY_MINUTES"].includes(rule.mode)) continue;
      if (frequencies.get(index)?.day !== day) frequencies.set(index, { day, songs: 0, since: event.atMs });
    }
    currentMusic = { trackId: event.trackId, atMs: event.atMs, expectedEndAtMs: event.expectedEndAtMs, serial: ++serial,
      partial: Number.isFinite(event.offsetFrames) && event.offsetFrames > 0, finished: false };
  }
  function musicFinished(event) {
    if (!fresh() || event?.contentKind === "COMMERCIAL" || !currentMusic || currentMusic.finished || currentMusic.partial || event.trackId !== currentMusic.trackId || !Number.isFinite(event.atMs) || event.atMs <= currentMusic.atMs) return;
    const day = local(event.atMs).date;
    for (let index = 0; index < rules.length; index++) if (frequencies.has(index) && frequencies.get(index).day !== day)
      frequencies.set(index, { day, songs: 0, since: event.atMs });
    const { item, due } = candidateFrequency(event.atMs, false);
    currentMusic.finished = true;
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index], state = frequencies.get(index);
      if (!state || !applies(rule, event.atMs)) continue;
      if (rule.mode === "EVERY_SONGS") state.songs++;
      if (due.includes(index)) { state.songs = 0; state.since = event.atMs; }
    }
    collect(event.atMs);
    if (item && !refused.has(item.id) && !timed.some(other => intersects(other, item))) committed.push(item);
  }
  function planAt(atMs, musicPlan) {
    const music = musicPlan || { phase: "RANDOM", nextBoundaryAtMs: null };
    if (!Number.isFinite(atMs) || !fresh() || atMs < snapshot.effectiveAt - EPSILON) return music;
    const prediction = currentMusic && !currentMusic.finished ? candidateFrequency(currentMusic.expectedEndAtMs, true).item : null;
    const candidates = [...timed, ...committed, ...(prediction ? [prediction] : [])];
    const active = candidates.filter(item => item.startMs <= atMs + EPSILON &&
      (item.predicted || atMs < item.endMs - EPSILON) && available(item, music))
      .sort((a, b) => Number(a.afterMusic) - Number(b.afterMusic) || a.startMs - b.startMs || a.index - b.index)[0];
    if (!active) return background(atMs, music, candidates);
    const elapsed = active.predicted ? 0 : frameAt(atMs - active.startMs);
    const entry = active.entries.find(value => elapsed < value.endFrame);
    if (!entry) return background(atMs, music, candidates);
    return { phase: "SCHEDULED", contentKind: "COMMERCIAL", afterMusic: active.afterMusic,
      key: `${active.id}:${entry.spot.id}:${entry.startFrame}`, occurrenceId: active.id,
      programmeLabel: `Commercial break: ${active.ruleName}`, ruleName: active.ruleName, commercialRevision: snapshot.revision,
      scheduleRevision: snapshot.revision, trackId: entry.spot.trackId, mediaAssetId: entry.spot.mediaAssetId, fingerprint: entry.spot.fingerprint,
      totalFrames: entry.spot.frames, offsetFrames: active.predicted ? 0 : elapsed - entry.startFrame,
      occurrenceStartsAtMs: active.startMs, occurrenceEndsAtMs: active.endMs,
      nextBoundaryAtMs: Math.min(active.endMs, active.startMs + entry.endFrame * 1000 / RATE) };
  }
  function refuse(occurrenceId) {
    const prediction = currentMusic && !currentMusic.finished ? candidateFrequency(currentMusic.expectedEndAtMs, true).item : null;
    const item = [...timed, ...committed, ...(prediction ? [prediction] : [])].find(value => value.id === occurrenceId);
    if (!item) return;
    refused.set(item.id, item.endMs); warn("RETAIL_COMMERCIAL_BREAK_SKIPPED", item.ruleName, item.id); collect(clock());
  }
  return { update, musicStarted, musicFinished, planAt, refuse, warnings: () => warnings.map(value => ({ ...value })) };
}
