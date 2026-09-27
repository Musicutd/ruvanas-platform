// These are signed player-event counts, never listener or rehabilitation
// outcomes. A STARTED event cannot be presented as a delivered programme.
export function correctionsNetworkDeliveryMetrics(evidence = []) {
  const totals = {
    centralProgramme: 0, localProgramme: 0, syndicatedProgramme: 0,
    centralRehabilitation: 0, localRehabilitation: 0,
    centralAnnouncement: 0, facilityAnnouncement: 0,
    request: 0, failed: 0, interrupted: 0,
    centralDeliveredSeconds: 0, localDeliveredSeconds: 0
  };
  const delivered = {
    CORRECTIONS_CENTRAL: "centralProgramme",
    CORRECTIONS_LOCAL: "localProgramme",
    CORRECTIONS_SYNDICATED: "syndicatedProgramme",
    CORRECTIONS_CENTRAL_REHAB: "centralRehabilitation",
    CORRECTIONS_LOCAL_REHAB: "localRehabilitation",
    CORRECTIONS_REHABILITATION: "localRehabilitation",
    CORRECTIONS_CENTRAL_ANNOUNCE: "centralAnnouncement",
    CORRECTIONS_STANDARD: "facilityAnnouncement",
    CORRECTIONS_PRIORITY: "facilityAnnouncement",
    CORRECTIONS_EMERGENCY: "facilityAnnouncement",
    CORRECTIONS_REQUEST: "request"
  };
  for (const row of evidence) {
    const count = Number(row.events);
    if (!Number.isFinite(count) || count < 0) continue;
    if (row.eventType === "COMPLETED" && delivered[row.source]) {
      totals[delivered[row.source]] += count;
      if (["CORRECTIONS_CENTRAL", "CORRECTIONS_SYNDICATED"].includes(row.source)) totals.centralDeliveredSeconds += Math.max(0, Number(row.deliveredSeconds) || 0);
      if (row.source === "CORRECTIONS_LOCAL") totals.localDeliveredSeconds += Math.max(0, Number(row.deliveredSeconds) || 0);
    }
    else if (row.eventType === "FAILED") totals.failed += count;
    else if (row.eventType === "INTERRUPTED") totals.interrupted += count;
  }
  return totals;
}
