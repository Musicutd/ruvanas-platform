"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function recorderType() {
  return ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export default function AudioLabClient() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(emptyProject);
  const [projectId, setProjectId] = useState("");
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [edits, setEdits] = useState(defaultEdits);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [permission, setPermission] = useState("NOT_TESTED");
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
  const selectingRef = useRef(false);

  const selected = useMemo(() => data?.projects.find((item) => item.id === projectId) || null, [data, projectId]);
  const linkedEpisodes = useMemo(() => (data?.episodes || []).filter((item) => !projectForm.programmeId || item.programmeId === projectForm.programmeId), [data, projectForm.programmeId]);

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/audio-lab", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "AudioLab could not be loaded.");
    setData(payload);
    setProjectId((current) => current || payload.projects[0]?.id || "");
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(meterFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!selected || selectingRef.current) return;
    selectingRef.current = true;
    setProjectForm({ title: selected.title, programmeId: selected.programmeId || "", episodeId: selected.episodeId || "", studentGroupId: selected.studentGroupId || "" });
    setEdits({ ...defaultEdits, ...(selected.editDecision || {}), trimEndMs: selected.editDecision?.trimEndMs ?? "" });
    setServerTake(selected.takes[0] ? { ...selected.takes[0], streamUrl: `/api/media/${selected.takes[0].mediaAsset.id}/stream`, promoVersionId: selected.takes[0].promoVersion?.id } : null);
    setRecording(null); setProgress(0); setAutosave("Saved"); setNotice(""); setError("");
    recoveryRead(selected.id).then((saved) => {
      if (saved?.blob) {
        setRecording(saved.blob); setDurationMs(saved.durationMs || 0); setDeviceId(saved.deviceId || "");
        setNotice("A local recording was recovered safely from this browser.");
      }
    }).catch(() => {});
    queueMicrotask(() => { selectingRef.current = false; });
  }, [selected?.id]);

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
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function testMicrophone() {
    setError(""); setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : true });
      stream.getTracks().forEach((track) => track.stop());
      const available = await navigator.mediaDevices.enumerateDevices();
      const microphones = available.filter((item) => item.kind === "audioinput");
      setDevices(microphones); setDeviceId((current) => current || microphones[0]?.deviceId || ""); setPermission("READY"); setNotice("Microphone is ready. Use headphones to avoid feedback.");
    } catch { setPermission("BLOCKED"); setError("Microphone access was blocked. Allow microphone access in the browser and test again."); }
  }

  function startMeter(stream) {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const values = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(values);
      let peak = 0;
      for (const sample of values) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      setLevel(Math.min(1, peak * 2.4));
      meterFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
    stream.addEventListener("inactive", () => { cancelAnimationFrame(meterFrameRef.current); context.close(); setLevel(0); }, { once: true });
  }

  async function startRecording() {
    if (!selected) return;
    setError(""); setNotice(""); setServerTake(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      streamRef.current = stream; startMeter(stream);
      const mimeType = recorderType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        const recoveryBlob = new Blob(chunksRef.current, { type: recorder.mimeType || event.data.type || "audio/webm" });
        const recoveryDuration = elapsedBeforePauseRef.current + (recorder.state === "recording" ? Date.now() - startedAtRef.current : 0);
        recoveryWrite(selected.id, { blob: recoveryBlob, durationMs: recoveryDuration, deviceId }).catch(() => {});
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || chunksRef.current[0]?.type || "audio/webm" });
        setRecording(blob); setRecordingState("STOPPED");
        await recoveryWrite(selected.id, { blob, durationMs: elapsedBeforePauseRef.current, deviceId }).catch(() => {});
        stream.getTracks().forEach((track) => track.stop());
        clearInterval(timerRef.current); setNotice("Recording stopped and saved locally for recovery.");
      };
      recorderRef.current = recorder; elapsedBeforePauseRef.current = 0; startedAtRef.current = Date.now();
      recorder.start(1000); setRecordingState("RECORDING");
      timerRef.current = setInterval(() => setDurationMs(elapsedBeforePauseRef.current + Date.now() - startedAtRef.current), 250);
    } catch (recordError) { setError(recordError instanceof Error ? recordError.message : "Recording could not start."); }
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

  useEffect(() => {
    if (!recording) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(recording); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  async function uploadRecording() {
    if (!selected || !recording) return;
    setWorking(true); setError(""); setNotice(""); setProgress(0);
    try {
      const baseType = recording.type.split(";", 1)[0] || "audio/webm";
      const extension = baseType.includes("ogg") ? "ogg" : baseType.includes("mp4") ? "m4a" : baseType.includes("mpeg") ? "mp3" : baseType.includes("wav") ? "wav" : "webm";
      const recovered = await recoveryRead(selected.id).catch(() => null);
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
        const start = await fetch("/api/school-radio/audio-lab/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: selected.id, originalName: `${projectForm.title}.${extension}`, mimeType: baseType, sizeBytes: recording.size }) });
        upload = await start.json().catch(() => ({}));
        if (!start.ok) throw new Error(upload.error || "The resumable upload could not start.");
        await recoveryWrite(selected.id, { blob: recording, durationMs, deviceId, upload }).catch(() => {});
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
        await recoveryWrite(selected.id, { blob: recording, durationMs, deviceId, upload }).catch(() => {});
        setProgress(Math.round((partNumber / upload.partCount) * 90));
      }
      let checksumSha256 = null;
      if (crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", await recording.arrayBuffer());
        checksumSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      const completed = await fetch(`/api/school-radio/audio-lab/uploads/${upload.uploadId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ durationMs, deviceLabel: devices.find((item) => item.deviceId === deviceId)?.label || null, checksumSha256, editDecision: { ...edits, trimEndMs: edits.trimEndMs === "" ? null : Number(edits.trimEndMs) } }) });
      const result = await completed.json().catch(() => ({}));
      if (!completed.ok) throw new Error(result.error || "The recording could not be finalised.");
      setProgress(100); setServerTake(result); await recoveryDelete(selected.id).catch(() => {}); setRecording(null); setNotice("Take uploaded safely. It is ready for teacher preview and audio approval."); await load();
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
  return <section style={s.panel}>
    <div style={s.heading}><div><p style={s.eyebrow}>STAGE 4C · AUDIOLAB QUICK RECORD</p><h2 style={s.title}>Record safely in the browser</h2><p style={s.hint}>Immutable source takes, local recovery, resumable protected uploads, non-destructive edits, and teacher preview.</p></div><span style={s.autosave}>{autosave}</span></div>
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
    {selected ? <><div style={{ ...s.grid, marginTop: 16 }}>
      <section style={s.card}><p style={s.eyebrow}>3 · MICROPHONE</p><h3 style={s.cardTitle}>Input check</h3>
        <label style={s.label}>Microphone<select style={s.input} value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Browser default</option>{devices.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Microphone ${index + 1}`}</option>)}</select></label>
        <button style={s.secondary} onClick={testMicrophone}>Test microphone permission</button><p style={s.hint}>Status: {permission.replaceAll("_", " ")} · use headphones and keep the meter below red.</p>
        <div style={s.meter}><div style={{ ...s.meterFill, width: `${level * 100}%`, background: level > 0.88 ? "#ef4444" : level > 0.65 ? "#f4b942" : "#22c55e" }} /></div>
      </section>
      <section style={s.card}><p style={s.eyebrow}>4 · RECORD</p><div style={s.timer}>{durationLabel(durationMs)}</div><p style={s.hint}>State: {recordingState}</p>
        <div style={s.actions}><button style={s.record} disabled={working || recordingState === "RECORDING" || recordingState === "PAUSED"} onClick={startRecording}>● Record</button><button style={s.secondary} disabled={!['RECORDING','PAUSED'].includes(recordingState)} onClick={pauseOrResume}>{recordingState === "PAUSED" ? "Resume" : "Pause"}</button><button style={s.secondary} disabled={!['RECORDING','PAUSED'].includes(recordingState)} onClick={stopRecording}>Stop</button></div>
        <p style={s.hint}>One-second chunks are retained locally for recovery, including during an interrupted recording.</p>
      </section>
    </div>
    <div style={{ ...s.grid, marginTop: 16 }}>
      <section style={s.card}><p style={s.eyebrow}>5 · NON-DESTRUCTIVE EDITS</p><h3 style={s.cardTitle}>Trim and finish</h3>
        <div style={s.two}><label style={s.label}>Trim start (ms)<input style={s.input} type="number" min="0" value={edits.trimStartMs} onChange={(event) => setEdits({ ...edits, trimStartMs: Number(event.target.value) })} /></label><label style={s.label}>Trim end (ms)<input style={s.input} type="number" min="0" value={edits.trimEndMs} onChange={(event) => setEdits({ ...edits, trimEndMs: event.target.value })} placeholder="End of take" /></label></div>
        <div style={s.two}><label style={s.label}>Fade in (ms)<input style={s.input} type="number" min="0" max="60000" value={edits.fadeInMs} onChange={(event) => setEdits({ ...edits, fadeInMs: Number(event.target.value) })} /></label><label style={s.label}>Fade out (ms)<input style={s.input} type="number" min="0" max="60000" value={edits.fadeOutMs} onChange={(event) => setEdits({ ...edits, fadeOutMs: Number(event.target.value) })} /></label></div>
        <label style={s.check}><input type="checkbox" checked={edits.normalize} onChange={(event) => setEdits({ ...edits, normalize: event.target.checked })} /> Normalize for speech</label><label style={s.label}>Loudness target<select style={s.input} value={edits.targetLufs} onChange={(event) => setEdits({ ...edits, targetLufs: Number(event.target.value) })}><option value="-16">-16 LUFS · web/radio</option><option value="-18">-18 LUFS · gentle</option><option value="-23">-23 LUFS · broadcast</option></select></label><label style={s.check}><input type="checkbox" checked={edits.noiseCleanup} onChange={(event) => setEdits({ ...edits, noiseCleanup: event.target.checked })} /> Request optional noise cleanup</label><p style={s.hint}>The source recording is never overwritten. These edit decisions are versioned and applied by the processing pipeline.</p>
      </section>
      <section style={s.card}><p style={s.eyebrow}>6 · PREVIEW & UPLOAD</p><h3 style={s.cardTitle}>Teacher preview</h3>
        {previewUrl ? <audio controls src={previewUrl} style={s.audio} /> : serverTake?.streamUrl ? <audio controls src={serverTake.streamUrl} style={s.audio} /> : <p style={s.hint}>Stop a recording to preview it here.</p>}
        {recording ? <><button style={s.primary} disabled={working} onClick={uploadRecording}>Upload protected take</button><div style={s.progress}><div style={{ ...s.progressFill, width: `${progress}%` }} /></div><p style={s.hint}>{progress ? `${progress}% uploaded` : "Upload starts in resumable 5 MB parts."}</p></> : null}
        {serverTake || selected.takes[0] ? <><p style={s.ready}>Protected take ready · audio review {(serverTake?.reviewStatus || selected.takes[0]?.promoVersion?.status || "PENDING").replaceAll("_", " ")}</p><button style={s.primary} disabled={working || !projectForm.episodeId} onClick={submitTake}>Submit to linked episode</button>{!projectForm.episodeId ? <p style={s.hint}>Link this project to a draft episode to submit it.</p> : null}</> : null}
      </section>
    </div></> : null}
    <p style={s.safety}>Private by default · no public sharing · immutable source take · local recovery stays on this device · protected Ruvanas playback only.</p>
  </section>;
}

const s = {
  panel: { border: "1px solid #3b4b66", borderRadius: 16, background: "#111d30", padding: 22, marginBottom: 22 }, heading: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 16 }, title: { margin: "0 0 8px", fontSize: 28 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, autosave: { color: "#93c5fd", fontSize: 12, whiteSpace: "nowrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }, two: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }, card: { border: "1px solid #34445f", borderRadius: 12, background: "#182235", padding: 18 }, cardTitle: { margin: "0 0 15px" }, label: { display: "grid", gap: 6, marginBottom: 12, color: "#dce5f3", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 7, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" }, check: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12, color: "#dce5f3", fontWeight: 800, fontSize: 13 },
  primary: { border: 0, borderRadius: 7, background: "#f4b942", color: "#101827", padding: "11px 14px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, background: "transparent", color: "#e2e8f0", padding: "10px 12px", fontWeight: 800, cursor: "pointer" }, record: { border: 0, borderRadius: 7, background: "#ef4444", color: "white", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, actions: { display: "flex", flexWrap: "wrap", gap: 8 }, timer: { fontSize: 42, fontWeight: 900, letterSpacing: 2, fontVariantNumeric: "tabular-nums" }, meter: { height: 16, marginTop: 15, background: "#08111f", borderRadius: 999, overflow: "hidden" }, meterFill: { height: "100%", transition: "width 80ms linear" }, audio: { width: "100%", margin: "4px 0 14px" }, progress: { height: 7, background: "#08111f", borderRadius: 999, overflow: "hidden", marginTop: 13 }, progressFill: { height: "100%", background: "#22c55e", transition: "width 150ms" },
  hint: { color: "#9facbf", lineHeight: 1.5, fontSize: 13, margin: "5px 0" }, ready: { color: "#bbf7d0", fontWeight: 800 }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 14 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 14 }, safety: { color: "#8ea0b8", fontSize: 12, margin: "16px 0 0" }
};

