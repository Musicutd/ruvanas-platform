"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { applyStudioMasteringPreset, normalizeStudioMastering, studioMasteringLabel } from "@/lib/studio-effects-mastering.mjs";
import { applyMultitrackCrossfade, crossfadeDuration, moveMultitrackClip } from "@/lib/multitrack-studio.mjs";
import StudioDestinationsClient from "./StudioDestinationsClient";

const emptyProject = { title: "", programmeId: "", episodeId: "", studentGroupId: "" };
const trackKinds = ["VOICE", "MUSIC", "EFFECT", "MIXED"];
const presets = ["NONE", "SPEECH_CLEANUP", "RADIO_VOICE", "CLEAN_INTERVIEW", "BROADCAST_VOICE", "PODCAST_VOICE", "PROMO_VOICE", "TELEPHONE_VOICE", "WARM_VOICE"];
const masterPresets = ["PODCAST", "ONLINE_RADIO", "RETAIL_PROMO", "SCHOOL_PROGRAMME"];
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const seconds = (milliseconds) => (Math.max(0, Number(milliseconds) || 0) / 1000).toFixed(1);

function clone(value) { return structuredClone(value); }

export default function MultitrackStudioClient({ requestedProjectId = "", experienceMode = "BEGINNER", onExperienceModeChange }) {
  const [catalogue, setCatalogue] = useState(null);
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState(null);
  const [draft, setDraft] = useState(emptyProject);
  const [sourceId, setSourceId] = useState("");
  const [targetTrackId, setTargetTrackId] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [zoom, setZoom] = useState(32);
  const [draggedClip, setDraggedClip] = useState(null);

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
  useEffect(() => {
    if (requestedProjectId && catalogue?.projects.some((item) => item.id === requestedProjectId)) setProjectId(requestedProjectId);
  }, [catalogue, requestedProjectId]);
  useEffect(() => {
    setProject((current) => current && current.state.mode !== experienceMode
      ? { ...current, state: { ...current.state, mode: experienceMode } }
      : current);
  }, [experienceMode]);

  const sourceMap = useMemo(() => new Map((catalogue?.sources || []).map((source) => [source.id, source])), [catalogue]);
  const durationMs = useMemo(() => Math.max(0, ...(project?.state.tracks || []).flatMap((track) => track.clips.map((clip) => clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs))), [project]);
  const trackLimit = project?.trackLimit || catalogue?.trackLimit || 8;
  const visibleTimelineMs = Math.max(60_000, durationMs + 10_000);
  const timelineScale = Math.max(1, Math.min(zoom, 120_000 / (visibleTimelineMs / 1000)));
  const timelineWidth = Math.max(900, Math.ceil((visibleTimelineMs / 1000) * timelineScale));
  const rulerStepSeconds = visibleTimelineMs > 300_000 ? 60 : visibleTimelineMs > 120_000 ? 30 : 10;
  const rulerMarks = useMemo(() => Array.from({ length: Math.ceil(visibleTimelineMs / 1000 / rulerStepSeconds) + 1 }, (_, index) => index * rulerStepSeconds), [visibleTimelineMs, rulerStepSeconds]);

  function updateState(change) {
    setProject((current) => current ? { ...current, state: typeof change === "function" ? change(clone(current.state)) : change } : current);
  }

  function updateTrack(trackId, changes) {
    updateState((state) => ({ ...state, tracks: state.tracks.map((track) => track.clientId === trackId ? { ...track, ...(typeof changes === "function" ? changes(track) : changes) } : track) }));
  }

  function chooseMasteringPreset(preset) {
    const mastering = applyStudioMasteringPreset(preset);
    updateState((state) => ({ ...state, master: { ...state.master, ...mastering, normalize: mastering.enabled } }));
  }

  async function createProject(event) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/multitrack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The multitrack project could not be created.");
      setDraft(emptyProject); await loadCatalogue(); setProjectId(payload.project.id); setNotice("Multitrack project created with a voice track and music bed.");
      window.dispatchEvent(new CustomEvent("ruvanas:studio-projects-refresh"));
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  function addTrack() {
    if (project.state.tracks.length >= trackLimit) { setError(`Your ${catalogue?.planName || "current"} plan supports up to ${trackLimit} multitrack tracks.`); return; }
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

  function placeClip(trackId, timelineStartMs) {
    if (!draggedClip) return;
    try {
      updateState((state) => moveMultitrackClip(state, { ...draggedClip, toTrackId: trackId, timelineStartMs }));
      setNotice("Clip moved. Save a snapshot when the arrangement is ready.");
      setError("");
    } catch (actionError) { setError(actionError.message); }
    setDraggedClip(null);
  }

  function setCrossfade(trackId, leftClipId, rightClipId, durationMs) {
    try {
      updateState((state) => applyMultitrackCrossfade(state, { trackId, leftClipId, rightClipId, durationMs }));
      setNotice(Number(durationMs) ? `Crossfade set to ${seconds(durationMs)} seconds.` : "Crossfade removed.");
      setError("");
    } catch (actionError) { setError(actionError.message); }
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
      window.dispatchEvent(new CustomEvent("ruvanas:studio-projects-refresh"));
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  if (!catalogue) return <section style={s.panel}><p style={s.hint}>{error || "Loading Multitrack Studio…"}</p></section>;
  return <section id="multitrack-studio" style={s.panel}>
    <div style={s.heading}><div><p style={s.eyebrow}>MULTITRACK</p><h2 style={s.title}>Build a complete school production</h2><p style={s.hint}>Layer voice, music and effects without changing source recordings. Server rendering, loudness checks and teacher approval create the final version.</p></div>{project ? <div style={s.mode}><button type="button" style={project.state.mode === "BEGINNER" ? s.active : s.secondary} onClick={() => { updateState((state) => ({ ...state, mode: "BEGINNER" })); onExperienceModeChange?.("BEGINNER"); }}>Beginner</button><button type="button" style={project.state.mode === "ADVANCED" ? s.active : s.secondary} onClick={() => { updateState((state) => ({ ...state, mode: "ADVANCED" })); onExperienceModeChange?.("ADVANCED"); }}>Advanced</button></div> : null}</div>
    {error ? <div style={s.error}>{error}</div> : null}{notice ? <div style={s.notice}>{notice}</div> : null}
    {project?.state.tracks.length > trackLimit ? <div style={s.error}>This project has {project.state.tracks.length} tracks, but the current plan supports {trackLimit}. Remove unused tracks before saving or rendering.</div> : null}
    <div style={s.topGrid}>
      <form style={s.card} onSubmit={createProject}><p style={s.eyebrow}>1 · PROJECT</p><h3 style={s.cardTitle}>New production</h3><label style={s.label}>Title<input style={s.input} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Year 8 podcast special" required /></label><label style={s.label}>Programme<select style={s.input} value={draft.programmeId} onChange={(event) => setDraft({ ...draft, programmeId: event.target.value, episodeId: "" })}><option value="">No programme link</option>{catalogue.programmes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={s.label}>Episode<select style={s.input} value={draft.episodeId} onChange={(event) => setDraft({ ...draft, episodeId: event.target.value })}><option value="">No episode link</option>{catalogue.episodes.filter((item) => !draft.programmeId || item.programmeId === draft.programmeId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button style={s.primary} disabled={working}>Create production</button></form>
      <section style={s.card}><p style={s.eyebrow}>2 · OPEN & ADD AUDIO</p><h3 style={s.cardTitle}>Studio project</h3><label style={s.label}>Project<select style={s.input} value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Choose project…</option>{catalogue.projects.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.currentVersion}</option>)}</select></label>{project ? <><label style={s.label}>Protected source<select style={s.input} value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose recording, music or audio…</option>{catalogue.sources.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.sourceType.toLowerCase()} · {seconds(item.durationMs)}s</option>)}</select></label><label style={s.label}>Destination track<select style={s.input} value={targetTrackId} onChange={(event) => setTargetTrackId(event.target.value)}>{project.state.tracks.map((track) => <option key={track.clientId} value={track.clientId}>{track.name}</option>)}</select></label><button style={s.primary} type="button" onClick={addClip}>Add clip</button></> : <p style={s.hint}>Create or choose a production to open the mixer.</p>}</section>
    </div>

    {project ? <><div style={s.transport}>
      <strong>{project.title}</strong>
      <span>Version {project.currentVersion} · timeline {seconds(durationMs)}s · {project.state.tracks.length}/{trackLimit} tracks on {catalogue.planName || "your plan"}</span>
      <label style={s.zoom}>Timeline zoom <input aria-label="Timeline zoom" type="range" min="16" max="96" step="8" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><span>{zoom} px/s</span></label>
      <button type="button" style={s.secondary} disabled={project.state.tracks.length >= trackLimit} onClick={addTrack}>+ Track</button>
      <button type="button" style={s.primary} disabled={working} onClick={() => sendAction("SAVE", { reason: "Multitrack manual save" })}>Save snapshot</button>
      <button type="button" style={s.primary} disabled={working} onClick={() => sendAction("QUEUE_RENDER", { preset: "SCHOOL_RADIO_MP3" })}>Render final MP3</button>
    </div>
      <p style={s.timelineHelp}>Drag a clip along its lane or onto another unlocked track. Select a clip and use ← or → for precise 0.1-second movement; hold Shift for 1 second.</p>
      <div style={s.timeline}>{project.state.tracks.map((track) => <article key={track.clientId} style={s.track}>
        <div style={s.trackHeader}><input aria-label="Track name" style={{ ...s.input, fontWeight: 900 }} value={track.name} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { name: event.target.value })} /><select aria-label="Track kind" style={s.compact} value={track.kind} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { kind: event.target.value })}>{trackKinds.map((kind) => <option key={kind}>{kind}</option>)}</select><button style={track.muted ? s.toggleOn : s.toggle} onClick={() => updateTrack(track.clientId, { muted: !track.muted })}>M</button><button style={track.solo ? s.toggleOn : s.toggle} onClick={() => updateTrack(track.clientId, { solo: !track.solo })}>S</button><button style={track.armed ? s.recordOn : s.toggle} onClick={() => updateTrack(track.clientId, { armed: !track.armed })}>Arm</button><button style={track.locked ? s.toggleOn : s.toggle} onClick={() => updateTrack(track.clientId, { locked: !track.locked })}>Lock</button><button style={s.danger} disabled={track.locked || project.state.tracks.length <= 1} onClick={() => updateState((state) => ({ ...state, tracks: state.tracks.filter((item) => item.clientId !== track.clientId) }))}>Remove track</button></div>
        <div style={s.mixer}><label style={s.inline}>Gain <input type="range" min="-36" max="12" step="0.5" value={track.gainDb} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { gainDb: Number(event.target.value) })} /><span>{track.gainDb} dB</span></label><label style={s.inline}>Pan <input type="range" min="-1" max="1" step="0.05" value={track.pan} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { pan: Number(event.target.value) })} /><span>{track.pan}</span></label><label style={s.inline}>Preset <select style={s.compact} value={track.preset} disabled={track.locked} onChange={(event) => updateTrack(track.clientId, { preset: event.target.value })}>{presets.map((preset) => <option key={preset}>{preset.replaceAll("_", " ")}</option>)}</select></label></div>
        <div style={s.laneScroll}>
          <div
            aria-label={`${track.name} timeline`}
            style={{ ...s.lane, width: timelineWidth }}
            onDragOver={(event) => { if (!track.locked) event.preventDefault(); }}
            onDrop={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); placeClip(track.clientId, Math.max(0, Math.round(((event.clientX - rect.left) / timelineScale) * 1000))); }}
          >
            <div aria-hidden="true" style={s.ruler}>{rulerMarks.map((mark) => <span key={mark} style={{ ...s.rulerMark, left: mark * timelineScale }}>{mark}s</span>)}</div>
            {!track.clips.length ? <p style={s.emptyLane}>Drop audio here or use Add clip above.</p> : track.clips.map((clip) => { const source = sourceMap.get(clip.mediaAssetId); const locked = track.locked || clip.locked; return <button
              key={clip.clientId}
              type="button"
              draggable={!locked}
              aria-label={`${source?.label || "Protected audio"}, starts at ${seconds(clip.timelineStartMs)} seconds`}
              title="Drag to move · Arrow keys nudge"
              style={{ ...s.timelineClip, left: (clip.timelineStartMs / 1000) * timelineScale, width: Math.max(72, ((clip.sourceEndMs - clip.sourceStartMs) / 1000) * timelineScale), cursor: locked ? "not-allowed" : "grab" }}
              onDragStart={() => setDraggedClip({ fromTrackId: track.clientId, clipId: clip.clientId })}
              onDragEnd={() => setDraggedClip(null)}
              onKeyDown={(event) => { if (locked || !["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); const direction = event.key === "ArrowLeft" ? -1 : 1; updateClip(track.clientId, clip.clientId, { timelineStartMs: Math.max(0, clip.timelineStartMs + direction * (event.shiftKey ? 1000 : 100)) }); }}
            ><strong>{source?.label || "Protected audio"}</strong><small>{seconds(clip.timelineStartMs)}s · {seconds(clip.sourceEndMs - clip.sourceStartMs)}s</small></button>; })}
          </div>
        </div>
        <div style={s.clips}>{track.clips.map((clip) => { const source = sourceMap.get(clip.mediaAssetId); return <div key={clip.clientId} style={s.clip}><div><strong>{source?.label || "Protected audio"}</strong><small>{seconds(clip.sourceEndMs - clip.sourceStartMs)}s · starts {seconds(clip.timelineStartMs)}s</small></div><label>Start ms<input style={s.smallInput} type="number" min="0" value={clip.timelineStartMs} disabled={track.locked || clip.locked} onChange={(event) => updateClip(track.clientId, clip.clientId, { timelineStartMs: Number(event.target.value) })} /></label><label>Fade in<input style={s.smallInput} type="number" min="0" value={clip.fadeInMs} disabled={track.locked || clip.locked} onChange={(event) => updateClip(track.clientId, clip.clientId, { fadeInMs: Number(event.target.value) })} /></label><label>Fade out<input style={s.smallInput} type="number" min="0" value={clip.fadeOutMs} disabled={track.locked || clip.locked} onChange={(event) => updateClip(track.clientId, clip.clientId, { fadeOutMs: Number(event.target.value) })} /></label><button style={s.danger} disabled={track.locked || clip.locked} onClick={() => updateTrack(track.clientId, (current) => ({ clips: current.clips.filter((item) => item.clientId !== clip.clientId) }))}>Remove</button></div>; })}</div>
        {track.clips.length > 1 ? <div style={s.crossfades}><strong>Clip transitions</strong>{track.clips.slice(0, -1).map((clip, index) => { const next = track.clips[index + 1]; const active = crossfadeDuration(clip, next); const maximum = Math.min(10_000, clip.sourceEndMs - clip.sourceStartMs, next.sourceEndMs - next.sourceStartMs); return <label key={`${clip.clientId}-${next.clientId}`} style={s.crossfade}>Crossfade {index + 1} → {index + 2}<input aria-label={`Crossfade clips ${index + 1} and ${index + 2}`} type="range" min="0" max={maximum} step="100" value={active} disabled={track.locked || clip.locked || next.locked} onChange={(event) => setCrossfade(track.clientId, clip.clientId, next.clientId, Number(event.target.value))} /><span>{seconds(active)}s</span></label>; })}</div> : null}
        {project.state.mode === "ADVANCED" ? <div style={s.advanced}><div style={s.automationHeading}><strong>Volume automation</strong><button style={s.secondary} onClick={() => updateTrack(track.clientId, (current) => ({ automation: [...current.automation, { clientId: uid("automation"), parameter: "GAIN", timeMs: 0, value: -3 }] }))}>+ Point</button></div>{track.automation.map((point) => <div key={point.clientId} style={s.automation}><label>Time ms<input style={s.smallInput} type="number" min="0" value={point.timeMs} onChange={(event) => updateTrack(track.clientId, (current) => ({ automation: current.automation.map((item) => item.clientId === point.clientId ? { ...item, timeMs: Number(event.target.value) } : item) }))} /></label><label>Gain dB<input style={s.smallInput} type="number" min="-36" max="18" step="0.5" value={point.value} onChange={(event) => updateTrack(track.clientId, (current) => ({ automation: current.automation.map((item) => item.clientId === point.clientId ? { ...item, value: Number(event.target.value) } : item) }))} /></label><button style={s.danger} onClick={() => updateTrack(track.clientId, (current) => ({ automation: current.automation.filter((item) => item.clientId !== point.clientId) }))}>Remove</button></div>)}</div> : null}
      </article>)}</div>
      <section style={s.finish}><div><p style={s.eyebrow}>MIX & OUTPUT</p><h3 style={s.cardTitle}>Music ducking and final versions</h3><label style={s.check}><input type="checkbox" checked={project.state.ducking.enabled} onChange={(event) => updateState((state) => ({ ...state, ducking: { ...state.ducking, enabled: event.target.checked } }))} /> Automatically lower music beneath voice</label><label style={s.inline}>Music reduction <input type="range" min="-30" max="-3" value={project.state.ducking.musicReductionDb} onChange={(event) => updateState((state) => ({ ...state, ducking: { ...state.ducking, musicReductionDb: Number(event.target.value) } }))} /><span>{project.state.ducking.musicReductionDb} dB</span></label><label style={s.label}>Delivery preset<select style={s.input} value={normalizeStudioMastering(project.state.master, project.state.master).preset} onChange={(event) => chooseMasteringPreset(event.target.value)}>{normalizeStudioMastering(project.state.master, project.state.master).preset === "CUSTOM" ? <option value="CUSTOM">Custom target</option> : null}{masterPresets.map((preset) => <option key={preset} value={preset}>{studioMasteringLabel(applyStudioMasteringPreset(preset))}</option>)}</select></label>{project.state.mode === "ADVANCED" ? <div style={s.mixer}><label style={s.inline}>Attack ms<input style={s.smallInput} type="number" value={project.state.ducking.attackMs} onChange={(event) => updateState((state) => ({ ...state, ducking: { ...state.ducking, attackMs: Number(event.target.value) } }))} /></label><label style={s.inline}>Release ms<input style={s.smallInput} type="number" value={project.state.ducking.releaseMs} onChange={(event) => updateState((state) => ({ ...state, ducking: { ...state.ducking, releaseMs: Number(event.target.value) } }))} /></label><label style={s.inline}>Target LUFS<input style={s.smallInput} type="number" min="-24" max="-9" step="0.5" value={project.state.master.targetLufs} onChange={(event) => updateState((state) => ({ ...state, master: { ...state.master, preset: "CUSTOM", targetLufs: Number(event.target.value) } }))} /></label><label style={s.inline}>True Peak<input style={s.smallInput} type="number" min="-3" max="-0.5" step="0.1" value={project.state.master.truePeakDbfs} onChange={(event) => updateState((state) => ({ ...state, master: { ...state.master, preset: "CUSTOM", truePeakDbfs: Number(event.target.value) } }))} /></label></div> : null}</div>
        <div style={s.renders}>{!project.renders.length ? <p style={s.hint}>No final renders yet.</p> : project.renders.map((render) => <div key={render.id} style={s.renderRow}><div><strong>{render.preset.replaceAll("_", " ")}</strong><small>{render.status.replaceAll("_", " ")}{render.loudnessLufs == null ? "" : ` · ${render.loudnessLufs} LUFS`}{render.outputVersion ? ` · output v${render.outputVersion.version} ${render.outputVersion.status.replaceAll("_", " ")}` : ""}</small><RenderQuality report={render.resultJson} /></div>{render.streamUrl ? <audio controls src={render.streamUrl} style={s.audio} /> : null}{project.canApprove && render.outputVersion?.status === "IN_REVIEW" && render.outputVersion.qcStatus === "PASSED" ? <button style={s.approve} disabled={working} onClick={() => sendAction("APPROVE_OUTPUT", { renderId: render.id })}>Approve output</button> : null}{render.outputVersion?.status === "APPROVED" && render.outputVersion.qcStatus === "PASSED" ? <StudioDestinationsClient renderId={render.id} /> : null}{render.errorMessage ? <span style={s.failure}>{render.errorMessage}</span> : null}</div>)}</div>
      </section></> : null}
    <p style={s.safety}>Non-destructive source files · version snapshots · protected school access · server-rendered masters · approved output changes are always explicit.</p>
  </section>;
}

function RenderQuality({ report }) {
  if (!report || (report.integratedLufs == null && report.truePeakDbfs == null && report.loudnessRangeLu == null)) return null;
  const quality = report.masteringQuality;
  return <small style={quality?.status === "READY" ? s.qualityReady : s.qualityWarning}>
    {report.integratedLufs} LUFS · {report.truePeakDbfs} dBTP · {report.loudnessRangeLu} LU range{quality?.status ? ` · ${quality.status.replaceAll("_", " ")}` : ""}
    {quality?.findings?.length ? <span style={s.qualityFindings}>{quality.findings.join(" ")}</span> : null}
  </small>;
}

const s = {
  zoom: { display: "flex", gap: 8, alignItems: "center", color: "var(--rv-text)", fontSize: 12, fontWeight: 800 },
  timelineHelp: { margin: "0 0 12px", color: "#b8c5d8", fontSize: 13, lineHeight: 1.5 },
  laneScroll: { overflowX: "auto", border: "1px solid var(--rv-border)", borderRadius: 9, background: "var(--rv-surface)", marginBottom: 10 },
  lane: { position: "relative", height: 94, minWidth: "100%", backgroundImage: "repeating-linear-gradient(90deg, transparent 0, transparent 31px, rgba(148,163,184,.12) 32px)" },
  ruler: { position: "absolute", inset: "0 0 auto 0", height: 24, borderBottom: "1px solid #334155", color: "var(--rv-text-muted)", fontSize: 10 },
  rulerMark: { position: "absolute", top: 5, transform: "translateX(4px)", whiteSpace: "nowrap" },
  emptyLane: { position: "absolute", left: 14, top: 40, margin: 0, color: "#8392aa", fontSize: 12 },
  timelineClip: { position: "absolute", top: 31, height: 52, overflow: "hidden", display: "grid", alignContent: "center", gap: 2, textAlign: "left", border: "1px solid #f4b942", borderRadius: 7, background: "var(--rv-info-bg)", color: "var(--rv-text)", padding: "6px 9px", boxShadow: "0 4px 12px rgba(0,0,0,.22)" },
  crossfades: { display: "grid", gap: 7, border: "1px solid #334155", borderRadius: 8, background: "var(--rv-surface)", padding: 10, marginTop: 10 },
  crossfade: { display: "grid", gridTemplateColumns: "minmax(145px,auto) minmax(140px,1fr) 48px", gap: 9, alignItems: "center", color: "var(--rv-text)", fontSize: 12 },
  panel: { border: "1px solid var(--rv-border)", borderRadius: 16, background: "var(--rv-surface)", padding: 22, marginBottom: 22 }, heading: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, marginBottom: 16 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, cardTitle: { margin: "0 0 14px" }, hint: { color: "var(--rv-text-muted)", lineHeight: 1.5, fontSize: 13 }, topGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }, card: { border: "1px solid var(--rv-border)", borderRadius: 12, background: "var(--rv-surface)", padding: 18 }, label: { display: "grid", gap: 6, marginBottom: 12, color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--rv-border)", borderRadius: 7, background: "var(--rv-input-bg)", color: "var(--rv-input-text)", padding: "9px 10px", font: "inherit" }, compact: { border: "1px solid var(--rv-border)", borderRadius: 6, background: "var(--rv-input-bg)", color: "var(--rv-input-text)", padding: "7px", maxWidth: 190 }, smallInput: { width: 96, border: "1px solid var(--rv-border)", borderRadius: 5, background: "var(--rv-input-bg)", color: "var(--rv-input-text)", padding: 6 }, primary: { border: 0, borderRadius: 7, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid var(--rv-border)", borderRadius: 7, background: "transparent", color: "var(--rv-text)", padding: "8px 11px", fontWeight: 800, cursor: "pointer" }, active: { border: "1px solid #60a5fa", borderRadius: 7, background: "#1d4ed8", color: "#fff", padding: "8px 11px", fontWeight: 900 }, mode: { display: "flex", gap: 7 }, transport: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", border: "1px solid var(--rv-border)", borderRadius: 10, background: "var(--rv-surface-muted)", padding: 14, margin: "18px 0 12px" }, timeline: { display: "grid", gap: 12 }, track: { border: "1px solid #41516b", borderRadius: 10, background: "var(--rv-surface)", padding: 13 }, trackHeader: { display: "grid", gridTemplateColumns: "minmax(170px,1fr) auto auto auto auto auto auto", gap: 7, alignItems: "center" }, toggle: { border: "1px solid var(--rv-border)", borderRadius: 6, background: "var(--rv-surface)", color: "var(--rv-text)", padding: "7px 9px", fontWeight: 900 }, toggleOn: { border: "1px solid #60a5fa", borderRadius: 6, background: "#1d4ed8", color: "#fff", padding: "7px 9px", fontWeight: 900 }, recordOn: { border: "1px solid #f87171", borderRadius: 6, background: "var(--rv-error-bg)", color: "var(--rv-text)", padding: "7px 9px", fontWeight: 900 }, mixer: { display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", margin: "11px 0" }, inline: { display: "flex", gap: 7, alignItems: "center", color: "var(--rv-text)", fontWeight: 800, fontSize: 12 }, clips: { display: "grid", gap: 7 }, clip: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", border: "1px solid var(--rv-border)", borderLeft: "7px solid #f4b942", borderRadius: 7, background: "var(--rv-surface)", padding: 10, fontSize: 12 }, empty: { border: "1px dashed var(--rv-border)", borderRadius: 7, padding: 12, color: "var(--rv-text-muted)" }, advanced: { marginTop: 12, borderTop: "1px solid #334155", paddingTop: 12 }, automationHeading: { display: "flex", justifyContent: "space-between", alignItems: "center" }, automation: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 8, fontSize: 12 }, danger: { border: "1px solid #f87171", borderRadius: 6, background: "transparent", color: "var(--rv-error-text)", padding: "7px 9px", fontWeight: 800 }, finish: { display: "grid", gridTemplateColumns: "minmax(280px,.8fr) minmax(320px,1.2fr)", gap: 18, border: "1px solid var(--rv-border)", borderRadius: 12, background: "var(--rv-surface)", padding: 18, marginTop: 16 }, check: { display: "flex", gap: 8, alignItems: "center", color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, renders: { display: "grid", gap: 9 }, renderRow: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #334155", paddingBottom: 9 }, audio: { width: 230, maxWidth: "100%" }, approve: { border: 0, borderRadius: 7, background: "#22c55e", color: "#052e16", padding: "9px 11px", fontWeight: 900 }, failure: { color: "var(--rv-error-text)", fontSize: 12 }, qualityReady: { display: "block", color: "var(--rv-success-text)", marginTop: 4 }, qualityWarning: { display: "block", color: "var(--rv-warning-text)", marginTop: 4 }, qualityFindings: { display: "block", maxWidth: 430, marginTop: 3 }, notice: { border: "1px solid #22c55e", background: "var(--rv-success-bg)", color: "var(--rv-success-text)", borderRadius: 8, padding: 12, marginBottom: 14 }, error: { border: "1px solid #ef4444", background: "var(--rv-error-bg)", color: "var(--rv-error-text)", borderRadius: 8, padding: 12, marginBottom: 14 }, safety: { color: "var(--rv-text-muted)", fontSize: 12, margin: "16px 0 0" }
};
