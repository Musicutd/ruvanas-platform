"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendPlaybackEvent,
  removePlaybackEvents
} from "@/lib/playback-queue.mjs";
import LiveChannelPlayer from "./LiveChannelPlayer";

const PLAYBACK_QUEUE_KEY = "ruvanas_proof_of_play_queue_v1";
const PLAYED_INSERTIONS_KEY = "ruvanas_played_campaign_insertions_v1";
const PLAYER_INSTANCE_KEY = "ruvanas_player_instance_v1";
const PLAYER_INSTANCE_HEADER = "X-Ruvanas-Player-Instance";
const PLAYER_APP_VERSION = "stage-15f-guided-shop-activation";
let volatilePlayerInstanceId = null;

function getPlayerInstanceId() {
  if (volatilePlayerInstanceId) return volatilePlayerInstanceId;
  try {
    volatilePlayerInstanceId = window.sessionStorage.getItem(PLAYER_INSTANCE_KEY);
    if (!volatilePlayerInstanceId) {
      volatilePlayerInstanceId = crypto.randomUUID();
      window.sessionStorage.setItem(PLAYER_INSTANCE_KEY, volatilePlayerInstanceId);
    }
  } catch {
    volatilePlayerInstanceId = crypto.randomUUID();
  }
  return volatilePlayerInstanceId;
}

function playerHeaders(headers = {}) {
  return { ...headers, [PLAYER_INSTANCE_HEADER]: getPlayerInstanceId() };
}

function isPlayerAccessBlocked(response, data) {
  return response.status === 429 ||
    data?.code === "PLAYER_STREAM_LIMIT_REACHED" ||
    data?.code === "PLAYER_DEVICE_IN_USE" ||
    data?.code === "PLAYER_SESSION_REVOKED" ||
    data?.code === "PLAYER_SERVICE_UNAVAILABLE";
}

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
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [accessBlockedCode, setAccessBlockedCode] = useState(null);
  const [activeInsertionId, setActiveInsertionId] = useState(null);
  const timer = useRef(null);
  const manifestTimer = useRef(null);
  const insertionTimer = useRef(null);
  const insertionAudio = useRef(null);
  const activeAudioRef = useRef(null);
  const activeItemRef = useRef(null);
  const startedPlaybackKey = useRef(null);
  const commandBusy = useRef(false);

  const flushPlaybackQueue = useCallback(async () => {
    const queued = readPlaybackQueue();
    if (!queued.length) return;

    try {
      const response = await fetch("/api/player/proof-of-play", {
        method: "POST",
        headers: playerHeaders({ "Content-Type": "application/json" }),
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
    const response = await fetch("/api/player/manifest", {
      cache: "no-store",
      headers: playerHeaders()
    });
    if (response.status === 401) return;
    const data = await response.json();
    if (isPlayerAccessBlocked(response, data)) {
      setAccessBlocked(true);
      setAccessBlockedCode(data.code || null);
      setState(null);
      setManifest(null);
      setMessage(data.error);
      return;
    }
    if (!response.ok) throw new Error(data.error || "Unable to load the playback plan.");
    setAccessBlocked(false);
    setAccessBlockedCode(null);
    setManifest(data);
    setActiveInsertionId((current) => data.insertions?.some((item) => item.scheduleItemId === current) ? current : null);
  }, []);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/player/state", {
      cache: "no-store",
      headers: playerHeaders()
    });
    if (response.status === 401) {
      setState(null);
      setLoading(false);
      return;
    }
    const data = await response.json();
    if (isPlayerAccessBlocked(response, data)) {
      setAccessBlocked(true);
      setAccessBlockedCode(data.code || null);
      setState(null);
      setManifest(null);
      setMessage(data.error);
      setLoading(false);
      return;
    }
    if (!response.ok) throw new Error(data.error || "Unable to load player state.");
    setAccessBlocked(false);
    setAccessBlockedCode(null);
    setState(data);
    await loadManifest();
    setLoading(false);
  }, [loadManifest]);

  const pollPlayerCommands = useCallback(async () => {
    if (commandBusy.current) return;
    commandBusy.current = true;
    try {
      const response = await fetch("/api/player/commands", {
        cache: "no-store",
        headers: playerHeaders()
      });
      if (!response.ok) return;
      const { command } = await response.json();
      if (!command) return;
      let outcome = "SUCCEEDED";
      let message = "Command completed by the enrolled player.";
      try {
        if (command.kind === "REFRESH_STATE") await loadState();
        else if (command.kind === "REFRESH_MANIFEST") await loadManifest();
        else if (command.kind === "COLLECT_DIAGNOSTICS" || command.kind === "PING") {
          // These commands intentionally inspect only the bounded state below.
        } else {
          outcome = "UNSUPPORTED";
          message = "The player does not support this command.";
        }
      } catch (error) {
        outcome = "FAILED";
        message = error instanceof Error ? error.message : "The player could not complete the command.";
      }
      await fetch(`/api/player/commands/${command.id}/acknowledge`, {
        method: "POST",
        headers: playerHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          outcome,
          message,
          details: {
            appVersion: PLAYER_APP_VERSION,
            manifestVersion: manifest?.version || null,
            sourceStatus: navigator.onLine ? "CONNECTED" : "DISCONNECTED"
          }
        })
      });
    } catch {
      // The expiring command remains visible to operations if the device disconnects.
    } finally {
      commandBusy.current = false;
    }
  }, [loadManifest, loadState, manifest?.version]);

  useEffect(() => {
    loadState().catch((error) => { setMessage(error.message); setLoading(false); });
  }, [loadState]);

  useEffect(() => {
    if (!state) return undefined;
    const heartbeat = async () => {
      const response = await fetch("/api/player/heartbeat", {
        method: "POST",
        headers: playerHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          appVersion: PLAYER_APP_VERSION,
          manifestVersion: manifest?.version || null,
          sourceStatus: navigator.onLine ? "CONNECTED" : "DISCONNECTED"
        })
      });
      if (response.status === 429 || response.status === 409 || response.status === 403) {
        const data = await response.json().catch(() => ({}));
        setAccessBlocked(true);
        setAccessBlockedCode(data.code || null);
        setManifest(null);
        setState(null);
        setMessage(data.error || "This subscription has reached its active player limit.");
        return;
      }
      await flushPlaybackQueue();
      await pollPlayerCommands();
    };
    heartbeat();
    timer.current = window.setInterval(heartbeat, state.heartbeatIntervalSeconds * 1000);
    return () => window.clearInterval(timer.current);
  }, [state, manifest?.version, flushPlaybackQueue, pollPlayerCommands]);

  useEffect(() => {
    if (!state) return undefined;
    const release = () => {
      fetch("/api/player/heartbeat", {
        method: "DELETE",
        headers: playerHeaders(),
        keepalive: true
      }).catch(() => {});
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [state]);

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
          positionSeconds: Math.max(0, Math.round(activeAudioRef.current?.currentTime || 0)),
          failureReason: `Interrupted for ${nextInsertion.itemType === "SCHOOL_ANNOUNCEMENT" ? `school announcement ${nextInsertion.announcementTitle}` : `campaign ${nextInsertion.campaignName}`}`
        });
      }
      startedPlaybackKey.current = null;
      setActiveInsertionId(nextInsertion.scheduleItemId);
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

  const playbackEvent = useCallback((item, eventType, audioElement, failureReason = null) => {
    if (!item || !manifest) return;
    queuePlaybackEvent({
      eventId: crypto.randomUUID(),
      manifestVersion: manifest.version,
      proofToken: item.proofToken,
      scheduleItemId: item.scheduleItemId,
      itemType: item.itemType,
      ...(item.itemType === "MUSIC" ? { trackId: item.trackId } : {}),
      eventType,
      occurredAt: new Date().toISOString(),
      positionSeconds: Math.max(0, Math.round(audioElement?.currentTime || 0)),
      ...(failureReason ? { failureReason } : {})
    });
  }, [manifest?.version, queuePlaybackEvent]);

  const handleLiveActiveItem = useCallback((item, element) => {
    activeItemRef.current = item;
    activeAudioRef.current = element;
    startedPlaybackKey.current = manifest ? `${manifest.version}:${item.scheduleItemId}` : null;
  }, [manifest?.version]);

  if (loading) return <main style={styles.page}><p>Connecting player...</p></main>;

  if (accessBlocked) {
    return <main style={styles.page}><section style={styles.card}>
      <p style={styles.eyebrow}>RUVANAS WEB PLAYER</p>
      <h1 style={styles.heading}>{accessBlockedCode === "PLAYER_SESSION_REVOKED"
        ? "Player session stopped"
        : accessBlockedCode === "PLAYER_DEVICE_IN_USE"
          ? "Player already active"
          : "Player limit reached"}</h1>
      <p style={styles.copy}>{message || "This subscription has no free player stream slots."}</p>
      <p style={styles.copy}>{accessBlockedCode === "PLAYER_SESSION_REVOKED"
        ? "An organisation owner or manager stopped this session. You can reconnect after the short safety window or contact the account manager."
        : accessBlockedCode === "PLAYER_DEVICE_IN_USE"
          ? "Use the active device for this shop, or ask an organisation owner or manager to stop its session before moving the player to a replacement device."
          : "Close another active player, then try again. An abandoned slot is released automatically after about 90 seconds."}</p>
      <button type="button" style={styles.button} onClick={() => {
        setLoading(true);
        setMessage("");
        loadState().catch((error) => { setMessage(error.message); setLoading(false); });
      }}>Try again</button>
    </section></main>;
  }

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
  const activePlaybackKey = activeInsertion
    ? `${manifest.version}:${activeInsertion.scheduleItemId}`
    : null;

  function startTrack(event) {
    if (!activeInsertion) return;
    if (startedPlaybackKey.current === activePlaybackKey) return;
    startedPlaybackKey.current = activePlaybackKey;
    rememberPlayedInsertion(activeInsertion.scheduleItemId);
    activeItemRef.current = activeInsertion;
    activeAudioRef.current = event.currentTarget;
    playbackEvent(activeInsertion, "STARTED", event.currentTarget);
  }

  function finishTrack(event) {
    if (!activeInsertion) return;
    playbackEvent(activeInsertion, "COMPLETED", event.currentTarget);
    startedPlaybackKey.current = null;
    setActiveInsertionId(null);
  }

  function failTrack(event) {
    if (!activeInsertion) return;
    playbackEvent(activeInsertion, "FAILED", event.currentTarget, "Browser audio playback failed");
    startedPlaybackKey.current = null;
    rememberPlayedInsertion(activeInsertion.scheduleItemId);
    setActiveInsertionId(null);
    setMessage("This audio could not be played. The player will retry when the schedule refreshes.");
  }

  return <main style={styles.page}><section style={styles.card}>
    <p style={styles.eyebrow}>RUVANAS WEB PLAYER</p>
    <h1 style={styles.heading}>{state.player.name}</h1>
    <p style={styles.copy}>{state.player.location} / {state.player.zone}</p>
    {activeInsertion ? <>
      <h2 style={styles.channel}>{activeInsertion.itemType === "SCHOOL_ANNOUNCEMENT" ? "School Radio" : activeInsertion.campaignName}</h2>
      <p style={styles.nowPlaying}>{activeInsertion.itemType === "SCHOOL_ANNOUNCEMENT" ? "Announcement playing" : "Campaign playing"}: <strong>{activeInsertion.artist} — {activeInsertion.title}</strong></p>
      <audio ref={insertionAudio} key={activePlaybackKey} src={activeInsertion.mediaUrl} controls autoPlay onPlay={startTrack} onEnded={finishTrack} onError={failTrack} style={{ width: "100%" }} />
      <p style={styles.online}>Online — secure schedule and proof of play active</p>
    </> : manifest?.playlist?.length && manifest?.live ? <>
      <h2 style={styles.channel}>{state.channel?.name || manifest.musicMode?.name}</h2>
      <LiveChannelPlayer
        manifest={manifest}
        onPlaybackEvent={playbackEvent}
        onActiveItem={handleLiveActiveItem}
        onMessage={setMessage}
      />
      <p style={styles.online}>Online — synchronized live channel and proof of play active</p>
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
