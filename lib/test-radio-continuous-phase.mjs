// Presentation evidence only. This cannot approve a schedule or authorize audio.
const safeId = value => typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value);
const label = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) : "";

export function continuousObservedPhase({ phase, occurrenceId, scheduleRevision, trackId }, schedule) {
  if (phase === "RANDOM") return { phase: "RANDOM", programme: null };
  const unknown = { phase: "UNKNOWN", programme: null };
  if (phase !== "SCHEDULED" || !safeId(occurrenceId) || !safeId(scheduleRevision) || !safeId(trackId) ||
      schedule?.enabled !== true || schedule.revisionFingerprint !== scheduleRevision) return unknown;
  const occurrence = schedule.occurrences?.find(item => item.id === occurrenceId);
  if (!occurrence || !occurrence.tracks?.some(item => item.trackId === trackId)) return unknown;
  const startsAt = new Date(occurrence.startsAt), endsAt = new Date(occurrence.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return unknown;
  return { phase: "SCHEDULED", programme: {
    occurrenceId, scheduleRevision, label: label(occurrence.label) || "Scheduled programme",
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString()
  } };
}

export function continuousPhaseView(listening) {
  if (listening?.phase === "RANDOM") return { phase: "RANDOM", label: "Random AutoDJ", programme: null };
  const p = listening?.programme;
  if (listening?.phase === "SCHEDULED" && safeId(p?.occurrenceId) && safeId(p?.scheduleRevision) && label(p?.label) &&
      Number.isFinite(Date.parse(p.startsAt)) && Number.isFinite(Date.parse(p.endsAt)) && Date.parse(p.endsAt) > Date.parse(p.startsAt)) {
    return { phase: "SCHEDULED", label: `Scheduled programme: ${label(p.label)}`, programme: {
      label: label(p.label), startsAt: p.startsAt, endsAt: p.endsAt
    } };
  }
  return { phase: "UNKNOWN", label: "Programme status awaiting source confirmation", programme: null };
}
