"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export default function PlayerPage() {
  const [state, setState] = useState(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [manifest, setManifest] = useState(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const timer = useRef(null);
  const manifestTimer = useRef(null);

  const loadManifest = useCallback(async () => {
    const response = await fetch("/api/player/manifest", { cache: "no-store" });
    if (response.status === 401) return;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load the playback plan.");
    setManifest(data);
    setTrackIndex(0);
  }, []);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/player/state", { cache: "no-store" });
    if (response.status === 401) {
      setState(null);
      setLoading(false);
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load player state.");
    setState(data);
    await loadManifest();
    setLoading(false);
  }, [loadManifest]);

  useEffect(() => {
    loadState().catch((error) => { setMessage(error.message); setLoading(false); });
  }, [loadState]);

  useEffect(() => {
    if (!state) return undefined;
    const heartbeat = async () => {
      await fetch("/api/player/heartbeat", { method: "POST" });
    };
    heartbeat();
    timer.current = window.setInterval(heartbeat, state.heartbeatIntervalSeconds * 1000);
    return () => window.clearInterval(timer.current);
  }, [state]);

  useEffect(() => {
    if (!state || !manifest) return undefined;
    manifestTimer.current = window.setInterval(() => {
      loadManifest().catch((error) => setMessage(error.message));
    }, manifest.refreshAfterSeconds * 1000);
    return () => window.clearInterval(manifestTimer.current);
  }, [state, manifest?.version, manifest?.refreshAfterSeconds, loadManifest]);

  async function enrol(event) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/player/enrol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "Unable to enrol this player.");
      return;
    }
    setCode("");
    await loadState();
  }

  if (loading) return <main style={styles.page}><p>Connecting player...</p></main>;

  if (!state) {
    return <main style={styles.page}><section style={styles.card}>
      <p style={styles.eyebrow}>RUVANAS WEB PLAYER</p>
      <h1 style={styles.heading}>Enrol this player</h1>
      <p style={styles.copy}>Enter the one-time code supplied by Ruvanas operations.</p>
      <form onSubmit={enrol} style={styles.form}>
        <input value={code} onChange={(event) => setCode(event.target.value)} style={styles.input} autoComplete="off" aria-label="Player enrolment code" />
        <button style={styles.button} disabled={!code.trim()}>Enrol player</button>
      </form>
      {message ? <p style={styles.error}>{message}</p> : null}
    </section></main>;
  }

  const activeTrack = manifest?.playlist?.[trackIndex] || null;

  return <main style={styles.page}><section style={styles.card}>
    <p style={styles.eyebrow}>RUVANAS WEB PLAYER</p>
    <h1 style={styles.heading}>{state.player.name}</h1>
    <p style={styles.copy}>{state.player.location} / {state.player.zone}</p>
    {activeTrack ? <>
      <h2 style={styles.channel}>{manifest.musicMode.name}</h2>
      <p style={styles.nowPlaying}>Now playing: <strong>{activeTrack.artist} — {activeTrack.title}</strong></p>
      <audio key={`${manifest.version}-${activeTrack.trackId}`} src={activeTrack.mediaUrl} controls autoPlay onEnded={()=>setTrackIndex((current)=>(current+1)%manifest.playlist.length)} style={{ width: "100%" }} />
      <p style={styles.online}>Online — secure schedule active</p>
    </> : state.channel?.streamUrl ? <>
      <h2 style={styles.channel}>{state.channel.name}</h2>
      <audio src={state.channel.streamUrl} controls autoPlay style={{ width: "100%" }} />
      <p style={styles.online}>Online — live channel fallback</p>
    </> : <div style={styles.waiting}>{manifest?.state === "LOCATION_CLOSED" ? "This location is currently closed. Playback will resume during opening hours." : "No playable schedule or channel is assigned to this zone yet. This player will update automatically."}</div>}
    {message ? <p style={styles.error}>{message}</p> : null}
  </section></main>;
}

const styles = {
  page: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#0f172a", color: "#fff", fontFamily: "Arial, sans-serif" },
  card: { width: "min(680px, 100%)", border: "1px solid #334155", borderRadius: 18, padding: "clamp(24px, 6vw, 48px)", background: "#111c2e", boxShadow: "0 24px 70px rgba(0,0,0,.28)" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.6 },
  heading: { fontSize: "clamp(32px, 7vw, 54px)", margin: "10px 0" },
  copy: { color: "#cbd5e1", lineHeight: 1.6 },
  form: { display: "grid", gap: 12, marginTop: 24 },
  input: { minHeight: 48, borderRadius: 8, border: "1px solid #64748b", padding: "10px 12px", fontSize: 16 },
  button: { minHeight: 48, border: 0, borderRadius: 8, background: "#f4b942", color: "#111827", fontWeight: 900, cursor: "pointer" },
  channel: { marginTop: 30, fontSize: 24 },
  nowPlaying: { color: "#e2e8f0", lineHeight: 1.5 },
  online: { display: "inline-block", color: "#86efac", fontWeight: 800 },
  waiting: { marginTop: 28, padding: 18, borderRadius: 10, background: "#1e293b", color: "#cbd5e1", lineHeight: 1.6 },
  error: { color: "#fca5a5", fontWeight: 800 }
};
