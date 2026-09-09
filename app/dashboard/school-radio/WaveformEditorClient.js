"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adjustSelection, copySelection, deleteSelection, duplicateSelection, MARKER_TYPES, pasteSelection,
  pushHistory, reflowClips, silenceSelection, splitAt, timelineDuration, trimToSelection
} from "@/lib/waveform-editor.mjs";
import { applyVoiceCleanupPreset, normalizeVoiceCleanup, voiceCleanupLabel } from "@/lib/voice-cleanup.mjs";
import { applyStudioEffectPreset, applyStudioMasteringPreset, normalizeStudioEffects, normalizeStudioMastering, studioEffectLabel, studioMasteringLabel } from "@/lib/studio-effects-mastering.mjs";

const newId = () => crypto.randomUUID();
const seconds = (milliseconds) => (Number(milliseconds || 0) / 1000).toFixed(2);
const milliseconds = (value) => Math.max(0, Math.round(Number(value || 0) * 1000));
const effectPresets = [
  ["NONE", "No effects", "Keep the repaired voice natural."], ["BROADCAST_VOICE", "Broadcast Voice", "Clear and controlled for radio."],
  ["PODCAST_VOICE", "Podcast Voice", "Warm, close and gently levelled."], ["PROMO_VOICE", "Promo Voice", "Brighter and more energetic."],
  ["TELEPHONE_VOICE", "Telephone Voice", "Intentional narrow-band character."], ["WARM_VOICE", "Warm Voice", "Softer tone with light space."],
  ["CLEAN_INTERVIEW", "Clean Interview", "Natural dynamics with a gentle gate."]
];
const masteringPresets = [
  ["PODCAST", "Podcast", "-16 LUFS · -1.5 dBTP"], ["ONLINE_RADIO", "Online Radio", "-16 LUFS · -1.0 dBTP"],
  ["RETAIL_PROMO", "Retail Promo", "-14 LUFS · -1.0 dBTP"], ["SCHOOL_PROGRAMME", "School Programme", "-18 LUFS · -1.5 dBTP"]
];

export default function WaveformEditorClient({ requestedProjectId = "", experienceMode, onExperienceModeChange }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [editor, setEditor] = useState(null);
  const [state, setState] = useState({ clips: [], markers: [], normalize: true, targetLufs: -16, noiseCleanup: false, voiceCleanup: applyVoiceCleanupPreset("OFF"), effects: applyStudioEffectPreset("NONE"), mastering: applyStudioMasteringPreset("PODCAST") });
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [cursorMs, setCursorMs] = useState(0);
  const [selection, setSelection] = useState({ startMs: 0, endMs: 0 });
  const [looping, setLooping] = useState(false);
  const [localMode, setLocalMode] = useState("BEGINNER");
  const [activePane, setActivePane] = useState("EDIT");
  const [zoom, setZoom] = useState(1);
  const [markerType, setMarkerType] = useState("EDIT_NOTE");
  const [markerLabel, setMarkerLabel] = useState("");
  const [clipboard, setClipboard] = useState({ durationMs: 0, clips: [] });
  const [lastAction, setLastAction] = useState("Project loaded");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);

  const durationMs = useMemo(() => timelineDuration(state.clips), [state.clips]);
  const sourceTake = useMemo(() => editor?.takes.find((take) => state.clips.some((clip) => clip.mediaAssetId === take.mediaAsset.id)) || editor?.takes[0], [editor, state.clips]);
  const peaks = sourceTake?.waveformPeaks || [];
  const advanced = (experienceMode || localMode) === "ADVANCED";
  const hasSelection = Math.max(selection.startMs, selection.endMs) > Math.min(selection.startMs, selection.endMs);
  const cleanup = normalizeVoiceCleanup(state.voiceCleanup, state.noiseCleanup);
  const effects = normalizeStudioEffects(state.effects);
  const mastering = normalizeStudioMastering(state.mastering, state);
  const previewGroupId = editor?.renders?.find((render) => render.resultJson?.studioPreview?.purpose === "VOICE_CLEANUP")?.resultJson?.studioPreview?.groupId;
  const cleanupPreviews = (editor?.renders || []).filter((render) => render.resultJson?.studioPreview?.purpose === "VOICE_CLEANUP" && render.resultJson.studioPreview.groupId === previewGroupId);
  const masterPreview = editor?.renders?.find((render) => render.resultJson?.studioPreview?.purpose === "EFFECTS_MASTERING");

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/school-radio/audio-lab", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Waveform projects could not be loaded.");
    const editableProjects = (payload.projects || []).filter((project) => project.type !== "MULTITRACK");
    setProjects(editableProjects);
    setProjectId((current) => current || editableProjects[0]?.id || "");
  }, []);

  const loadEditor = useCallback(async () => {
    if (!projectId) return;
    const response = await fetch(`/api/school-radio/audio-lab/projects/${projectId}/editor`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The waveform editor could not be loaded.");
    setEditor(payload); setState(payload.state); setHistory([]); setFuture([]); setLastAction("Project loaded");
    setCursorMs(0); setSelection({ startMs: 0, endMs: 0 });
  }, [projectId]);

  useEffect(() => { loadProjects().catch((loadError) => setError(loadError.message)); }, [loadProjects]);
  useEffect(() => {
    if (requestedProjectId && projects.some((project) => project.id === requestedProjectId)) setProjectId(requestedProjectId);
  }, [projects, requestedProjectId]);
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

  function commit(next, label = "Edit") {
    setHistory((items) => pushHistory(items, state)); setFuture([]); setState(next); setLastAction(label);
  }
  function chooseCleanupPreset(preset) {
    const voiceCleanup = applyVoiceCleanupPreset(preset);
    commit({ ...state, voiceCleanup, noiseCleanup: voiceCleanup.enabled && voiceCleanup.noiseReduction > 0 }, `Voice cleanup: ${voiceCleanupLabel(voiceCleanup)}`);
  }
  function changeCleanup(changes, label) {
    const voiceCleanup = normalizeVoiceCleanup({ ...cleanup, ...changes, enabled: true, preset: "CUSTOM" });
    commit({ ...state, voiceCleanup, noiseCleanup: voiceCleanup.noiseReduction > 0 }, label);
  }
  function chooseEffectPreset(preset) {
    const nextEffects = applyStudioEffectPreset(preset);
    commit({ ...state, effects: nextEffects }, `Effects: ${studioEffectLabel(nextEffects)}`);
  }
  function changeEffects(changes, label) {
    commit({ ...state, effects: normalizeStudioEffects({ ...effects, ...changes, enabled: true, preset: "CUSTOM" }) }, label);
  }
  function chooseMasteringPreset(preset) {
    const nextMastering = applyStudioMasteringPreset(preset);
    commit({ ...state, mastering: nextMastering, normalize: nextMastering.enabled, targetLufs: nextMastering.targetLufs }, `Mastering: ${studioMasteringLabel(nextMastering)}`);
  }
  function changeMastering(changes, label) {
    const nextMastering = normalizeStudioMastering({ ...mastering, ...changes, preset: "CUSTOM" });
    commit({ ...state, mastering: nextMastering, normalize: nextMastering.enabled, targetLufs: nextMastering.targetLufs }, label);
  }
  function undo() {
    if (!history.length) return;
    setFuture((items) => pushHistory(items, state)); setState(history.at(-1)); setHistory((items) => items.slice(0, -1)); setLastAction("Undo");
  }
  function redo() {
    if (!future.length) return;
    setHistory((items) => pushHistory(items, state)); setState(future.at(-1)); setFuture((items) => items.slice(0, -1)); setLastAction("Redo");
  }
  function editClips(operation, label = "Timeline edit") { commit({ ...state, clips: operation(state.clips) }, label); }

  function copyCurrentSelection() {
    const copied = copySelection(state.clips, selection.startMs, selection.endMs);
    if (!copied.clips.length) return;
    setClipboard(copied); setLastAction("Selection copied"); setMessage("Selection copied to the Studio clipboard.");
  }

  function cutCurrentSelection() {
    const copied = copySelection(state.clips, selection.startMs, selection.endMs);
    if (!copied.clips.length) return;
    setClipboard(copied);
    editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, true, newId), "Cut selection");
  }

  function pasteAtCursor() {
    if (!clipboard.clips.length) return;
    editClips((clips) => pasteSelection(clips, clipboard, cursorMs, newId), "Paste selection");
  }

  function moveSelection(direction) {
    const start = Math.min(selection.startMs, selection.endMs);
    const end = Math.max(selection.startMs, selection.endMs);
    const ordered = [...state.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    const index = ordered.findIndex((clip) => clip.timelineStartMs < end && clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs > start && !clip.locked);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    commit({ ...state, clips: reflowClips(ordered) }, direction < 0 ? "Move selection earlier" : "Move selection later");
  }

  function undoOrRedo(event) {
    if (!(event.ctrlKey || event.metaKey)) return false;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return true; }
    if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return true; }
    if (event.key.toLowerCase() === "c") { event.preventDefault(); copyCurrentSelection(); return true; }
    if (event.key.toLowerCase() === "x") { event.preventDefault(); cutCurrentSelection(); return true; }
    if (event.key.toLowerCase() === "v") { event.preventDefault(); pasteAtCursor(); return true; }
    return false;
  }

  useEffect(() => {
    const onKey = (event) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName) || undoOrRedo(event)) return;
      if (event.code === "Space") { event.preventDefault(); playFromCursor(); }
      if (event.key.toLowerCase() === "s") editClips((clips) => splitAt(clips, cursorMs, newId), "Split at cursor");
      if (event.key === "Backspace") { event.preventDefault(); editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, true, newId), "Ripple delete"); }
      if (event.key === "Delete") editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, false, newId), "Delete and keep gap");
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
      setMessage(action === "QUEUE_RENDER" ? "Final render queued. The background audio worker will prepare the review copy." : action === "QUEUE_CLEANUP_PREVIEW" ? "Before and After previews queued. They will appear together when the protected worker finishes." : action === "QUEUE_MASTER_PREVIEW" ? "Effects and mastering preview queued. Its quality report will appear when processing finishes." : action === "INITIALIZE" ? "The source take is ready in the non-destructive timeline." : `Project saved as version ${payload.currentVersion}.`);
      window.dispatchEvent(new CustomEvent("ruvanas:studio-projects-refresh"));
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  function addMarker() {
    const label = markerLabel.trim() || markerType.replaceAll("_", " ").toLowerCase();
    commit({ ...state, markers: [...state.markers, { clientId: newId(), positionMs: cursorMs, type: markerType, label }].sort((a, b) => a.positionMs - b.positionMs) }, `Add marker: ${label}`);
    setMarkerLabel("");
  }

  function addRegion() {
    if (!hasSelection) return;
    const start = Math.min(selection.startMs, selection.endMs); const end = Math.max(selection.startMs, selection.endMs);
    const label = markerLabel.trim() || "Named region";
    commit({ ...state, markers: [...state.markers, { clientId: newId(), positionMs: start, type: "CHAPTER", label: `${label} · start` }, { clientId: newId(), positionMs: end, type: "CHAPTER", label: `${label} · end` }].sort((a, b) => a.positionMs - b.positionMs) }, `Add region: ${label}`);
    setMarkerLabel("");
  }

  if (!projects.length) return <section style={s.panel}><p style={s.hint}>{error || "Create and upload an AudioLab take to unlock the waveform editor."}</p></section>;
  return <section style={s.panel} aria-labelledby="waveform-title">
    <div style={s.heading}><div><p style={s.eyebrow}>WAVEFORM</p><h2 id="waveform-title" style={s.title}>Shape the programme without touching the source</h2><p style={s.hint}>Cached waveform peaks, versioned edits, markers, undo/redo, and server-rendered review copies.</p></div><button type="button" style={s.secondary} onClick={() => { const next = advanced ? "BEGINNER" : "ADVANCED"; setLocalMode(next); onExperienceModeChange?.(next); }}>{advanced ? "Use Beginner" : "Use Advanced"}</button></div>
    {error ? <div style={s.error}>{error}</div> : null}{message ? <div style={s.notice}>{message}</div> : null}
    <label style={s.label}>AudioLab project<select style={s.input} value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
    {editor && !state.clips.length ? <div style={s.empty}><p style={s.hint}>Choose a protected take to place it on the timeline. Its source file will remain unchanged.</p><div style={s.actions}>{editor.takes.map((take) => <button key={take.id} style={s.primary} disabled={working || !take.durationMs} onClick={() => send("INITIALIZE", { takeId: take.id })}>Use {take.mediaAsset.name} {take.waveformStatus === "READY" ? "· waveform ready" : "· analysing"}</button>)}</div></div> : null}
    {state.clips.length ? <>
      <div style={s.paneTabs} role="tablist" aria-label="Waveform workflow">
        <button type="button" role="tab" aria-selected={activePane === "EDIT"} style={activePane === "EDIT" ? s.paneActive : s.paneTab} onClick={() => setActivePane("EDIT")}><strong>Edit audio</strong><span>Timeline and precision tools</span></button>
        <button type="button" role="tab" aria-selected={activePane === "CLEAN"} style={activePane === "CLEAN" ? s.paneActive : s.paneTab} onClick={() => setActivePane("CLEAN")}><strong>Clean voice</strong><span>Repair and compare</span></button>
        <button type="button" role="tab" aria-selected={activePane === "MASTER"} style={activePane === "MASTER" ? s.paneActive : s.paneTab} onClick={() => setActivePane("MASTER")}><strong>Effects & master</strong><span>Style, loudness and quality</span></button>
      </div>
      {activePane === "EDIT" ? <>
      <div style={s.toolbar}><button style={s.primary} onClick={playFromCursor}>▶ Play / pause</button><button style={looping ? s.active : s.secondary} onClick={() => setLooping(!looping)}>↻ Loop selection</button><button style={s.secondary} disabled={!hasSelection} onClick={copyCurrentSelection}>Copy</button><button style={s.secondary} disabled={!hasSelection} onClick={cutCurrentSelection}>Cut</button><button style={s.secondary} disabled={!clipboard.clips.length} onClick={pasteAtCursor}>Paste at cursor</button><button style={s.secondary} disabled={!history.length} onClick={undo}>Undo</button><button style={s.secondary} disabled={!future.length} onClick={redo}>Redo</button><label style={s.inline}>Zoom <input type="range" min="1" max="5" step=".5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label></div>
      <p style={s.history}>Edit history: {history.length} undo step{history.length === 1 ? "" : "s"} · {future.length} redo step{future.length === 1 ? "" : "s"} · Latest: {lastAction}</p>
      <div style={s.canvasWrap}><canvas ref={canvasRef} role="img" aria-label="Waveform timeline. Use the selection fields and keyboard controls for precise editing." onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setCursorMs(Math.round(((event.clientX - rect.left) / rect.width) * durationMs)); }} /></div>
      {sourceTake ? <audio ref={audioRef} src={`/api/media/${sourceTake.mediaAsset.id}/stream`} onTimeUpdate={onAudioTime} onEnded={() => setCursorMs(0)} preload="metadata" /> : null}
      <div style={s.timeGrid}><label style={s.label}>Cursor (seconds)<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(cursorMs)} onChange={(event) => setCursorMs(milliseconds(event.target.value))} /></label><label style={s.label}>Selection start<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(selection.startMs)} onChange={(event) => setSelection({ ...selection, startMs: milliseconds(event.target.value) })} /></label><label style={s.label}>Selection end<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(selection.endMs)} onChange={(event) => setSelection({ ...selection, endMs: milliseconds(event.target.value) })} /></label><div style={s.duration}>Length<br /><strong>{seconds(durationMs)} s</strong></div></div>
      <div style={s.actions}><button style={s.secondary} onClick={() => editClips((clips) => splitAt(clips, cursorMs, newId), "Split at cursor")}>Split at cursor</button><button style={s.secondary} disabled={!hasSelection} onClick={() => editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, true, newId), "Ripple delete")}>Ripple delete</button><button style={s.secondary} disabled={!hasSelection} onClick={() => editClips((clips) => silenceSelection(clips, selection.startMs, selection.endMs, newId), "Replace with silence")}>Replace with silence</button><button style={s.secondary} disabled={!hasSelection} onClick={() => editClips((clips) => trimToSelection(clips, selection.startMs, selection.endMs, newId), "Crop to selection")}>Crop / trim to selection</button></div>
      {advanced ? <div style={s.advanced}>
        <div style={s.actions}><button style={s.secondary} disabled={!hasSelection} onClick={() => editClips((clips) => duplicateSelection(clips, selection.startMs, selection.endMs, newId), "Duplicate selection")}>Duplicate selection</button><button style={s.secondary} onClick={() => moveSelection(-1)}>Move earlier</button><button style={s.secondary} onClick={() => moveSelection(1)}>Move later</button><button style={s.secondary} disabled={!hasSelection} onClick={() => editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, false, newId), "Delete and keep gap")}>Delete, keep gap</button></div>
        <div style={s.timeGrid}><label style={s.label}>Selection gain (dB)<input style={s.input} type="number" min="-36" max="18" step=".5" defaultValue="0" onBlur={(event) => editClips((clips) => adjustSelection(clips, selection.startMs, selection.endMs, { gainDb: Number(event.target.value) }))} /></label><label style={s.label}>Fade in (ms)<input style={s.input} type="number" min="0" max="60000" defaultValue="0" onBlur={(event) => editClips((clips) => adjustSelection(clips, selection.startMs, selection.endMs, { fadeInMs: Number(event.target.value) }))} /></label><label style={s.label}>Fade out (ms)<input style={s.input} type="number" min="0" max="60000" defaultValue="0" onBlur={(event) => editClips((clips) => adjustSelection(clips, selection.startMs, selection.endMs, { fadeOutMs: Number(event.target.value) }))} /></label></div>
        <div style={s.markerRow}><input style={s.input} value={markerLabel} onChange={(event) => setMarkerLabel(event.target.value)} placeholder="Marker or region name" /><select style={s.input} value={markerType} onChange={(event) => setMarkerType(event.target.value)}>{MARKER_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select><button style={s.secondary} onClick={addMarker}>Add marker</button><button style={s.secondary} disabled={!hasSelection} onClick={addRegion}>Add named region</button></div>
        <div style={s.markerList}>{state.markers.map((marker) => <button key={marker.clientId} style={s.marker} onClick={() => setCursorMs(marker.positionMs)}>{seconds(marker.positionMs)} · {marker.type.replaceAll("_", " ")} · {marker.label}</button>)}</div>
      </div> : null}
      <p style={s.shortcuts}>Keyboard: Space play/pause · S split · Backspace ripple delete · Delete keep gap · L loop · Ctrl/Cmd+C/X/V copy, cut and paste · Ctrl/Cmd+Z/Y undo and redo.</p>
      </> : activePane === "CLEAN" ? <section style={s.cleanup} aria-labelledby="voice-cleanup-title">
        <div style={s.cleanupHeading}><div><p style={s.eyebrow}>CLEAN VOICE</p><h3 id="voice-cleanup-title" style={s.cardTitle}>Repair common voice problems safely</h3><p style={s.hint}>Choose a starting point, then compare protected server previews. Your original recording never changes.</p></div><span style={cleanup.enabled ? s.cleanupOn : s.cleanupOff}>{voiceCleanupLabel(cleanup)}</span></div>
        <div style={s.presetGrid}>
          {[{ id: "OFF", title: "Off", text: "Keep the edited audio unchanged." }, { id: "GENTLE", title: "Gentle repair", text: "Light background cleanup for a good recording." }, { id: "CLEAN_DIALOGUE", title: "Clean dialogue", text: "Stronger repair for interviews and spoken audio." }, { id: "BROADCAST", title: "Broadcast voice", text: "Clear, level speech with a broadcast tone." }].map((preset) => <button type="button" key={preset.id} aria-pressed={cleanup.preset === preset.id} style={cleanup.preset === preset.id ? s.presetActive : s.preset} onClick={() => chooseCleanupPreset(preset.id)}><strong>{preset.title}</strong><span>{preset.text}</span></button>)}
        </div>
        {advanced && cleanup.enabled ? <div style={s.cleanupControls}>
          <label style={s.label}>Background noise <span>{cleanup.noiseReduction}%</span><input type="range" min="0" max="100" step="5" value={cleanup.noiseReduction} onChange={(event) => changeCleanup({ noiseReduction: Number(event.target.value) }, "Adjust background cleanup")} /></label>
          <label style={s.label}>Rumble filter <span>{cleanup.rumbleHz ? `${cleanup.rumbleHz} Hz` : "Off"}</span><input type="range" min="0" max="160" step="10" value={cleanup.rumbleHz} onChange={(event) => changeCleanup({ rumbleHz: Number(event.target.value) }, "Adjust rumble filter")} /></label>
          <label style={s.label}>De-ess <span>{cleanup.deEss}%</span><input type="range" min="0" max="100" step="5" value={cleanup.deEss} onChange={(event) => changeCleanup({ deEss: Number(event.target.value) }, "Adjust de-ess")} /></label>
          <label style={s.label}>Speech levelling <span>{cleanup.speechLeveling}%</span><input type="range" min="0" max="100" step="5" value={cleanup.speechLeveling} onChange={(event) => changeCleanup({ speechLeveling: Number(event.target.value) }, "Adjust speech levelling")} /></label>
          <label style={s.label}>Electrical hum<select style={s.input} value={cleanup.humHz} onChange={(event) => changeCleanup({ humHz: Number(event.target.value) }, "Adjust hum removal")}><option value="0">Off</option><option value="50">50 Hz</option><option value="60">60 Hz</option></select></label>
          <label style={s.label}>Voice tone<select style={s.input} value={cleanup.voiceEq} onChange={(event) => changeCleanup({ voiceEq: event.target.value }, "Adjust voice tone")}><option value="NEUTRAL">Neutral</option><option value="MALE">Male voice</option><option value="FEMALE">Female voice</option><option value="BROADCAST">Broadcast</option></select></label>
          <label style={s.check}><input type="checkbox" checked={cleanup.limiter} onChange={(event) => changeCleanup({ limiter: event.target.checked }, "Adjust clipping protection")} /> Prevent new clipping</label>
        </div> : null}
        <div style={s.previewActions}><button type="button" style={s.primary} disabled={working || !cleanup.enabled} onClick={() => send("QUEUE_CLEANUP_PREVIEW")}>Create Before/After preview</button><span style={s.hint}>{cleanup.enabled ? "Both previews use the same saved edit version." : "Choose a repair preset to enable comparison."}</span></div>
        {cleanupPreviews.length ? <CleanupPreview renders={cleanupPreviews} /> : null}
      </section> : <section style={s.cleanup} aria-labelledby="effects-master-title">
        <div style={s.cleanupHeading}><div><p style={s.eyebrow}>EFFECTS & MASTER</p><h3 id="effects-master-title" style={s.cardTitle}>Choose a sound, then check delivery quality</h3><p style={s.hint}>Curated effects stay editable until the protected worker renders them. Mastering reports measured LUFS, True Peak and loudness range.</p></div><span style={s.cleanupOn}>{studioEffectLabel(effects)} · {studioMasteringLabel(mastering)}</span></div>
        <h4 style={s.sectionTitle}>1 · Sound preset</h4>
        <div style={s.presetGrid}>{effectPresets.map(([id, title, text]) => <button type="button" key={id} aria-pressed={effects.preset === id} style={effects.preset === id ? s.presetActive : s.preset} onClick={() => chooseEffectPreset(id)}><strong>{title}</strong><span>{text}</span></button>)}</div>
        {advanced && effects.enabled ? <div style={s.cleanupControls}>
          <label style={s.label}>Tone<select style={s.input} value={effects.tone} onChange={(event) => changeEffects({ tone: event.target.value }, "Adjust effects tone")}><option value="NEUTRAL">Neutral</option><option value="WARM">Warm</option><option value="BRIGHT">Bright</option><option value="BROADCAST">Broadcast</option><option value="TELEPHONE">Telephone</option></select></label>
          <label style={s.label}>Compression <span>{effects.compression}%</span><input type="range" min="0" max="100" step="5" value={effects.compression} onChange={(event) => changeEffects({ compression: Number(event.target.value) }, "Adjust compression")} /></label>
          <label style={s.label}>Noise gate <span>{effects.gate}%</span><input type="range" min="0" max="100" step="5" value={effects.gate} onChange={(event) => changeEffects({ gate: Number(event.target.value) }, "Adjust noise gate")} /></label>
          <label style={s.label}>Reverb <span>{effects.reverb}%</span><input type="range" min="0" max="30" step="1" value={effects.reverb} onChange={(event) => changeEffects({ reverb: Number(event.target.value) }, "Adjust reverb")} /></label>
          <label style={s.label}>Delay <span>{effects.delayMs} ms</span><input type="range" min="0" max="250" step="10" value={effects.delayMs} onChange={(event) => changeEffects({ delayMs: Number(event.target.value) }, "Adjust delay")} /></label>
          <label style={s.label}>High-pass Hz<input style={s.input} type="number" min="0" max="500" step="5" value={effects.highpassHz} onChange={(event) => changeEffects({ highpassHz: Number(event.target.value) }, "Adjust effects high-pass")} /></label>
          <label style={s.label}>Low-pass Hz<input style={s.input} type="number" min="0" max="20000" step="100" value={effects.lowpassHz} onChange={(event) => changeEffects({ lowpassHz: Number(event.target.value) }, "Adjust effects low-pass")} /></label>
          <label style={s.check}><input type="checkbox" checked={effects.hardLimiter} onChange={(event) => changeEffects({ hardLimiter: event.target.checked }, "Adjust effects limiter")} /> Hard limiter in effects rack</label>
        </div> : null}
        <h4 style={s.sectionTitle}>2 · Delivery preset</h4>
        <div style={s.presetGrid}>{masteringPresets.map(([id, title, text]) => <button type="button" key={id} aria-pressed={mastering.preset === id} style={mastering.preset === id ? s.presetActive : s.preset} onClick={() => chooseMasteringPreset(id)}><strong>{title}</strong><span>{text}</span></button>)}</div>
        {advanced ? <div style={s.cleanupControls}>
          <label style={s.label}>Target loudness (LUFS)<input style={s.input} type="number" min="-24" max="-9" step="0.5" value={mastering.targetLufs} onChange={(event) => changeMastering({ targetLufs: Number(event.target.value), enabled: true }, "Adjust loudness target")} /></label>
          <label style={s.label}>True Peak ceiling (dBTP)<input style={s.input} type="number" min="-3" max="-0.5" step="0.1" value={mastering.truePeakDbfs} onChange={(event) => changeMastering({ truePeakDbfs: Number(event.target.value), enabled: true }, "Adjust True Peak ceiling")} /></label>
          <label style={s.label}>Maximum loudness range (LU)<input style={s.input} type="number" min="1" max="20" step="0.5" value={mastering.maxLoudnessRangeLu} onChange={(event) => changeMastering({ maxLoudnessRangeLu: Number(event.target.value), enabled: true }, "Adjust loudness range")} /></label>
          <label style={s.check}><input type="checkbox" checked={mastering.limiter} onChange={(event) => changeMastering({ limiter: event.target.checked }, "Adjust mastering limiter")} /> Final clipping limiter</label>
        </div> : null}
        <div style={s.previewActions}><button type="button" style={s.primary} disabled={working || (!effects.enabled && !mastering.enabled)} onClick={() => send("QUEUE_MASTER_PREVIEW")}>Create mastered preview</button><span style={s.hint}>The worker measures the rendered result; it does not estimate a pass in the browser.</span></div>
        {masterPreview ? <MasterPreview render={masterPreview} /> : null}
      </section>}
      <div style={s.finish}><span style={s.hint}>Current finish: {studioEffectLabel(effects)} · {mastering.enabled ? `${mastering.targetLufs} LUFS · ${mastering.truePeakDbfs} dBTP` : "loudness matching off"}</span><button style={s.secondary} disabled={working} onClick={() => send("SAVE", { reason: "Manual waveform snapshot" })}>Save version</button><button style={s.primary} disabled={working} onClick={() => send("QUEUE_RENDER", { preset: "SCHOOL_RADIO_MP3" })}>Create review render</button></div>
      {editor.renders?.some((render) => !render.resultJson?.studioPreview) ? <div style={s.renders}><h3 style={{ marginTop: 0 }}>Recent renders</h3>{editor.renders.filter((render) => !render.resultJson?.studioPreview).map((render) => <div key={render.id} style={s.renderRow}><div><strong>{render.preset.replaceAll("_", " ")} · {render.status}</strong><QualitySummary report={render.resultJson} /></div>{render.streamUrl ? <audio controls src={render.streamUrl} /> : null}{render.errorMessage ? <span style={{ color: "#fecaca" }}>{render.errorMessage}</span> : null}</div>)}</div> : null}
    </> : null}
    <p style={s.safety}>The waveform uses cached peaks. The original recording is never changed or publicly shared; every save creates a recoverable project version.</p>
  </section>;
}

function CleanupPreview({ renders }) {
  const [side, setSide] = useState("AFTER");
  const selected = renders.find((render) => render.resultJson?.studioPreview?.variant === side);
  const before = renders.find((render) => render.resultJson?.studioPreview?.variant === "BEFORE");
  const after = renders.find((render) => render.resultJson?.studioPreview?.variant === "AFTER");
  const ready = before?.status === "SUCCEEDED" && after?.status === "SUCCEEDED";
  return <div style={s.comparison}>
    <div style={s.previewActions}><strong>Before / After comparison</strong><button type="button" aria-pressed={side === "BEFORE"} style={side === "BEFORE" ? s.active : s.secondary} onClick={() => setSide("BEFORE")}>Before</button><button type="button" aria-pressed={side === "AFTER"} style={side === "AFTER" ? s.active : s.secondary} onClick={() => setSide("AFTER")}>After</button></div>
    {ready && selected?.streamUrl ? <audio key={selected.id} controls src={selected.streamUrl} style={{ width: "100%" }} /> : <p style={s.hint}>Before: {before?.status || "QUEUED"} · After: {after?.status || "QUEUED"}. The comparison will unlock when both are ready.</p>}
    {renders.some((render) => render.status === "FAILED") ? <p style={{ color: "#fecaca" }}>A preview could not be prepared. Your saved edit and original recording are still safe.</p> : null}
  </div>;
}

function MasterPreview({ render }) {
  const ready = render.status === "SUCCEEDED" && render.streamUrl;
  return <div style={s.comparison}>
    <div style={s.previewActions}><strong>Mastered preview</strong><span style={s.hint}>{render.status.replaceAll("_", " ")}</span></div>
    {ready ? <audio controls src={render.streamUrl} style={{ width: "100%" }} /> : <p style={s.hint}>The protected audio worker is preparing and measuring this preview.</p>}
    <QualitySummary report={render.resultJson} />
    {render.status === "FAILED" ? <p style={{ color: "#fecaca" }}>{render.errorMessage || "The preview could not be prepared. Your source and saved edits are unchanged."}</p> : null}
  </div>;
}

function QualitySummary({ report }) {
  const quality = report?.masteringQuality;
  if (!report || (report.integratedLufs == null && report.truePeakDbfs == null && report.loudnessRangeLu == null)) return <small style={s.qualityMuted}>Quality measurement pending</small>;
  const measurement = [
    report.integratedLufs == null ? null : `${report.integratedLufs} LUFS`,
    report.truePeakDbfs == null ? null : `${report.truePeakDbfs} dBTP`,
    report.loudnessRangeLu == null ? null : `${report.loudnessRangeLu} LU range`
  ].filter(Boolean).join(" · ");
  const ready = quality?.status === "READY";
  return <small style={ready ? s.qualityReady : s.qualityWarning}>
    {measurement || "No loudness measurement"}{quality?.status ? ` · ${quality.status.replaceAll("_", " ")}` : ""}
    {quality?.findings?.length ? <span style={s.qualityFindings}>{quality.findings.join(" ")}</span> : null}
  </small>;
}

const s = {
  panel: { border: "1px solid var(--rv-border)", borderRadius: 16, background: "var(--rv-surface)", padding: 22, marginBottom: 22 }, heading: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, marginBottom: 16 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, cardTitle: { margin: "0 0 6px", fontSize: 20 }, sectionTitle: { margin: "18px 0 8px", fontSize: 15, color: "var(--rv-warning-text)" }, hint: { color: "var(--rv-text-muted)", lineHeight: 1.5, fontSize: 13 }, label: { display: "grid", gap: 6, color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--rv-border)", borderRadius: 7, background: "var(--rv-input-bg)", color: "var(--rv-input-text)", padding: "10px 11px", font: "inherit" }, compact: { border: "1px solid var(--rv-border)", borderRadius: 7, background: "var(--rv-input-bg)", padding: "7px" }, primary: { border: 0, borderRadius: 7, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid var(--rv-border)", borderRadius: 7, background: "transparent", color: "var(--rv-text)", padding: "9px 12px", fontWeight: 800, cursor: "pointer" }, active: { border: "1px solid #60a5fa", borderRadius: 7, background: "#1d4ed8", color: "#fff", padding: "9px 12px", fontWeight: 800 }, actions: { display: "flex", flexWrap: "wrap", gap: 8 }, toolbar: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "16px 0 10px" }, paneTabs: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginTop: 16 }, paneTab: { display: "grid", gap: 3, textAlign: "left", border: "1px solid var(--rv-border)", borderRadius: 9, background: "var(--rv-surface-muted)", color: "var(--rv-text)", padding: 12, cursor: "pointer" }, paneActive: { display: "grid", gap: 3, textAlign: "left", border: "2px solid #f4b942", borderRadius: 9, background: "var(--rv-warning-bg)", color: "var(--rv-text)", padding: 11, cursor: "pointer" }, history: { color: "var(--rv-info-text)", fontSize: 12, margin: "0 0 10px" }, inline: { display: "flex", gap: 8, alignItems: "center", color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, canvasWrap: { overflowX: "auto", border: "1px solid var(--rv-border)", borderRadius: 10, touchAction: "pan-x" }, timeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, margin: "12px 0" }, duration: { color: "var(--rv-text-muted)", alignSelf: "end", padding: 8 }, advanced: { border: "1px solid #334155", background: "var(--rv-surface)", borderRadius: 10, padding: 14, marginTop: 12 }, markerRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }, markerList: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }, marker: { background: "var(--rv-surface)", border: "1px solid var(--rv-border)", color: "var(--rv-info-text)", borderRadius: 999, padding: "6px 10px" }, cleanup: { border: "1px solid #49617e", background: "var(--rv-surface-muted)", borderRadius: 12, padding: 16, marginTop: 16 }, cleanupHeading: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }, cleanupOn: { alignSelf: "start", borderRadius: 999, background: "var(--rv-success-bg)", color: "var(--rv-success-text)", padding: "6px 10px", fontSize: 12, fontWeight: 900 }, cleanupOff: { alignSelf: "start", borderRadius: 999, background: "var(--rv-surface)", color: "var(--rv-text)", padding: "6px 10px", fontSize: 12, fontWeight: 900 }, presetGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 9, marginTop: 12 }, preset: { display: "grid", gap: 5, textAlign: "left", border: "1px solid var(--rv-border)", borderRadius: 9, background: "var(--rv-surface)", color: "var(--rv-text)", padding: 12, cursor: "pointer" }, presetActive: { display: "grid", gap: 5, textAlign: "left", border: "2px solid #f4b942", borderRadius: 9, background: "var(--rv-warning-bg)", color: "var(--rv-text)", padding: 11, cursor: "pointer" }, cleanupControls: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, borderTop: "1px solid #334155", marginTop: 14, paddingTop: 14 }, previewActions: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 14 }, comparison: { borderTop: "1px solid #334155", marginTop: 14, paddingTop: 2 }, finish: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderTop: "1px solid #334155", marginTop: 16, paddingTop: 16 }, check: { display: "flex", gap: 7, alignItems: "center", color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, shortcuts: { color: "var(--rv-text-muted)", fontSize: 12 }, empty: { border: "1px dashed var(--rv-border)", borderRadius: 10, padding: 16, marginTop: 14 }, notice: { border: "1px solid #22c55e", background: "var(--rv-success-bg)", color: "var(--rv-success-text)", borderRadius: 8, padding: 12, marginBottom: 14 }, error: { border: "1px solid #ef4444", background: "var(--rv-error-bg)", color: "var(--rv-error-text)", borderRadius: 8, padding: 12, marginBottom: 14 }, renders: { marginTop: 16, background: "var(--rv-surface-muted)", borderRadius: 10, padding: 14 }, renderRow: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderTop: "1px solid #26364f", padding: "10px 0" }, qualityMuted: { display: "block", color: "var(--rv-text-muted)", marginTop: 4 }, qualityReady: { display: "block", color: "var(--rv-success-text)", marginTop: 4 }, qualityWarning: { display: "block", color: "var(--rv-warning-text)", marginTop: 4 }, qualityFindings: { display: "block", color: "var(--rv-warning-text)", marginTop: 3, maxWidth: 620 }, safety: { color: "var(--rv-text-muted)", fontSize: 12, margin: "16px 0 0" }
};

