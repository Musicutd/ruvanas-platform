"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { continuousRadioPlayerView, continuousRadioStartBody, replaceContinuousRadioAudio } from "@/lib/test-radio-continuous-player.mjs";

const button = { minHeight: 44, padding: "10px 16px", borderRadius: 8, border: "1px solid #846315", fontWeight: 700, cursor: "pointer" };

export function ContinuousRadioListening({ snapshot, refreshError }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackMessage, setPlaybackMessage] = useState("");
  const audio = useRef(null);
  const attachAudio = useCallback(node => replaceContinuousRadioAudio(audio, node), []);
  useEffect(() => {
    const receivedAt = performance.now();
    setElapsedMs(0);
    const update = () => setElapsedMs(Math.max(0, performance.now() - receivedAt));
    const timer = setInterval(update, 1_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [snapshot]);
  const view = continuousRadioPlayerView(snapshot, elapsedMs, Boolean(refreshError));
  useEffect(() => { setPlaybackMessage(""); }, [view.enabled, view.listenerUrl]);
  return <div style={{ padding: 18, background: "#edf3f8", borderRadius: 10, margin: "18px 0" }}>
    <p role="status" style={{ marginTop: 0, fontWeight: 700 }}>{view.label}</p>
    {view.programme && <p style={{ fontWeight: 700, color: "#32556c" }}>{view.programme.label}</p>}
    {view.track ? <div style={{ borderLeft: "4px solid #e4a51e", paddingLeft: 12 }}>
      <p style={{ marginBottom: 4, fontSize: 13 }}>Music sent to Streamerr</p>
      <p style={{ margin: "4px 0", fontSize: 21, fontWeight: 800 }}>{view.track.title}</p>
      <p style={{ marginTop: 4 }}>{view.track.artist}</p>
    </div> : <p>No current source-track title is confirmed.</p>}
    {view.enabled && <>
      <audio key={view.listenerUrl} ref={attachAudio} controls preload="none" src={view.listenerUrl}
        aria-label="Continuous Test Radio HTTPS audio player" style={{ width: "100%", minHeight: 44 }}
        onPlaying={() => setPlaybackMessage("Your browser is playing the stream. Please check that you can hear the music.")}
        onWaiting={() => setPlaybackMessage("Buffering the stream…")}
        onPause={() => setPlaybackMessage("Listening paused on this device. AutoDJ continues until you use Stop AutoDJ.")}
        onError={() => setPlaybackMessage("The secure player could not load audio. Refresh status and try Play again. No insecure fallback is used.")} />
      <p><a href={view.listenerUrl} target="_blank" rel="noopener noreferrer">Open Test Radio’s secure stream</a></p>
      <p role="status">{playbackMessage || "Press Play when you are ready. Listening never starts automatically."}</p>
      <p style={{ fontSize: 13 }}>This stream is public to anyone with its address. The title reports music sent by Ruvanas, not proof that a listener heard it; listening can be a few seconds behind.</p>
    </>}
  </div>;
}

export default function ContinuousAutoDj({ stationId }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [exposureAccepted, setExposureAccepted] = useState(false);
  const refreshSequence = useRef(0);
  const refreshAbort = useRef(null);
  const commandInFlight = useRef(false);
  const endpoint = `/api/admin/stations/${encodeURIComponent(stationId)}/continuous-autodj`;
  const refresh = useCallback(async () => {
    if (commandInFlight.current) return;
    const sequence = ++refreshSequence.current;
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    const requestStartedAt = performance.now();
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "AutoDJ status could not be checked.");
      if (sequence === refreshSequence.current) {
        // Count the entire request time conservatively, so a delayed response
        // cannot revive a title or player from an already expired observation.
        setState({ ...body, requestAgeMs: Math.max(0, performance.now() - requestStartedAt) }); setError("");
      }
    } catch (caught) {
      if (sequence === refreshSequence.current && caught.name !== "AbortError") setError(caught.message || "AutoDJ status could not be checked.");
    }
  }, [endpoint]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3_000);
    return () => { clearInterval(timer); refreshSequence.current += 1; refreshAbort.current?.abort(); };
  }, [refresh]);

  async function command(action) {
    if (commandInFlight.current) return;
    const request = action === "start" ? continuousRadioStartBody(exposureAccepted) : { action: "stop" };
    if (!request) return;
    commandInFlight.current = true;
    refreshSequence.current += 1;
    refreshAbort.current?.abort();
    setBusy(true); setError(""); setMessage("");
    // Stop removes the local player immediately; only a fresh server response
    // may establish that audio is streaming again.
    if (action === "stop") setState(previous => previous ? { ...previous, status: "STOPPING", listening: null } : previous);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The command could not be confirmed. Refresh status before retrying.");
      setExposureAccepted(false);
      setMessage(action === "stop" ? "Stop requested. Check the status below for the encoder’s shutdown confirmation." : "AutoDJ enabled. The status below will confirm when the worker is sending music.");
      commandInFlight.current = false;
      await refresh();
    } catch (caught) { setError(caught.name === "AbortError" ? "The command timed out; its result is not confirmed. Refresh status or use Stop AutoDJ." : caught.message || "The command could not be confirmed."); }
    finally { clearTimeout(timeout); commandInFlight.current = false; setBusy(false); }
  }
  const enabled = state?.enabled === true;
  const serviceExpiresAt = typeof state?.serviceExpiresAt === "string" && Number.isFinite(Date.parse(state.serviceExpiresAt)) ? new Date(state.serviceExpiresAt) : null;
  return <section aria-labelledby="continuous-autodj-title" style={{ margin: "28px 0", padding: 24, border: "2px solid #d8a527", borderRadius: 12, background: "#f7fafc", color: "#14283d" }}>
    <p style={{ margin: "0 0 8px", color: "#816000", fontWeight: 800 }}>OWNER CONTROL · TEST RADIO ONLY</p>
    <h2 id="continuous-autodj-title" style={{ marginTop: 0 }}>Continuous AutoDJ</h2>
    <p>Play approved songs from your existing Ruvanas music library in a continuing random rotation. Approved weekly programmes take over at their exact start time; random AutoDJ returns at the end. Once started, AutoDJ runs until you stop it, unless a safety, music-rights or service-permission check requires a stop.</p>
    <p>Only Test Radio uses this control. Registration stays closed and other Streamerr channels are unchanged.</p>
    <div style={{ background: "#fff5d9", padding: 14, borderRadius: 8 }}>
      <strong>Approved allowance: US$15 per month.</strong> The planning estimate is about US$13.70 per month for the existing worker and one 128 kbps stream, including a small bandwidth allowance. This is per station, not per listener; existing website, Streamerr, R2 and taxes are separate. This control does not upgrade your plan or create a paid service.
    </div>
    {serviceExpiresAt && <p style={{ padding: 12, background: "#fff5d9", borderRadius: 8 }}><strong>Current service permission expires: {serviceExpiresAt.toLocaleString()}.</strong> AutoDJ will stop if this permission is not renewed. Starting continuous playback does not extend your existing private-preview or subscription access.</p>}
    {error && <p role="alert" style={{ padding: 12, background: "#fff0f0", color: "#9f1825" }}>{error} AutoDJ may still be running. Stop remains available.</p>}
    {message && <p role="status">{message}</p>}
    <ContinuousRadioListening snapshot={state} refreshError={error} />
    {state && !state.startAllowed && !enabled && <p>Starting is not available yet. The worker, connection and approved catalogue must be verified first.</p>}
    {!enabled && <label style={{ display: "block", margin: "16px 0", lineHeight: 1.6 }}>
      <input type="checkbox" checked={exposureAccepted} disabled={busy} onChange={event => setExposureAccepted(event.target.checked)} /> I want Test Radio to keep playing until I stop it. Anyone with its stream address can listen; the monthly allowance is US$15.
    </label>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      <button type="button" onClick={() => command("start")} disabled={busy || enabled || !state?.startAllowed || !exposureAccepted || Boolean(error)} style={{ ...button, background: "#f4b942" }}>Start continuous AutoDJ</button>
      <button type="button" onClick={() => command("stop")} disabled={busy} style={{ ...button, background: "#ffe3e3", borderColor: "#a3313b" }}>Stop AutoDJ</button>
      <button type="button" onClick={refresh} disabled={busy} style={button}>Refresh status</button>
    </div>
    <p style={{ marginBottom: 0, fontSize: 13 }}>Pausing the player affects only this device. Stop AutoDJ requests that the encoder stop sending music. Suspending the Render worker is a separate action to stop its compute charges. The monthly allowance is not a Render billing cap.</p>
  </section>;
}
