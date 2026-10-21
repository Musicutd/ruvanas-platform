"use client";

import { useCallback, useEffect, useState } from "react";

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
  const endpoint = `/api/admin/stations/${encodeURIComponent(stationId)}/catalogue-test`;
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The test status is unavailable.");
      setState(body); setError("");
    } catch (caught) { setError(caught.message || "The test status is unavailable."); }
  }, [endpoint]);
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
        body: JSON.stringify({ action, ...(action === "prepare" ? {} : { sessionId: state.latest.id }),
          ...(action === "arm" ? { publicExposureAccepted: exposureAccepted } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The command could not be confirmed. Check the test status before retrying.");
      setExposureAccepted(false);
      await refresh();
    } catch (caught) { setError(caught.message || "The command could not be confirmed."); }
    finally { setBusy(false); }
  }
  const prepared = state?.latest?.status === "PREPARED" && !state.latest.stopRequestedAt && new Date(state.latest.expiresAt) > new Date();
  const items = state?.latest?.items || state?.preview?.items || [];
  const button = { minHeight: 44, padding: "10px 16px", borderRadius: 8, border: "1px solid #846315", fontWeight: 700, cursor: "pointer" };
  return <section aria-labelledby="catalogue-stream-test-title" style={{ margin: "28px 0", padding: 24, border: "1px solid #b7c7d8", borderRadius: 12, background: "#f7fafc", color: "#14283d" }}>
    <p style={{ margin: "0 0 8px", color: "#816000", fontWeight: 800 }}>OWNER-ONLY · TEST RADIO</p>
    <h2 id="catalogue-stream-test-title" style={{ marginTop: 0 }}>Test your catalogue through Centova</h2>
    <p>Prepare a random mix from approved existing recordings for Malta. The test lasts at most five minutes, including preparation, then stops automatically. It does not enable normal AutoDJ, change your tester plan or publish a Ruvanas player.</p>
    <p><strong>Preparing sends no audio.</strong> Starting is a separate action. Centova’s direct listener address is publicly reachable during a stream; hiding the Ruvanas player does not make it private.</p>
    {error && <p role="alert" style={{ padding: 12, background: "#fff0f0", color: "#9f1825" }}>{error}</p>}
    {!state && !error && <p role="status">Checking the existing catalogue and connection…</p>}
    {state && <>
      <p role="status"><strong>{catalogueTestAudioStatus(state.latest, error, attentionRequired)}</strong> · {state.sourceReady ? "Saved connection ready" : "Saved connection needs attention"} · {state.workerReady ? "Test worker ready" : "No test worker assigned"}</p>
      {attentionRequired && <p role="alert" style={{ padding: 12, background: "#fff0f0", color: "#9f1825" }}>A previous test could not confirm that its output stopped. Preparing and starting new tests are blocked until the worker is checked and this safety hold is separately resolved. Refreshing does not clear the hold.</p>}
      {!state.preview.ready && <p>{state.preview.label}</p>}
      {state.preview.ready && <p>{state.preview.eligibleTrackCount} recordings pass this test’s rights, territory, tier and media checks.</p>}
      {!state.startEnabled && <p style={{ padding: 12, background: "#fff5d9" }}>Starting audio is disabled. A verified test worker and separate live-test confirmation are required. No paid service is created by these controls.</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="button" onClick={() => command("prepare")} disabled={busy || active || attentionRequired || !state.preview.ready || !state.sourceReady} style={{ ...button, background: "#f4b942" }}>Prepare random test — no audio</button>
        <button type="button" onClick={refresh} disabled={busy} style={button}>Refresh status</button>
        {active && <button type="button" onClick={() => command("stop")} disabled={busy || state.latest.stopRequestedAt} style={{ ...button, background: "#ffe3e3" }}>Stop test</button>}
      </div>
      {state.latest && <p>Saved test: {state.latest.status}{state.latest.stopRequestedAt ? " · stop requested, awaiting worker confirmation" : ""}{state.latest.endedReason ? ` · ${state.latest.endedReason}` : ""}</p>}
      {items.length > 0 && <><h3>Random playlist {state.latest ? "saved for review" : "example — prepare to save"}</h3><ol>{items.map((item, index) => <li key={`${index}-${item.title}`} style={{ marginBottom: 8 }}>{item.artist} — {item.title} <span>({time(item.playDurationSeconds)})</span></li>)}</ol></>}
      {prepared && <div style={{ borderTop: "1px solid #c3ced7", paddingTop: 16 }}>
        <label style={{ display: "block", marginBottom: 12 }}><input type="checkbox" checked={exposureAccepted} disabled={!state.startEnabled} onChange={event => setExposureAccepted(event.target.checked)} /> I understand that this test sends audio to Streamerr/Centova and its direct stream may be heard by anyone with its address.</label>
        <button type="button" onClick={() => command("arm")} disabled={busy || attentionRequired || !state.startEnabled || !exposureAccepted} style={{ ...button, background: "#f4b942" }}>Start five-minute Centova test</button>
      </div>}
      <h3>Test log</h3>
      <p>These records show source authentication and audio sent, not proof that a listener heard the music. Nothing is added to confirmed royalty or device proof-of-play reports.</p>
      {!state.latest?.events?.length ? <p>No audio-send events recorded.</p> : <ul>{state.latest.events.map((event, index) => <li key={index}>{new Date(event.occurredAt).toLocaleTimeString()} · {event.kind.replaceAll("_", " ")}</li>)}</ul>}
    </>}
  </section>;
}
