// Read-only presentation of an already-authorized Test Radio snapshot. This
// module cannot grant playback, change a draft or send audio to any destination.
import { TEST_RADIO_CONTINUOUS as P, continuousSourceReady, continuousSourceFingerprint } from "./test-radio-continuous-policy.mjs";
import { continuousObservedPhase } from "./test-radio-continuous-phase.mjs";

const clean = (value, fallback = "") => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) || fallback : fallback;
const id = value => typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value);
const timestamp = value => value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
const iso = value => new Date(value).toISOString();
const unknownSource = () => ({ confirmed: false, phase: "UNKNOWN", label: "Current source not confirmed — AutoDJ may still be running.",
  track: null, observedAt: null, expiresInMs: 0 });
function timezoneFor(runtime) {
  try {
    if (typeof runtime?.timezone !== "string" || runtime.timezone.length > 80) return "Europe/Malta";
    new Intl.DateTimeFormat("en-GB", { timeZone: runtime.timezone }).format(0);
    return runtime.timezone;
  } catch { return "Europe/Malta"; }
}
function winnerAt(occurrences, instant) {
  return occurrences.filter(item => item.start <= instant && item.end > instant)
    .sort((left, right) => right.priority - left.priority || left.start - right.start || left.id.localeCompare(right.id))[0] || null;
}
function nextTransition(occurrences, instant) {
  const currentId = winnerAt(occurrences, instant)?.id || null;
  const boundaries = [...new Set(occurrences.flatMap(item => [item.start, item.end]).filter(value => value > instant))].sort((a, b) => a - b);
  for (const at of boundaries) {
    const winner = winnerAt(occurrences, at);
    if ((winner?.id || null) !== currentId) return { at, winner };
  }
  return null;
}

export function buildTestRadioNowNext({ authorized, observation, runtime, now = new Date() } = {}) {
  const nowMs = timestamp(now);
  if (!Number.isFinite(nowMs)) throw new Error("A valid status-check time is required.");
  const result = { stationId: P.stationId, checkedAt: iso(nowMs), timezone: timezoneFor(runtime), source: unknownSource(),
    plan: { enabled: false, current: null, next: null, horizonLabel: "next two calendar days" }, warnings: [] };
  const station = authorized?.station, grant = authorized?.grant, source = authorized?.source;
  const scoped = station?.id === P.stationId && grant?.stationId === P.stationId && id(station.organisationId) &&
    grant.organisationId === station.organisationId && id(grant.id) && Array.isArray(authorized?.tracks) && authorized.tracks.length <= P.maximumCandidates;
  if (!scoped) {
    result.warnings.push("Test Radio status is unavailable. Refresh to check again; no playback setting has changed.");
    return result;
  }
  const eligible = new Map(authorized.tracks.filter(entry => id(entry?.track?.id)).map(entry => [entry.track.id, entry]));
  let occurrences = [], runtimeUsable = false;
  if (runtime?.enabled === true) {
    const effectiveAt = timestamp(runtime.effectiveAt), validUntil = timestamp(runtime.validUntil);
    runtimeUsable = runtime.stationId === P.stationId && id(runtime.channelId) && id(runtime.versionId) && id(runtime.revisionFingerprint) &&
      Number.isFinite(effectiveAt) && Number.isFinite(validUntil) && validUntil > nowMs &&
      Array.isArray(runtime.occurrences) && runtime.occurrences.length <= 400;
    if (runtimeUsable) {
      const seen = new Set();
      for (const item of runtime.occurrences) {
        const start = timestamp(item?.startsAt), end = timestamp(item?.endsAt);
        if (!id(item?.id) || seen.has(item.id) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < effectiveAt ||
            !Number.isInteger(item.priority) || item.priority < 0 || item.priority > 100 || !Array.isArray(item.tracks) || item.tracks.length > 64) {
          runtimeUsable = false; break;
        }
        seen.add(item.id);
        const tracks = item.tracks.filter(track => {
          const entry = eligible.get(track?.trackId);
          return entry && entry.fingerprint === track.fingerprint && entry.track.mediaAssetId === track.mediaAssetId && entry.durationSeconds === track.durationSeconds;
        });
        if (!tracks.length) {
          result.warnings.push("An approved playlist no longer has eligible recordings. Its programme may use random AutoDJ instead.");
          continue;
        }
        occurrences.push({ id: item.id, start, end, priority: item.priority, label: clean(item.label, "Scheduled programme"), tracks });
      }
      // Equal-priority overlaps are not an approved choice we may invent here.
      for (let left = 0; runtimeUsable && left < occurrences.length; left++) for (let right = left + 1; right < occurrences.length; right++) {
        const a = occurrences[left], b = occurrences[right];
        if (a.priority === b.priority && a.start < b.end && b.start < a.end) { runtimeUsable = false; break; }
      }
    }
    if (!runtimeUsable) {
      occurrences = [];
      result.warnings.push("The approved programme times could not be verified. Ask your administrator to review the approved week.");
    }
  } else if (runtime?.reasonCode && runtime.reasonCode !== "SCHEDULE_DISABLED") {
    result.warnings.push("The approved schedule is unavailable. Random AutoDJ may continue; ask your administrator to review the week.");
  }
  if (Array.isArray(runtime?.warnings) && runtime.warnings.length) {
    // Runtime warnings may contain arbitrary playlist names. Do not forward the
    // raw object or unbounded diagnostic text into the subscriber response.
    result.warnings.push("The approved schedule has warnings. Ask your administrator to review its music and programme times.");
  }
  const current = runtimeUsable ? winnerAt(occurrences, nowMs) : null;
  const transition = runtimeUsable ? nextTransition(occurrences, nowMs) : null;
  result.plan = { enabled: runtimeUsable,
    current: current ? { label: current.label, startsAt: iso(current.start), endsAt: iso(current.end) } : null,
    next: transition ? transition.winner
      ? { kind: "PROGRAMME", label: transition.winner.label, startsAt: iso(transition.at), endsAt: iso(transition.winner.end) }
      : { kind: "RANDOM", label: "Random AutoDJ", startsAt: iso(transition.at) } : null,
    horizonLabel: "next two calendar days" };

  const observedAt = timestamp(observation?.observedAt), leaseUntil = timestamp(source?.encoderLeaseUntil);
  const track = eligible.get(observation?.trackId)?.track;
  const sourceReady = continuousSourceReady(source) && grant.sourceFingerprint === continuousSourceFingerprint(source);
  const freshSource = sourceReady && typeof source?.encoderLeaseOwner === "string" && source.encoderLeaseOwner.startsWith(P.leasePrefix) &&
    Number.isFinite(leaseUntil) && leaseUntil > nowMs && observation?.grantId === grant.id && observation.leaseOwner === source.encoderLeaseOwner &&
    observation.state === "STREAMING" && Number.isSafeInteger(observation.audioBytesSent) && observation.audioBytesSent > 0 &&
    Number.isFinite(observedAt) && observedAt <= nowMs && nowMs - observedAt < P.observationFreshnessMs && track;
  if (freshSource) {
    const crossed = runtimeUsable ? nextTransition(occurrences, observedAt) : null;
    const oldProgrammeEnd = timestamp(observation.programme?.endsAt);
    const pastBoundary = crossed && crossed.at <= nowMs || observation.phase === "SCHEDULED" && Number.isFinite(oldProgrammeEnd) && oldProgrammeEnd <= nowMs;
    const safeRuntime = runtimeUsable ? { enabled: true, revisionFingerprint: runtime.revisionFingerprint,
      occurrences: occurrences.map(item => ({ id: item.id, label: item.label, startsAt: iso(item.start), endsAt: iso(item.end), tracks: item.tracks })) } : null;
    const phase = continuousObservedPhase({ phase: observation.phase, trackId: observation.trackId,
      occurrenceId: observation.programme?.occurrenceId, scheduleRevision: observation.programme?.scheduleRevision }, safeRuntime);
    const matchingScheduled = phase.phase !== "SCHEDULED" || current?.id === phase.programme?.occurrenceId;
    const expiresInMs = Math.max(0, Math.min(P.observationFreshnessMs - (nowMs - observedAt), leaseUntil - nowMs,
      transition ? transition.at - nowMs : Infinity, phase.phase === "SCHEDULED" ? timestamp(runtime.validUntil) - nowMs : Infinity));
    if (!pastBoundary && matchingScheduled && phase.phase !== "UNKNOWN" && expiresInMs > 0) {
      result.source = { confirmed: true, phase: phase.phase,
        label: phase.phase === "SCHEDULED" ? `Scheduled programme: ${current.label}` : "Random AutoDJ",
        track: { title: clean(track.title, "Untitled recording"), artist: clean(track.artist, "Unknown artist") },
        observedAt: iso(observedAt), expiresInMs };
      if (current && phase.phase === "RANDOM") result.warnings.push("A programme is planned now, but the latest source report still shows random AutoDJ. Refresh to check the handover.");
    } else if (pastBoundary) result.warnings.push("A scheduled handover is due. Refresh for a source report recorded after the handover.");
  }
  result.warnings = [...new Set(result.warnings)];
  return result;
}
