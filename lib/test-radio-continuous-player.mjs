// Presentation only: this module cannot authorize or start a stream.
import { safeTestRadioListenerUrl, replaceCatalogueTestAudio } from "./catalogue-test-player.mjs";
import { continuousPhaseView } from "./test-radio-continuous-phase.mjs";

export const CONTINUOUS_TEST_RADIO_ID = "cmvcnbwi20008hr23sd76psi8";
const MAX_SNAPSHOT_AGE_MS = 15_000;
const cleanLabel = (value, fallback) => typeof value === "string" && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) : fallback;

export const replaceContinuousRadioAudio = replaceCatalogueTestAudio;

export function continuousRadioPlayerView(snapshot, elapsedMs = 0, refreshError = false) {
  const off = { enabled: false, listenerUrl: null, track: null, label: "Checking Test Radio…", state: "CHECKING" };
  if (refreshError || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return { ...off, state: "UNAVAILABLE", label: "Status unavailable — refresh to confirm. AutoDJ may still be running." };
  }
  if (!snapshot) return off;
  const requestAgeMs = snapshot.requestAgeMs ?? 0;
  if (!Number.isFinite(requestAgeMs) || requestAgeMs < 0) return { ...off, state: "STALE", label: "Audio status is stale — refresh to confirm." };
  const ageMs = elapsedMs + requestAgeMs;
  if (snapshot.stationId !== CONTINUOUS_TEST_RADIO_ID) return { ...off, state: "UNAVAILABLE", label: "Test Radio status could not be verified." };
  if (snapshot.attentionRequired === true || snapshot.status === "NEEDS_ATTENTION") {
    return { ...off, state: "NEEDS_ATTENTION", label: "AutoDJ needs attention — source status must be checked." };
  }
  if (snapshot.status === "STOPPING") {
    return { ...off, state: "STOPPING", label: "Stop requested — waiting for the encoder to confirm shutdown." };
  }
  if (snapshot.enabled !== true) {
    return { ...off, state: "STOPPED", label: "AutoDJ is disabled. No continuous run is authorized." };
  }
  if (snapshot.worker?.ready !== true || snapshot.status === "WAITING_FOR_WORKER") {
    return { ...off, state: "WAITING_FOR_WORKER", label: "AutoDJ is enabled, but no fresh worker connection is confirmed. The worker may be stopped or disconnected." };
  }
  if (snapshot.status !== "STREAMING" || snapshot.sourceReady !== true || snapshot.listening?.enabled !== true) {
    return { ...off, state: "STARTING", label: "AutoDJ is preparing or reconnecting. No current audio is confirmed yet." };
  }
  const listening = snapshot.listening;
  const listenerUrl = safeTestRadioListenerUrl(listening.listenerUrl);
  const expiresInMs = Number.isFinite(listening.expiresInMs) ? Math.min(MAX_SNAPSHOT_AGE_MS, listening.expiresInMs) : 0;
  if (!listenerUrl || expiresInMs <= ageMs) {
    return { ...off, state: "STALE", label: "Audio status is stale — refresh to confirm. AutoDJ may still be running." };
  }
  // The backend supplies a title only after positive actual audio-send evidence.
  // Never select a playlist item from the clock or promote an enabled grant to audio.
  const observed = listening.track;
  const sourceTime = typeof observed?.sourceStartedAt === "string" ? Date.parse(observed.sourceStartedAt) : NaN;
  const track = observed && Number.isFinite(sourceTime) && Number.isFinite(observed.expiresInMs) && observed.expiresInMs > ageMs
    ? { title: cleanLabel(observed.title, "Untitled recording"), artist: cleanLabel(observed.artist, "Unknown artist"), sourceStartedAt: observed.sourceStartedAt } : null;
  return { enabled: true, listenerUrl, track, state: "STREAMING", label: "Audio is being sent to Streamerr — press Play to check the sound.",
    programme: track ? continuousPhaseView(listening) : null };
}

export function continuousRadioStartBody(exposureAccepted) {
  if (exposureAccepted !== true) return null;
  return { action: "start", publicExposureAccepted: true, monthlyBudgetUsd: 15 };
}
