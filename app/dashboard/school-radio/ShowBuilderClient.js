"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const blankItem = { type: "MUSIC_TRACK", label: "", sourceId: "", notes: "", transitionPreset: "CLEAN", introCueMs: 0, outroCueMs: 0, cueOffsetMs: "" };
const blankSchedule = { target: "", startsAt: "", endsAt: "" };
const broadcastTypes = new Set(["MUSIC_TRACK", "JINGLE", "VOICE_TRACK", "INTERVIEW", "ANNOUNCEMENT"]);

function Badge({ value }) {
  const colors = value === "APPROVED" ? ["#14532d", "#bbf7d0"] : value === "IN_REVIEW" ? ["#713f12", "#fef3c7"] : value === "CHANGES_REQUESTED" || value === "REJECTED" ? ["#7f1d1d", "#fecaca"] : ["#334155", "#e2e8f0"];
  return <span style={{ ...s.badge, background: colors[0], color: colors[1] }}>{String(value || "DRAFT").replaceAll("_", " ")}</span>;
}

function durationLabel(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function itemAudioUrl(item) {
  const id = item.sourceTrack?.mediaAsset?.id || item.sourcePromoVersion?.mediaAsset?.id || item.sourceAnnouncement?.promoVersion?.mediaAsset?.id || item.sourceTake?.mediaAsset?.id || item.sourceMediaAsset?.id;
  return id ? `/api/media/${id}/stream` : "";
}

async function playTransitionPreview(previous, voice, next) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Transition preview is not supported by this browser.");
  const context = new AudioContextClass();
  const decode = async (entry) => {
    const response = await fetch(itemAudioUrl(entry));
    if (!response.ok) throw new Error("One of the preview items is no longer available.");
    return context.decodeAudioData(await response.arrayBuffer());
  };
  try {
    const [beforeBuffer, voiceBuffer, afterBuffer] = await Promise.all([previous ? decode(previous) : null, decode(voice), next ? decode(next) : null]);
    const beforeDuration = Math.min(5, beforeBuffer?.duration || 0);
    const voiceDuration = Math.min(90, voiceBuffer.duration);
    const afterDuration = Math.min(5, afterBuffer?.duration || 0);
    const overlap = voice.transitionPreset === "CROSSFADE" ? 1 : voice.transitionPreset === "DUCK_VOICE" ? 1.5 : 0;
    const voiceStart = Math.max(0, beforeDuration - overlap);
    const afterStart = voiceStart + voiceDuration - (voice.transitionPreset === "CROSSFADE" ? 1 : 0);
    const origin = context.currentTime + 0.1;
    const schedule = (buffer, when, offset, duration, gainValue = 1, fade = false) => {
      if (!buffer || duration <= 0) return;
      const source = context.createBufferSource(); const gain = context.createGain();
      source.buffer = buffer; source.connect(gain).connect(context.destination);
      gain.gain.setValueAtTime(gainValue, origin + when);
      if (fade) gain.gain.linearRampToValueAtTime(voice.transitionPreset === "DUCK_VOICE" ? 0.22 : 0, origin + when + duration);
      source.start(origin + when, offset, duration);
    };
    schedule(beforeBuffer, 0, Math.max(0, (beforeBuffer?.duration || 0) - beforeDuration), beforeDuration, 1, overlap > 0);
    schedule(voiceBuffer, voiceStart, 0, voiceDuration, 1, false);
    schedule(afterBuffer, afterStart, 0, afterDuration, voice.transitionPreset === "DUCK_VOICE" ? 0.35 : 1, false);
    await new Promise((resolve) => setTimeout(resolve, Math.ceil((afterStart + afterDuration + 0.2) * 1000)));
  } finally { await context.close().catch(() => {}); }
}

function sourceOptions(data, episodeId, type) {
  if (!data) return [];
  if (type === "MUSIC_TRACK") return data.catalogue.tracks.map((item) => ({ id: item.id, label: `${item.artist} — ${item.title}` }));
  if (type === "JINGLE") return data.catalogue.jingles.map((item) => ({ id: item.id, label: `${item.promoAsset.name} · ${item.promoAsset.mediaType.replaceAll("_", " ")}` }));
  if (type === "VOICE_TRACK") return data.catalogue.takes.filter((item) => item.project.episodeId === episodeId).map((item) => ({ id: item.id, label: `${item.project.title} · ${durationLabel(item.durationMs)}` }));
  if (type === "INTERVIEW") return data.catalogue.interviews.map((item) => ({ id: item.id, label: item.name || item.originalName }));
  if (type === "ANNOUNCEMENT") return data.catalogue.announcements.map((item) => ({ id: item.id, label: item.title }));
  return [];
}

function sourceField(type) {
  return ({ MUSIC_TRACK: "sourceTrackId", JINGLE: "sourcePromoVersionId", VOICE_TRACK: "sourceTakeId", INTERVIEW: "sourceMediaAssetId", ANNOUNCEMENT: "sourceAnnouncementId" })[type];
}

export default function ShowBuilderClient() {
  const [data, setData] = useState(null);
  const [episodeId, setEpisodeId] = useState("");
  const [item, setItem] = useState(blankItem);
  const [schedule, setSchedule] = useState(blankSchedule);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewing, setPreviewing] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/show-builder", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Show Builder could not be loaded.");
    setData(payload);
    setEpisodeId((current) => current || payload.episodes[0]?.id || "");
  }, []);
  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  const episode = useMemo(() => data?.episodes.find((candidate) => candidate.id === episodeId) || null, [data, episodeId]);
  const rundown = episode?.rundown || null;
  const options = sourceOptions(data, episodeId, item.type);
  const targets = useMemo(() => (data?.locations || []).flatMap((location) => [
    { value: `location:${location.id}`, label: location.name },
    ...location.zones.map((zone) => ({ value: `zone:${zone.id}`, label: `${location.name} — ${zone.name}` }))
  ]), [data]);

  async function mutate(body, success) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/show-builder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The Show Builder action could not be completed.");
      setNotice(success); await load(); return payload;
    } catch (actionError) { setError(actionError.message); return null; } finally { setWorking(false); }
  }

  async function createRundown() {
    if (!episodeId) return;
    await mutate({ action: "CREATE_RUNDOWN", episodeId }, "A new private rundown is ready.");
  }

  async function addItem(event) {
    event.preventDefault();
    const body = { action: "ADD_ITEM", rundownId: rundown.id, type: item.type, label: item.label, notes: item.notes || null, transitionPreset: item.transitionPreset, introCueMs: Number(item.introCueMs || 0), outroCueMs: Number(item.outroCueMs || 0), cueOffsetMs: item.cueOffsetMs === "" ? null : Number(item.cueOffsetMs) };
    if (broadcastTypes.has(item.type)) body[sourceField(item.type)] = item.sourceId;
    const result = await mutate(body, "Rundown item added and saved as a new revision.");
    if (result) setItem(blankItem);
  }

  async function createVoiceProject() {
    const title = `${episode.title} — voice link ${rundown.items.filter((candidate) => candidate.type === "VOICE_TRACK").length + 1}`;
    const payload = await mutate({ action: "CREATE_VOICE_PROJECT", rundownId: rundown.id, title }, "Voice-track project created. Record or retake it in AudioLab above.");
    if (!payload?.project) return;
    window.dispatchEvent(new CustomEvent("ruvanas:audiolab-refresh", { detail: { projectId: payload.project.id } }));
    document.getElementById("audio-lab-quick-record")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function scheduleEpisode(event) {
    event.preventDefault();
    const [targetType, targetId] = schedule.target.split(":");
    const start = new Date(schedule.startsAt); const end = new Date(schedule.endsAt);
    if (!targetId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { setError("Choose a player target, start time, and end time."); return; }
    const payload = { action: "SCHEDULE", rundownId: rundown.id, locationId: targetType === "location" ? targetId : null, zoneId: targetType === "zone" ? targetId : null, startsAt: start.toISOString(), endsAt: end.toISOString() };
    const result = await mutate(payload, "Approved episode scheduled for the school player.");
    if (result) setSchedule(blankSchedule);
  }

  async function previewTransition(entry, previous, next) {
    setError(""); setNotice(""); setPreviewing(entry.id);
    try { await playTransitionPreview(previous, entry, next); setNotice("Transition preview completed."); }
    catch (previewError) { setError(previewError.message); }
    finally { setPreviewing(""); }
  }

  if (!data) return <section style={s.panel}><p style={s.hint}>{error || "Loading Show Builder…"}</p></section>;
  return <section style={s.panel}>
    <div style={s.heading}><div><p style={s.eyebrow}>STAGE 4E · SHOW BUILDER + VOICE TRACK</p><h2 style={s.title}>Build a complete radio show</h2><p style={s.hint}>Arrange catalogue music, IDs, voice links, interviews, announcements and cues. Approval locks the exact revision sent to players.</p></div>{rundown ? <Badge value={rundown.status} /> : null}</div>
    {error ? <div style={s.error}>{error}</div> : null}{notice ? <div style={s.notice}>{notice}</div> : null}
    <div style={s.topGrid}>
      <section style={s.card}><p style={s.eyebrow}>1 · EPISODE</p><label style={s.label}>Episode<select style={s.input} value={episodeId} onChange={(event) => { setEpisodeId(event.target.value); setItem(blankItem); }}><option value="">Choose episode…</option>{data.episodes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.programme.title} — {candidate.title} · {candidate.status.replaceAll("_", " ")}</option>)}</select></label>
        {!episode ? <p style={s.hint}>Create an episode in the editorial workspace below first.</p> : !rundown ? <button style={s.primary} disabled={working || !["DRAFT", "CHANGES_REQUESTED"].includes(episode.status)} onClick={createRundown}>Start this rundown</button> : <><p style={s.meta}>Revision {rundown.revision}{rundown.approvedRevision ? ` · approved revision ${rundown.approvedRevision}` : ""}</p>{rundown.reviewNotes ? <p style={s.review}>Review note: {rundown.reviewNotes}</p> : null}</>}
      </section>
      <section style={s.card}><p style={s.eyebrow}>VOICE TRACK</p><h3 style={s.cardTitle}>Record or retake a link</h3><p style={s.hint}>Creates an episode-linked recording project in the protected AudioLab. After upload, refresh this builder and choose the take below.</p><button style={s.secondary} disabled={working || !rundown || rundown.status === "IN_REVIEW"} onClick={createVoiceProject}>Open a new voice-track take</button><button style={{ ...s.linkButton, marginLeft: 8 }} onClick={() => load().catch((loadError) => setError(loadError.message))}>Refresh takes</button></section>
    </div>

    {rundown ? <>
      <form style={{ ...s.card, marginTop: 16 }} onSubmit={addItem}><p style={s.eyebrow}>2 · ADD TO RUNDOWN</p><div style={s.formGrid}>
        <label style={s.label}>Item type<select style={s.input} value={item.type} onChange={(event) => setItem({ ...blankItem, type: event.target.value })}>{["MUSIC_TRACK", "JINGLE", "VOICE_TRACK", "INTERVIEW", "ANNOUNCEMENT", "SCRIPT_NOTE", "HARD_TIME", "FLEXIBLE_MARKER"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
        <label style={s.label}>Label<input style={s.input} value={item.label} onChange={(event) => setItem({ ...item, label: event.target.value })} placeholder="Presenter link into the next song" required /></label>
        {broadcastTypes.has(item.type) ? <label style={s.label}>Audio source<select style={s.input} value={item.sourceId} onChange={(event) => setItem({ ...item, sourceId: event.target.value })} required><option value="">Choose approved audio…</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{!options.length ? <span style={s.warning}>No matching approved source is available yet.</span> : null}</label> : null}
        {item.type === "HARD_TIME" || item.type === "FLEXIBLE_MARKER" ? <label style={s.label}>Cue from show start (ms)<input style={s.input} type="number" min="0" value={item.cueOffsetMs} onChange={(event) => setItem({ ...item, cueOffsetMs: event.target.value })} /></label> : null}
        {broadcastTypes.has(item.type) ? <label style={s.label}>Transition<select style={s.input} value={item.transitionPreset} onChange={(event) => setItem({ ...item, transitionPreset: event.target.value })}><option value="CLEAN">Clean</option><option value="CROSSFADE">Crossfade</option><option value="DUCK_VOICE">Duck music under voice</option><option value="HARD_START">Hard start</option></select></label> : null}
        <label style={s.label}>Script / cue note<textarea style={{ ...s.input, minHeight: 72 }} value={item.notes} onChange={(event) => setItem({ ...item, notes: event.target.value })} /></label>
      </div><button style={s.primary} disabled={working || rundown.status === "IN_REVIEW"}>Add item</button></form>

      <section style={{ ...s.card, marginTop: 16 }}><div style={s.heading}><div><p style={s.eyebrow}>3 · RUNDOWN</p><h3 style={s.cardTitle}>{episode.title}</h3></div><span style={s.meta}>{rundown.items.filter((candidate) => broadcastTypes.has(candidate.type)).length} playable items</span></div>
        {!rundown.items.length ? <p style={s.hint}>The rundown is empty. Add its first item above.</p> : <div style={s.list}>{rundown.items.map((entry, index) => {
          const previous = [...rundown.items.slice(0, index)].reverse().find((candidate) => itemAudioUrl(candidate));
          const next = rundown.items.slice(index + 1).find((candidate) => itemAudioUrl(candidate));
          return <article key={entry.id} style={s.row}><div style={s.position}>{index + 1}</div><div style={s.itemBody}><div style={s.itemHead}><div><strong>{entry.label}</strong><div style={s.meta}>{entry.type.replaceAll("_", " ")} · {entry.estimatedDurationMs ? durationLabel(entry.estimatedDurationMs) : "cue only"} · {entry.transitionPreset.replaceAll("_", " ")}</div></div><div style={s.actions}><button style={s.icon} disabled={working || index === 0 || rundown.status === "IN_REVIEW"} onClick={() => mutate({ action: "MOVE_ITEM", rundownId: rundown.id, itemId: entry.id, direction: "UP" }, "Item moved.")}>↑</button><button style={s.icon} disabled={working || index === rundown.items.length - 1 || rundown.status === "IN_REVIEW"} onClick={() => mutate({ action: "MOVE_ITEM", rundownId: rundown.id, itemId: entry.id, direction: "DOWN" }, "Item moved.")}>↓</button><button style={s.remove} disabled={working || rundown.status === "IN_REVIEW"} onClick={() => mutate({ action: "REMOVE_ITEM", rundownId: rundown.id, itemId: entry.id }, "Item removed; previous approval was invalidated safely.")}>Remove</button></div></div>{entry.notes ? <p style={s.note}>{entry.notes}</p> : null}
            {itemAudioUrl(entry) ? <audio controls preload="none" src={itemAudioUrl(entry)} style={s.audio} /> : null}
            {entry.type === "VOICE_TRACK" ? <div style={s.preview}><span style={s.previewTitle}>Transition preview · {entry.transitionPreset.replaceAll("_", " ")}</span>{previous ? <label>Before<audio controls preload="none" src={itemAudioUrl(previous)} /></label> : <span style={s.meta}>No preceding audio</span>}<label>Voice link<audio controls preload="none" src={itemAudioUrl(entry)} /></label>{next ? <label>After<audio controls preload="none" src={itemAudioUrl(next)} /></label> : <span style={s.meta}>No following audio</span>}<button style={s.secondary} disabled={Boolean(previewing)} onClick={() => previewTransition(entry, previous, next)}>{previewing === entry.id ? "Playing transition…" : "Play combined transition"}</button></div> : null}
          </div></article>;
        })}</div>}
        <div style={s.reviewActions}>{["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(rundown.status) ? <button style={s.primary} disabled={working || !rundown.items.some((candidate) => broadcastTypes.has(candidate.type))} onClick={() => mutate({ action: "SUBMIT", rundownId: rundown.id }, "Rundown submitted for staff approval.")}>Submit rundown</button> : null}{data.canManage && rundown.status === "IN_REVIEW" ? <><button style={s.approve} disabled={working} onClick={() => mutate({ action: "REVIEW", rundownId: rundown.id, decision: "APPROVE" }, "The exact rundown revision is approved.")}>Approve revision</button><button style={s.secondary} disabled={working} onClick={() => mutate({ action: "REVIEW", rundownId: rundown.id, decision: "REQUEST_CHANGES", notes: window.prompt("What should be changed?") || "Changes requested by staff." }, "Rundown returned for changes.")}>Request changes</button></> : null}</div>
      </section>

      {data.canManage && rundown.status === "APPROVED" && rundown.approvedRevision === rundown.revision ? <form style={{ ...s.card, marginTop: 16 }} onSubmit={scheduleEpisode}><p style={s.eyebrow}>4 · SCHEDULE APPROVED EPISODE</p><div style={s.formGrid}><label style={s.label}>School player target<select style={s.input} value={schedule.target} onChange={(event) => setSchedule({ ...schedule, target: event.target.value })} required><option value="">Choose location or zone…</option>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label><label style={s.label}>Starts<input style={s.input} type="datetime-local" value={schedule.startsAt} onChange={(event) => setSchedule({ ...schedule, startsAt: event.target.value })} required /></label><label style={s.label}>Ends<input style={s.input} type="datetime-local" value={schedule.endsAt} onChange={(event) => setSchedule({ ...schedule, endsAt: event.target.value })} required /></label></div><button style={s.primary} disabled={working}>Schedule episode</button></form> : null}
    </> : null}
    <p style={s.privacy}>Private-by-default · staff-managed · immutable approval revisions · editing approved content automatically withdraws its approval.</p>
  </section>;
}

const s = {
  panel: { border: "1px solid #2b3a54", borderRadius: 16, background: "#111c2d", padding: 22, marginBottom: 24 }, heading: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }, eyebrow: { color: "#f4b942", fontSize: 11, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, cardTitle: { margin: "0 0 12px" }, hint: { color: "#9facbf", lineHeight: 1.5, fontSize: 13 }, topGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginTop: 18 }, card: { border: "1px solid #34445f", borderRadius: 12, padding: 16, background: "#162238" }, formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }, label: { display: "grid", gap: 6, color: "#dce5f3", fontWeight: 800, fontSize: 12 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 7, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" }, primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "11px 15px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 8, background: "transparent", color: "#e2e8f0", padding: "10px 13px", fontWeight: 800, cursor: "pointer" }, linkButton: { border: 0, background: "none", color: "#f4b942", fontWeight: 800, cursor: "pointer" }, badge: { borderRadius: 5, padding: "5px 8px", fontSize: 10, fontWeight: 900, whiteSpace: "nowrap" }, meta: { color: "#93a4bd", fontSize: 12 }, warning: { color: "#fcd34d", fontWeight: 500 }, review: { color: "#fed7aa", borderLeft: "3px solid #fb923c", paddingLeft: 10 }, list: { display: "grid", gap: 9 }, row: { display: "grid", gridTemplateColumns: "32px 1fr", gap: 10, padding: 12, border: "1px solid #34445f", borderRadius: 9, background: "#101a2b" }, position: { width: 28, height: 28, borderRadius: 14, display: "grid", placeItems: "center", background: "#263750", color: "#f4b942", fontWeight: 900 }, itemBody: { minWidth: 0 }, itemHead: { display: "flex", justifyContent: "space-between", gap: 10 }, actions: { display: "flex", gap: 5, flexWrap: "wrap" }, icon: { border: "1px solid #64748b", borderRadius: 5, background: "transparent", color: "#fff", cursor: "pointer" }, remove: { border: 0, background: "none", color: "#fca5a5", cursor: "pointer", fontWeight: 800 }, note: { color: "#cbd5e1", fontSize: 13 }, audio: { width: "100%", marginTop: 8 }, preview: { marginTop: 10, padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8, border: "1px solid #475569", borderRadius: 8 }, previewTitle: { gridColumn: "1/-1", color: "#f4b942", fontSize: 11, fontWeight: 900 }, reviewActions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }, approve: { border: 0, borderRadius: 8, background: "#22c55e", color: "#052e16", padding: "11px 15px", fontWeight: 900, cursor: "pointer" }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 10, marginTop: 12 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 10, marginTop: 12 }, privacy: { color: "#8191a8", fontSize: 11, marginTop: 16 }
};

