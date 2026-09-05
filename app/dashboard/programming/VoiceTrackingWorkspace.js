"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./programming.module.css";

const EMPTY = { title: "", channelId: "", audioRenderId: "", outgoingTrackId: "", incomingTrackId: "", outgoingCueOutMs: 0, voiceTrimStartMs: 0, voiceTrimEndMs: 0, incomingIntroEndMs: 15000, outgoingOverlapMs: 2000, incomingOverlapMs: 2000, duckingDb: -12 };
const seconds = (value) => `${(Number(value || 0) / 1000).toFixed(1)}s`;
const gainFromDb = (value) => Math.pow(10, Number(value || 0) / 20);

function sourceById(items, id) { return (items || []).find((item) => item.id === id) || null; }

export default function VoiceTrackingWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [previewed, setPreviewed] = useState("");
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const previewRef = useRef([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/voice-tracking", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load Voice Tracking.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);
  useEffect(() => { load(); return () => stopPreview(); }, [load]);

  const selected = useMemo(() => ({
    render: sourceById(data?.renders, form.audioRenderId),
    outgoing: sourceById(data?.tracks, form.outgoingTrackId),
    incoming: sourceById(data?.tracks, form.incomingTrackId)
  }), [data, form.audioRenderId, form.outgoingTrackId, form.incomingTrackId]);

  function stopPreview() {
    for (const entry of previewRef.current) {
      if (entry.kind === "timer") clearTimeout(entry.value);
      if (entry.kind === "audio") { entry.value.pause(); entry.value.src = ""; }
      if (entry.kind === "context") entry.value.close().catch(() => {});
    }
    previewRef.current = [];
  }

  async function playPreview(segue, acknowledge = false) {
    stopPreview(); setError(""); setNotice("Preparing the outgoing song, voice link and incoming song…");
    const outgoing = segue.outgoingTrack || selected.outgoing;
    const voice = segue.voice || selected.render;
    const incoming = segue.incomingTrack || selected.incoming;
    if (!outgoing?.streamUrl || !voice?.streamUrl || !incoming?.streamUrl) return setError("Choose all three approved audio sources before previewing.");
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      await context.resume();
      previewRef.current.push({ kind: "context", value: context });
      const tracks = [new Audio(outgoing.streamUrl), new Audio(voice.streamUrl), new Audio(incoming.streamUrl)];
      tracks.forEach((audio) => { audio.preload = "auto"; previewRef.current.push({ kind: "audio", value: audio }); });
      const gains = tracks.map((audio) => { const node = context.createGain(); context.createMediaElementSource(audio).connect(node).connect(context.destination); return node.gain; });
      const cueOut = Number(segue.outgoingCueOutMs ?? form.outgoingCueOutMs);
      const voiceStart = Number(segue.voiceTrimStartMs ?? form.voiceTrimStartMs);
      const voiceEnd = Number(segue.voiceTrimEndMs ?? form.voiceTrimEndMs);
      const outOverlap = Number(segue.outgoingOverlapMs ?? form.outgoingOverlapMs);
      const inOverlap = Number(segue.incomingOverlapMs ?? form.incomingOverlapMs);
      const leadMs = Math.min(4000, Math.max(1000, cueOut - outOverlap));
      tracks[0].currentTime = Math.max(0, cueOut - outOverlap - leadMs) / 1000;
      tracks[1].currentTime = voiceStart / 1000;
      tracks[2].currentTime = 0;
      const voiceDelayMs = leadMs;
      const incomingDelayMs = voiceDelayMs + (voiceEnd - voiceStart) - inOverlap;
      const now = context.currentTime;
      gains[0].setValueAtTime(1, now); gains[0].linearRampToValueAtTime(gainFromDb(segue.duckingDb ?? form.duckingDb), now + voiceDelayMs / 1000); gains[0].linearRampToValueAtTime(0, now + (leadMs + outOverlap) / 1000);
      gains[1].setValueAtTime(1, now + voiceDelayMs / 1000); gains[1].linearRampToValueAtTime(0, now + (voiceDelayMs + voiceEnd - voiceStart) / 1000);
      gains[2].setValueAtTime(gainFromDb(segue.duckingDb ?? form.duckingDb), now + incomingDelayMs / 1000); gains[2].linearRampToValueAtTime(1, now + (incomingDelayMs + inOverlap) / 1000);
      await tracks[0].play();
      for (const [delay, audio] of [[voiceDelayMs, tracks[1]], [incomingDelayMs, tracks[2]]]) {
        const timer = setTimeout(() => audio.play().catch(() => setError("The browser blocked part of the audio preview. Press preview again.")), Math.max(0, delay));
        previewRef.current.push({ kind: "timer", value: timer });
      }
      const stop = setTimeout(() => { stopPreview(); setNotice("Segue preview complete. The saved draft can now be approved."); }, Math.max(8000, incomingDelayMs + Math.min(8000, Number(segue.incomingIntroEndMs ?? form.incomingIntroEndMs))));
      previewRef.current.push({ kind: "timer", value: stop });
      if (acknowledge && segue.id) setPreviewed(segue.id);
    } catch (previewError) { stopPreview(); setError(previewError.message || "The browser could not play this segue preview."); }
  }

  function selectRender(id) {
    const render = sourceById(data?.renders, id);
    setForm((current) => ({ ...current, audioRenderId: id, voiceTrimStartMs: 0, voiceTrimEndMs: render?.durationMs || 0 }));
  }
  function selectTrack(field, id) {
    const track = sourceById(data?.tracks, id);
    setForm((current) => ({ ...current, [field]: id, ...(field === "outgoingTrackId" ? { outgoingCueOutMs: track?.durationMs || 0 } : { incomingIntroEndMs: Math.min(15000, track?.durationMs || 0) }) }));
  }
  function reset() { setEditing(null); setForm(EMPTY); setPreviewed(""); setError(""); setNotice(""); }
  function edit(segue) {
    setEditing(segue);
    setForm({ title: segue.title, channelId: segue.channel.id, audioRenderId: segue.audioRenderId, outgoingTrackId: segue.outgoingTrack.id, incomingTrackId: segue.incomingTrack.id, outgoingCueOutMs: segue.outgoingCueOutMs, voiceTrimStartMs: segue.voiceTrimStartMs, voiceTrimEndMs: segue.voiceTrimEndMs, incomingIntroEndMs: segue.incomingIntroEndMs, outgoingOverlapMs: segue.outgoingOverlapMs, incomingOverlapMs: segue.incomingOverlapMs, duckingDb: segue.duckingDb });
    setPreviewed("");
  }

  async function save(event) {
    event.preventDefault(); setBusy("save"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/voice-tracking", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { action: "SAVE", segueId: editing.id, expectedVersion: editing.version, ...form } : form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the voice track.");
      setNotice(editing ? "Voice-track timing saved as a new draft version." : "Voice-track draft created. Listen to its complete segue before approval.");
      setEditing(null); setForm(EMPTY); setPreviewed(""); await load();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function action(segue, actionName) {
    setBusy(`${actionName}:${segue.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/voice-tracking", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName, segueId: segue.id, expectedVersion: segue.version, previewAcknowledged: previewed === segue.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The voice-track action failed.");
      setNotice(actionName === "APPROVE" ? "Voice track approved and available as a protected Radio Clock source." : "Voice track archived.");
      setPreviewed(""); await load();
    } catch (actionError) { setError(actionError.message); } finally { setBusy(""); }
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading Voice Tracking…</div></section>;
  const ready = Boolean(selected.render && selected.outgoing && selected.incoming);
  return <section className={styles.panel} aria-labelledby="voice-tracking-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>VOICE TRACKING + SEGUE</p><h2 id="voice-tracking-title">Make every link sound live</h2></div><span className={styles.count}>{data?.segues?.filter((segue) => segue.status === "APPROVED").length || 0} approved</span></div>
    <p className={styles.panelIntro}>Reuse an approved AudioLab or multitrack voice render, set the outgoing cue and next-song intro, then listen to the real three-part transition before approval. Approved links become protected sources in Radio Clocks.</p>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {(data?.segues || []).length ? <div className={styles.voiceTrackGrid}>{data.segues.map((segue) => <article className={styles.voiceTrackCard} key={segue.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{segue.title}</strong><span>{segue.channel?.name}</span></div><span className={segue.status === "APPROVED" ? styles.publishedBadge : styles.draftBadge}>{segue.status}</span></div>
      <div className={styles.segueFlow}><span>{segue.outgoingTrack.name}</span><b>−{seconds(segue.outgoingOverlapMs)}</b><span>{segue.voice.name}</span><b>−{seconds(segue.incomingOverlapMs)}</b><span>{segue.incomingTrack.name}</span></div>
      <p>{seconds(segue.timeline.voiceDurationMs)} voice · {segue.duckingDb} dB music bed · version {segue.version}</p>
      <div className={styles.cardActions}><button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => playPreview(segue, true)}>{previewed === segue.id ? "Previewed ✓" : "Play complete segue"}</button>{data.canAuthor && segue.status === "DRAFT" ? <button type="button" className={styles.secondaryButton} onClick={() => edit(segue)}>Edit timing</button> : null}{data.canApprove && segue.status === "DRAFT" ? <button type="button" className={styles.primaryButton} disabled={busy !== "" || previewed !== segue.id} onClick={() => action(segue, "APPROVE")}>Approve for clocks</button> : null}{data.canApprove ? <button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => action(segue, "ARCHIVE")}>Archive</button> : null}</div>
    </article>)}</div> : <div className={styles.emptyState}>No voice tracks yet. Create the first segue after an AudioLab or multitrack output has passed review.</div>}
    {data?.canAuthor ? <form className={styles.smartPlaylistForm} onSubmit={save}>
      <div className={styles.smartFormHeader}><div><h3>{editing ? "Edit voice-track timing" : "Create a voice-track segue"}</h3><p>Cue values are bounded by each protected audio file. Saving never changes live programming.</p></div>{editing ? <button type="button" className={styles.secondaryButton} onClick={reset}>Create another</button> : null}</div>
      {!data.renders.length ? <div className={styles.safetyBanner}><strong>An approved voice render is needed</strong><span>Record and finish the link in the existing AudioLab or multitrack studio, pass quality review, then return here.</span></div> : null}
      <div className={styles.formGrid}>
        <label><span>Voice-track title</span><input required minLength="2" maxLength="160" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Breakfast link into headlines" /></label>
        <label><span>Channel</span><select required value={form.channelId} onChange={(event) => setForm({ ...form, channelId: event.target.value })}><option value="">Choose channel</option>{data.channels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label><span>Approved voice render</span><select required value={form.audioRenderId} onChange={(event) => selectRender(event.target.value)}><option value="">Choose AudioLab output</option>{data.renders.map((item) => <option value={item.id} key={item.id}>{item.name} · {seconds(item.durationMs)}</option>)}</select></label>
        <label><span>Outgoing song</span><select required value={form.outgoingTrackId} onChange={(event) => selectTrack("outgoingTrackId", event.target.value)}><option value="">Choose song</option>{data.tracks.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label><span>Incoming song</span><select required value={form.incomingTrackId} onChange={(event) => selectTrack("incomingTrackId", event.target.value)}><option value="">Choose song</option>{data.tracks.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label><span>Outgoing cue-out (ms)</span><input type="number" min="1" max={selected.outgoing?.durationMs || undefined} required value={form.outgoingCueOutMs} onChange={(event) => setForm({ ...form, outgoingCueOutMs: Number(event.target.value) })} /></label>
        <label><span>Voice start / end (ms)</span><span className={styles.inlineInputs}><input type="number" min="0" required value={form.voiceTrimStartMs} onChange={(event) => setForm({ ...form, voiceTrimStartMs: Number(event.target.value) })} /><input type="number" min="1" max={selected.render?.durationMs || undefined} required value={form.voiceTrimEndMs} onChange={(event) => setForm({ ...form, voiceTrimEndMs: Number(event.target.value) })} /></span></label>
        <label><span>Incoming intro ends (ms)</span><input type="number" min="0" max={selected.incoming?.durationMs || undefined} required value={form.incomingIntroEndMs} onChange={(event) => setForm({ ...form, incomingIntroEndMs: Number(event.target.value) })} /></label>
        <label><span>Outgoing / incoming overlap (ms)</span><span className={styles.inlineInputs}><input type="number" min="0" max="30000" required value={form.outgoingOverlapMs} onChange={(event) => setForm({ ...form, outgoingOverlapMs: Number(event.target.value) })} /><input type="number" min="0" max="30000" required value={form.incomingOverlapMs} onChange={(event) => setForm({ ...form, incomingOverlapMs: Number(event.target.value) })} /></span></label>
        <label><span>Music under voice (dB)</span><input type="number" min="-36" max="0" step="0.5" required value={form.duckingDb} onChange={(event) => setForm({ ...form, duckingDb: Number(event.target.value) })} /></label>
      </div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>AudioLab render · rights-cleared songs · cue-bound preview · manager approval</span><button type="button" className={styles.secondaryButton} disabled={!ready || busy !== ""} onClick={() => playPreview(form)}>Preview draft timing</button><button className={styles.primaryButton} disabled={!ready || busy !== ""}>{busy === "save" ? "Saving…" : editing ? "Save new version" : "Create draft"}</button></div>
    </form> : null}
  </section>;
}
