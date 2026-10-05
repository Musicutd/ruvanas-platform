// A media response may already be buffered when the Edge withdraws playback.
// Pausing alone leaves those bytes available to the browser's Play control.
export function unloadCorrectionsEdgeAudio(element) {
  if (!element) return 0;
  const positionSeconds = Number.isFinite(element.currentTime) ?
    Math.max(0, Math.floor(element.currentTime)) : 0;
  element.pause();
  element.removeAttribute("src");
  element.load();
  return positionSeconds;
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
        if (interrupted) await interrupt(interrupted);
        return await playback();
      } catch (localError) {
        if (localError?.status !== 401) throw localError;
      }
    }
    // Only a rejected local refresh needs a new cloud grant/attestation.
    clearLease();
    await establish();
    if (interrupted && !interrupted.ended) await interrupt(interrupted);
    return playback();
  }
}
