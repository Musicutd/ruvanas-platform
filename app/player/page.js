"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendPlaybackEvent,
  removePlaybackEvents
} from "@/lib/playback-queue.mjs";

const PLAYBACK_QUEUE_KEY = "ruvanas_proof_of_play_queue_v1";
const PLAYED_INSERTIONS_KEY = "ruvanas_played_campaign_insertions_v1";

function readPlaybackQueue() {
  try {
    const value = JSON.parse(window.localStorage.getItem(PLAYBACK_QUEUE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writePlaybackQueue(queue) {
  window.localStorage.setItem(PLAYBACK_QUEUE_KEY, JSON.stringify(queue));
}

function readPlayedInsertions() {
  try {
    const value = JSON.parse(window.localStorage.getItem(PLAYED_INSERTIONS_KEY) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function rememberPlayedInsertion(scheduleItemId) {
  const played = [...readPlayedInsertions(), scheduleItemId].slice(-500);
  window.localStorage.setItem(PLAYED_INSERTIONS_KEY, JSON.stringify([...new Set(played)]));
}

export default function PlayerPage() {
  const [state, setState] = useState(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [manifest, setManifest] = useState(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [activeInsertionId, setActiveInsertionId] = useState(null);
  const [playSequence, setPlaySequence] = useState(0);
  const timer = useRef(null);
  const manifestTimer = useRef(null);
  const insertionTimer = useRef(null);
  const audio = useRef(null);
  const activeItemRef = useRef(null);
  const startedPlaybackKey = useRef(null);

  const flushPlaybackQueue = useCallback(async () => {
    const queued = readPlaybackQueue();
    if (!queued.length) return;

    try {
      const response = await fetch("/api/player/proof-of-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: queued.slice(0, 100) })
      });
      if (!response.ok) return;

      const sentIds = queued.slice(0, 100).map((event) => event.eventId);
      writePlaybackQueue(removePlaybackEvents(readPlaybackQueue(), sentIds));
    } catch {
      // Keep the queue on this device and retry after connectivity returns.
    }
  }, []);

  const queuePlaybackEvent = useCallback((event) => {
    writePlaybackQueue(appendPlaybackEvent(readPlaybackQueue(), event));
    flushPlaybackQueue();
  }, [flushPlaybackQueue]);

  const loadManifest = useCallback(async () => {
    const response = await fetch("/api/player/manifest", { cache: "no-store" });
    if (response.status === 401) return;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load the playback plan.");
    setManifest(data);
    setTrackIndex((current) => data.playlist?.length ? current % data.playlist.length : 0);
    setActiveInsertionId((current) => data.insertions?.some((item) => item.scheduleItemId === current) ? current : null);
    setPlaySequence((current) => current + 1);
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
      await flushPlaybackQueue();
    };
    heartbeat();
    timer.current = window.setInterval(heartbeat, state.heartbeatIntervalSeconds * 1000);
    return () => window.clearInterval(timer.current);
  }, [state, flushPlaybackQueue]);

  useEffect(() => {
    window.addEventListener("online", flushPlaybackQueue);
    flushPlaybackQueue();
    return () => window.removeEventListener("online", flushPlaybackQueue);
  }, [flushPlaybackQueue]);

  useEffect(() => {
    if (!state || !manifest) return undefined;
    manifestTimer.current = window.setInterval(() => {
      loadManifest().catch((error) => setMessage(error.message));
    }, manifest.refreshAfterSeconds * 1000);
    return () => window.clearInterval(manifestTimer.current);
  }, [state, manifest?.version, manifest?.refreshAfterSeconds, loadManifest]);

  useEffect(() => {
    if (!manifest) return undefined;
    window.clearTimeout(insertionTimer.current);
    if (activeInsertionId) return undefined;
    const played = readPlayedInsertions();
    const nextInsertion = (manifest.insertions || [])
      .filter((item) => !played.has(item.scheduleItemId))
      .sort((left, right) => left.plannedStart.localeCompare(right.plannedStart))[0];
    if (!nextInsertion) return undefined;

    const activate = () => {
      const current = activeItemRef.current;
      if (current?.itemType === "MUSIC" && startedPlaybackKey.current) {
        queuePlaybackEvent({
          eventId: crypto.randomUUID(),
          manifestVersion: manifest.version,
          proofToken: current.proofToken,
          scheduleItemId: current.scheduleItemId,
          itemType: current.itemType,
          trackId: current.trackId,
          eventType: "INTERRUPTED",
          occurredAt: new Date().toISOString(),
          positionSeconds: Math.max(0, Math.round(audio.current?.currentTime || 0)),
          failureReason: `Interrupted for ${nextInsertion.itemType === "SCHOOL_ANNOUNCEMENT" ? `school announcement ${nextInsertion.announcementTitle}` : `campaign ${nextInsertion.campaignName}`}`
        });
      }
      startedPlaybackKey.current = null;
      setActiveInsertionId(nextInsertion.scheduleItemId);
      setPlaySequence((current) => current + 1);
    };
    const delay = Math.max(0, new Date(nextInsertion.plannedStart).getTime() - Date.now());
    insertionTimer.current = window.setTimeout(activate, delay);
    return () => window.clearTimeout(insertionTimer.current);
  }, [manifest, activeInsertionId, queuePlaybackEvent]);

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

  const activeInsertion = manifest?.insertions?.find((item) => item.scheduleItemId === activeInsertionId) || null;
  const activeTrack = manifest?.playlist?.[trackIndex] || null;
  const activeItem = activeInsertion || activeTrack;
  activeItemRef.current = activeItem;
  const activePlaybackKey = activeItem
    ? `${manifest.version}:${activeItem.scheduleItemId}:${playSequence}`
    : null;

  function playbackEvent(eventType, audioElement, failureReason = null) {
    if (!activeItem || !manifest) return;
    queuePlaybackEvent({
      eventId: crypto.randomUUID(),
      manifestVersion: manifest.version,
      proofToken: activeItem.proofToken,
      scheduleItemId: activeItem.scheduleItemId,
      itemType: activeItem.itemType,
      ...(activeItem.itemType === "MUSIC" ? { trackId: activeItem.trackId } : {}),
      eventType,
      occurredAt: new Date().toISOString(),
      positionSeconds: Math.max(0, Math.round(audioElement?.currentTime || 0)),
      ...(failureReason ? { failureReason } : {})
    });
  }

  function startTrack(event) {
    if (startedPlaybackKey.current === activePlaybackKey) return;
    startedPlaybackKey.current = activePlaybackKey;
    if (activeItem.itemType !== "MUSIC") rememberPlayedInsertion(activeItem.scheduleItemId);
    playbackEvent("STARTED", event.currentTarget);
  }

  function finishTrack(event) {
    playbackEvent("COMPLETED", event.currentTarget);
    startedPlaybackKey.current = null;
    if (activeItem.itemType !== "MUSIC") setActiveInsertionId(null);
    else setTrackIndex((current) => (current + 1) % manifest.playlist.length);
    setPlaySequence((current) => current + 1);
  }

  function failTrack(event) {
    playbackEvent("FAILED", event.currentTarget, "Browser audio playback failed");
    startedPlaybackKey.current = null;
    if (activeItem.itemType !== "MUSIC") {
      rememberPlayedInsertion(activeItem.scheduleItemId);
      setActiveInsertionId(null);
    }
    setMessage("This audio could not be played. The player will retry when the schedule refreshes.");
  }

  return <main style={styles.page}><section style={styles.card}>
    <p style={styles.eyebrow}>RUVANAS WEB PLAYER</p>
    <h1 style={styles.heading}>{state.player.name}</h1>
    <p style={styles.copy}>{state.player.location} / {state.player.zone}</p>
    {activeItem ? <>
      <h2 style={styles.channel}>{activeItem.itemType === "SCHOOL_ANNOUNCEMENT" ? "School Radio" : activeItem.itemType === "PROMO" ? activeItem.campaignName : manifest.musicMode?.name}</h2>
      <p style={styles.nowPlaying}>{activeItem.itemType === "SCHOOL_ANNOUNCEMENT" ? "Announcement playing" : activeItem.itemType === "PROMO" ? "Campaign playing" : "Now playing"}: <strong>{activeItem.artist} — {activeItem.title}</strong></p>
      <audio ref={audio} key={activePlaybackKey} src={activeItem.mediaUrl} controls autoPlay onPlay={startTrack} onEnded={finishTrack} onError={failTrack} style={{ width: "100%" }} />
      <p style={styles.online}>Online — secure schedule and proof of play active</p>
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
