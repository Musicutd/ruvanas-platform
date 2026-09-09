"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { studioMeterState } from "@/lib/studio-recording.mjs";
import { inspectStudioBrowserSupport, studioBrowserSupportMessage } from "@/lib/studio-browser-support.mjs";

const emptyProject = { title: "", programmeId: "", episodeId: "", studentGroupId: "" };
const defaultEdits = { trimStartMs: 0, trimEndMs: "", fadeInMs: 0, fadeOutMs: 0, normalize: true, targetLufs: -16, noiseCleanup: false };

function durationLabel(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function openRecoveryStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ruvanas-audiolab", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("recordings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function recoveryWrite(projectId, value) {
  const database = await openRecoveryStore();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("recordings", "readwrite");
    transaction.objectStore("recordings").put(value, projectId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function recoveryRead(projectId) {
  const database = await openRecoveryStore();
  const value = await new Promise((resolve, reject) => {
    const transaction = database.transaction("recordings", "readonly");
    const request = transaction.objectStore("recordings").get(projectId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
}

async function recoveryDelete(projectId) {
  const database = await openRecoveryStore();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("recordings", "readwrite");
    transaction.objectStore("recordings").delete(projectId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function recordingSupport() {
  return inspectStudioBrowserSupport({
    mediaDevices: navigator.mediaDevices,
    MediaRecorderClass: window.MediaRecorder,
    AudioContextClass: window.AudioContext || window.webkitAudioContext,
    indexedDb: window.indexedDB
  });
}

export default function AudioLabClient({ requestedProjectId = "", experienceMode = "BEGINNER" }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(emptyProject);
  const [projectId, setProjectId] = useState("");
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [edits, setEdits] = useState(defaultEdits);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [permission, setPermission] = useState("NOT_TESTED");
  const [recordDestination, setRecordDestination] = useState("WAVEFORM");
  const [multitrackProjectId, setMultitrackProjectId] = useState("");
  const [targetTrackId, setTargetTrackId] = useState("");
  const [countIn, setCountIn] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [monitoring, setMonitoring] = useState(false);
  const [recordingState, setRecordingState] = useState("IDLE");
  const [durationMs, setDurationMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [serverTake, setServerTake] = useState(null);
  const [progress, setProgress] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [autosave, setAutosave] = useState("Saved");
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  const timerRef = useRef(null);
  const meterFrameRef = useRef(null);
  const meterContextRef = useRef(null);
  const monitorGainRef = useRef(null);
  const selectingRef = useRef(false);

  const selected = useMemo(() => data?.projects.find((item) => item.id === projectId) || null, [data, projectId]);
  const multitrackProject = useMemo(() => data?.multitrackProjects?.find((item) => item.id === multitrackProjectId) || null, [data, multitrackProjectId]);
  const availableTracks = useMemo(() => (multitrackProject?.tracks || []).filter((track) => track.armed && !track.locked), [multitrackProject]);
  const targetTrack = useMemo(() => availableTracks.find((track) => track.id === targetTrackId) || null, [availableTracks, targetTrackId]);
  const captureProject = recordDestination === "MULTITRACK" ? multitrackProject : selected;
  const captureKey = captureProject ? (recordDestination === "MULTITRACK" ? `${captureProject.id}:${targetTrackId || "track"}` : captureProject.id) : "";
  const meter = useMemo(() => studioMeterState(level), [level]);
  const linkedEpisodes = useMemo(() => (data?.episodes || []).filter((item) => !projectForm.programmeId || item.programmeId === projectForm.programmeId), [data, projectForm.programmeId]);

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/audio-lab", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "AudioLab could not be loaded.");
    const projects = (payload.projects || []).filter((project) => project.type !== "MULTITRACK");
    const multitrackProjects = (payload.projects || []).filter((project) => project.type === "MULTITRACK");
    setData({ ...payload, projects, multitrackProjects });
    setProjectId((current) => current || projects[0]?.id || "");
    setMultitrackProjectId((current) => current || multitrackProjects[0]?.id || "");
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);
  useEffect(() => {
    if (requestedProjectId && data?.projects.some((project) => project.id === requestedProjectId)) setProjectId(requestedProjectId);
  }, [data, requestedProjectId]);
  useEffect(() => {
    const refresh = (event) => load().then(() => { if (event.detail?.projectId) setProjectId(event.detail.projectId); }).catch((loadError) => setError(loadError.message));
    window.addEventListener("ruvanas:audiolab-refresh", refresh);
    return () => window.removeEventListener("ruvanas:audiolab-refresh", refresh);
  }, [load]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(meterFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    meterContextRef.current?.close().catch(() => {});
  }, []);

  useEffect(() => {
    if (!availableTracks.some((track) => track.id === targetTrackId)) setTargetTrackId(availableTracks[0]?.id || "");
  }, [availableTracks, targetTrackId]);

  useEffect(() => {
    if (monitorGainRef.current) monitorGainRef.current.gain.value = monitoring ? 1 : 0;
  }, [monitoring]);

  useEffect(() => {
    if (!selected || selectingRef.current) return;
    selectingRef.current = true;
    setProjectForm({ title: selected.title, programmeId: selected.programmeId || "", episodeId: selected.episodeId || "", studentGroupId: selected.studentGroupId || "" });
    setEdits({ ...defaultEdits, ...(selected.editDecision || {}), trimEndMs: selected.editDecision?.trimEndMs ?? "" });
    setServerTake(selected.takes[0] ? { ...selected.takes[0], streamUrl: `/api/media/${selected.takes[0].mediaAsset.id}/stream`, promoVersionId: selected.takes[0].promoVersion?.id } : null);
    setRecording(null); setProgress(0); setAutosave("Saved"); setNotice(""); setError("");
    queueMicrotask(() => { selectingRef.current = false; });
  }, [selected?.id]);

  useEffect(() => {
    if (!captureKey) return;
    recoveryRead(captureKey).then((saved) => {
      if (!saved?.blob) return;
      setRecording(saved.blob); setDurationMs(saved.durationMs || 0); setDeviceId(saved.deviceId || ""); setRecordingState("STOPPED");
      setNotice(recordDestination === "MULTITRACK" ? "A local track recording was recovered safely from this browser." : "A local recording was recovered safely from this browser.");
    }).catch(() => {});
  }, [captureKey, recordDestination]);

  useEffect(() => {
    if (!selected || selectingRef.current) return;
    setAutosave("Saving…");
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch("/api/school-radio/audio-lab", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: selected.id, ...projectForm, programmeId: projectForm.programmeId || null, episodeId: projectForm.episodeId || null, studentGroupId: projectForm.studentGroupId || null, editDecision: { ...edits, trimEndMs: edits.trimEndMs === "" ? null : Number(edits.trimEndMs) }, reason: "AudioLab autosave" }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Autosave failed.");
        setAutosave(`Saved · v${payload.project.currentVersion}`);
      } catch (saveError) { setAutosave("Not saved"); setError(saveError.message); }
    }, 900);
    return () => clearTimeout(timeout);
  }, [projectForm, edits, selected?.id]);

  async function createProject(event) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/audio-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, programmeId: draft.programmeId || null, episodeId: draft.episodeId || null, studentGroupId: draft.studentGroupId || null }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The project could not be created.");
      setDraft(emptyProject); await load(); setProjectId(payload.project.id); setNotice("Quick Record project created.");
      window.dispatchEvent(new CustomEvent("ruvanas:studio-projects-refresh"));
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function testMicrophone() {
    setError(""); setNotice("");
    try {
      const support = recordingSupport();
      if (!support.ready) throw new Error(studioBrowserSupportMessage(support));
      stopInput();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : true });
      streamRef.current = stream;
      startMeter(stream);
      const available = await navigator.mediaDevices.enumerateDevices();
      const microphones = available.filter((item) => item.kind === "audioinput");
      setDevices(microphones); setDeviceId((current) => current || microphones[0]?.deviceId || ""); setPermission("READY"); setNotice("Microphone is live. Check the level before recording and use headphones for monitoring.");
    } catch (permissionError) {
      setPermission("BLOCKED");
      setError(permissionError instanceof Error && permissionError.message.startsWith("This browser")
        ? permissionError.message
        : "Microphone access was blocked. Allow microphone access in the browser and test again.");
    }
  }

  function startMeter(stream) {
    cancelAnimationFrame(meterFrameRef.current);
    meterContextRef.current?.close().catch(() => {});
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Live audio monitoring is not supported in this browser.");
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const monitorGain = context.createGain();
    monitorGain.gain.value = monitoring ? 1 : 0;
    source.connect(monitorGain).connect(context.destination);
    meterContextRef.current = context;
    monitorGainRef.current = monitorGain;
    const values = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(values);
      let peak = 0;
      for (const sample of values) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      setLevel(Math.min(1, peak * 2.4));
      meterFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
    stream.addEventListener("inactive", () => { cancelAnimationFrame(meterFrameRef.current); context.close().catch(() => {}); setLevel(0); }, { once: true });
  }

  function stopInput() {
    cancelAnimationFrame(meterFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    monitorGainRef.current = null;
    meterContextRef.current?.close().catch(() => {});
    meterContextRef.current = null;
    setLevel(0);
  }

  async function startRecording() {
    if (!captureProject || (recordDestination === "MULTITRACK" && !targetTrack)) {
      setError("Choose an armed, unlocked multitrack track before recording.");
      return;
    }
    setError(""); setNotice(""); setServerTake(null);
    try {
      const support = recordingSupport();
      if (!support.ready) throw new Error(studioBrowserSupportMessage(support));
      let stream = streamRef.current;
      if (!stream?.active) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        streamRef.current = stream; startMeter(stream);
      }
      if (countIn) {
        setRecordingState("COUNT_IN");
        for (let count = 3; count >= 1; count -= 1) {
          setCountdown(count);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        setCountdown(0);
      }
      const mimeType = support.preferredMimeType;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        const recoveryBlob = new Blob(chunksRef.current, { type: recorder.mimeType || event.data.type || "audio/webm" });
        const recoveryDuration = elapsedBeforePauseRef.current + (recorder.state === "recording" ? Date.now() - startedAtRef.current : 0);
        recoveryWrite(captureKey, { blob: recoveryBlob, durationMs: recoveryDuration, deviceId, targetTrackId: targetTrack?.id || null }).catch(() => {});
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || chunksRef.current[0]?.type || "audio/webm" });
        setRecording(blob); setRecordingState("STOPPED");
        await recoveryWrite(captureKey, { blob, durationMs: elapsedBeforePauseRef.current, deviceId, targetTrackId: targetTrack?.id || null }).catch(() => {});
        stopInput();
        clearInterval(timerRef.current); setNotice("Recording stopped and saved locally for recovery.");
      };
      recorderRef.current = recorder; elapsedBeforePauseRef.current = 0; startedAtRef.current = Date.now();
      recorder.start(1000); setRecordingState("RECORDING");
      timerRef.current = setInterval(() => setDurationMs(elapsedBeforePauseRef.current + Date.now() - startedAtRef.current), 250);
    } catch (recordError) {
      setCountdown(0); setRecordingState("IDLE"); stopInput();
      setError(recordError instanceof Error ? recordError.message : "Recording could not start.");
    }
  }

  function pauseOrResume() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause(); elapsedBeforePauseRef.current += Date.now() - startedAtRef.current; setDurationMs(elapsedBeforePauseRef.current); setRecordingState("PAUSED"); clearInterval(timerRef.current);
    } else if (recorder.state === "paused") {
      recorder.resume(); startedAtRef.current = Date.now(); setRecordingState("RECORDING"); timerRef.current = setInterval(() => setDurationMs(elapsedBeforePauseRef.current + Date.now() - startedAtRef.current), 250);
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || !["recording", "paused"].includes(recorder.state)) return;
    if (recorder.state === "recording") elapsedBeforePauseRef.current += Date.now() - startedAtRef.current;
    setDurationMs(elapsedBeforePauseRef.current); recorder.stop();
  }

  async function retake() {
    if (!recording || !captureKey) return;
    if (!window.confirm("Discard this local take and record it again? The uploaded source, if any, will not be changed.")) return;
    await recoveryDelete(captureKey).catch(() => {});
    setRecording(null); setDurationMs(0); setProgress(0); setRecordingState("IDLE");
    setNotice("The local take was cleared. Press Record when you are ready to retake it.");
  }

  useEffect(() => {
    if (!recording) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(recording); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  async function uploadRecording() {
    if (!captureProject || !recording || (recordDestination === "MULTITRACK" && !targetTrack)) return;
    setWorking(true); setError(""); setNotice(""); setProgress(0);
    try {
      const baseType = recording.type.split(";", 1)[0] || "audio/webm";
      const extension = baseType.includes("ogg") ? "ogg" : baseType.includes("mp4") ? "m4a" : baseType.includes("mpeg") ? "mp3" : baseType.includes("wav") ? "wav" : "webm";
      const recovered = await recoveryRead(captureKey).catch(() => null);
      let upload = recovered?.upload || null;
      let receivedParts = new Set();
      if (upload?.uploadId) {
        const statusResponse = await fetch(`/api/school-radio/audio-lab/uploads/${upload.uploadId}`, { cache: "no-store" });
        const statusPayload = await statusResponse.json().catch(() => ({}));
        if (statusResponse.ok && ["INITIATED", "UPLOADING"].includes(statusPayload.session?.status)) {
          upload = { ...upload, partSizeBytes: statusPayload.session.partSizeBytes, partCount: statusPayload.session.partCount };
          receivedParts = new Set(statusPayload.session.parts.map((item) => item.partNumber));
          setNotice(`Resuming the protected upload from part ${receivedParts.size + 1}.`);
        } else {
          upload = null;
        }
      }
      if (!upload) {
        const start = await fetch("/api/school-radio/audio-lab/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: captureProject.id, originalName: `${captureProject.title}.${extension}`, mimeType: baseType, sizeBytes: recording.size }) });
        upload = await start.json().catch(() => ({}));
        if (!start.ok) throw new Error(upload.error || "The resumable upload could not start.");
        await recoveryWrite(captureKey, { blob: recording, durationMs, deviceId, targetTrackId: targetTrack?.id || null, upload }).catch(() => {});
      }
      for (let partNumber = 1; partNumber <= upload.partCount; partNumber += 1) {
        if (receivedParts.has(partNumber)) {
          setProgress(Math.round((partNumber / upload.partCount) * 90));
          continue;
        }
        const startByte = (partNumber - 1) * upload.partSizeBytes;
        const part = recording.slice(startByte, Math.min(recording.size, startByte + upload.partSizeBytes));
        let uploaded = false;
        for (let attempt = 1; attempt <= 3 && !uploaded; attempt += 1) {
          const response = await fetch(`/api/school-radio/audio-lab/uploads/${upload.uploadId}/parts/${partNumber}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: part });
          if (response.ok) uploaded = true;
          else if (attempt === 3) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Upload part ${partNumber} failed.`); }
        }
        receivedParts.add(partNumber);
        await recoveryWrite(captureKey, { blob: recording, durationMs, deviceId, targetTrackId: targetTrack?.id || null, upload }).catch(() => {});
        setProgress(Math.round((partNumber / upload.partCount) * 90));
      }
      let checksumSha256 = null;
      if (crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", await recording.arrayBuffer());
        checksumSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      const completed = await fetch(`/api/school-radio/audio-lab/uploads/${upload.uploadId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ durationMs, deviceLabel: devices.find((item) => item.deviceId === deviceId)?.label || null, checksumSha256, targetTrackId: targetTrack?.id || null, editDecision: { ...edits, trimEndMs: edits.trimEndMs === "" ? null : Number(edits.trimEndMs) } }) });
      const result = await completed.json().catch(() => ({}));
      if (!completed.ok) throw new Error(result.error || "The recording could not be finalised.");
      setProgress(100); setServerTake(result); await recoveryDelete(captureKey).catch(() => {}); setRecording(null); setNotice(result.placement ? `Recording placed safely on ${result.placement.trackName}. The source take remains immutable.` : "Take uploaded safely. It is ready for teacher preview and audio approval."); await load();
      window.dispatchEvent(new CustomEvent("ruvanas:studio-projects-refresh"));
      window.dispatchEvent(new CustomEvent("ruvanas:multitrack-refresh", { detail: { projectId: captureProject.id } }));
    } catch (uploadError) { setError(uploadError.message); } finally { setWorking(false); }
  }

  async function submitTake() {
    const episodeId = projectForm.episodeId;
    const promoVersionId = serverTake?.promoVersionId || selected?.takes[0]?.promoVersion?.id;
    if (!episodeId || !promoVersionId) return;
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/school-radio/editorial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SUBMIT_EPISODE", episodeId, promoVersionId, notes: `Submitted from AudioLab project: ${projectForm.title}` }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The take could not be submitted.");
      setNotice("Take submitted to the linked episode for staff moderation.");
    } catch (submitError) { setError(submitError.message); } finally { setWorking(false); }
  }

  if (!data) return <section style={s.panel}><p style={s.hint}>{error || "Loading AudioLab…"}</p></section>;
  return <section id="audio-lab-quick-record" style={s.panel}>
    <div style={s.heading}><div><p style={s.eyebrow}>RECORD</p><h2 style={s.title}>Record safely in the browser</h2><p style={s.hint}>Immutable source takes, local recovery, resumable protected uploads, non-destructive edits, and teacher preview.</p></div><span style={s.autosave}>{experienceMode === "ADVANCED" ? "Advanced" : "Beginner"} · {autosave}</span></div>
    {error ? <div style={s.error}>{error}</div> : null}{notice ? <div style={s.notice}>{notice}</div> : null}
    <div style={s.grid}>
      <form style={s.card} onSubmit={createProject}><p style={s.eyebrow}>1 · PROJECT</p><h3 style={s.cardTitle}>New Quick Record</h3>
        <label style={s.label}>Project title<input style={s.input} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Monday student bulletin" required /></label>
        <label style={s.label}>Programme<select style={s.input} value={draft.programmeId} onChange={(event) => setDraft({ ...draft, programmeId: event.target.value, episodeId: "" })}><option value="">No programme link</option>{data.programmes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label style={s.label}>Episode<select style={s.input} value={draft.episodeId} onChange={(event) => setDraft({ ...draft, episodeId: event.target.value })}><option value="">No episode link</option>{data.episodes.filter((item) => !draft.programmeId || item.programmeId === draft.programmeId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <button style={s.primary} disabled={working}>Create project</button>
      </form>
      <section style={s.card}><p style={s.eyebrow}>2 · OPEN</p><h3 style={s.cardTitle}>AudioLab project</h3>
        <label style={s.label}>Project<select style={s.input} value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Choose project…</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status.replaceAll("_", " ")}</option>)}</select></label>
        {selected ? <><label style={s.label}>Title<input style={s.input} value={projectForm.title} onChange={(event) => setProjectForm({ ...projectForm, title: event.target.value })} /></label><label style={s.label}>Programme<select style={s.input} value={projectForm.programmeId} onChange={(event) => setProjectForm({ ...projectForm, programmeId: event.target.value, episodeId: "" })}><option value="">No programme</option>{data.programmes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={s.label}>Episode<select style={s.input} value={projectForm.episodeId} onChange={(event) => setProjectForm({ ...projectForm, episodeId: event.target.value })}><option value="">No episode</option>{linkedEpisodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></> : <p style={s.hint}>Create or choose a project before recording.</p>}
      </section>
    </div>
    {selected ? <><section style={{ ...s.card, marginTop: 16 }}><p style={s.eyebrow}>RECORDING DESTINATION</p><div style={s.grid}>
      <label style={s.label}>Send this recording to<select style={s.input} disabled={["COUNT_IN", "RECORDING", "PAUSED"].includes(recordingState)} value={recordDestination} onChange={(event) => { stopInput(); setRecordDestination(event.target.value); setRecording(null); setRecordingState("IDLE"); setDurationMs(0); }}><option value="WAVEFORM">New protected waveform take</option><option value="MULTITRACK">Armed multitrack track</option></select></label>
      {recordDestination === "MULTITRACK" ? <><label style={s.label}>Multitrack project<select style={s.input} disabled={["COUNT_IN", "RECORDING", "PAUSED"].includes(recordingState)} value={multitrackProjectId} onChange={(event) => { setMultitrackProjectId(event.target.value); setTargetTrackId(""); }}><option value="">Choose project…</option>{(data.multitrackProjects || []).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label style={s.label}>Armed track<select style={s.input} disabled={["COUNT_IN", "RECORDING", "PAUSED"].includes(recordingState)} value={targetTrackId} onChange={(event) => setTargetTrackId(event.target.value)}><option value="">Choose armed track…</option>{availableTracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select>{multitrackProject && !availableTracks.length ? <span style={s.warning}>Arm and unlock a track in Multitrack before recording.</span> : null}</label></> : <p style={s.hint}>The take opens in Waveform for non-destructive precision editing.</p>}
    </div></section><div style={{ ...s.grid, marginTop: 16 }}>
      <section style={s.card}><p style={s.eyebrow}>3 · MICROPHONE</p><h3 style={s.cardTitle}>Input check</h3>
        <label style={s.label}>Microphone<select style={s.input} disabled={["COUNT_IN", "RECORDING", "PAUSED"].includes(recordingState)} value={deviceId} onChange={(event) => { stopInput(); setDeviceId(event.target.value); setPermission("NOT_TESTED"); }}><option value="">Browser default</option>{devices.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Microphone ${index + 1}`}</option>)}</select></label>
        <button style={s.secondary} onClick={testMicrophone}>Start live input check</button><p style={s.hint}>Status: {permission.replaceAll("_", " ")} · use headphones and keep the meter below red.</p>
        <div role="meter" aria-label="Microphone input level" aria-valuemin="0" aria-valuemax="100" aria-valuenow={meter.percent} style={s.meter}><div style={{ ...s.meterFill, width: `${meter.percent}%`, background: meter.clipping ? "#ef4444" : meter.value > 0.65 ? "#f4b942" : "#22c55e" }} /></div>
        <p role="status" style={meter.clipping ? s.warning : s.hint}>{meter.clipping ? "Clipping detected — lower the microphone gain or move back." : `Input level: ${meter.tone.toLowerCase()}`}</p>
        {experienceMode === "ADVANCED" ? <label style={s.check}><input type="checkbox" checked={monitoring} onChange={(event) => setMonitoring(event.target.checked)} /> Headphone monitoring (use headphones to prevent feedback)</label> : null}
      </section>
      <section style={s.card}><p style={s.eyebrow}>4 · RECORD</p><div style={s.timer}>{countdown ? countdown : durationLabel(durationMs)}</div><p style={s.hint}>State: {countdown ? "COUNTING IN" : recordingState.replaceAll("_", " ")}</p>
        <label style={s.check}><input type="checkbox" checked={countIn} onChange={(event) => setCountIn(event.target.checked)} /> 3-second count-in</label>
        <div style={s.actions}><button style={s.record} disabled={working || ["COUNT_IN", "RECORDING", "PAUSED"].includes(recordingState) || (recordDestination === "MULTITRACK" && !targetTrack)} onClick={startRecording}>● Record</button><button style={s.secondary} disabled={!['RECORDING','PAUSED'].includes(recordingState)} onClick={pauseOrResume}>{recordingState === "PAUSED" ? "Resume" : "Pause"}</button><button style={s.secondary} disabled={!['RECORDING','PAUSED'].includes(recordingState)} onClick={stopRecording}>Stop</button>{recording ? <button style={s.secondary} disabled={working} onClick={retake}>Retake</button> : null}</div>
        <p style={s.hint}>One-second chunks are retained locally for recovery, including during an interrupted recording.</p>
      </section>
    </div>
    <div style={{ ...s.grid, marginTop: 16 }}>
      <section style={s.card}><p style={s.eyebrow}>5 · NON-DESTRUCTIVE FINISH</p><h3 style={s.cardTitle}>{experienceMode === "ADVANCED" ? "Trim and finish" : "Choose a simple finish"}</h3>
        {experienceMode === "ADVANCED" ? <>
          <div style={s.two}><label style={s.label}>Trim start (ms)<input style={s.input} type="number" min="0" value={edits.trimStartMs} onChange={(event) => setEdits({ ...edits, trimStartMs: Number(event.target.value) })} /></label><label style={s.label}>Trim end (ms)<input style={s.input} type="number" min="0" value={edits.trimEndMs} onChange={(event) => setEdits({ ...edits, trimEndMs: event.target.value })} placeholder="End of take" /></label></div>
          <div style={s.two}><label style={s.label}>Fade in (ms)<input style={s.input} type="number" min="0" max="60000" value={edits.fadeInMs} onChange={(event) => setEdits({ ...edits, fadeInMs: Number(event.target.value) })} /></label><label style={s.label}>Fade out (ms)<input style={s.input} type="number" min="0" max="60000" value={edits.fadeOutMs} onChange={(event) => setEdits({ ...edits, fadeOutMs: Number(event.target.value) })} /></label></div>
          <label style={s.check}><input type="checkbox" checked={edits.normalize} onChange={(event) => setEdits({ ...edits, normalize: event.target.checked })} /> Normalize for speech</label><label style={s.label}>Loudness target<select style={s.input} value={edits.targetLufs} onChange={(event) => setEdits({ ...edits, targetLufs: Number(event.target.value) })}><option value="-16">-16 LUFS · web/radio</option><option value="-18">-18 LUFS · gentle</option><option value="-23">-23 LUFS · broadcast</option></select></label><label style={s.check}><input type="checkbox" checked={edits.noiseCleanup} onChange={(event) => setEdits({ ...edits, noiseCleanup: event.target.checked })} /> Request optional noise cleanup</label>
        </> : <label style={s.label}>Finish preset<select style={s.input} value={!edits.normalize ? "ORIGINAL" : edits.noiseCleanup ? "CLEAN_SPEECH" : "CLEAR_SPEECH"} onChange={(event) => {
          const preset = event.target.value;
          setEdits({ ...edits, normalize: preset !== "ORIGINAL", targetLufs: -16, noiseCleanup: preset === "CLEAN_SPEECH" });
        }}><option value="CLEAR_SPEECH">Clear speech · balanced level</option><option value="CLEAN_SPEECH">Clean speech · reduce steady noise</option><option value="ORIGINAL">Keep original level</option></select><span style={s.hint}>Open Waveform for precise trim, fade and timing controls.</span></label>}
        <p style={s.hint}>The source recording is never overwritten. These edit decisions are versioned and applied by the processing pipeline.</p>
      </section>
      <section style={s.card}><p style={s.eyebrow}>6 · PREVIEW & UPLOAD</p><h3 style={s.cardTitle}>Teacher preview</h3>
        {previewUrl ? <audio controls src={previewUrl} style={s.audio} /> : serverTake?.streamUrl ? <audio controls src={serverTake.streamUrl} style={s.audio} /> : <p style={s.hint}>Stop a recording to preview it here.</p>}
        {recording ? <><button style={s.primary} disabled={working || (recordDestination === "MULTITRACK" && !targetTrack)} onClick={uploadRecording}>{recordDestination === "MULTITRACK" ? `Upload and place on ${targetTrack?.name || "armed track"}` : "Upload protected take"}</button><div style={s.progress}><div style={{ ...s.progressFill, width: `${progress}%` }} /></div><p style={s.hint}>{progress ? `${progress}% uploaded` : "Upload starts in resumable 5 MB parts."}</p></> : null}
        {serverTake || selected.takes[0] ? <><p style={s.ready}>Protected take ready · audio review {(serverTake?.reviewStatus || selected.takes[0]?.promoVersion?.status || "PENDING").replaceAll("_", " ")}</p><button style={s.primary} disabled={working || !projectForm.episodeId} onClick={submitTake}>Submit to linked episode</button>{!projectForm.episodeId ? <p style={s.hint}>Link this project to a draft episode to submit it.</p> : null}</> : null}
      </section>
    </div></> : null}
    <p style={s.safety}>Private by default · no public sharing · immutable source take · local recovery stays on this device · protected Ruvanas playback only.</p>
  </section>;
}

const s = {
  panel: { border: "1px solid var(--rv-border)", borderRadius: 16, background: "var(--rv-surface)", padding: 22, marginBottom: 22 }, heading: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 16 }, title: { margin: "0 0 8px", fontSize: 28 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, autosave: { color: "var(--rv-info-text)", fontSize: 12, whiteSpace: "nowrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }, two: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }, card: { border: "1px solid var(--rv-border)", borderRadius: 12, background: "var(--rv-surface)", padding: 18 }, cardTitle: { margin: "0 0 15px" }, label: { display: "grid", gap: 6, marginBottom: 12, color: "var(--rv-text)", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--rv-border)", borderRadius: 7, background: "var(--rv-input-bg)", color: "var(--rv-input-text)", padding: "10px 11px", font: "inherit" }, check: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12, color: "var(--rv-text)", fontWeight: 800, fontSize: 13 },
  primary: { border: 0, borderRadius: 7, background: "#f4b942", color: "#101827", padding: "11px 14px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid var(--rv-border)", borderRadius: 7, background: "transparent", color: "var(--rv-text)", padding: "10px 12px", fontWeight: 800, cursor: "pointer" }, record: { border: 0, borderRadius: 7, background: "#ef4444", color: "white", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, actions: { display: "flex", flexWrap: "wrap", gap: 8 }, timer: { fontSize: 42, fontWeight: 900, letterSpacing: 2, fontVariantNumeric: "tabular-nums" }, meter: { height: 16, marginTop: 15, background: "var(--rv-surface)", borderRadius: 999, overflow: "hidden" }, meterFill: { height: "100%", transition: "width 80ms linear" }, audio: { width: "100%", margin: "4px 0 14px" }, progress: { height: 7, background: "var(--rv-surface)", borderRadius: 999, overflow: "hidden", marginTop: 13 }, progressFill: { height: "100%", background: "#22c55e", transition: "width 150ms" },
  hint: { color: "var(--rv-text-muted)", lineHeight: 1.5, fontSize: 13, margin: "5px 0" }, warning: { color: "var(--rv-error-text)", lineHeight: 1.5, fontSize: 13, fontWeight: 800, margin: "5px 0" }, ready: { color: "var(--rv-success-text)", fontWeight: 800 }, error: { border: "1px solid #ef4444", background: "var(--rv-error-bg)", color: "var(--rv-error-text)", borderRadius: 8, padding: 12, marginBottom: 14 }, notice: { border: "1px solid #22c55e", background: "var(--rv-success-bg)", color: "var(--rv-success-text)", borderRadius: 8, padding: 12, marginBottom: 14 }, safety: { color: "var(--rv-text-muted)", fontSize: 12, margin: "16px 0 0" }
};

