"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MANIFEST_KEY = "ruvanas_signage_manifest_v1";
const PROOF_QUEUE_KEY = "ruvanas_signage_proof_queue_v1";
const ASSET_CACHE = "ruvanas-signage-assets-v1";
const MAX_QUEUE = 500;

function readJson(key, fallback) {
  try { return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function writeQueue(queue) {
  window.localStorage.setItem(PROOF_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
}

async function materialiseAssetUrls(manifest) {
  const assets = new Map();
  for (const region of manifest?.playlist?.layout?.regions || []) {
    for (const item of region.items || []) assets.set(item.asset.id, item.asset.mediaUrl);
  }
  const cache = "caches" in window ? await caches.open(ASSET_CACHE) : null;
  const urls = {};
  for (const [assetId, mediaUrl] of assets) {
    let response = null;
    try {
      response = await fetch(mediaUrl, { credentials: "same-origin" });
      if (!response.ok) response = null;
      else if (cache) await cache.put(mediaUrl, response.clone());
    } catch {
      response = cache ? await cache.match(mediaUrl) : null;
    }
    if (!response && cache) response = await cache.match(mediaUrl);
    if (response) urls[assetId] = URL.createObjectURL(await response.blob());
  }
  return urls;
}

function DisplayRegion({ region, manifest, assetUrls, onEvent }) {
  const [index, setIndex] = useState(0);
  const item = region.items[index % Math.max(1, region.items.length)] || null;
  useEffect(() => { setIndex(0); }, [manifest.version, region.id]);
  useEffect(() => {
    if (!item) return undefined;
    onEvent(item, "STARTED");
    if (item.asset.kind === "VIDEO") {
      const watchdogSeconds = Math.max(item.durationSeconds, item.asset.durationSeconds || 0) + 15;
      const watchdog = window.setTimeout(() => {
        onEvent(item, "FAILED", "Video playback did not finish within its verified duration");
        setIndex((current) => (current + 1) % region.items.length);
      }, watchdogSeconds * 1000);
      return () => window.clearTimeout(watchdog);
    }
    const timer = window.setTimeout(() => {
      onEvent(item, "COMPLETED");
      setIndex((current) => (current + 1) % region.items.length);
    }, item.durationSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [item?.id, index, manifest.version, onEvent, region.items.length]);
  if (!item) return null;
  const next = (eventType, failureReason = null) => {
    onEvent(item, eventType, failureReason);
    setIndex((current) => (current + 1) % region.items.length);
  };
  const mediaStyle = { width: "100%", height: "100%", objectFit: region.fitMode === "CONTAIN" ? "contain" : region.fitMode === "STRETCH" ? "fill" : "cover", display: "block" };
  return <div style={{ position: "absolute", left: `${region.x / manifest.playlist.layout.canvasWidth * 100}%`, top: `${region.y / manifest.playlist.layout.canvasHeight * 100}%`, width: `${region.width / manifest.playlist.layout.canvasWidth * 100}%`, height: `${region.height / manifest.playlist.layout.canvasHeight * 100}%`, zIndex: region.zIndex, overflow: "hidden" }}>
    {item.asset.kind === "VIDEO" ? <video
      key={`${manifest.version}:${item.id}`}
      src={assetUrls[item.asset.id] || item.asset.mediaUrl}
      autoPlay muted playsInline preload="auto"
      onEnded={() => next("COMPLETED")}
      onError={() => next("FAILED", "Video asset could not be rendered")}
      style={mediaStyle}
    /> : <img
      src={assetUrls[item.asset.id] || item.asset.mediaUrl}
      alt=""
      onError={() => next("FAILED", "Visual asset could not be rendered")}
      style={mediaStyle}
    />}
  </div>;
}

export default function SignagePage() {
  const [state, setState] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [assetUrls, setAssetUrls] = useState({});
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const objectUrls = useRef([]);
  const manifestRef = useRef(null);

  const flushProof = useCallback(async () => {
    const queued = readJson(PROOF_QUEUE_KEY, []);
    if (!Array.isArray(queued) || !queued.length) return;
    try {
      const batch = queued.slice(0, 100);
      const response = await fetch("/api/signage/proof", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }) });
      if (!response.ok) return;
      const sent = new Set(batch.map((event) => event.eventId));
      writeQueue(readJson(PROOF_QUEUE_KEY, []).filter((event) => !sent.has(event.eventId)));
    } catch { /* Retain device-confirmed events until connectivity returns. */ }
  }, []);

  const queueEvent = useCallback((item, eventType, failureReason = null) => {
    const currentManifest = manifestRef.current;
    if (!currentManifest?.playlist) return;
    const event = {
      eventId: crypto.randomUUID(),
      manifestVersion: currentManifest.version,
      proofToken: item.proofToken,
      playlistId: currentManifest.playlist.id,
      playlistItemId: item.id,
      assetId: item.asset.id,
      ...(currentManifest.takeover?.id ? { takeoverId: currentManifest.takeover.id } : {}),
      ...(currentManifest.playlist.retailMediaOrderId ? { retailMediaOrderId: currentManifest.playlist.retailMediaOrderId } : {}),
      eventType,
      occurredAt: new Date().toISOString(),
      ...(failureReason ? { failureReason } : {})
    };
    const queue = readJson(PROOF_QUEUE_KEY, []);
    writeQueue([...(Array.isArray(queue) ? queue.filter((entry) => entry.eventId !== event.eventId) : []), event]);
    flushProof();
  }, [flushProof]);

  const applyManifest = useCallback(async (value) => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const urls = await materialiseAssetUrls(value);
    objectUrls.current = Object.values(urls);
    setAssetUrls(urls);
    manifestRef.current = value;
    setManifest(value);
  }, []);

  const loadManifest = useCallback(async () => {
    try {
      const response = await fetch("/api/signage/manifest", { cache: "no-store" });
      if (response.status === 401) return false;
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Unable to load the display plan.");
      window.localStorage.setItem(MANIFEST_KEY, JSON.stringify(value));
      await applyManifest(value);
      setMessage("");
      return true;
    } catch (error) {
      const cached = readJson(MANIFEST_KEY, null);
      if (cached?.offlineGraceUntil && new Date(cached.offlineGraceUntil) > new Date()) {
        await applyManifest(cached);
        setMessage("Offline mode — displaying the last verified plan.");
        return true;
      }
      setMessage(error instanceof Error ? error.message : "No verified display plan is available.");
      return false;
    }
  }, [applyManifest]);

  const loadState = useCallback(async () => {
    try {
      const response = await fetch("/api/signage/state", { cache: "no-store" });
      if (response.status === 401) { setState(null); setLoading(false); return; }
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Unable to load display state.");
      setState(value);
      await loadManifest();
      setLoading(false);
    } catch (error) {
      const cached = readJson(MANIFEST_KEY, null);
      if (cached?.device && cached?.offlineGraceUntil && new Date(cached.offlineGraceUntil) > new Date()) {
        setState({ device: cached.device, heartbeatIntervalSeconds: 60, manifestUrl: "/api/signage/manifest" });
        await applyManifest(cached);
        setMessage("Offline mode — displaying the last verified plan.");
        setLoading(false);
        return;
      }
      throw error;
    }
  }, [applyManifest, loadManifest]);

  useEffect(() => {
    loadState().catch((error) => { setMessage(error.message); setLoading(false); });
    return () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, [loadState]);

  useEffect(() => {
    if (!state) return undefined;
    const heartbeat = async () => { try { await fetch("/api/signage/heartbeat", { method: "POST" }); await flushProof(); } catch {} };
    heartbeat();
    const timer = window.setInterval(heartbeat, state.heartbeatIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [state, flushProof]);

  useEffect(() => {
    if (!state || !manifest) return undefined;
    const timer = window.setInterval(() => loadManifest(), manifest.refreshAfterSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [state, manifest?.version, manifest?.refreshAfterSeconds, loadManifest]);

  useEffect(() => {
    window.addEventListener("online", flushProof);
    flushProof();
    return () => window.removeEventListener("online", flushProof);
  }, [flushProof]);

  async function enrol(event) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/signage/enrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const value = await response.json();
    if (!response.ok) { setMessage(value.error || "Unable to enrol this display."); return; }
    setCode(""); await loadState();
  }

  const canvas = manifest?.playlist?.layout;
  const aspectRatio = useMemo(() => canvas ? `${canvas.canvasWidth} / ${canvas.canvasHeight}` : "16 / 9", [canvas?.canvasWidth, canvas?.canvasHeight]);
  if (loading) return <main style={styles.center}><p>Connecting secure display…</p></main>;
  if (!state) return <main style={styles.center}><section style={styles.card}>
    <p style={styles.eyebrow}>RUVANAS DIGITAL SIGNAGE</p><h1 style={styles.heading}>Enrol this display</h1>
    <p style={styles.copy}>Enter the one-time code supplied by an authorised Ruvanas administrator.</p>
    <form onSubmit={enrol} style={styles.form}><input value={code} onChange={(event) => setCode(event.target.value)} aria-label="Display enrolment code" autoComplete="off" style={styles.input} /><button disabled={!code.trim()} style={styles.button}>Enrol display</button></form>
    {message ? <p style={styles.error}>{message}</p> : null}
  </section></main>;
  if (!canvas || manifest.state !== "READY") return <main style={styles.center}><section style={styles.card}><p style={styles.eyebrow}>RUVANAS DIGITAL SIGNAGE</p><h1 style={styles.heading}>{state.device.name}</h1><p style={styles.copy}>{state.device.location} / {state.device.zone}</p><div style={styles.waiting}>No active visual playlist is scheduled. This display will update automatically.</div>{message ? <p style={styles.notice}>{message}</p> : null}</section></main>;

  return <main style={styles.player} aria-label={`${manifest.playlist.name} digital signage`}>
    <div style={{ position: "relative", width: "100vw", maxHeight: "100vh", aspectRatio, background: canvas.backgroundColor, overflow: "hidden" }}>
      {canvas.regions.map((region) => <DisplayRegion key={`${manifest.version}:${region.id}`} region={region} manifest={manifest} assetUrls={assetUrls} onEvent={queueEvent} />)}
    </div>
    {message ? <div style={styles.offline}>{message}</div> : null}
  </main>;
}

const styles = {
  center: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#070d19", color: "#fff", fontFamily: "Arial, sans-serif" },
  player: { minHeight: "100vh", display: "grid", placeItems: "center", margin: 0, background: "#000", overflow: "hidden" },
  card: { width: "min(680px, 100%)", border: "1px solid #334155", borderRadius: 18, padding: "clamp(24px, 6vw, 48px)", background: "#111c2e" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.6 },
  heading: { fontSize: "clamp(32px, 7vw, 54px)", margin: "10px 0" },
  copy: { color: "#cbd5e1", lineHeight: 1.6 },
  form: { display: "grid", gap: 12, marginTop: 24 },
  input: { minHeight: 48, borderRadius: 8, border: "1px solid #64748b", padding: "10px 12px", fontSize: 16 },
  button: { minHeight: 48, border: 0, borderRadius: 8, background: "#f4b942", color: "#111827", fontWeight: 900, cursor: "pointer" },
  waiting: { marginTop: 28, padding: 18, borderRadius: 10, background: "#1e293b", color: "#cbd5e1", lineHeight: 1.6 },
  error: { color: "#fca5a5", fontWeight: 800 },
  notice: { color: "#fde68a", fontWeight: 700 },
  offline: { position: "fixed", right: 12, bottom: 12, zIndex: 9999, padding: "7px 10px", borderRadius: 7, background: "rgba(15,23,42,.88)", color: "#fde68a", font: "700 12px Arial" }
};
