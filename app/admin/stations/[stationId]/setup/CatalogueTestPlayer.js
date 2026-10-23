"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { catalogueTestPlayerView, replaceCatalogueTestAudio } from "@/lib/catalogue-test-player.mjs";

export default function CatalogueTestPlayer({ snapshot, refreshError }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackMessage, setPlaybackMessage] = useState("");
  const audio = useRef(null);
  const attachAudio = useCallback(node => replaceCatalogueTestAudio(audio, node), []);
  useEffect(() => {
    const receivedAt = performance.now();
    setElapsedMs(0);
    const update = () => setElapsedMs(Math.max(0, performance.now() - receivedAt));
    const timer = setInterval(update, 1_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [snapshot]);
  const view = catalogueTestPlayerView(snapshot, elapsedMs, Boolean(refreshError));
  useEffect(() => {
    setPlaybackMessage("");
  }, [view.enabled, view.listenerUrl, snapshot?.sessionId]);
  return <section aria-labelledby="test-radio-listen-title" style={{ margin: "20px 0", padding: 20, borderRadius: 10, background: "#e9f0f7", border: "1px solid #b7c7d8" }}>
    <h3 id="test-radio-listen-title" style={{ marginTop: 0 }}>Listen to Test Radio</h3>
    <p role="status">{view.label}</p>
    {view.track ? <div style={{ borderLeft: "4px solid #e4a51e", paddingLeft: 12 }}>
      <p style={{ marginBottom: 4, fontSize: 13 }}>Music sent to Streamerr</p>
      {view.track.phase && <p style={{ fontWeight: 700 }}>{view.track.phase}</p>}
      <p style={{ margin: "4px 0", fontSize: 20, fontWeight: 800 }}>{view.track.title}</p>
      <p style={{ marginTop: 4 }}>{view.track.artist}</p>
    </div> : <p>No current source-track title is confirmed.</p>}
    <p style={{ fontSize: 13 }}>Titles come from the music sent by Ruvanas. Your player may be a few seconds behind; press Play to check the sound.</p>
    {view.enabled && <>
      <audio key={`${snapshot.sessionId}:${view.listenerUrl}`} ref={attachAudio} controls preload="none" src={view.listenerUrl}
        aria-label="Test Radio HTTPS audio player" style={{ width: "100%", minHeight: 44 }}
        onPlaying={() => setPlaybackMessage("Your browser is playing the stream. Please check that you can hear the music.")}
        onWaiting={() => setPlaybackMessage("Buffering the stream…")}
        onPause={() => setPlaybackMessage("Listening paused on this device. This does not stop the station test.")}
        onError={() => setPlaybackMessage("The player could not load audio. Refresh status, then try Play again. No insecure fallback is used.")} />
      <p><a href={view.listenerUrl} target="_blank" rel="noopener noreferrer">Open the secure stream in another tab</a></p>
      <p role="status">{playbackMessage || "Press Play when you are ready. Audio never starts automatically."}</p>
    </>}
    <p style={{ marginBottom: 0, fontSize: 13 }}>This owner-only control listens to the existing Streamerr feed. It does not start the encoder, enable normal broadcasting or publish a public Ruvanas player. The unlisted Streamerr address is not password-protected.</p>
  </section>;
}
