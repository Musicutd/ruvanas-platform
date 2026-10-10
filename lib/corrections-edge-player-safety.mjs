// A media response may already be buffered when the Edge withdraws playback.
// Pausing alone leaves those bytes available to the browser's Play control.
const PENDING_KEY = "ruvanas_edge_pending_terminal_v1:";

export function correctionsEdgePendingKey(connection) {
  // Keep pending evidence across signed manifest rotations. The current scoped
  // lease can still report the prior session's terminal result to this Edge.
  return PENDING_KEY + JSON.stringify([connection.nodeId, connection.organisationId,
    connection.facilityId, connection.zoneId, connection.playerId, connection.endpointOrigin]);
}

export function readCorrectionsEdgePending(storage, key) {
  const saved = storage.getItem(key);
  if (!saved) return null;
  const item = JSON.parse(saved);
  if (!item || typeof item.sessionId !== "string" ||
      !["COMPLETED", "FAILED", "INTERRUPTED"].includes(item.reportEventType) ||
      !Number.isSafeInteger(item.reportPositionSeconds) || item.reportPositionSeconds < 0) {
    throw new Error("The private player has an invalid pending playback report.");
  }
  return { ...item, ended: false };
}

export function writeCorrectionsEdgePending(storage, key, item) {
  storage.setItem(key, JSON.stringify({ sessionId: item.sessionId,
    durationSeconds: item.durationSeconds, reportEventType: item.reportEventType,
    reportPositionSeconds: item.reportPositionSeconds }));
}

export function clearCorrectionsEdgePending(storage, key, item) {
  const saved = readCorrectionsEdgePending(storage, key);
  if (saved?.sessionId === item.sessionId && saved.reportEventType === item.reportEventType &&
      saved.reportPositionSeconds === item.reportPositionSeconds) storage.removeItem(key);
}

export function unloadCorrectionsEdgeAudio(element) {
  if (!element) return 0;
  const positionSeconds = Number.isFinite(element.currentTime) ?
    Math.max(0, Math.floor(element.currentTime)) : 0;
  element.pause();
  element.removeAttribute("src");
  element.load();
  return positionSeconds;
}

export function detachCorrectionsEdgeAudio(element, item, rememberInterruption) {
  const positionSeconds = unloadCorrectionsEdgeAudio(element);
  if (item) {
    item.stoppedAtSeconds = positionSeconds;
    rememberInterruption(item);
  }
}

export function pinCorrectionsEdgeTerminal(item, eventType, positionSeconds) {
  item.reportEventType ??= eventType;
  item.reportPositionSeconds ??= positionSeconds;
  return { eventType: item.reportEventType, positionSeconds: item.reportPositionSeconds };
}

export async function finishPendingCorrectionsTerminal(item, { report, playback }) {
  if (!await report(item)) return { confirmed: false, result: null };
  return { confirmed: true, result: await playback() };
}

export async function pollCorrectionsEdgePlayback({ needsRenewal, renew, playback,
  halt, clearLease, establish, interrupt }) {
  let renewalFailed = false;
  try {
    if (needsRenewal) {
      renewalFailed = true;
      await renew();
      renewalFailed = false;
    }
    return await playback();
  } catch (error) {
    // This must happen before any network wait: a suspended Edge cannot recall
    // bytes the browser has already buffered.
    const interrupted = halt();
    if (error?.status !== 401) throw error;
    if (!renewalFailed) {
      try {
        // The short access lease may expire during a cloud outage while its
        // local refresh lease and signed offline manifest are still valid.
        await renew();
        if (interrupted && !await interrupt(interrupted)) {
          throw new Error("The prior Edge playback result is unconfirmed.");
        }
        return await playback();
      } catch (localError) {
        if (localError?.status !== 401) throw localError;
      }
    }
    // Only a rejected local refresh needs a new cloud grant/attestation.
    clearLease();
    await establish();
    if (interrupted && !interrupted.ended && !await interrupt(interrupted)) {
      throw new Error("The prior Edge playback result is unconfirmed.");
    }
    return playback();
  }
}
