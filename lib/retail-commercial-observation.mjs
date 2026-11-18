// Revalidate accepted-source evidence against the current commercial approval.
// A title or subscriber draft alone never creates a commercial playback report.
export function retailCommercialObservation(snapshot, event, now = new Date()) {
  const instant = now.getTime(), presentation = Date.parse(event?.presentationAt || "");
  const effective = Date.parse(snapshot?.effectiveAt || ""), expiry = Date.parse(snapshot?.validUntil || "");
  if (!snapshot?.enabled || event?.phase !== "COMMERCIAL" || event.commercialRevision !== snapshot.revisionFingerprint ||
      !Number.isFinite(instant) || !Number.isFinite(effective) || !Number.isFinite(expiry) || effective > instant || expiry <= instant ||
      !Array.isArray(snapshot.spots) || !Array.isArray(snapshot.rules) || !Number.isFinite(presentation) || presentation > instant || presentation < effective ||
      typeof event.occurrenceId !== "string" || !/^[A-Za-z0-9_:.+-]{1,240}$/.test(event.occurrenceId)) return null;
  const spot = snapshot.spots.find(row => row.track.id === event.trackId);
  const rule = snapshot.rules.find(row => row.name === event.commercialRuleName && row.spotIds.includes(spot?.id));
  if (!spot || !rule || !Number.isFinite(spot.durationSeconds) || instant - presentation > spot.durationSeconds * 1000 + 10000) return null;
  return { track: spot.track, phase: "COMMERCIAL", programme: null,
    commercial: { ruleName: rule.name, revision: snapshot.revisionFingerprint, occurrenceId: event.occurrenceId } };
}
