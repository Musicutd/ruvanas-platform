"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const emptyProject = { title: "", programmeId: "", episodeId: "", studentGroupId: "" };
const trackKinds = ["VOICE", "MUSIC", "EFFECT", "MIXED"];
const presets = ["NONE", "SPEECH_CLEANUP", "PODCAST_VOICE", "RADIO_VOICE"];
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const seconds = (milliseconds) => (Math.max(0, Number(milliseconds) || 0) / 1000).toFixed(1);

function clone(value) { return structuredClone(value); }

export default function MultitrackStudioClient() {
  const [catalogue, setCatalogue] = useState(null);
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState(null);
  const [draft, setDraft] = useState(emptyProject);
  const [sourceId, setSourceId] = useState("");
  const [targetTrackId, setTargetTrackId] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadCatalogue = useCallback(async () => {
    const response = await fetch("/api/school-radio/multitrack", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Multitrack Studio could not be loaded.");
    setCatalogue(payload);
  }, []);

  const loadProject = useCallback(async (id = projectId) => {
    if (!id) { setProject(null); return; }
    const response = await fetch(`/api/school-radio/multitrack/projects/${id}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The multitrack project could not be opened.");
    setProject(payload);
    setTargetTrackId((current) => payload.state.tracks.some((track) => track.clientId === current) ? current : payload.state.tracks[0]?.clientId || "");
  }, [projectId]);

  useEffect(() => { loadCatalogue().catch((loadError) => setError(loadError.message)); }, [loadCatalogue]);
  useEffect(() => { loadProject().catch((loadError) => setError(loadError.message)); }, [projectId, loadProject]);

  const sourceMap = useMemo(() => new Map((catalogue?.sources || []).map((source) => [source.id, source])), [catalogue]);
  const durationMs = useMemo(() => Math.max(0, ...(project?.state.tracks || []).flatMap((track) => track.clips.map((clip) => clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs))), [project]);

  function updateState(change) {
    setProject((current) => current ? { ...current, state: typeof change === "function" ? change(clone(current.state)) : change } : current);
  }

  function updateTrack(trackId, changes) {
    updateState((state) => ({ ...state, tracks: state.tracks.map((track) => track.clientId === trackId ? { ...track, ...(typeof changes === "function" ? changes(track) : changes) } : track) }));
  }

  async function createProject(event) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/multitrack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The multitrack project could not be created.");
      setDraft(emptyProject); await loadCatalogue(); setProjectId(payload.project.id); setNotice("Multitrack project created with a voice track and music bed.");
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  function addTrack() {
    const track = { clientId: uid("track"), name: `Track ${project.state.tracks.length + 1}`, kind: "VOICE", order: project.state.tracks.length, gainDb: 0, pan: 0, muted: false, solo: false, armed: false, locked: false, preset: "NONE", automation: [], clips: [] };
    updateState((state) => ({ ...state, tracks: [...state.tracks, track] })); setTargetTrackId(track.clientId);
  }

  function addClip() {
    const source = sourceMap.get(sourceId);
    const target = project?.state.tracks.find((track) => track.clientId === targetTrackId);
    if (!source || !target || !source.durationMs) { setError("Choose an analysed audio source and a destination track."); return; }
    const timelineStartMs = Math.max(0, ...target.clips.map((clip) => clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs));
    const clip = { clientId: uid("clip"), kind: "SOURCE", mediaAssetId: source.id, sourceStartMs: 0, sourceEndMs: source.durationMs, timelineStartMs, gainDb: 0, fadeInMs: 0, fadeOutMs: 0, fadeInCurve: "linear", fadeOutCurve: "linear", locked: false };
    updateTrack(target.clientId, (track) => ({ clips: [...track.clips, clip] })); setNotice(`${source.label} added to ${target.name}.`); setError("");
  }

  function updateClip(trackId, clipId, changes) {
    updateTrack(trackId, (track) => ({ clips: track.clips.map((clip) => clip.clientId === clipId ? { ...clip, ...changes } : clip) }));
  }

  async function sendAction(action, extra = {}) {
    if (!project) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/school-radio/multitrack/projects/${project.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(action === "APPROVE_OUTPUT" ? {} : { state: project.state }), ...extra }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The multitrack action could not be completed.");
      setProject(payload); await loadCatalogue();
      setNotice(action === "SAVE" ? "Project snapshot saved." : action === "QUEUE_RENDER" ? "Final mix queued. The audio worker will render it safely in the background." : "Final output approved for school use.");
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  if (!catalogue) return <section style={s.panel}><p style={s.hint}>{error || "Loading Multitrack Studio…"}</p></section>;
  return <section id="multitrack-studio" style={s.panel}>
    <div style={s.heading}><div><p style={s.eyebrow}>STAGE 4F · MULTITRACK STUDIO</p><h2 style={s.title}>Build a complete school production</h2><p style={s.hint}>Layer voice, music and effects without changing source recordings. Server rendering, loudness checks and teacher approval create the final version.</p></div>{project ? <div style={s.mode}><button style={project.state.mode === "BEGINNER" ? s.active : s.secondary} onClick={() => updateState((state) => ({ ...state, mode: "BEGINNER" }))}>Beginner</button><button style={project.state.mode === "ADVANCED" ? s.active : s.secondary} onClick={() => updateState((state) => ({ ...state, mode: "ADVANCED" }))}>Advanced</button></div> : null}</div>
    {error ? <div style={s.error}>{error}</div> : null}{notice ? <div style={s.notice}>{notice}</div> : null}
    <div style={s.topGrid}>
      <form style={s.card} onSubmit={createProject}><p style={s.eyebrow}>1 · PROJECT</p><h3 style={s.cardTitle}>New production</h3><label style={s.label}>Title<input style={s.input} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Year 8 podcast special" required /></label><label style={s.label}>Programme<select style={s.input} value={draft.programmeId} onChange={(event) => setDraft({ ...draft, programmeId: event.target.value, episodeId: "" })}><option value="">No programme link</option>{catalogue.programmes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={s.label}>Episode<select style={s.input} value={draft.episodeId} onChange={(event) => setDraft({ ...draft, episodeId: event.target.value })}><option value="">No episode link</option>{catalogue.episodes.filter((item) => !draft.programmeId || item.programmeId === draft.programmeId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button style={s.primary} disabled={working}>Create production</button></form>
      <section style={s.card}><p style={s.eyebrow}>2 · OPEN & ADD AUDIO</p><h3 style={s.cardTitle}>Studio project</h3><label style={s.label}>Project<select style={s.input} value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Choose project…</option>{catalogue.projects.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.currentVersion}</option>)}</select></label>{project ? <><label style={s.label}>Protected source<select style={s.input} value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose recording, music or audio…</option>{catalogue.sources.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.sourceType.toLowerCase()} · {seconds(item.durationMs)}s</option>)}</select></label><label style={s.label}>Destination track<select style={s.input} value={targetTrackId} onChange={(event) => setTargetTrackId(event.target.value)}>{project.state.tracks.map((track) => <option key={track.clientId} value={track.clientId}>{track.name}</option>)}</select></label><button style={s.primary} type="button" onClick={addClip}>Add clip</button></> : <p style={s.hint}>Create or choose a production to open the mixer.</p>}</section>
    </div>

    {project ? <><div style={s.transport}><strong>{project.title}</strong><span>Version {project.currentVersion} · timeline {seconds(durationMs)}s</span><button style={s.secondary} onClick={addTrack}>+ Track</button><button style={s.primary} disabled={working} onClick={() => sendAction("SAVE", { reason: "Multitrack manual save" })}>Save snapshot</button><button style={s.primary} disabled={working} onClick={() => sendAction("QUEUE_RENDER", { preset: "SCHOOL_RADIO_MP3" })}>Render final MP3</button></div>
      <div style={s.timeline}>{project.state.tracks.map((track) => <article key={track.clientId} style={s.track}>
        <div style={s.trackHeader}><input aria-label="Track name" style={{ ...s.input, fontWeight: 900 }} value={track.name} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { name: event.target.value })} /><select aria-label="Track kind" style={s.compact} value={track.kind} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { kind: event.target.value })}>{trackKinds.map((kind) => <option key={kind}>{kind}</option>)}</select><button style={track.muted ? s.toggleOn : s.toggle} onClick={() => updateTrack(track.clientId, { muted: !track.muted })}>M</button><button style={track.solo ? s.toggleOn : s.toggle} onClick={() => updateTrack(track.clientId, { solo: !track.solo })}>S</button><button style={track.armed ? s.recordOn : s.toggle} onClick={() => updateTrack(track.clientId, { armed: !track.armed })}>Arm</button><button style={track.locked ? s.toggleOn : s.toggle} onClick={() => updateTrack(track.clientId, { locked: !track.locked })}>Lock</button></div>
        <div style={s.mixer}><label style={s.inline}>Gain <input type="range" min="-36" max="12" step="0.5" value={track.gainDb} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { gainDb: Number(event.target.value) })} /><span>{track.gainDb} dB</span></label><label style={s.inline}>Pan <input type="range" min="-1" max="1" step="0.05" value={track.pan} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { pan: Number(event.target.value) })} /><span>{track.pan}</span></label><label style={s.inline}>Preset <select style={s.compact} value={track.preset} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { preset: event.target.value })}>{presets.map((preset) => <option key={preset}>{preset.replaceAll("_", " ")}</option>)}</select></label></div>
        <div style={s.clips}>{!track.clips.length ? <p style={s.empty}>No clips on this track.</p> : track.clips.map((clip) => { const source = sourceMap.get(clip.mediaAssetId); return <div key={clip.clientId} style={s.clip}><div><strong>{source?.label || "Protected audio"}</strong><small>{seconds(clip.sourceEndMs - clip.sourceStartMs)}s · starts {seconds(clip.timelineStartMs)}s</small></div><label>Start ms<input style={s.smallInput} type="number" min="0" value={clip.timelineStartMs} disabled={track.locked || clip.locked} onChange={(event) => updateClip(track.clientId, clip.clientId, { timelineStartMs: Number(event.target.value) })} /></label><label>Fade in<input style={s.smallInput} type="number" min="0" value={clip.fadeInMs} disabled={track.locked || clip.locked} onChange={(event) => updateClip(track.clientId, clip.clientId, { fadeInMs: Number(event.target.value) })} /></label><label>Fade out<input style={s.smallInput} type="number" min="0" value={clip.fadeOutMs} disabled={track.locked || clip.locked} onChange={(event) => updateClip(track.clientId, clip.clientId, { fadeOutMs: Number(event.target.value) })} /></label><button style={s.danger} disabled={track.locked || clip.locked} onClick={() => updateTrack(track.clientId, (current) => ({ clips: current.clips.filter((item) => item.clientId !== clip.clientId) }))}>Remove</button></div>; })}</div>
        {project.state.mode === "ADVANCED" ? <div style={s.advanced}><div style={s.automationHeading}><strong>Volume automation</strong><button style={s.secondary} onClick={() => updateTrack(track.clientId, (current) => ({ automation: [...current.automation, { clientId: uid("automation"), parameter: "GAIN", timeMs: 0, value: -3 }] }))}>+ Point</button></div>{track.automation.map((point) => <div key={point.clientId} style={s.automation}><label>Time ms<input style={s.smallInput} type="number" min="0" value={point.timeMs} onChange={(event) => updateTrack(track.clientId, (current) => ({ automation: current.automation.map((item) => item.clientId === point.clientId ? { ...item, timeMs: Number(event.target.value) } : item) }))} /></label><label>Gain dB<input style={s.smallInput} type="number" min="-36" max="18" step="0.5" value={point.value} onChange={(event) => updateTrack(track.clientId, (current) => ({ automation: current.automation.map((item) => item.clientId === point.clientId ? { ...item, value: Number(event.target.value) } : item) }))} /></label><button style={s.danger} onClick={() => updateTrack(track.clientId, (current) => ({ automation: current.automation.filter((item) => item.clientId !== point.clientId) }))}>Remove</button></div>)}</div> : null}
      </article>)}</div>
      <section style={s.finish}><div><p style={s.eyebrow}>MIX & OUTPUT</p><h3 style={s.cardTitle}>Music ducking and final versions</h3><label style={s.check}><input type="checkbox" checked={project.state.ducking.enabled} onChange={(event) => updateState((state) => ({ ...state, ducking: { ...state.ducking, enabled: event.target.checked } }))} /> Automatically lower music beneath voice</label><label style={s.inline}>Music reduction <input type="range" min="-30" max="-3" value={project.state.ducking.musicReductionDb} onChange={(event) => updateState((state) => ({ ...state, ducking: { ...state.ducking, musicReductionDb: Number(event.target.value) } }))} /><span>{project.state.ducking.musicReductionDb} dB</span></label>{project.state.mode === "ADVANCED" ? <div style={s.mixer}><label style={s.inline}>Attack ms<input style={s.smallInput} type="number" value={project.state.ducking.attackMs} onChange={(event) => updateState((state) => ({ ...state, ducking: { ...state.ducking, attackMs: Number(event.target.value) } }))} /></label><label style={s.inline}>Release ms<input style={s.smallInput} type="number" value={project.state.ducking.releaseMs} onChange={(event) => updateState((state) => ({ ...state, ducking: { ...state.ducking, releaseMs: Number(event.target.value) } }))} /></label><label style={s.inline}>Target LUFS<select style={s.compact} value={project.state.master.targetLufs} onChange={(event) => updateState((state) => ({ ...state, master: { ...state.master, targetLufs: Number(event.target.value) } }))}><option>-14</option><option>-16</option><option>-18</option><option>-23</option><option>-24</option></select></label></div> : null}</div>
        <div style={s.renders}>{!project.renders.length ? <p style={s.hint}>No final renders yet.</p> : project.renders.map((render) => <div key={render.id} style={s.renderRow}><div><strong>{render.preset.replaceAll("_", " ")}</strong><small>{render.status.replaceAll("_", " ")}{render.loudnessLufs == null ? "" : ` · ${render.loudnessLufs} LUFS`}{render.outputVersion ? ` · output v${render.outputVersion.version} ${render.outputVersion.status.replaceAll("_", " ")}` : ""}</small></div>{render.streamUrl ? <audio controls src={render.streamUrl} style={s.audio} /> : null}{project.canApprove && render.outputVersion?.status === "IN_REVIEW" && render.outputVersion.qcStatus === "PASSED" ? <button style={s.approve} disabled={working} onClick={() => sendAction("APPROVE_OUTPUT", { renderId: render.id })}>Approve output</button> : null}{render.errorMessage ? <span style={s.failure}>{render.errorMessage}</span> : null}</div>)}</div>
      </section></> : null}
    <p style={s.safety}>Non-destructive source files · version snapshots · protected school access · server-rendered masters · approved output changes are always explicit.</p>
  </section>;
}

const s = {
  panel: { border: "1px solid #3b4b66", borderRadius: 16, background: "#111d30", padding: 22, marginBottom: 22 }, heading: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, marginBottom: 16 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, cardTitle: { margin: "0 0 14px" }, hint: { color: "#9facbf", lineHeight: 1.5, fontSize: 13 }, topGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }, card: { border: "1px solid #34445f", borderRadius: 12, background: "#182235", padding: 18 }, label: { display: "grid", gap: 6, marginBottom: 12, color: "#dce5f3", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 7, background: "#fff", color: "#111827", padding: "9px 10px", font: "inherit" }, compact: { border: "1px solid #61708a", borderRadius: 6, background: "#fff", color: "#111827", padding: "7px", maxWidth: 190 }, smallInput: { width: 96, border: "1px solid #61708a", borderRadius: 5, background: "#fff", color: "#111827", padding: 6 }, primary: { border: 0, borderRadius: 7, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, background: "transparent", color: "#e2e8f0", padding: "8px 11px", fontWeight: 800, cursor: "pointer" }, active: { border: "1px solid #60a5fa", borderRadius: 7, background: "#1d4ed8", color: "#fff", padding: "8px 11px", fontWeight: 900 }, mode: { display: "flex", gap: 7 }, transport: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", border: "1px solid #34445f", borderRadius: 10, background: "#0b1628", padding: 14, margin: "18px 0 12px" }, timeline: { display: "grid", gap: 12 }, track: { border: "1px solid #41516b", borderRadius: 10, background: "#172338", padding: 13 }, trackHeader: { display: "grid", gridTemplateColumns: "minmax(170px,1fr) auto auto auto auto auto", gap: 7, alignItems: "center" }, toggle: { border: "1px solid #64748b", borderRadius: 6, background: "#0f172a", color: "#cbd5e1", padding: "7px 9px", fontWeight: 900 }, toggleOn: { border: "1px solid #60a5fa", borderRadius: 6, background: "#1d4ed8", color: "#fff", padding: "7px 9px", fontWeight: 900 }, recordOn: { border: "1px solid #f87171", borderRadius: 6, background: "#991b1b", color: "#fff", padding: "7px 9px", fontWeight: 900 }, mixer: { display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", margin: "11px 0" }, inline: { display: "flex", gap: 7, alignItems: "center", color: "#dce5f3", fontWeight: 800, fontSize: 12 }, clips: { display: "grid", gap: 7 }, clip: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", border: "1px solid #475569", borderLeft: "7px solid #f4b942", borderRadius: 7, background: "#0d1728", padding: 10, fontSize: 12 }, empty: { border: "1px dashed #52627c", borderRadius: 7, padding: 12, color: "#93a4bd" }, advanced: { marginTop: 12, borderTop: "1px solid #334155", paddingTop: 12 }, automationHeading: { display: "flex", justifyContent: "space-between", alignItems: "center" }, automation: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 8, fontSize: 12 }, danger: { border: "1px solid #f87171", borderRadius: 6, background: "transparent", color: "#fecaca", padding: "7px 9px", fontWeight: 800 }, finish: { display: "grid", gridTemplateColumns: "minmax(280px,.8fr) minmax(320px,1.2fr)", gap: 18, border: "1px solid #34445f", borderRadius: 12, background: "#182235", padding: 18, marginTop: 16 }, check: { display: "flex", gap: 8, alignItems: "center", color: "#dce5f3", fontWeight: 800, fontSize: 13 }, renders: { display: "grid", gap: 9 }, renderRow: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #334155", paddingBottom: 9 }, audio: { width: 230, maxWidth: "100%" }, approve: { border: 0, borderRadius: 7, background: "#22c55e", color: "#052e16", padding: "9px 11px", fontWeight: 900 }, failure: { color: "#fecaca", fontSize: 12 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 14 }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 14 }, safety: { color: "#8ea0b8", fontSize: 12, margin: "16px 0 0" }
};
