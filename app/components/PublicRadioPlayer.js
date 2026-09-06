"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LiveChannelPlayer from "@/app/player/LiveChannelPlayer";
import styles from "./public-radio-player.module.css";

function sessionIdFor(slug) {
  const key = `ruvanas_public_listener_${slug}`;
  let value = window.sessionStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); window.sessionStorage.setItem(key, value); }
  return value;
}

export default function PublicRadioPlayer({ slug, compact = false }) {
  const [manifest, setManifest] = useState(null);
  const [message, setMessage] = useState("Connecting to the live station…");
  const [activeItem, setActiveItem] = useState(null);
  const sessionId = useRef(null);
  const telemetry = useRef(null);
  const listening = useRef(false);
  const refreshTimer = useRef(null);
  const heartbeatTimer = useRef(null);

  const sendEvent = useCallback((type, listeningSeconds = 0) => {
    const authority = telemetry.current;
    if (!authority?.token) return;
    fetch(authority.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authority.token}` },
      body: JSON.stringify({ events: [{ eventId: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), listeningSeconds }] }),
      keepalive: type === "SESSION_ENDED"
    }).catch(() => {});
  }, []);

  const setListening = useCallback((value, failed = false) => {
    if (failed) sendEvent("PLAYBACK_ERROR", 0);
    if (value && !listening.current) { listening.current = true; sendEvent("SESSION_STARTED", 0); }
    if (!value && listening.current) { listening.current = false; sendEvent("SESSION_ENDED", 0); }
  }, [sendEvent]);

  const loadManifest = useCallback(async () => {
    if (!sessionId.current) sessionId.current = sessionIdFor(slug);
    const response = await fetch(`/api/public/player/${encodeURIComponent(slug)}/manifest`, { cache: "no-store", headers: { "X-Ruvanas-Listener-Session": sessionId.current } });
    const data = await response.json();
    if (!response.ok) {
      setManifest(null);
      throw new Error(data.error || "This public station is unavailable.");
    }
    telemetry.current = data.analytics;
    setManifest(data);
    setActiveItem(data.nowPlaying);
    setMessage("");
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => loadManifest().catch((error) => setMessage(error.message)), data.refreshAfterSeconds * 1_000);
  }, [slug]);

  useEffect(() => {
    loadManifest().catch((error) => setMessage(error.message));
    return () => window.clearTimeout(refreshTimer.current);
  }, [loadManifest]);

  useEffect(() => {
    window.clearInterval(heartbeatTimer.current);
    heartbeatTimer.current = window.setInterval(() => { if (listening.current) sendEvent("HEARTBEAT", 30); }, 30_000);
    return () => window.clearInterval(heartbeatTimer.current);
  }, [sendEvent]);

  useEffect(() => {
    const release = () => {
      if (listening.current) sendEvent("SESSION_ENDED", 0);
      if (sessionId.current) fetch(`/api/public/player/${encodeURIComponent(slug)}/manifest`, { method: "DELETE", headers: { "X-Ruvanas-Listener-Session": sessionId.current }, keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [sendEvent, slug]);

  if (!manifest) return <section className={`${styles.player} ${compact ? styles.compact : ""}`}><div className={styles.loadingPulse} /><p className={styles.message}>{message}</p><button className={styles.retry} onClick={() => loadManifest().catch((error) => setMessage(error.message))}>Try again</button></section>;

  const currentInsertion = manifest.insertions.find((item) => {
    const start = new Date(item.plannedStart).getTime();
    return start <= Date.now() && start + item.durationSeconds * 1_000 > Date.now();
  });
  const accent = manifest.station.accent || "#f4b942";
  return <section className={`${styles.player} ${compact ? styles.compact : ""}`} style={{ "--player-accent": accent }}>
    <header className={styles.header}>
      {manifest.station.logoUrl ? <img className={styles.logo} src={manifest.station.logoUrl} alt="" /> : <div className={styles.logoFallback}>{manifest.station.name.slice(0, 1).toUpperCase()}</div>}
      <div><p className={styles.eyebrow}>LIVE ON RUVANAS</p><h1 className={styles.title}>{manifest.station.name}</h1><p className={styles.tagline}>{manifest.station.tagline || manifest.station.description || "Live radio, wherever you are."}</p></div>
    </header>
    <div className={styles.nowPlaying}><span className={styles.liveDot} /><div><small>NOW PLAYING</small><strong>{activeItem?.artist ? `${activeItem.artist} — ${activeItem.title}` : activeItem?.title || manifest.channel.name}</strong></div></div>
    <div className={styles.audioArea}>
      {currentInsertion ? <audio src={currentInsertion.mediaUrl} controls autoPlay className={styles.audio} onPlay={() => { setActiveItem(currentInsertion); setListening(true); }} onPause={() => setListening(false)} onEnded={() => loadManifest().catch(() => {})} onError={() => { setListening(false, true); setMessage("This programme item could not be played."); }} />
        : manifest.externalLive ? <audio src={manifest.externalLive.mediaUrl} controls className={styles.audio} onPlay={() => setListening(true)} onPause={() => setListening(false)} onError={() => { setListening(false, true); setMessage("The live programme is temporarily unavailable."); }} />
          : manifest.playlist.length && manifest.live ? <LiveChannelPlayer manifest={manifest} onPlaybackEvent={(item, type) => { if (type === "STARTED") setActiveItem(item); }} onActiveItem={(item) => setActiveItem(item)} onMessage={setMessage} onPlayingChange={setListening} />
            : manifest.fallbackStream ? <audio src={manifest.fallbackStream.mediaUrl} controls className={styles.audio} onPlay={() => setListening(true)} onPause={() => setListening(false)} onError={() => { setListening(false, true); setMessage("The station stream is temporarily unavailable."); }} />
              : <p className={styles.message}>The station is online, but no programme is available at this moment.</p>}
    </div>
    {message ? <p className={styles.message} aria-live="polite">{message}</p> : null}
    <footer className={styles.footer}><span>{manifest.channel.name}</span><span>Anonymous listening · privacy-safe analytics</span><span>Powered by Ruvanas</span></footer>
  </section>;
}
