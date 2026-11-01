"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subscriberTestStreamData, subscriberStreamObservation, subscriberStreamEvidence } from "@/lib/subscriber-test-stream-ui.mjs";

const VERSION = "retail-subscriber-stream-v1";
const NOOP = () => {};

export default function SubscriberTestStreamPlayer({ initialState, requestHeaders, onAccessBlocked = NOOP }) {
  const [stream, setStream] = useState(() => subscriberTestStreamData(initialState));
  const [status, setStatus] = useState("Ready — press Play on this shop device.");
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const audio = useRef(null), currentStream = useRef(stream), latestObservation = useRef(null), lastPosition = useRef(null);
  const reportBusy = useRef(false), pollBusy = useRef(false), mounted = useRef(false), scheduledReport = useRef(null);
  currentStream.current = stream;

  const stopDevice = useCallback(message => {
    const element = audio.current;
    currentStream.current = null;
    if (element) { element.pause(); element.removeAttribute("src"); element.load(); }
    latestObservation.current = null;
    if (mounted.current) { setStream(null); setPlaying(false); setError(message); }
  }, []);

  const request = useCallback(async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(path, { cache: "no-store", ...options, headers: requestHeaders(options.headers || {}), signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if ([401, 403, 409, 429].includes(response.status)) {
        stopDevice(body.error || "This device is no longer authorized to play. Reload to check its connection.");
        if (mounted.current) onAccessBlocked(body);
        throw new Error(body.error || "Device playback access is unavailable.");
      }
      if (!response.ok) throw new Error(body.error || "The shop connection could not be checked.");
      return body;
    } finally { clearTimeout(timeout); }
  }, [requestHeaders, stopDevice, onAccessBlocked]);

  const report = useCallback(async () => {
    if (!mounted.current || !currentStream.current || reportBusy.current) return;
    reportBusy.current = true;
    const observed = latestObservation.current || subscriberStreamObservation(audio.current, "pause");
    try {
      await request("/api/player/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appVersion: VERSION, manifestVersion: null, sourceStatus: observed.sourceStatus }) });
      if (!mounted.current || !currentStream.current) return;
      await request("/api/player/stream-evidence", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscriberStreamEvidence(observed)) });
    } catch (failure) {
      // An unverified lease must not keep a device playing indefinitely. The
      // shared encoder keeps running; only this browser's playback is stopped.
      stopDevice(failure.message || "The shop connection could not be checked. Reload this page to reconnect.");
    } finally {
      reportBusy.current = false;
      if (mounted.current && currentStream.current && latestObservation.current !== observed) {
        scheduledReport.current = setTimeout(report, 500);
      }
    }
  }, [request, stopDevice]);

  const observe = useCallback((event, element = audio.current) => {
    const observation = subscriberStreamObservation(element, event, lastPosition.current);
    lastPosition.current = observation.positionSeconds;
    const changed = latestObservation.current?.state !== observation.state || latestObservation.current?.sourceStatus !== observation.sourceStatus;
    latestObservation.current = observation;
    if (!mounted.current) return;
    setPlaying(observation.state === "PLAYING");
    setStatus(observation.state === "PLAYING" ? "Audio is playing in this browser." : observation.state === "FAILED" ? "Audio could not play. Check the shop connection and try Play again." :
      element?.muted || element?.volume === 0 ? "The player is muted. Turn up its volume to hear the radio." :
        ["waiting", "stalled"].includes(event) || observation.sourceStatus === "DEGRADED" ? "Buffering — waiting for audio." : "Paused on this device. The shared Retail stream keeps running.");
    if (changed && currentStream.current) { clearTimeout(scheduledReport.current); scheduledReport.current = setTimeout(report, 250); }
  }, [report]);

  const refreshAccess = useCallback(async () => {
    if (!mounted.current || !currentStream.current || pollBusy.current) return;
    pollBusy.current = true;
    try {
      const nextState = await request("/api/player/state");
      const next = subscriberTestStreamData(nextState);
      if (!next || nextState.player.id !== initialState.player.id || next.channelId !== currentStream.current?.channelId) {
        stopDevice("This shop's approved stream is no longer available. Reload to check the current setup."); return;
      }
      if (mounted.current) setStream(next);
    } catch (failure) { stopDevice(failure.message || "Unable to verify this device. Reload to reconnect."); }
    finally { pollBusy.current = false; }
  }, [initialState.player.id, request, stopDevice]);

  useEffect(() => {
    mounted.current = true;
    const mountedAudio = audio.current;
    // Development Strict Mode replays effects after cleanup. Restore only the
    // still-valid server-approved URL; this never starts playback automatically.
    currentStream.current = subscriberTestStreamData(initialState);
    if (mountedAudio && currentStream.current && mountedAudio.src !== currentStream.current.streamUrl) mountedAudio.src = currentStream.current.streamUrl;
    const accessTimer = setInterval(refreshAccess, 30_000);
    const reportTimer = setInterval(() => { observe("progress"); report(); }, 15_000);
    const expiryTimer = setInterval(() => {
      if (currentStream.current && Date.parse(currentStream.current.expiresAt) <= Date.now()) stopDevice("This test access has expired. Contact the account owner.");
    }, 1000);
    report();
    const release = () => {
      stopDevice("This player page was closed.");
      // React may clear the ref before passive cleanup; stop the captured media
      // element too so removing this player cannot leave a detached stream on.
      if (mountedAudio) { mountedAudio.pause(); mountedAudio.removeAttribute("src"); mountedAudio.load(); }
      fetch("/api/player/heartbeat", { method: "DELETE", headers: requestHeaders(), keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", release);
    return () => {
      mounted.current = false;
      clearInterval(accessTimer); clearInterval(reportTimer); clearInterval(expiryTimer); clearTimeout(scheduledReport.current);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [initialState, observe, refreshAccess, report, requestHeaders, stopDevice]);

  return <main style={styles.page}><section style={styles.card}>
    <p style={styles.eyebrow}>RUVANAS · SHOP PLAYER</p>
    <h1 style={styles.heading}>{initialState.player.name}</h1>
    <p style={styles.copy}>{initialState.player.location} · {initialState.player.zone}</p>
    <h2>Retail radio</h2>
    <p style={styles.copy}>The same live programme plays in all your shops. Keep this page open on the connected device.</p>
    {stream ? <audio ref={audio} src={stream.streamUrl} controls preload="none" style={{ width: "100%" }}
      onPlaying={event => observe("playing", event.currentTarget)} onPause={event => observe("pause", event.currentTarget)}
      onWaiting={event => observe("waiting", event.currentTarget)} onStalled={event => observe("stalled", event.currentTarget)}
      onEnded={event => observe("ended", event.currentTarget)} onError={event => observe("error", event.currentTarget)}
      onVolumeChange={event => observe("volumechange", event.currentTarget)} /> : null}
    <p role="status" style={{ ...styles.status, color: playing ? "#bbf7d0" : "#fcd88a" }}>{stream ? status : "Playback on this device is stopped."}</p>
    {error && <p role="alert" style={styles.error}>{error}</p>}
    {!stream && <p style={styles.copy}>Reload this page to check access and reconnect. Your shared Retail stream continues independently.</p>}
    <p style={styles.note}>Device status reports browser playback only. It does not confirm your speakers are audible or create individual song proof-of-play records.</p>
  </section></main>;
}

const styles = {
  page: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#0f172a", color: "#fff", fontFamily: "Arial, sans-serif" },
  card: { width: "min(680px, 100%)", border: "1px solid #334155", borderRadius: 18, padding: "clamp(24px, 6vw, 48px)", background: "#111c2e" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.6 },
  heading: { fontSize: "clamp(30px, 6vw, 44px)", margin: "10px 0", overflowWrap: "anywhere" },
  copy: { color: "#cbd5e1", lineHeight: 1.6 }, status: { fontWeight: 800, lineHeight: 1.5 },
  error: { color: "#fecaca", padding: 12, background: "#3b171b", borderRadius: 8 },
  note: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.5, marginTop: 24 }
};
