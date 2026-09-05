"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./studio.module.css";

const openStates = new Set(["CREATED", "SOUNDCHECK", "READY", "ON_AIR"]);
const dbGain = (value) => 10 ** (Number(value) / 20);

export default function BrowserStudioClient() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [meter, setMeter] = useState(-60);
  const [mixer, setMixer] = useState({ microphoneGainDb: 0, bedGainDb: -18, duckingDb: -12, limiterEnabled: true, echoCancellation: true, noiseSuppression: true });
  const [bedPlaying, setBedPlaying] = useState(false);
  const audioRef = useRef(null);
  const peerRef = useRef(null);
  const publishRef = useRef(null);

  const load = useCallback(async (sessionId = "") => {
    const response = await fetch(`/api/dj-access/studio${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Browser Live Studio is unavailable.");
    setData(payload);
    const nextId = sessionId || payload.sessions.find((session) => openStates.has(session.status))?.id || payload.sessions[0]?.id || "";
    setSelectedId(nextId);
    publishRef.current = payload.publish || null;
    if (!sessionId && nextId && payload.sessions.find((item) => item.id === nextId)?.providerReady) return load(nextId);
    return payload;
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)).finally(() => setBusy("")); }, [load]);
  const session = useMemo(() => data?.sessions?.find((item) => item.id === selectedId) || null, [data, selectedId]);

  useEffect(() => {
    if (!session || !new Set(["SOUNDCHECK", "READY", "ON_AIR"]).has(session.status)) return undefined;
    const id = setInterval(() => {
      fetch("/api/dj-access/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "HEARTBEAT", sessionId: session.id, mixer }) }).catch(() => {});
    }, (data?.heartbeatSeconds || 15) * 1_000);
    return () => clearInterval(id);
  }, [data?.heartbeatSeconds, mixer, session]);

  useEffect(() => () => {
    audioRef.current?.microphone?.getTracks().forEach((track) => track.stop());
    audioRef.current?.context?.close().catch(() => {});
    peerRef.current?.close();
  }, []);

  async function action(body, success, { refresh = true } = {}) {
    setBusy(body.action); setError(""); setNotice("");
    try {
      const response = await fetch("/api/dj-access/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The studio action failed.");
      if (payload.publish) publishRef.current = payload.publish;
      if (refresh) await load(body.sessionId);
      setNotice(success);
      return payload;
    } catch (actionError) { setError(actionError.message); throw actionError; } finally { setBusy(""); }
  }

  async function buildMixer() {
    if (audioRef.current) return audioRef.current;
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: mixer.echoCancellation, noiseSuppression: mixer.noiseSuppression, autoGainControl: false }, video: false });
    const context = new AudioContext({ latencyHint: "interactive" });
    const source = context.createMediaStreamSource(microphone);
    const micGain = context.createGain();
    const bedGain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    const analyser = context.createAnalyser();
    const destination = context.createMediaStreamDestination();
    micGain.gain.value = dbGain(mixer.microphoneGainDb);
    bedGain.gain.value = dbGain(mixer.bedGainDb);
    limiter.threshold.value = -2;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    analyser.fftSize = 2048;
    source.connect(micGain).connect(limiter);
    bedGain.connect(limiter);
    limiter.connect(analyser).connect(destination);
    audioRef.current = { microphone, context, micGain, bedGain, limiter, analyser, destination, bed: null, bedSource: null };
    return audioRef.current;
  }

  async function soundcheck() {
    if (!session) return;
    try {
      const started = await action({ action: "START_SOUNDCHECK", sessionId: session.id, expectedVersion: session.sessionVersion }, "Microphone connected. Measuring a short sample…");
      const audio = await buildMixer();
      const samples = new Float32Array(audio.analyser.fftSize);
      let peak = 0;
      const end = performance.now() + 1_500;
      while (performance.now() < end) {
        audio.analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const peakDb = peak > 0 ? 20 * Math.log10(peak) : -60;
      setMeter(Math.max(-60, peakDb));
      const latencyMs = Math.round(((audio.context.baseLatency || 0) + (audio.context.outputLatency || 0)) * 1_000);
      await action({ action: "SAVE_SOUNDCHECK", sessionId: session.id, expectedVersion: started.session.sessionVersion, mixer, soundcheck: { permissionGranted: true, microphoneDetected: audio.microphone.getAudioTracks().some((track) => track.readyState === "live"), sampleRate: audio.context.sampleRate, peakDb, latencyMs, mixer } }, "Soundcheck saved. Check the result before preparing the live link.");
    } catch (soundcheckError) {
      if (soundcheckError?.name === "NotAllowedError") setError("Microphone permission was not granted. Allow microphone access, then run soundcheck again.");
    }
  }

  function updateGain(field, value) {
    const next = { ...mixer, [field]: Number(value) };
    setMixer(next);
    const audio = audioRef.current;
    if (audio && field === "microphoneGainDb") audio.micGain.gain.setTargetAtTime(dbGain(value), audio.context.currentTime, 0.02);
    if (audio && field === "bedGainDb") audio.bedGain.gain.setTargetAtTime(dbGain(value), audio.context.currentTime, 0.02);
  }

  async function chooseBed(file) {
    const audio = await buildMixer();
    if (audio.bed) { audio.bed.pause(); URL.revokeObjectURL(audio.bed.src); }
    const element = new Audio(URL.createObjectURL(file));
    element.loop = true;
    const bedSource = audio.context.createMediaElementSource(element);
    bedSource.connect(audio.bedGain);
    audio.bed = element; audio.bedSource = bedSource; setBedPlaying(false);
  }

  async function toggleBed() {
    const bed = audioRef.current?.bed;
    if (!bed) return;
    if (bed.paused) { await bed.play(); setBedPlaying(true); } else { bed.pause(); setBedPlaying(false); }
  }

  async function waitForIce(peer) {
    if (peer.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      peer.addEventListener("icegatheringstatechange", () => { if (peer.iceGatheringState === "complete") { clearTimeout(timeout); resolve(); } });
    });
  }

  async function connectWhip(publish) {
    if (!publish?.whipEndpoint || !publish?.publishToken) throw new Error("The protected publishing link is missing or expired. Refresh the studio and try again.");
    const audio = await buildMixer();
    peerRef.current?.close();
    const peer = new RTCPeerConnection();
    for (const track of audio.destination.stream.getAudioTracks()) peer.addTrack(track, audio.destination.stream);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIce(peer);
    const response = await fetch(publish.whipEndpoint, { method: "POST", headers: { Authorization: `Bearer ${publish.publishToken}`, "Content-Type": "application/sdp" }, body: peer.localDescription.sdp });
    if (!response.ok) throw new Error(`The WHIP media connection was rejected (${response.status}).`);
    await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
    publishRef.current = { ...publish, resourceUrl: response.headers.get("Location") || null };
    peerRef.current = peer;
  }

  async function goLive() {
    if (!session) return;
    try {
      const prepared = await action({ action: "PREPARE", sessionId: session.id, expectedVersion: session.sessionVersion }, "Protected publishing connection prepared.", { refresh: false });
      await connectWhip(prepared.publish);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await action({ action: "GO_LIVE", sessionId: session.id, expectedVersion: prepared.session.sessionVersion, mixer }, "You are live through the protected Ruvanas playout path.");
    } catch (goLiveError) {
      setError(goLiveError instanceof Error ? goLiveError.message : "The live media connection could not be opened.");
      await load(session.id).catch(() => {});
    }
  }

  async function stopWhip() {
    const publish = publishRef.current;
    if (publish?.resourceUrl) await fetch(publish.resourceUrl, { method: "DELETE", headers: { Authorization: `Bearer ${publish.publishToken}` } }).catch(() => {});
    peerRef.current?.close(); peerRef.current = null;
  }

  async function close(actionName) {
    if (!session) return;
    await stopWhip();
    await action({ action: actionName, sessionId: session.id, expectedVersion: session.sessionVersion, reason: actionName === "END" ? "Presenter ended the Browser Live Studio session." : "Presenter activated the safe programming fallback." }, actionName === "END" ? "Studio session ended." : "Fallback active; schedule or AutoDJ has resumed.").catch(() => {});
  }

  if (busy === "load" && !data) return <article className={styles.card}><p>Checking your private studio access…</p></article>;
  if (!data) return <article className={styles.card}><p className={styles.error}>{error || "Browser Live Studio is unavailable."}</p><a className={styles.primary} href="/dj/access">Return to presenter access</a></article>;
  return <article className={styles.card}>
    <p className={styles.kicker}>BROWSER LIVE STUDIO</p><h1>{session?.title || "No studio scheduled"}</h1>
    <p className={styles.body}>{data.grant.channel?.station?.name ? `${data.grant.channel.station.name} / ` : ""}{data.grant.channel?.name} · protected {data.protocol} publishing</p>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {data.sessions.length > 1 ? <label className={styles.field}><span>Studio session</span><select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); load(event.target.value).catch((loadError) => setError(loadError.message)); }}>{data.sessions.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status.toLowerCase()}</option>)}</select></label> : null}
    {!session ? <div className={styles.empty}>Your station manager has not scheduled a Browser Live Studio session for this access window.</div> : <>
      <div className={styles.status}><span className={session.status === "ON_AIR" ? styles.onAir : ""}>{session.status.replaceAll("_", " ")}</span><strong>{new Date(session.scheduledStart).toLocaleString()}–{new Date(session.scheduledEnd).toLocaleTimeString()}</strong><small>{session.connectionQuality.toLowerCase()} soundcheck · automatic fallback after a missed studio heartbeat</small></div>
      <section className={styles.mixer}><div className={styles.mixerHeader}><div><h2>Local mixer</h2><p>Microphone and optional cue-bed audio are mixed in this browser before protected publishing.</p></div><output>{Math.round(meter)} dB peak</output></div>
        <label><span>Microphone gain <strong>{mixer.microphoneGainDb} dB</strong></span><input type="range" min="-24" max="12" step="1" value={mixer.microphoneGainDb} onChange={(event) => updateGain("microphoneGainDb", event.target.value)} /></label>
        <label><span>Cue-bed gain <strong>{mixer.bedGainDb} dB</strong></span><input type="range" min="-60" max="0" step="1" value={mixer.bedGainDb} onChange={(event) => updateGain("bedGainDb", event.target.value)} /></label>
        <div className={styles.bedRow}><label className={styles.fileButton}>Choose local cue bed<input type="file" accept="audio/*" onChange={(event) => event.target.files?.[0] && chooseBed(event.target.files[0]).catch(() => setError("The local cue bed could not be opened."))} /></label><button type="button" onClick={toggleBed} disabled={!audioRef.current?.bed}>{bedPlaying ? "Pause cue bed" : "Play cue bed"}</button></div>
      </section>
      <div className={styles.actions}>
        {new Set(["CREATED", "SOUNDCHECK"]).has(session.status) ? <button className={styles.primary} type="button" disabled={busy !== ""} onClick={soundcheck}>{busy ? "Working…" : "Run soundcheck"}</button> : null}
        {session.status === "SOUNDCHECK" ? <button className={styles.primary} type="button" disabled={busy !== "" || session.connectionQuality !== "GOOD" || !data.providerConfigured} onClick={goLive}>{data.providerConfigured ? "Prepare and go live" : "Provider setup required"}</button> : null}
        {session.status === "READY" ? <button className={styles.primary} type="button" disabled={busy !== "" || !data.publish} onClick={() => connectWhip(data.publish).then(() => action({ action: "GO_LIVE", sessionId: session.id, expectedVersion: session.sessionVersion, mixer }, "You are live.")).catch((connectError) => setError(connectError.message))}>Reconnect and go live</button> : null}
        {session.status === "ON_AIR" && !peerRef.current ? <button className={styles.primary} type="button" disabled={busy !== "" || !data.publish} onClick={() => connectWhip(data.publish).then(() => setNotice("Live audio reconnected to the existing on-air session.")).catch((connectError) => setError(connectError.message))}>Reconnect live audio</button> : null}
        {["SOUNDCHECK", "READY", "ON_AIR"].includes(session.status) ? <button type="button" disabled={busy !== ""} onClick={() => close("FORCE_FALLBACK")}>Activate fallback</button> : null}
        {openStates.has(session.status) ? <button type="button" disabled={busy !== ""} onClick={() => close("END")}>End studio</button> : null}
      </div>
      {!data.providerConfigured ? <p className={styles.providerNote}>Your soundcheck and mixer can be tested now. Broadcasting stays locked until Ruvanas is connected to compatible real-time media infrastructure.</p> : null}
    </>}
  </article>;
}
