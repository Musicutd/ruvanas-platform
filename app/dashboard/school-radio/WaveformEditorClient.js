"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adjustSelection, changeSelectionGain, copySelection, deleteSelection, duplicateSelection, MARKER_TYPES, pasteSelection,
  pushHistory, reflowClips, silenceSelection, splitAt, timelineDuration, trimToSelection
} from "@/lib/waveform-editor.mjs";
import { applyVoiceCleanupPreset, normalizeVoiceCleanup, voiceCleanupLabel } from "@/lib/voice-cleanup.mjs";
import { applyStudioEffectPreset, applyStudioMasteringPreset, normalizeStudioEffects, normalizeStudioMastering, studioEffectLabel, studioMasteringLabel } from "@/lib/studio-effects-mastering.mjs";
import { gainDbFromVerticalDrag, waveformDragSelection, waveformTimeAtPointer } from "@/lib/waveform-interaction.mjs";
import { waveformPrimaryShortcut } from "@/lib/waveform-shortcuts.mjs";

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

export default function WaveformEditorClient({ requestedProjectId = "", experienceMode, onExperienceModeChange, apiBase = "/api/school-radio/audio-lab", mediaBase = "/api/media", supervised = false }) {
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
  const [editTool, setEditTool] = useState("SELECT");
  const [gainAdjustmentDb, setGainAdjustmentDb] = useState(0);
  const [markerType, setMarkerType] = useState("EDIT_NOTE");
  const [markerLabel, setMarkerLabel] = useState("");
  const [clipboard, setClipboard] = useState({ durationMs: 0, clips: [] });
  const [lastAction, setLastAction] = useState("Project loaded");
  const [message, setMessage] = useState("");
  const [saveFeedback, setSaveFeedback] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [workingAction, setWorkingAction] = useState("");
  const sectionRef = useRef(null);
  const stateRef = useRef(state);
  const requestInFlightRef = useRef(false);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const dragRef = useRef(null);
  const gainDragRef = useRef(null);

  const durationMs = useMemo(() => timelineDuration(state.clips), [state.clips]);
  const sourceTake = useMemo(() => editor?.takes.find((take) => state.clips.some((clip) => clip.mediaAssetId === take.mediaAsset.id)) || editor?.takes[0], [editor, state.clips]);
  const gainEnabled = editor?.studioProEnabled === true;
  const advanced = gainEnabled && (experienceMode || localMode) === "ADVANCED";
  const hasSelection = Math.max(selection.startMs, selection.endMs) > Math.min(selection.startMs, selection.endMs);
  const canEdit = !editor?.restrictedReadOnly && !working;
  const cleanup = normalizeVoiceCleanup(state.voiceCleanup, state.noiseCleanup);
  const effects = normalizeStudioEffects(state.effects);
  const mastering = normalizeStudioMastering(state.mastering, state);
  const previewGroupId = editor?.renders?.find((render) => render.resultJson?.studioPreview?.purpose === "VOICE_CLEANUP")?.resultJson?.studioPreview?.groupId;
  const cleanupPreviews = (editor?.renders || []).filter((render) => render.resultJson?.studioPreview?.purpose === "VOICE_CLEANUP" && render.resultJson.studioPreview.groupId === previewGroupId);
  const masterPreview = editor?.renders?.find((render) => render.resultJson?.studioPreview?.purpose === "EFFECTS_MASTERING");

  const loadProjects = useCallback(async () => {
    const response = await fetch(apiBase, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Waveform projects could not be loaded.");
    const editableProjects = (payload.projects || []).filter((project) => project.type !== "MULTITRACK");
    setProjects(editableProjects);
    setProjectId((current) => current || editableProjects[0]?.id || "");
  }, [apiBase]);

  const loadEditor = useCallback(async () => {
    if (!projectId) return;
    const response = await fetch(`${apiBase}/projects/${projectId}/editor`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The waveform editor could not be loaded.");
    setEditor(payload); stateRef.current = payload.state; setState(payload.state); setHistory([]); setFuture([]); setLastAction("Project loaded"); setSaveFeedback("");
    setCursorMs(0); setSelection({ startMs: 0, endMs: 0 });
  }, [apiBase, projectId]);

  useEffect(() => { loadProjects().catch((loadError) => setError(loadError.message)); }, [loadProjects]);
  useEffect(() => {
    if (requestedProjectId && projects.some((project) => project.id === requestedProjectId)) setProjectId(requestedProjectId);
  }, [projects, requestedProjectId]);
  useEffect(() => { loadEditor().catch((loadError) => setError(loadError.message)); }, [loadEditor]);
  useEffect(() => {
    const hasActiveWork = editor?.takes.some((take) => ["PENDING", "RUNNING"].includes(take.waveformStatus)) || editor?.renders.some((render) => ["QUEUED", "RUNNING"].includes(render.status));
    if (!projectId || !hasActiveWork) return;
    const timer = setInterval(async () => {
      const response = await fetch(`${apiBase}/projects/${projectId}/editor`, { cache: "no-store" });
      if (response.ok) setEditor(await response.json());
    }, 5000);
    return () => clearInterval(timer);
  }, [apiBase, editor, projectId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(720, Math.round((canvas.parentElement?.clientWidth || 720) * zoom));
    const height = 210;
    canvas.width = width * ratio; canvas.height = height * ratio;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    context.scale(ratio, ratio);
    context.fillStyle = "#08111f"; context.fillRect(0, 0, width, height);
    context.strokeStyle = "#2b425e"; context.lineWidth = 1; context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
    const takesByAsset = new Map((editor?.takes || []).map((take) => [take.mediaAsset.id, take]));
    for (const clip of state.clips) {
      const left = durationMs ? clip.timelineStartMs / durationMs * width : 0;
      const right = durationMs ? (clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs) / durationMs * width : 0;
      if (clip.kind === "SILENCE") {
        context.fillStyle = "rgba(148,163,184,.12)"; context.fillRect(left, 0, Math.max(0, right - left), height);
        continue;
      }
      const take = takesByAsset.get(clip.mediaAssetId);
      const peaks = take?.waveformPeaks || [];
      const takeDuration = Number(take?.durationMs || take?.mediaAsset?.durationMs || clip.sourceEndMs);
      if (!peaks.length || !(takeDuration > 0)) continue;
      context.strokeStyle = clip.locked ? "#94a3b8" : "#37e4c2";
      context.lineWidth = 1.5;
      context.beginPath();
      const samples = Math.max(1, Math.ceil((right - left) / 2));
      for (let index = 0; index <= samples; index++) {
        const fraction = index / samples;
        const sourceMs = clip.sourceStartMs + fraction * (clip.sourceEndMs - clip.sourceStartMs);
        const peakIndex = Math.min(peaks.length - 1, Math.max(0, Math.round(sourceMs / takeDuration * (peaks.length - 1))));
        const timelineMs = clip.timelineStartMs + fraction * (clip.sourceEndMs - clip.sourceStartMs);
        const previewDb = gainEnabled && hasSelection && !clip.locked && timelineMs >= Math.min(selection.startMs, selection.endMs) && timelineMs < Math.max(selection.startMs, selection.endMs) ? gainAdjustmentDb : 0;
        const gainDb = Math.min(18, Math.max(-36, Number(clip.gainDb || 0) + previewDb));
        const gainMultiplier = Math.pow(10, gainDb / 20);
        const amplitude = Math.min(1, Math.abs(Number(peaks[peakIndex]) || 0) * gainMultiplier) * height * .42;
        const x = left + fraction * (right - left);
        context.moveTo(x, height / 2 - amplitude); context.lineTo(x, height / 2 + amplitude);
      }
      context.stroke();
      context.strokeStyle = "rgba(255,255,255,.25)"; context.beginPath(); context.moveTo(left, 0); context.lineTo(left, height); context.stroke();
    }
    const startX = durationMs ? Math.min(selection.startMs, selection.endMs) / durationMs * width : 0;
    const endX = durationMs ? Math.max(selection.startMs, selection.endMs) / durationMs * width : 0;
    if (endX > startX) {
      context.fillStyle = "rgba(56,189,248,.28)"; context.fillRect(startX, 0, endX - startX, height);
      context.strokeStyle = "#7dd3fc"; context.lineWidth = 2; context.strokeRect(startX, 1, endX - startX, height - 2);
    }
    for (const marker of state.markers) {
      const x = durationMs ? (marker.positionMs / durationMs) * width : 0;
      context.strokeStyle = marker.type === "TEACHER_FEEDBACK" ? "#ef4444" : "#60a5fa"; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    const cursorX = durationMs ? (cursorMs / durationMs) * width : 0;
    context.strokeStyle = "#fff"; context.beginPath(); context.moveTo(cursorX, 0); context.lineTo(cursorX, height); context.stroke();
  }, [cursorMs, durationMs, editor?.takes, gainAdjustmentDb, gainEnabled, hasSelection, selection, state.clips, state.markers, zoom]);

  function commit(next, label = "Edit") {
    setHistory((items) => pushHistory(items, state)); setFuture([]); stateRef.current = next; setState(next); setLastAction(label); setSaveFeedback("");
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
    if (!canEdit || !history.length) return;
    setFuture((items) => pushHistory(items, state)); stateRef.current = history.at(-1); setState(stateRef.current); setHistory((items) => items.slice(0, -1)); setLastAction("Undo"); setSaveFeedback("");
  }
  function redo() {
    if (!canEdit || !future.length) return;
    setHistory((items) => pushHistory(items, state)); stateRef.current = future.at(-1); setState(stateRef.current); setFuture((items) => items.slice(0, -1)); setLastAction("Redo"); setSaveFeedback("");
  }
  function editClips(operation, label = "Timeline edit") {
    if (!canEdit) return;
    commit({ ...state, clips: operation(state.clips) }, label);
  }

  function wavePosition(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return waveformTimeAtPointer(event.clientX, rect.left, rect.width, durationMs);
  }

  function onWavePointerDown(event) {
    if (event.button !== 0 || !durationMs || event.detail >= 2) return;
    event.preventDefault();
    event.currentTarget.focus();
    const position = wavePosition(event);
    dragRef.current = { pointerId: event.pointerId, startMs: position, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCursorMs(position);
    if (editTool === "SELECT") setSelection({ startMs: position, endMs: position });
  }

  function onWavePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || editTool !== "SELECT") return;
    if (Math.abs(event.clientX - drag.startX) >= 3) drag.moved = true;
    if (drag.moved) setSelection(waveformDragSelection(drag.startMs, wavePosition(event)));
  }

  function onWavePointerUp(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = wavePosition(event);
    if (editTool === "SELECT") {
      setSelection(drag.moved ? waveformDragSelection(drag.startMs, position) : { startMs: position, endMs: position });
      setCursorMs(drag.moved ? Math.min(drag.startMs, position) : position);
    } else if (advanced && canEdit) {
      editClips((clips) => splitAt(clips, position, newId), "Blade at cursor");
      setCursorMs(position);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function selectWholeWave() {
    if (!durationMs) return;
    setEditTool("SELECT");
    setSelection({ startMs: 0, endMs: durationMs });
    setCursorMs(0);
  }

  function onGainPointerDown(event) {
    if (event.button !== 0 || !canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    gainDragRef.current = { pointerId: event.pointerId, startY: event.clientY, startDb: gainAdjustmentDb };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onGainPointerMove(event) {
    const drag = gainDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setGainAdjustmentDb(gainDbFromVerticalDrag(drag.startDb, drag.startY, event.clientY));
  }

  function onGainPointerUp(event) {
    if (gainDragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    gainDragRef.current = null;
  }

  function onGainKeyDown(event) {
    const adjustment = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5, PageUp: 3, PageDown: -3 }[event.key];
    if (adjustment == null && event.key !== "Home") return;
    event.preventDefault();
    setGainAdjustmentDb((value) => event.key === "Home" ? 0 : Math.min(18, Math.max(-36, value + adjustment)));
  }

  function applyGainAdjustment() {
    if (!gainEnabled || !canEdit || !hasSelection || !gainAdjustmentDb) return;
    try {
      const clips = changeSelectionGain(state.clips, selection.startMs, selection.endMs, gainAdjustmentDb, newId);
      commit({ ...state, clips }, `${gainAdjustmentDb > 0 ? "+" : ""}${gainAdjustmentDb} dB on selection`);
      setGainAdjustmentDb(0);
      setError("");
      canvasRef.current?.focus();
    } catch (gainError) { setError(gainError.message); }
  }

  function copyCurrentSelection() {
    const copied = copySelection(state.clips, selection.startMs, selection.endMs);
    if (!copied.clips.length) return;
    setClipboard(copied); setLastAction("Selection copied"); setMessage("Selection copied to the Studio clipboard.");
  }

  function cutCurrentSelection() {
    if (!canEdit || !hasSelection) return;
    const copied = copySelection(state.clips, selection.startMs, selection.endMs);
    if (!copied.clips.length) return;
    setClipboard(copied);
    editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, true, newId), "Cut selection");
    const start = Math.min(selection.startMs, selection.endMs);
    setSelection({ startMs: start, endMs: start }); setCursorMs(start);
  }

  function deleteCurrentSelection(keepGap = false) {
    if (!canEdit || !hasSelection) return;
    editClips((clips) => deleteSelection(clips, selection.startMs, selection.endMs, !keepGap, newId), keepGap ? "Delete and keep gap" : "Delete selection");
    const start = Math.min(selection.startMs, selection.endMs);
    setSelection({ startMs: start, endMs: start }); setCursorMs(start);
  }

  function silenceCurrentSelection() {
    if (!canEdit || !hasSelection) return;
    editClips((clips) => silenceSelection(clips, selection.startMs, selection.endMs, newId), "Silence selection");
    const start = Math.min(selection.startMs, selection.endMs);
    setSelection({ startMs: start, endMs: start }); setCursorMs(start);
  }

  function pasteAtCursor() {
    if (!clipboard.clips.length) return;
    editClips((clips) => pasteSelection(clips, clipboard, cursorMs, newId), "Paste selection");
  }

  function moveSelection(direction) {
    if (!canEdit || !hasSelection) return;
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
      const root = sectionRef.current;
      if (!root?.getClientRects().length) return;
      if (event.target?.nodeType && ![document.body, document.documentElement].includes(event.target) && !root.contains(event.target)) return;
      const shortcut = waveformPrimaryShortcut(event, { visible: true, canEdit: Boolean(editor && canEdit), hasSelection });
      if (shortcut) {
        event.preventDefault();
        if (shortcut === "SAVE") send("SAVE", { reason: "Manual waveform snapshot" });
        if (shortcut === "PLAY_PAUSE") playFromCursor();
        if (shortcut === "DELETE_SELECTION" || shortcut === "DELETE_KEEP_GAP") deleteCurrentSelection(shortcut === "DELETE_KEEP_GAP" && advanced);
        return;
      }
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(event.target?.tagName) || event.target?.isContentEditable) return;
      if (undoOrRedo(event)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "s" && canEdit) editClips((clips) => splitAt(clips, cursorMs, newId), "Split at cursor");
      if (event.key === "Backspace") { event.preventDefault(); deleteCurrentSelection(); }
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
    if (!projectId || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setWorking(true); setWorkingAction(action); setError(""); setMessage("");
    try {
      const response = await fetch(`${apiBase}/projects/${projectId}/editor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, state: stateRef.current, ...extra }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The waveform action failed.");
      setEditor(payload); stateRef.current = payload.state; setState(payload.state); setHistory([]); setFuture([]);
      if (action === "SAVE") setSaveFeedback(`Saved version ${payload.currentVersion}. Your edits are retained.`);
      setMessage(action === "QUEUE_RENDER" ? "Final render queued. The background audio worker will prepare the review copy." : action === "QUEUE_CLEANUP_PREVIEW" ? "Before and After previews queued. They will appear together when the protected worker finishes." : action === "QUEUE_MASTER_PREVIEW" ? "Effects and mastering preview queued. Its quality report will appear when processing finishes." : action === "INITIALIZE" ? "The source take is ready in the non-destructive timeline." : `Project saved as version ${payload.currentVersion}.`);
      window.dispatchEvent(new CustomEvent("ruvanas:studio-projects-refresh"));
    } catch (actionError) {
      setError(actionError.message);
      if (action === "SAVE") setSaveFeedback(`Save failed: ${actionError.message}`);
    } finally { requestInFlightRef.current = false; setWorking(false); setWorkingAction(""); }
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
  return <section ref={sectionRef} style={s.panel} aria-labelledby="waveform-title">
    <div style={s.heading}><div><p style={s.eyebrow}>{supervised ? "SUPERVISED CORRECTIONS STUDIO" : "WAVEFORM"} · STUDIO {editor?.studioLevel || "BASIC"}</p><h2 id="waveform-title" style={s.title}>Shape the programme without touching the source</h2><p style={s.hint}>Cached waveform peaks, versioned edits, markers, undo/redo, and server-rendered review copies.</p></div><button type="button" style={s.secondary} disabled={!editor?.studioProEnabled} title={!editor?.studioProEnabled ? "Studio Pro is included with Tiers 3–5." : undefined} onClick={() => { const next = advanced ? "BEGINNER" : "ADVANCED"; setLocalMode(next); onExperienceModeChange?.(next); }}>{editor?.studioProEnabled ? (advanced ? "Use Basic tools" : "Use Pro tools") : "Basic tools"}</button></div>
    {error ? <div style={s.error}>{error}</div> : null}{message ? <div style={s.notice}>{message}</div> : null}
    {editor?.restrictedReadOnly ? <div style={s.error}>This project contains Studio Pro edits. They remain intact, but editing and rendering are read-only on the current Basic plan.</div> : null}
    <label style={s.label}>AudioLab project<select style={s.input} value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
    {editor && !state.clips.length ? <div style={s.empty}><p style={s.hint}>{history.length ? "The timeline is empty. Undo the edit to restore your wave, or start again from a protected take." : "Choose a protected take to place it on the timeline. Its source file will remain unchanged."}</p><div style={s.actions}>{history.length ? <button type="button" style={s.secondary} disabled={!canEdit} onClick={undo}>↶ Undo and restore wave</button> : null}{editor.takes.map((take) => <button key={take.id} style={s.primary} disabled={working || editor.restrictedReadOnly || !take.durationMs} onClick={() => send("INITIALIZE", { takeId: take.id })}>Use {take.mediaAsset.name} {take.waveformStatus === "READY" ? "· waveform ready" : "· analysing"}</button>)}</div></div> : null}
    {state.clips.length ? <>
      <div style={s.paneTabs} role="tablist" aria-label="Waveform workflow">
        <button type="button" role="tab" aria-selected={activePane === "EDIT"} style={workflowTabStyle(activePane === "EDIT", "EDIT")} onClick={() => setActivePane("EDIT")}><span style={s.paneIcon} aria-hidden="true">✂</span><strong>Edit audio</strong><small>Cut and arrange</small></button>
        <button type="button" role="tab" aria-selected={activePane === "CLEAN"} style={workflowTabStyle(activePane === "CLEAN", "CLEAN")} onClick={() => setActivePane("CLEAN")}><span style={{ ...s.paneIcon, background: "linear-gradient(135deg,#53dfc8,#66aef2)" }} aria-hidden="true">✦</span><strong>Clean voice</strong><small>Repair sound</small></button>
        <button type="button" role="tab" aria-selected={activePane === "MASTER"} style={workflowTabStyle(activePane === "MASTER", "MASTER")} onClick={() => setActivePane("MASTER")}><span style={{ ...s.paneIcon, background: "linear-gradient(135deg,#b38dff,#f29ac1)" }} aria-hidden="true">◉</span><strong>Effects & master</strong><small>Polish output</small></button>
      </div>
      {activePane === "EDIT" ? <>
      <div style={s.toolbar} aria-label="Waveform tools"><button type="button" style={s.primary} onClick={playFromCursor}>▶ Play / pause</button><button type="button" aria-pressed={editTool === "SELECT"} style={editTool === "SELECT" ? s.active : s.secondary} onClick={() => setEditTool("SELECT")}>╎ Select</button>{advanced ? <button type="button" aria-pressed={editTool === "BLADE"} style={editTool === "BLADE" ? s.active : s.secondary} onClick={() => setEditTool("BLADE")}>✂ Blade</button> : null}<button type="button" style={s.secondary} onClick={selectWholeWave}>Select whole wave</button><button type="button" style={looping ? s.active : s.secondary} onClick={() => setLooping(!looping)}>↻ Loop</button><button type="button" style={s.secondary} disabled={!history.length || !canEdit} onClick={undo}>↶ Undo</button><button type="button" style={s.secondary} disabled={!future.length || !canEdit} onClick={redo}>↷ Redo</button><button type="button" style={s.secondary} onClick={() => setZoom(1)}>Fit wave</button><label style={s.inline}>Zoom <input type="range" min="1" max="5" step=".5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label></div>
      <p style={s.dragHint}>{editTool === "BLADE" ? "✂ Click the wave where you want to split it. Switch to Select to highlight audio." : "╎ Drag to highlight part of the wave, or double-click to highlight the whole wave."}</p>
      <p style={s.history}>Edit history: {history.length} undo step{history.length === 1 ? "" : "s"} · {future.length} redo step{future.length === 1 ? "" : "s"} · Latest: {lastAction}</p>
      <div style={s.waveStage}>
        <div style={s.canvasWrap}><canvas ref={canvasRef} tabIndex={0} role="img" aria-label={`${editTool === "BLADE" ? "Blade: click to split" : "Select: drag to highlight; double-click to select the whole wave"} on the waveform. Time fields below allow precise adjustment.`} style={{ cursor: editTool === "BLADE" ? "crosshair" : "text", touchAction: "none" }} onPointerDown={onWavePointerDown} onPointerMove={onWavePointerMove} onPointerUp={onWavePointerUp} onPointerCancel={() => { dragRef.current = null; }} onDoubleClick={selectWholeWave} /></div>
        {gainEnabled && hasSelection && canEdit ? <div style={s.waveGainHud} role="group" aria-label="Selected audio amplitude">
          <button type="button" role="slider" aria-label="Drag up to amplify or down to reduce selected audio" aria-valuemin={-36} aria-valuemax={18} aria-valuenow={gainAdjustmentDb} aria-valuetext={`${gainAdjustmentDb > 0 ? "+" : ""}${gainAdjustmentDb} decibels`} style={s.waveGainKnob} onPointerDown={onGainPointerDown} onPointerMove={onGainPointerMove} onPointerUp={onGainPointerUp} onPointerCancel={onGainPointerUp} onKeyDown={onGainKeyDown}><span style={{ ...s.waveGainNeedle, transform: `rotate(${gainAdjustmentDb * 5}deg)` }} /></button>
          <div style={s.waveGainReadout}><strong>Amplitude</strong><label><input aria-label="Selected audio gain change in dB" style={s.waveGainInput} type="number" min="-36" max="18" step="0.5" value={gainAdjustmentDb} onChange={(event) => setGainAdjustmentDb(Math.min(18, Math.max(-36, Number(event.target.value) || 0)))} /> dB</label><small>Drag knob ↑ louder · ↓ quieter</small></div>
          <button type="button" style={s.waveGainApply} disabled={gainAdjustmentDb === 0} onClick={applyGainAdjustment}>Apply</button>
        </div> : null}
      </div>
      <div style={s.selectionBar} aria-live="polite"><div style={s.selectionSummary}><strong>{hasSelection ? `${seconds(Math.abs(selection.endMs - selection.startMs))} seconds selected` : "Select part of the wave"}</strong><span>{hasSelection ? `${seconds(Math.min(selection.startMs, selection.endMs))}–${seconds(Math.max(selection.startMs, selection.endMs))} s · Choose an edit below.` : "Drag from left to right—or right to left—then choose an edit."}</span></div><div style={s.selectionActions}><button type="button" style={{ ...s.cutButton, opacity: hasSelection && canEdit ? 1 : .48 }} disabled={!hasSelection || !canEdit} onClick={cutCurrentSelection}>✂ Cut selection</button><button type="button" style={{ ...s.deleteButton, opacity: hasSelection && canEdit ? 1 : .48 }} disabled={!hasSelection || !canEdit} onClick={() => deleteCurrentSelection()}>⌫ Delete selection</button><button type="button" style={{ ...s.silenceButton, opacity: hasSelection && canEdit ? 1 : .48 }} disabled={!hasSelection || !canEdit} onClick={silenceCurrentSelection}>◌ Silence selection</button></div></div>
      {gainEnabled ? <div style={s.gainPanel}><div><strong>Amplify or reduce</strong><p style={s.gainHint}>Adjust only the highlighted audio. Positive dB raises it; negative dB reduces it. The wave updates when applied; create a review render to hear the result. Final mastering may rebalance overall loudness.</p></div><label style={s.gainControl}>Gain change <output>{gainAdjustmentDb > 0 ? "+" : ""}{gainAdjustmentDb} dB</output><input aria-label="Gain change in decibels" type="range" min="-36" max="18" step="0.5" value={gainAdjustmentDb} onChange={(event) => setGainAdjustmentDb(Number(event.target.value))} /></label><input aria-label="Gain change number in decibels" style={s.gainNumber} type="number" min="-36" max="18" step="0.5" value={gainAdjustmentDb} onChange={(event) => setGainAdjustmentDb(Math.min(18, Math.max(-36, Number(event.target.value) || 0)))} /><button type="button" style={s.primary} disabled={!hasSelection || !canEdit || gainAdjustmentDb === 0} onClick={applyGainAdjustment}>Apply dB change</button></div> : editor && hasSelection ? <p style={s.gainLocked}>Amplitude adjustment is included with Studio Pro (tiers 3–5). Your current plan has Studio Basic, so gain editing is unavailable here.</p> : null}
      {sourceTake ? <audio ref={audioRef} src={supervised ? `${mediaBase}/${sourceTake.mediaAsset.id}` : `${mediaBase}/${sourceTake.mediaAsset.id}/stream`} onTimeUpdate={onAudioTime} onEnded={() => setCursorMs(0)} preload="metadata" /> : null}
      <div style={s.timeGrid}><label style={s.label}>Cursor (seconds)<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(cursorMs)} onChange={(event) => setCursorMs(milliseconds(event.target.value))} /></label><label style={s.label}>Selection start<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(selection.startMs)} onChange={(event) => setSelection({ ...selection, startMs: milliseconds(event.target.value) })} /></label><label style={s.label}>Selection end<input style={s.input} type="number" min="0" max={seconds(durationMs)} step=".01" value={seconds(selection.endMs)} onChange={(event) => setSelection({ ...selection, endMs: milliseconds(event.target.value) })} /></label><div style={s.duration}>Selection duration<br /><strong>{seconds(Math.abs(selection.endMs-selection.startMs))} s</strong></div><div style={s.duration}>Project length<br /><strong>{seconds(durationMs)} s</strong></div></div>
      <details style={s.moreTools}><summary>More edit tools</summary><div style={s.actions}><button type="button" style={s.secondary} disabled={!canEdit} onClick={() => editClips((clips) => splitAt(clips, cursorMs, newId), "Split at cursor")}>Split at cursor</button><button type="button" style={s.secondary} disabled={!hasSelection} onClick={copyCurrentSelection}>Copy</button><button type="button" style={s.secondary} disabled={!clipboard.clips.length || !canEdit} onClick={pasteAtCursor}>Paste at cursor</button><button type="button" style={s.secondary} disabled={!hasSelection} onClick={() => setZoom(Math.min(5, Math.max(1, durationMs / Math.max(1, Math.abs(selection.endMs-selection.startMs)))))}>Fit selection</button><button type="button" style={s.secondary} disabled={!hasSelection || !canEdit} onClick={() => editClips((clips) => trimToSelection(clips, selection.startMs, selection.endMs, newId), "Crop to selection")}>Crop to selection</button></div></details>
      {advanced ? <div style={s.advanced}>
        <div style={s.actions}><button style={s.secondary} disabled={!hasSelection || !canEdit} onClick={() => editClips((clips) => duplicateSelection(clips, selection.startMs, selection.endMs, newId), "Duplicate selection")}>Duplicate selection</button><button style={s.secondary} disabled={!canEdit} onClick={() => moveSelection(-1)}>Move earlier</button><button style={s.secondary} disabled={!canEdit} onClick={() => moveSelection(1)}>Move later</button><button style={s.secondary} disabled={!hasSelection || !canEdit} onClick={() => deleteCurrentSelection(true)}>Delete, keep gap</button></div>
        <div style={s.timeGrid}><label style={s.label}>Fade-in handle<input aria-label="Fade-in handle" type="range" min="0" max={Math.min(60000, Math.abs(selection.endMs-selection.startMs))} step="10" defaultValue="0" onChange={(event) => editClips((clips) => adjustSelection(clips, selection.startMs, selection.endMs, { fadeInMs: Number(event.target.value) }))} /></label><label style={s.label}>Fade-out handle<input aria-label="Fade-out handle" type="range" min="0" max={Math.min(60000, Math.abs(selection.endMs-selection.startMs))} step="10" defaultValue="0" onChange={(event) => editClips((clips) => adjustSelection(clips, selection.startMs, selection.endMs, { fadeOutMs: Number(event.target.value) }))} /></label></div>
        <div style={s.markerRow}><input style={s.input} value={markerLabel} onChange={(event) => setMarkerLabel(event.target.value)} placeholder="Marker or region name" /><select style={s.input} value={markerType} onChange={(event) => setMarkerType(event.target.value)}>{MARKER_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select><button style={s.secondary} onClick={addMarker}>Add marker</button><button style={s.secondary} disabled={!hasSelection} onClick={addRegion}>Add named region</button></div>
        <div style={s.markerList}>{state.markers.map((marker) => <button key={marker.clientId} style={s.marker} onClick={() => setCursorMs(marker.positionMs)}>{seconds(marker.positionMs)} · {marker.type.replaceAll("_", " ")} · {marker.label}</button>)}</div>
      </div> : null}
      <p style={s.shortcuts}>Keyboard: Space play/pause · Delete selected audio · Shift+Delete keep gap in Pro · Ctrl/Cmd+S save · S split · L loop · Ctrl/Cmd+C/X/V copy, cut and paste · Ctrl/Cmd+Z/Y undo and redo.</p>
      </> : activePane === "CLEAN" ? <section style={s.cleanup} aria-labelledby="voice-cleanup-title">
        <div style={s.cleanupHeading}><div><p style={s.eyebrow}>CLEAN VOICE</p><h3 id="voice-cleanup-title" style={s.cardTitle}>Repair common voice problems safely</h3><p style={s.hint}>Choose a starting point, then compare protected server previews. Your original recording never changes.</p></div><span style={cleanup.enabled ? s.cleanupOn : s.cleanupOff}>{voiceCleanupLabel(cleanup)}</span></div>
        <div style={s.presetGrid}>
          {[{ id: "OFF", title: "Off", text: "Keep the edited audio unchanged." }, { id: "GENTLE", title: "Gentle repair", text: "Light background cleanup for a good recording." }, { id: "CLEAN_DIALOGUE", title: "Clean dialogue", text: "Stronger repair for interviews and spoken audio." }, { id: "BROADCAST", title: "Broadcast voice", text: "Clear, level speech with a broadcast tone." }].map((preset) => <button type="button" key={preset.id} aria-pressed={cleanup.preset === preset.id} style={presetCardStyle(cleanup.preset === preset.id, preset.id)} onClick={() => chooseCleanupPreset(preset.id)}>{presetCardContent(preset.id, preset.title, preset.text, cleanup.preset === preset.id)}</button>)}
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
        <div style={s.presetGrid}>{effectPresets.map(([id, title, text]) => <button type="button" key={id} aria-pressed={effects.preset === id} style={presetCardStyle(effects.preset === id, id)} onClick={() => chooseEffectPreset(id)}>{presetCardContent(id, title, text, effects.preset === id)}</button>)}</div>
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
        <div style={s.presetGrid}>{masteringPresets.map(([id, title, text]) => <button type="button" key={id} aria-pressed={mastering.preset === id} style={presetCardStyle(mastering.preset === id, id)} onClick={() => chooseMasteringPreset(id)}>{presetCardContent(id, title, text, mastering.preset === id)}</button>)}</div>
        {advanced ? <div style={s.cleanupControls}>
          <label style={s.label}>Target loudness (LUFS)<input style={s.input} type="number" min="-24" max="-9" step="0.5" value={mastering.targetLufs} onChange={(event) => changeMastering({ targetLufs: Number(event.target.value), enabled: true }, "Adjust loudness target")} /></label>
          <label style={s.label}>True Peak ceiling (dBTP)<input style={s.input} type="number" min="-3" max="-0.5" step="0.1" value={mastering.truePeakDbfs} onChange={(event) => changeMastering({ truePeakDbfs: Number(event.target.value), enabled: true }, "Adjust True Peak ceiling")} /></label>
          <label style={s.label}>Maximum loudness range (LU)<input style={s.input} type="number" min="1" max="20" step="0.5" value={mastering.maxLoudnessRangeLu} onChange={(event) => changeMastering({ maxLoudnessRangeLu: Number(event.target.value), enabled: true }, "Adjust loudness range")} /></label>
          <label style={s.check}><input type="checkbox" checked={mastering.limiter} onChange={(event) => changeMastering({ limiter: event.target.checked }, "Adjust mastering limiter")} /> Final clipping limiter</label>
        </div> : null}
        <div style={s.previewActions}><button type="button" style={s.primary} disabled={working || (!effects.enabled && !mastering.enabled)} onClick={() => send("QUEUE_MASTER_PREVIEW")}>Create mastered preview</button><span style={s.hint}>The worker measures the rendered result; it does not estimate a pass in the browser.</span></div>
        {masterPreview ? <MasterPreview render={masterPreview} /> : null}
      </section>}
      <div style={s.finish}><span style={s.hint}>Current finish: {studioEffectLabel(effects)} · {mastering.enabled ? `${mastering.targetLufs} LUFS · ${mastering.truePeakDbfs} dBTP` : "loudness matching off"}</span><button type="button" style={s.secondary} disabled={working || editor.restrictedReadOnly} onClick={() => send("SAVE", { reason: "Manual waveform snapshot" })}>{workingAction === "SAVE" ? "Saving…" : "Save version"}</button><button type="button" style={s.primary} disabled={working || editor.restrictedReadOnly} onClick={() => send("QUEUE_RENDER", { preset: "SCHOOL_RADIO_MP3" })}>Create review render</button></div>
      {saveFeedback ? <p role="status" aria-live="polite" style={saveFeedback.startsWith("Save failed:") ? s.error : s.notice}>{saveFeedback}</p> : null}
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

const choiceDecor = {
  EDIT: ["✂", "#f4b942"], CLEAN: ["✦", "#43d9c3"], MASTER: ["◉", "#bd94ff"],
  OFF: ["○", "#94a3b8"], GENTLE: ["✧", "#43d9c3"], CLEAN_DIALOGUE: ["◈", "#66b5f2"], BROADCAST: ["◉", "#f4b942"],
  NONE: ["○", "#94a3b8"], BROADCAST_VOICE: ["◉", "#f4b942"], PODCAST_VOICE: ["◌", "#bd94ff"],
  PROMO_VOICE: ["✦", "#f59abf"], TELEPHONE_VOICE: ["⌁", "#66b5f2"], WARM_VOICE: ["☀", "#f3aa72"],
  CLEAN_INTERVIEW: ["◇", "#43d9c3"], PODCAST: ["◌", "#bd94ff"], ONLINE_RADIO: ["◉", "#66b5f2"],
  RETAIL_PROMO: ["✦", "#f59abf"], SCHOOL_PROGRAMME: ["✧", "#43d9c3"]
};

function workflowTabStyle(selected, id) {
  const accent = choiceDecor[id][1];
  return {
    ...(selected ? s.paneActive : s.paneTab), ...s.paneVisual,
    border: `1px solid ${selected ? accent : `${accent}66`}`,
    borderLeft: `4px solid ${accent}`,
    background: `linear-gradient(115deg, ${accent}${selected ? "36" : "19"}, var(--rv-surface) 76%)`,
    boxShadow: selected ? `0 0 0 1px ${accent}66, 0 10px 24px rgba(0,0,0,.14)` : "none",
    padding: "13px 15px", transition: "background .2s, border-color .2s, box-shadow .2s"
  };
}

function presetCardStyle(selected, id) {
  const accent = (choiceDecor[id] || choiceDecor.NONE)[1];
  return {
    ...(selected ? s.presetActive : s.preset),
    minHeight: 92, padding: "12px 13px", borderRadius: 12,
    border: `1px solid ${selected ? accent : `${accent}66`}`,
    borderLeft: `4px solid ${accent}`,
    background: `linear-gradient(135deg, ${accent}${selected ? "36" : "18"}, var(--rv-surface) 78%)`,
    boxShadow: selected ? `0 0 0 1px ${accent}66, 0 8px 20px rgba(0,0,0,.12)` : "none",
    transition: "background .2s, border-color .2s, box-shadow .2s"
  };
}

function presetCardContent(id, title, description, selected) {
  const [symbol, accent] = choiceDecor[id] || choiceDecor.NONE;
  return <>
    <span style={s.presetHead}><span aria-hidden="true" style={{ ...s.presetIcon, background: accent }}>{symbol}</span><strong>{title}</strong>{selected ? <small style={s.presetSelected}>✓ Selected</small> : null}</span>
    <span style={s.presetDescription}>{description}</span>
  </>;
}

const s = {
  presetHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  presetIcon: { display: "grid", placeItems: "center", flex: "0 0 25px", width: 25, height: 25, borderRadius: 8, color: "#142033", fontSize: 17, fontWeight: 900 },
  presetSelected: { marginLeft: "auto", color: "var(--rv-text)", fontWeight: 900, fontSize: 11 },
  presetDescription: { color: "var(--rv-text-muted)", fontSize: 12, lineHeight: 1.35 },
  paneVisual: { display: "grid", gridTemplateColumns: "42px minmax(0,1fr)", gridTemplateRows: "auto auto", alignItems: "center", columnGap: 10, minHeight: 72, backgroundImage: "linear-gradient(115deg,rgba(70,134,173,.08),transparent)" },
  paneIcon: { display: "grid", gridRow: "1 / 3", placeItems: "center", width: 38, height: 38, borderRadius: 11, background: "linear-gradient(135deg,#f8c95e,#ed8b5a)", color: "#17243b", fontSize: 22, boxShadow: "0 7px 20px rgba(244,185,66,.22)" },
  dragHint: { borderLeft: "4px solid #2dd4bf", background: "linear-gradient(90deg,rgba(45,212,191,.14),rgba(96,165,250,.06))", borderRadius: 9, padding: "10px 13px", color: "var(--rv-text)", fontSize: 13, fontWeight: 800, margin: "4px 0 10px" },
  selectionBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, marginTop: 12, padding: 16, border: "1px solid #3c6477", borderRadius: 13, background: "linear-gradient(110deg,#142638,#20324e)", color: "#fff" },
  selectionSummary: { display: "grid", gap: 4, fontSize: 13 },
  selectionActions: { display: "flex", flexWrap: "wrap", gap: 8 },
  cutButton: { border: 0, borderRadius: 9, padding: "10px 13px", background: "#f8c45d", color: "#17243b", fontWeight: 900, cursor: "pointer" },
  deleteButton: { border: 0, borderRadius: 9, padding: "10px 13px", background: "#ff9a89", color: "#17243b", fontWeight: 900, cursor: "pointer" },
  silenceButton: { border: 0, borderRadius: 9, padding: "10px 13px", background: "#54ddcc", color: "#17243b", fontWeight: 900, cursor: "pointer" },
  gainPanel: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 10, padding: "14px 16px", border: "1px solid #9d78df", borderRadius: 13, background: "linear-gradient(110deg,rgba(119,83,194,.2),rgba(71,143,196,.12))", color: "var(--rv-text)" },
  gainLocked: { margin: "10px 0 0", padding: "10px 13px", border: "1px solid var(--rv-border)", borderRadius: 9, background: "var(--rv-surface-muted)", color: "var(--rv-text-muted)", fontSize: 13 },
  gainHint: { maxWidth: 380, margin: "4px 0 0", color: "var(--rv-text-muted)", fontSize: 12, lineHeight: 1.4 },
  gainControl: { display: "grid", gap: 4, minWidth: 220, flex: "1 1 220px", fontWeight: 800, fontSize: 13 },
  gainNumber: { width: 78, border: "1px solid var(--rv-border)", borderRadius: 7, background: "var(--rv-input-bg)", color: "var(--rv-input-text)", padding: "9px 7px", font: "inherit" },
  waveStage: { position: "relative" },
  waveGainHud: { position: "absolute", top: 13, left: "50%", transform: "translateX(-50%)", zIndex: 2, display: "flex", alignItems: "center", gap: 9, maxWidth: "calc(100% - 20px)", padding: "7px 9px", border: "1px solid #7dd3fc", borderRadius: 10, background: "rgba(8,17,31,.94)", color: "#f8fafc", boxShadow: "0 10px 25px rgba(0,0,0,.4)" },
  waveGainKnob: { position: "relative", flex: "0 0 31px", width: 31, height: 31, borderRadius: "50%", border: "2px solid #7dd3fc", background: "#183549", cursor: "ns-resize", touchAction: "none" },
  waveGainNeedle: { position: "absolute", left: "50%", top: 3, width: 2, height: 8, marginLeft: -1, borderRadius: 2, background: "#f8c45d", transformOrigin: "1px 11px" },
  waveGainReadout: { display: "grid", gap: 1, fontSize: 11, whiteSpace: "nowrap" },
  waveGainInput: { width: 48, border: 0, borderBottom: "1px solid #7dd3fc", background: "transparent", color: "#f8fafc", font: "inherit", fontWeight: 900, textAlign: "right" },
  waveGainApply: { border: 0, borderRadius: 7, background: "#f8c45d", color: "#17243b", padding: "7px 9px", fontWeight: 900, cursor: "pointer" },
  moreTools: { marginTop: 12, border: "1px solid var(--rv-border)", borderRadius: 10, padding: "10px 13px", color: "var(--rv-text)", fontWeight: 800 },
  panel: { border: "1px solid var(--rv-border)", borderRadius: 16, background: "var(--rv-surface)", padding: 22, marginBottom: 22 }, heading: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, marginBottom: 16 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, cardTitle: { margin: "0 0 6px", fontSize: 20 }, sectionTitle: { margin: "18px 0 8px", fontSize: 15, color: "var(--rv-warning-text)" }, hint: { color: "var(--rv-text-muted)", lineHeight: 1.5, fontSize: 13 }, label: { display: "grid", gap: 6, color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--rv-border)", borderRadius: 7, background: "var(--rv-input-bg)", color: "var(--rv-input-text)", padding: "10px 11px", font: "inherit" }, compact: { border: "1px solid var(--rv-border)", borderRadius: 7, background: "var(--rv-input-bg)", padding: "7px" }, primary: { border: 0, borderRadius: 7, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid var(--rv-border)", borderRadius: 7, background: "transparent", color: "var(--rv-text)", padding: "9px 12px", fontWeight: 800, cursor: "pointer" }, active: { border: "1px solid #60a5fa", borderRadius: 7, background: "#1d4ed8", color: "#fff", padding: "9px 12px", fontWeight: 800 }, actions: { display: "flex", flexWrap: "wrap", gap: 8 }, toolbar: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "16px 0 10px" }, paneTabs: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginTop: 16 }, paneTab: { display: "grid", gap: 3, textAlign: "left", border: "1px solid var(--rv-border)", borderRadius: 9, background: "var(--rv-surface-muted)", color: "var(--rv-text)", padding: 12, cursor: "pointer" }, paneActive: { display: "grid", gap: 3, textAlign: "left", border: "2px solid #f4b942", borderRadius: 9, background: "var(--rv-warning-bg)", color: "var(--rv-text)", padding: 11, cursor: "pointer" }, history: { color: "var(--rv-info-text)", fontSize: 12, margin: "0 0 10px" }, inline: { display: "flex", gap: 8, alignItems: "center", color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, canvasWrap: { overflowX: "auto", border: "1px solid var(--rv-border)", borderRadius: 10, touchAction: "pan-x" }, timeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, margin: "12px 0" }, duration: { color: "var(--rv-text-muted)", alignSelf: "end", padding: 8 }, advanced: { border: "1px solid #334155", background: "var(--rv-surface)", borderRadius: 10, padding: 14, marginTop: 12 }, markerRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }, markerList: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }, marker: { background: "var(--rv-surface)", border: "1px solid var(--rv-border)", color: "var(--rv-info-text)", borderRadius: 999, padding: "6px 10px" }, cleanup: { border: "1px solid #49617e", background: "var(--rv-surface-muted)", borderRadius: 12, padding: 16, marginTop: 16 }, cleanupHeading: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }, cleanupOn: { alignSelf: "start", borderRadius: 999, background: "var(--rv-success-bg)", color: "var(--rv-success-text)", padding: "6px 10px", fontSize: 12, fontWeight: 900 }, cleanupOff: { alignSelf: "start", borderRadius: 999, background: "var(--rv-surface)", color: "var(--rv-text)", padding: "6px 10px", fontSize: 12, fontWeight: 900 }, presetGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 9, marginTop: 12 }, preset: { display: "grid", gap: 5, textAlign: "left", border: "1px solid var(--rv-border)", borderRadius: 9, background: "var(--rv-surface)", color: "var(--rv-text)", padding: 12, cursor: "pointer" }, presetActive: { display: "grid", gap: 5, textAlign: "left", border: "2px solid #f4b942", borderRadius: 9, background: "var(--rv-warning-bg)", color: "var(--rv-text)", padding: 11, cursor: "pointer" }, cleanupControls: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, borderTop: "1px solid #334155", marginTop: 14, paddingTop: 14 }, previewActions: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 14 }, comparison: { borderTop: "1px solid #334155", marginTop: 14, paddingTop: 2 }, finish: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderTop: "1px solid #334155", marginTop: 16, paddingTop: 16 }, check: { display: "flex", gap: 7, alignItems: "center", color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, shortcuts: { color: "var(--rv-text-muted)", fontSize: 12 }, empty: { border: "1px dashed var(--rv-border)", borderRadius: 10, padding: 16, marginTop: 14 }, notice: { border: "1px solid #22c55e", background: "var(--rv-success-bg)", color: "var(--rv-success-text)", borderRadius: 8, padding: 12, marginBottom: 14 }, error: { border: "1px solid #ef4444", background: "var(--rv-error-bg)", color: "var(--rv-error-text)", borderRadius: 8, padding: 12, marginBottom: 14 }, renders: { marginTop: 16, background: "var(--rv-surface-muted)", borderRadius: 10, padding: 14 }, renderRow: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderTop: "1px solid #26364f", padding: "10px 0" }, qualityMuted: { display: "block", color: "var(--rv-text-muted)", marginTop: 4 }, qualityReady: { display: "block", color: "var(--rv-success-text)", marginTop: 4 }, qualityWarning: { display: "block", color: "var(--rv-warning-text)", marginTop: 4 }, qualityFindings: { display: "block", color: "var(--rv-warning-text)", marginTop: 3, maxWidth: 620 }, safety: { color: "var(--rv-text-muted)", fontSize: 12, margin: "16px 0 0" }
};
