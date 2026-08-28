"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adjustSelection, deleteSelection, duplicateSelection, MARKER_TYPES,
  pushHistory, reflowClips, silenceSelection, splitAt, timelineDuration, trimToSelection
} from "@/lib/waveform-editor.mjs";

const newId = () => crypto.randomUUID();
const seconds = (milliseconds) => (Number(milliseconds || 0) / 1000).toFixed(2);
const milliseconds = (value) => Math.max(0, Math.round(Number(value || 0) * 1000));

export default function WaveformEditorClient() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [editor, setEditor] = useState(null);
  const [state, setState] = useState({ clips: [], markers: [], normalize: true, targetLufs: -16, noiseCleanup: false });
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [cursorMs, setCursorMs] = useState(0);
  const [selection, setSelection] = useState({ startMs: 0, endMs: 0 });
  const [looping, setLooping] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [markerType, setMarkerType] = useState("EDIT_NOTE");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);

  const durationMs = useMemo(() => timelineDuration(state.clips), [state.clips]);
  const sourceTake = useMemo(() => editor?.takes.find((take) => state.clips.some((clip) => clip.mediaAssetId === take.mediaAsset.id)) || editor?.takes[0], [editor, state.clips]);
  const peaks = sourceTake?.waveformPeaks || [];

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/school-radio/audio-lab", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Waveform projects could not be loaded.");
    setProjects(payload.projects || []);
    setProjectId((current) => current || payload.projects?.[0]?.id || "");
  }, []);

  const loadEditor = useCallback(async () => {
    if (!projectId) return;
    const response = await fetch(`/api/school-radio/audio-lab/projects/${projectId}/editor`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The waveform editor could not be loaded.");
    setEditor(payload); setState(payload.state); setHistory([]); setFuture([]);
    setCursorMs(0); setSelection({ startMs: 0, endMs: 0 });
  }, [projectId]);

  useEffect(() => { loadProjects().catch((loadError) => setError(loadError.message)); }, [loadProjects]);
  useEffect(() => { loadEditor().catch((loadError) => setError(loadError.message)); }, [loadEditor]);
  useEffect(() => {
    const hasActiveWork = editor?.takes.some((take) => ["PENDING", "RUNNING"].includes(take.waveformStatus)) || editor?.renders.some((render) => ["QUEUED", "RUNNING"].includes(render.status));
    if (!projectId || !hasActiveWork) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/school-radio/audio-lab/projects/${projectId}/editor`, { cache: "no-store" });
      if (response.ok) setEditor(await response.json());
    }, 5000);
    return () => clearInterval(timer);
  }, [editor, projectId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(720, Math.round((canvas.parentElement?.clientWidth || 720) * zoom));
    const height = 210;
    canvas.width = width * ratio; canvas.height = height * ratio;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    context.scale(ratio, ratio); context.fillStyle = "#08111f"; context.fillRect(0, 0, width, height);
    const startX = durationMs ? (Math.min(selection.startMs, selection.endMs) / durationMs) * width : 0;
    const endX = durationMs ? (Math.max(selection.startMs, selection.endMs) / durationMs) * width : 0;
    context.fillStyle = "rgba(59,130,246,.25)"; context.fillRect(startX, 0, Math.max(0, endX - startX), height);
    context.strokeStyle = "#f4b942"; context.lineWidth = 2; context.beginPath();
    if (peaks.length) {
      peaks.forEach((peak, index) => { const x = (index / Math.max(1, peaks.length - 1)) * width; const amplitude = peak * (height * 0.43); context.moveTo(x, height / 2 - amplitude); context.lineTo(x, height / 2 + amplitude); });
    } else {
      context.moveTo(0, height / 2); context.lineTo(width, height / 2);
    }
    context.stroke();
    for (const marker of state.markers) {
      const x = durationMs ? (marker.positionMs / durationMs) * width : 0;
      context.strokeStyle = marker.type === "TEACHER_FEEDBACK" ? "#ef4444" : "#60a5fa"; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    const cursorX = durationMs ? (cursorMs / durationMs) * width : 0;
    context.strokeStyle = "#fff"; context.beginPath(); context.moveTo(cursorX, 0); context.lineTo(cursorX, height); context.stroke();
  }, [cursorMs, durationMs, peaks, selection, state.markers, zoom]);

  function commit(next) {
    setHistory((items) => pushHistory(items, state)); setFuture([]); setState(next);
  }
  function undo() {
    if (!history.length) return;
    setFuture((items) => pushHistory(items, state)); setState(history.at(-1)); setHistory((items) => items.slice(0, -1));
  }
  function redo() {
    if (!future.length) return;
    setHistory((items) => pushHistory(items, state)); setState(future.at(-1)); setFuture((items) => items.slice(0, -1));
  }
  function editClips(operation) { commit({ ...state, clips: operation(state.clips) }); }

  function moveSelection(direction) {
    const start = Math.min(selection.startMs, selection.endMs);
    const end = Math.max(selection.startMs, selection.endMs);
    const ordered = [...state.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    const index = ordered.findIndex((clip) => clip.timelineStartMs < end && clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs > start && !clip.locked);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    commit({ ...state, clips: reflowClips(ordered) });
  }

  function undoOrRedo(event) {
    if (!(event.ctrlKey || event.metaKey)) return false;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return true; }
    if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return true; }
    return false;
  }

  useEffect(() => {
    const onKey = (event) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName) || undoOrRedo(event)) return;
      if (event.code === "Space") { event.preventDefault(); playFromCursor(); }
      if (event.key.toLowerCase() === "s") editClips((clips) => splitAt(clips, cursorMs, newId));
      if (event.key === "Backspace") { event.preventDefault(); editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, true, newId)); }
      if (event.key === "Delete") editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, false, newId));
      if (event.key.toLowerCase() === "l") setLooping((value) => !value);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });

  function playFromCursor() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, cursorMs / 1000); audio.paused ? audio.play().catch(() => {}) : audio.pause();
  }

  function onAudioTime() {
    const audio = audioRef.current;
    if (!audio) return;
    const position = audio.currentTime * 1000; setCursorMs(Math.min(durationMs, position));
    const start = Math.min(selection.startMs, selection.endMs); const end = Math.max(selection.startMs, selection.endMs);
    if (looping && end > start && position >= end) { audio.currentTime = start / 1000; audio.play().catch(() => {}); }
  }

  async function send(action, extra = {}) {
    if (!projectId) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/school-radio/audio-lab/projects/${projectId}/editor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, state, ...extra }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The waveform action failed.");
      setEditor(payload); setState(payload.state); setHistory([]); setFuture([]);
      setMessage(action === "QUEUE_RENDER" ? "Final render queued. The background audio worker will prepare the review copy." : action === "INITIALIZE" ? "The source take is ready in the non-destructive timeline." : `Project saved as version ${payload.currentVersion}.`);
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  function addMarker() {
    commit({ ...state, markers: [...state.markers, { clientId: newId(), positionMs: cursorMs, type: markerType, label: markerType.replaceAll("_", " ").toLowerCase() }].sort((a, b) => a.positionMs - b.positionMs) });
  }

  if (!projects.length) return <section style={s.panel}><p style={s.hint}>{error || "Create and upload an AudioLab take to unlock the waveform editor."}</p></section>;
  return <section style={s.panel} aria-labelledby="waveform-title">
    <div style={s.heading}><div><p style={s.eyebrow}>STAGE 4D · WAVEFORM EDITOR</p><h2 id="waveform-title" style={s.title}>Shape the programme without touching the source</h2><p style={s.hint}>Cached waveform peaks, versioned edits, markers, undo/redo, and server-rendered review copies.</p></div><button style={s.secondary} onClick={() => setAdvanced((value) => !value)}>{advanced ? "Beginner controls" : "Advanced controls"}</button></div>
    {error ? <div style={s.error}>{error}</div> : null}{message ? <div style={s.notice}>{message}</div> : null}
    <label style={s.label}>AudioLab project<select style={s.input} value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
    {editor && !state.clips.length ? <div style={s.empty}><p style={s.hint}>Choose a protected take to place it on the timeline. Its source file will remain unchanged.</p><div style={s.actions}>{editor.takes.map((take) => <button key={take.id} style={s.primary} disabled={working || !take.durationMs} onClick={() => send("INITIALIZE", { takeId: take.id })}>Use {take.mediaAsset.name} {take.waveformStatus === "READY" ? "· waveform ready" : "· analysing"}</button>)}</div></div> : null}
    {state.clips.length ? <>
      <div style={s.toolbar}><button style={s.primary} onClick={playFromCursor}>▶ Play / pause</button><button style={looping ? s.active : s.secondary} onClick={() => setLooping(!looping)}>↻ Loop selection</button><button style={s.secondary} disabled={!history.length} onClick={undo}>Undo</button><button style={s.secondary} disabled={!future.length} onClick={redo}>Redo</button><label style={s.inline}>Zoom <input type="range" min="1" max="5" step=".5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label></div>
      <div style={s.canvasWrap}><canvas ref={canvasRef} role="img" aria-label="Waveform timeline. Use the selection fields and keyboard controls for precise editing." onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setCursorMs(Math.round(((event.clientX - rect.left) / rect.width) * durationMs)); }} /></div>
      {sourceTake ? <audio ref={audioRef} src={`/api/media/${sourceTake.mediaAsset.id}/stream`} onTimeUpdate={onAudioTime} onEnded={() => setCursorMs(0)} preload="metadata" /> : null}
      <div style={s.timeGrid}><label style={s.label}>Cursor (seconds)<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(cursorMs)} onChange={(event) => setCursorMs(milliseconds(event.target.value))} /></label><label style={s.label}>Selection start<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(selection.startMs)} onChange={(event) => setSelection({ ...selection, startMs: milliseconds(event.target.value) })} /></label><label style={s.label}>Selection end<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(selection.endMs)} onChange={(event) => setSelection({ ...selection, endMs: milliseconds(event.target.value) })} /></label><div style={s.duration}>Length<br /><strong>{seconds(durationMs)} s</strong></div></div>
      <div style={s.actions}><button style={s.secondary} onClick={() => editClips((clips) => splitAt(clips, cursorMs, newId))}>Split at cursor</button><button style={s.secondary} onClick={() => editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, true, newId))}>Ripple delete</button><button style={s.secondary} onClick={() => editClips((clips) => silenceSelection(clips, selection.startMs, selection.endMs, newId))}>Replace with silence</button><button style={s.secondary} onClick={() => editClips((clips) => trimToSelection(clips, selection.startMs, selection.endMs, newId))}>Trim to selection</button></div>
      {advanced ? <div style={s.advanced}>
        <div style={s.actions}><button style={s.secondary} onClick={() => editClips((clips) => duplicateSelection(clips, selection.startMs, selection.endMs, newId))}>Duplicate selection</button><button style={s.secondary} onClick={() => moveSelection(-1)}>Move earlier</button><button style={s.secondary} onClick={() => moveSelection(1)}>Move later</button><button style={s.secondary} onClick={() => editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, false, newId))}>Delete, keep gap</button></div>
        <div style={s.timeGrid}><label style={s.label}>Selection gain (dB)<input style={s.input} type="number" min="-36" max="18" step=".5" defaultValue="0" onBlur={(event) => editClips((clips) => adjustSelection(clips, selection.startMs, selection.endMs, { gainDb: Number(event.target.value) }))} /></label><label style={s.label}>Fade in (ms)<input style={s.input} type="number" min="0" max="60000" defaultValue="0" onBlur={(event) => editClips((clips) => adjustSelection(clips, selection.startMs, selection.endMs, { fadeInMs: Number(event.target.value) }))} /></label><label style={s.label}>Fade out (ms)<input style={s.input} type="number" min="0" max="60000" defaultValue="0" onBlur={(event) => editClips((clips) => adjustSelection(clips, selection.startMs, selection.endMs, { fadeOutMs: Number(event.target.value) }))} /></label></div>
        <div style={s.markerRow}><select style={s.input} value={markerType} onChange={(event) => setMarkerType(event.target.value)}>{MARKER_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select><button style={s.secondary} onClick={addMarker}>Add marker at cursor</button></div>
        <div style={s.markerList}>{state.markers.map((marker) => <button key={marker.clientId} style={s.marker} onClick={() => setCursorMs(marker.positionMs)}>{seconds(marker.positionMs)} · {marker.type.replaceAll("_", " ")} · {marker.label}</button>)}</div>
      </div> : null}
      <div style={s.finish}><label style={s.check}><input type="checkbox" checked={state.normalize} onChange={(event) => commit({ ...state, normalize: event.target.checked })} /> Normalize final render</label><label style={s.inline}>Target <select style={s.compact} value={state.targetLufs} onChange={(event) => commit({ ...state, targetLufs: Number(event.target.value) })}><option value="-16">-16 LUFS</option><option value="-18">-18 LUFS</option><option value="-23">-23 LUFS</option></select></label>{advanced ? <label style={s.check}><input type="checkbox" checked={state.noiseCleanup} onChange={(event) => commit({ ...state, noiseCleanup: event.target.checked })} /> Gentle noise cleanup</label> : null}<button style={s.secondary} disabled={working} onClick={() => send("SAVE", { reason: "Manual waveform snapshot" })}>Save version</button><button style={s.primary} disabled={working} onClick={() => send("QUEUE_RENDER", { preset: "SCHOOL_RADIO_MP3" })}>Create review render</button></div>
      <p style={s.shortcuts}>Keyboard: Space play/pause · S split · Backspace ripple delete · Delete keep gap · L loop · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo.</p>
      {editor.renders?.length ? <div style={s.renders}><h3 style={{ marginTop: 0 }}>Recent renders</h3>{editor.renders.map((render) => <div key={render.id} style={s.renderRow}><span>{render.preset.replaceAll("_", " ")} · {render.status}</span>{render.loudnessLufs != null ? <span>{render.loudnessLufs.toFixed(1)} LUFS</span> : null}{render.streamUrl ? <audio controls src={render.streamUrl} /> : null}{render.errorMessage ? <span style={{ color: "#fecaca" }}>{render.errorMessage}</span> : null}</div>)}</div> : null}
    </> : null}
    <p style={s.safety}>The waveform uses cached peaks. The original recording is never changed or publicly shared; every save creates a recoverable project version.</p>
  </section>;
}

const s = {
  panel: { border: "1px solid #3b4b66", borderRadius: 16, background: "#111d30", padding: 22, marginBottom: 22 }, heading: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, marginBottom: 16 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, hint: { color: "#9facbf", lineHeight: 1.5, fontSize: 13 }, label: { display: "grid", gap: 6, color: "#dce5f3", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 7, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" }, compact: { border: "1px solid #61708a", borderRadius: 7, background: "#fff", padding: "7px" }, primary: { border: 0, borderRadius: 7, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, background: "transparent", color: "#e2e8f0", padding: "9px 12px", fontWeight: 800, cursor: "pointer" }, active: { border: "1px solid #60a5fa", borderRadius: 7, background: "#1d4ed8", color: "#fff", padding: "9px 12px", fontWeight: 800 }, actions: { display: "flex", flexWrap: "wrap", gap: 8 }, toolbar: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "16px 0 10px" }, inline: { display: "flex", gap: 8, alignItems: "center", color: "#dce5f3", fontWeight: 800, fontSize: 13 }, canvasWrap: { overflowX: "auto", border: "1px solid #3b4b66", borderRadius: 10, touchAction: "pan-x" }, timeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, margin: "12px 0" }, duration: { color: "#9facbf", alignSelf: "end", padding: 8 }, advanced: { border: "1px solid #334155", background: "#182235", borderRadius: 10, padding: 14, marginTop: 12 }, markerRow: { display: "grid", gridTemplateColumns: "minmax(180px,1fr) auto", gap: 8 }, markerList: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }, marker: { background: "#24334d", border: "1px solid #475569", color: "#dbeafe", borderRadius: 999, padding: "6px 10px" }, finish: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderTop: "1px solid #334155", marginTop: 16, paddingTop: 16 }, check: { display: "flex", gap: 7, alignItems: "center", color: "#dce5f3", fontWeight: 800, fontSize: 13 }, shortcuts: { color: "#93a4bd", fontSize: 12 }, empty: { border: "1px dashed #52627c", borderRadius: 10, padding: 16, marginTop: 14 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 14 }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 14 }, renders: { marginTop: 16, background: "#0b1628", borderRadius: 10, padding: 14 }, renderRow: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderTop: "1px solid #26364f", padding: "10px 0" }, safety: { color: "#8ea0b8", fontSize: 12, margin: "16px 0 0" }
};

