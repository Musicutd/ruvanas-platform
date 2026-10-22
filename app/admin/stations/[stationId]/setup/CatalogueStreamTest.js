"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const time = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export function catalogueTestAudioStatus(latest, error = "", attentionRequired = false) {
  if (attentionRequired === true) return "Stop not confirmed — needs attention";
  if (error) return "Audio status unavailable — refresh to confirm";
  if (latest?.endedReason === "CATALOGUE_TEST_STOP_UNCONFIRMED" ||
      latest?.events?.some(event => event.kind === "TEST_ENDED" && event.details?.stopConfirmed === false)) {
    return "Stop not confirmed — needs attention";
  }
  return ["ARMED", "RUNNING"].includes(latest?.status) ? "Test running or starting" : "No active Ruvanas test";
}
export default function CatalogueStreamTest({ stationId }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exposureAccepted, setExposureAccepted] = useState(false);
  const [profileId, setProfileId] = useState("FIVE_MINUTES");
  const refreshSequence = useRef(0);
  const endpoint = `/api/admin/stations/${encodeURIComponent(stationId)}/catalogue-test`;
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const response = await fetch(`${endpoint}?profileId=${encodeURIComponent(profileId)}`, { cache: "no-store", credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The test status is unavailable.");
      if (sequence === refreshSequence.current) {
        setState(body); setError("");
        // A reload during a running hour test must display its saved profile,
        // not the default five-minute choice. This never prepares or arms it.
        if (["ARMED", "RUNNING"].includes(body.latest?.status) && ["FIVE_MINUTES", "ONE_HOUR"].includes(body.latest.profileId)) setProfileId(body.latest.profileId);
      }
    } catch (caught) { if (sequence === refreshSequence.current) setError(caught.message || "The test status is unavailable."); }
  }, [endpoint, profileId]);
  useEffect(() => { refresh(); }, [refresh]);
  const active = ["ARMED", "RUNNING"].includes(state?.latest?.status);
  const attentionRequired = state?.attentionRequired === true;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [active, refresh]);
  async function command(action) {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "prepare" ? { profileId } : { sessionId: state.latest.id }),
          ...(action === "arm" ? { publicExposureAccepted: exposureAccepted } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The command could not be confirmed. Check the test status before retrying.");
      setExposureAccepted(false);
      await refresh();
    } catch (caught) { setError(caught.message || "The command could not be confirmed."); }
    finally { setBusy(false); }
  }
  const previewMatches = state?.preview?.profileId === profileId;
  const savedProfileMatches = state?.latest?.profileId === profileId;
  const prepared = savedProfileMatches && state?.latest?.status === "PREPARED" && !state.latest.stopRequestedAt && new Date(state.latest.preparationDeadlineAt) > new Date();
  const savedPlaylist = active || prepared;
  const items = (savedPlaylist ? state?.latest?.items : previewMatches ? state?.preview?.items : []) || [];
  const selectedMinutes = profileId === "ONE_HOUR" ? 60 : 5;
  const button = { minHeight: 44, padding: "10px 16px", borderRadius: 8, border: "1px solid #846315", fontWeight: 700, cursor: "pointer" };
  return <section aria-labelledby="catalogue-stream-test-title" style={{ margin: "28px 0", padding: 24, border: "1px solid #b7c7d8", borderRadius: 12, background: "#f7fafc", color: "#14283d" }}>
    <p style={{ margin: "0 0 8px", color: "#816000", fontWeight: 800 }}>OWNER-ONLY · TEST RADIO</p>
    <h2 id="catalogue-stream-test-title" style={{ marginTop: 0 }}>Test your catalogue through Centova</h2>
    <p>Prepare a random mix from approved existing recordings for Malta. Choose a five-minute check or a separate one-hour test. After Start, the selected time includes file preparation and connection time, then output stops automatically. It does not enable normal AutoDJ, change your tester plan or publish a Ruvanas player.</p>
    <p><strong>Preparing sends no audio.</strong> Starting is a separate action. Centova’s direct listener address is publicly reachable during a stream; hiding the Ruvanas player does not make it private.</p>
    <label style={{ display: "block", margin: "16px 0" }}>Test duration <select value={profileId} disabled={busy || active || attentionRequired} onChange={event => { refreshSequence.current += 1; setProfileId(event.target.value); setExposureAccepted(false); }} style={{ minHeight: 44, marginLeft: 12 }}><option value="FIVE_MINUTES">5 minutes — standard check</option><option value="ONE_HOUR">60 minutes — extended test</option></select></label>
    <p>Maximum {selectedMinutes} minutes, one session only, with no automatic restart. Existing hosting and bandwidth charges may apply; this control does not purchase or upgrade a service.</p>
    {error && <p role="alert" style={{ padding: 12, background: "#fff0f0", color: "#9f1825" }}>{error}</p>}
    {!state && !error && <p role="status">Checking the existing catalogue and connection…</p>}
    {state && <>
      <p role="status"><strong>{catalogueTestAudioStatus(state.latest, error, attentionRequired)}</strong> · {state.sourceReady ? "Saved connection ready" : "Saved connection needs attention"} · {state.workerReady ? "Test worker ready" : "No test worker assigned"}</p>
      {attentionRequired && <p role="alert" style={{ padding: 12, background: "#fff0f0", color: "#9f1825" }}>A previous test could not confirm that its output stopped. Preparing and starting new tests are blocked until the worker is checked and this safety hold is separately resolved. Refreshing does not clear the hold.</p>}
      {!state.preview.ready && <p>{state.preview.label}</p>}
      {state.preview.ready && previewMatches && <p>{state.preview.eligibleTrackCount} recordings pass this test’s rights, territory, tier and media checks for the full {selectedMinutes}-minute window. {state.preview.items.length} unique recordings selected.</p>}
      {!state.startEnabled && <p style={{ padding: 12, background: "#fff5d9" }}>Starting audio is disabled. A verified test worker and separate live-test confirmation are required. No paid service is created by these controls.</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="button" onClick={() => command("prepare")} disabled={busy || active || attentionRequired || !state.preview.ready || !previewMatches || !state.sourceReady || !!error} style={{ ...button, background: "#f4b942" }}>Prepare random test — no audio</button>
        <button type="button" onClick={refresh} disabled={busy} style={button}>Refresh status</button>
        {active && <button type="button" onClick={() => command("stop")} disabled={busy || state.latest.stopRequestedAt} style={{ ...button, background: "#ffe3e3" }}>Stop test</button>}
      </div>
      {state.latest && <p>Saved test: {state.latest.status} · {time(state.latest.durationSeconds)} maximum{state.latest.stopRequestedAt ? " · stop requested, awaiting worker confirmation" : ""}{state.latest.endedReason ? ` · ${state.latest.endedReason}` : ""}</p>}
      {active && state.latest.deadlineAt && <p><strong>Automatic hard stop: {new Date(state.latest.deadlineAt).toLocaleString()}</strong></p>}
      {items.length > 0 && <><h3>Random playlist {savedPlaylist ? "saved for review" : "example — prepare to save"}</h3><ol>{items.map((item, index) => <li key={`${index}-${item.title}`} style={{ marginBottom: 8 }}>{item.artist} — {item.title} <span>({time(item.playDurationSeconds)})</span></li>)}</ol></>}
      {prepared && <div style={{ borderTop: "1px solid #c3ced7", paddingTop: 16 }}>
        <p>Prepared for {time(state.latest.durationSeconds)} maximum. Start by {new Date(state.latest.preparationDeadlineAt).toLocaleString()}, or prepare a fresh test. Once started, the hard cutoff cannot be extended.</p>
        <label style={{ display: "block", marginBottom: 12 }}><input type="checkbox" checked={exposureAccepted} disabled={!state.startEnabled} onChange={event => setExposureAccepted(event.target.checked)} /> I understand that this test sends audio to Streamerr/Centova and its direct stream may be heard by anyone with its address.</label>
        <button type="button" onClick={() => command("arm")} disabled={busy || attentionRequired || !state.startEnabled || !exposureAccepted || !!error} style={{ ...button, background: "#f4b942" }}>Start {Math.ceil(state.latest.durationSeconds / 60)}-minute Centova test</button>
      </div>}
      <h3>Test log</h3>
      <p>These records show source authentication and audio sent, not proof that a listener heard the music. Nothing is added to confirmed royalty or device proof-of-play reports.</p>
      {!state.latest?.events?.length ? <p>No audio-send events recorded.</p> : <ul>{state.latest.events.map((event, index) => <li key={index}>{new Date(event.occurredAt).toLocaleTimeString()} · {event.kind.replaceAll("_", " ")}</li>)}</ul>}
    </>}
  </section>;
}
