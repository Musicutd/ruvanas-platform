// Read-only presentation for the isolated owner test. This grants no source,
// broadcast, catalogue or subscriber-player authority and never opens a URL.
import { HANDOVER_TEST_MODE, HANDOVER_TEST_PHASES, HANDOVER_TEST_PHASE_LABELS } from "./catalogue-test-modes.mjs";
export const TEST_RADIO_LISTENER_URL = "https://ruvanastestradio-radio105network.radioca.st/stream";
const TEST_RADIO_ID = "cmvcnbwi20008hr23sd76psi8";
const SNAPSHOT_MAX_AGE_MS = 15_000;
const instant = value => value instanceof Date ? value.getTime() : typeof value === "string" && value ? Date.parse(value) : NaN;
const label = (value, fallback) => typeof value === "string" && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) : fallback;

export function safeTestRadioListenerUrl(value) {
  // Exact allowlist: no HTTP fallback, embedded credentials, extra paths,
  // query tokens or a saved URL belonging to another station.
  return value === TEST_RADIO_LISTENER_URL ? value : null;
}

export function catalogueTestListeningSnapshot({ stationId, streamConfig, latest, sourceReady, workerReady,
  attentionRequired = false, now = new Date() }) {
  const nowMs = instant(now);
  const base = { listenerUrl: null, enabled: false, state: "UNAVAILABLE", label: "Listening status unavailable",
    checkedAt: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null, expiresInMs: 0,
    sessionId: latest?.id || null, track: null };
  if (stationId !== TEST_RADIO_ID || !Number.isFinite(nowMs)) return base;
  if (attentionRequired || latest?.endedReason === "CATALOGUE_TEST_STOP_UNCONFIRMED" ||
      latest?.events?.some(event => event.kind === "TEST_ENDED" && event.details?.stopConfirmed === false)) {
    return { ...base, state: "ATTENTION", label: "Output stop needs checking — listening disabled" };
  }
  const listenerUrl = sourceReady === true ? safeTestRadioListenerUrl(streamConfig?.streamUrl) : null;
  if (!listenerUrl) return { ...base, label: "Save Test Radio’s verified HTTPS listening address first" };
  if (latest?.stopRequestedAt) return { ...base, listenerUrl, state: "STOP_REQUESTED", label: "Stop requested — waiting for source confirmation" };
  if (!["ARMED", "RUNNING"].includes(latest?.status)) {
    return { ...base, listenerUrl, state: "INACTIVE", label: "No active catalogue test — player is off" };
  }
  const deadline = Math.min(instant(latest?.deadlineAt), instant(latest?.expiresAt));
  if (!Number.isFinite(deadline) || deadline <= nowMs) {
    return { ...base, listenerUrl, state: "EXPIRED", label: "Test deadline reached — waiting for final source status" };
  }
  const leaseUntil = instant(streamConfig?.encoderLeaseUntil);
  if (workerReady !== true || !Number.isFinite(leaseUntil) || leaseUntil <= nowMs) {
    return { ...base, listenerUrl, state: "STALE", label: "Worker status is stale — refresh before listening" };
  }
  if (latest.status === "ARMED") return { ...base, listenerUrl, state: "STARTING", label: "Test is preparing — no source track reported yet" };
  const events = (Array.isArray(latest.events) ? latest.events : []).filter(event => Number.isFinite(instant(event.occurredAt)))
    .slice().sort((left, right) => instant(left.occurredAt) - instant(right.occurredAt) || String(left.id || "").localeCompare(String(right.id || "")));
  if (events.some(event => instant(event.occurredAt) > nowMs || event.kind === "TEST_ENDED")) {
    return { ...base, listenerUrl, state: "STALE", label: "Source status changed — refresh to confirm" };
  }
  const snapshot = { ...base, listenerUrl, enabled: true, state: "RUNNING", label: "Test running — press Play to listen",
    expiresInMs: Math.max(0, Math.min(SNAPSHOT_MAX_AGE_MS, deadline - nowMs, leaseUntil - nowMs)) };
  // A track is reported only after actual source bytes were observed. Never
  // derive “now playing” by adding playlist durations or from SOURCE_AUTHENTICATED.
  const lastSourceEvent = events.filter(event => ["TRACK_AUDIO_SENT", "TRACK_ENDED"].includes(event.kind)).at(-1);
  if (lastSourceEvent?.kind !== "TRACK_AUDIO_SENT" || !Number.isSafeInteger(lastSourceEvent.details?.audioBytesSent) ||
      lastSourceEvent.details.audioBytesSent <= 0) return snapshot;
  const matches = (latest.plan?.items || []).filter(item => item.trackId === lastSourceEvent.trackId);
  if (matches.length !== 1 || !Number.isInteger(matches[0].playDurationSeconds) || matches[0].playDurationSeconds < 1) return snapshot;
  const remainingMs = instant(lastSourceEvent.occurredAt) + matches[0].playDurationSeconds * 1_000 - nowMs;
  if (remainingMs <= 0) return snapshot;
  const phase = latest.authorization?.testMode === HANDOVER_TEST_MODE && latest.plan?.testMode === HANDOVER_TEST_MODE &&
    HANDOVER_TEST_PHASES[latest.plan.items.indexOf(matches[0])] === lastSourceEvent.details?.phase ? HANDOVER_TEST_PHASE_LABELS[lastSourceEvent.details.phase] : null;
  return { ...snapshot, track: { title: label(matches[0].title, "Untitled recording"), artist: label(matches[0].artist, "Unknown artist"),
    sourceStartedAt: new Date(instant(lastSourceEvent.occurredAt)).toISOString(), expiresInMs: remainingMs, ...(phase ? { phase } : {}) } };
}

// Monotonic elapsed time is supplied by the browser; an old snapshot can never
// leave a title or player live indefinitely when polling fails or a tab sleeps.
export function catalogueTestPlayerView(snapshot, elapsedMs, refreshError = false) {
  if (refreshError || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return { enabled: false, track: null, label: "Status unavailable — refresh to confirm", listenerUrl: null };
  }
  if (snapshot?.enabled !== true) return { enabled: false, track: null, label: snapshot?.label || "Checking listening status…", listenerUrl: null };
  const listenerUrl = safeTestRadioListenerUrl(snapshot.listenerUrl);
  if (!listenerUrl || !Number.isFinite(snapshot.expiresInMs) || snapshot.expiresInMs <= elapsedMs) {
    return { enabled: false, track: null, label: "Status is stale — refresh to confirm", listenerUrl: null };
  }
  const track = snapshot.track && Number.isFinite(snapshot.track.expiresInMs) && snapshot.track.expiresInMs > elapsedMs ? snapshot.track : null;
  return { enabled: true, listenerUrl, track, label: snapshot.label };
}

// React clears a normal ref before effects run on conditional removal. Release
// the previous node in the callback-ref itself so detached media cannot keep
// playing or downloading after expiry, error, a new session or page unmount.
export function replaceCatalogueTestAudio(ref, node) {
  const previous = ref.current;
  if (previous && previous !== node) {
    try { previous.pause(); } catch { /* Continue releasing the source. */ }
    try { previous.removeAttribute("src"); } catch { /* Still reset media. */ }
    try { previous.load(); } catch { /* Element is already detached. */ }
  }
  ref.current = node;
}
