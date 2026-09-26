"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WaveformEditorClient from "@/app/dashboard/school-radio/WaveformEditorClient";
import MultitrackStudioClient from "@/app/dashboard/school-radio/MultitrackStudioClient";
import styles from "./contributor.module.css";

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Please try again.");
  return body;
}

export default function ContributorStudio() {
  const [workspace, setWorkspace] = useState(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState("WELCOME");
  const [recording, setRecording] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [renders, setRenders] = useState([]);
  const [renderId, setRenderId] = useState("");
  const [submitted, setSubmitted] = useState(null);
  const [now, setNow] = useState(Date.now());
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedRef = useRef(0);

  const refreshSession = useCallback(async () => {
    const response = await fetch("/api/corrections/contributor/session", { cache: "no-store" });
    if (response.ok) setWorkspace(await response.json());
    else setWorkspace(null);
  }, []);
  useEffect(() => { refreshSession().catch(() => {}); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [refreshSession]);
  const refreshRenders = useCallback(async () => {
    if (!workspace?.session?.projectId) return;
    const endpoint = workspace.session.projectType === "MULTITRACK"
      ? `/api/corrections/contributor/multitrack/projects/${workspace.session.projectId}`
      : `/api/corrections/contributor/audio-lab/projects/${workspace.session.projectId}/editor`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return;
    const editor = await response.json();
    setRenders((editor.renders || []).filter((item) => !item.resultJson?.studioPreview));
  }, [workspace?.session?.projectId, workspace?.session?.projectType]);
  useEffect(() => { if (!workspace || submitted || tool !== "STUDIO") return; refreshRenders(); const timer = setInterval(refreshRenders, 5000); return () => clearInterval(timer); }, [workspace, submitted, tool, refreshRenders]);

  const enter = async (event) => {
    event.preventDefault(); setBusy(true); setNotice("");
    try { const result = await readResponse(await fetch("/api/corrections/contributor/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode: code.trim() }) })); setWorkspace(result); setCode(""); setTool("WELCOME"); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const uploadRecording = async (file, durationMs) => {
    setBusy(true); setNotice("Saving the protected recording…");
    try {
      const form = new FormData(); form.append("recording", file); form.append("durationMs", String(Math.max(1, Math.round(durationMs))));
      await readResponse(await fetch("/api/corrections/contributor/recordings", { method: "POST", body: form }));
      setNotice("Recording saved to this project. Open the waveform and choose the new take."); setEditorKey((value) => value + 1);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const startRecording = async () => {
    setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((value) => MediaRecorder.isTypeSupported(value));
      if (!mimeType) { stream.getTracks().forEach((track) => track.stop()); throw new Error("This browser cannot record a supported audio format."); }
      const recorder = new MediaRecorder(stream, { mimeType }); streamRef.current = stream; recorderRef.current = recorder; chunksRef.current = []; startedRef.current = Date.now();
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop()); setRecording(false);
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        const file = new File(chunksRef.current, `Inside recording ${new Date().toISOString().slice(0, 19)}.${extension}`, { type: mimeType.split(";")[0] });
        uploadRecording(file, Date.now() - startedRef.current);
      };
      recorder.start(1000); setRecording(true);
    } catch (error) { setNotice(error.message || "Microphone access is unavailable."); }
  };
  const stopRecording = () => { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); };
  const importFile = async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const audio = new Audio(); audio.preload = "metadata"; audio.src = url;
      await new Promise((resolve, reject) => { audio.onloadedmetadata = resolve; audio.onerror = reject; });
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) throw new Error("The file duration could not be checked.");
      await uploadRecording(file, audio.duration * 1000);
    } catch (error) { setNotice(error.message || "The file could not be checked."); }
    finally { URL.revokeObjectURL(url); event.target.value = ""; }
  };
  const submit = async () => {
    setBusy(true); setNotice("");
    try {
      const result = await readResponse(await fetch("/api/corrections/contributor/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ renderId }) }));
      setSubmitted(result.submission); setNotice("Submitted for staff review. Nothing has been published or scheduled.");
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const exit = async () => { if (recording) stopRecording(); await fetch("/api/corrections/contributor/session", { method: "DELETE" }); setWorkspace(null); setTool("WELCOME"); setNotice(""); };
  const minutesLeft = workspace?.session?.expiresAt ? Math.max(0, Math.ceil((new Date(workspace.session.expiresAt).getTime() - now) / 60000)) : 0;
  const reviewRenders = renders.filter((item) => item.status === "SUCCEEDED" &&
    new Date(item.createdAt).getTime() >= new Date(workspace?.session?.activatedAt || 0).getTime() &&
    (item.reviewVersionId || item.outputVersion?.status === "IN_REVIEW"));
  return <main className={styles.page}><header className={styles.header}><strong>RUVANAS INSIDE</strong><span>Supervised Studio</span></header>
    {!workspace ? <section className={styles.entry}><span className={styles.eyebrow}>Restricted contributor access</span><h1>Your Studio session</h1><p>Enter the time-limited code given to you by your supervisor. Use a separate private browser window, not a staff-signed-in window.</p><form onSubmit={enter}><label>Session access code<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" required /></label><button disabled={busy || !code.trim()}>Open session</button></form>{notice && <p role="alert" className={styles.notice}>{notice}</p>}</section> : <div className={styles.shell}>
      <div className={styles.top}><div><span className={styles.eyebrow}>Supervised Corrections Studio Session</span><h1>{workspace.session.programmeTitle}</h1><p>{workspace.session.facilityName} · {workspace.session.projectTitle}</p></div><button className={styles.secondary} onClick={exit}>Leave this session</button></div>
      <div className={styles.facts}><div><span>Supervisor</span><strong>{workspace.session.supervisorName}</strong></div><div><span>Status</span><strong>{submitted ? "Submitted" : workspace.session.status}</strong></div><div><span>Time remaining</span><strong>{minutesLeft} minutes</strong></div><div><span>Tools</span><strong>Recording · Editing · Review render</strong></div></div>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {submitted ? <section className={styles.card}><h2>Work sent to staff review</h2><p>Revision {submitted.revision} is saved against the exact Studio render. Only authorised staff can approve, request changes or reject it.</p></section> : minutesLeft === 0 ? <section className={styles.card}><h2>Session expired</h2><p>Your saved work remains available to staff. Ask your supervisor for a new session to continue.</p></section> : tool === "WELCOME" ? <section className={styles.card}><h2>Ready to create?</h2><p>You can record and edit only this assigned programme. No publishing, scheduling, broadcasting, account settings or catalogue downloads are available.</p><button onClick={() => setTool("STUDIO")}>Open Studio</button></section> : <>
        <section className={styles.card}><span className={styles.eyebrow}>Recording</span><h2>Capture or add voice</h2><p>Record a take using this device, or add audio supplied for this programme. Files stay in this supervised project and must pass staff review.</p><div className={styles.actions}><button disabled={busy || recording} onClick={startRecording}>Start recording</button><button className={styles.secondary} disabled={!recording} onClick={stopRecording}>Stop and save</button><label className={styles.file}>Add audio file<input type="file" accept=".mp3,.wav,.ogg,.m4a,.webm,audio/*" disabled={busy || recording} onChange={importFile} /></label></div></section>
        <section className={styles.editor}>{workspace.session.projectType === "MULTITRACK"
          ? <MultitrackStudioClient key={editorKey} requestedProjectId={workspace.session.projectId} experienceMode="BEGINNER" apiBase="/api/corrections/contributor/multitrack" mediaBase="/api/corrections/contributor/media" supervised />
          : <WaveformEditorClient key={editorKey} requestedProjectId={workspace.session.projectId} experienceMode="BEGINNER" apiBase="/api/corrections/contributor/audio-lab" mediaBase="/api/corrections/contributor/media" supervised />}</section>
        <section className={styles.card}><span className={styles.eyebrow}>Submit for Review</span><h2>Send the exact render to Corrections Guard</h2><p>Create a final render in the {workspace.session.projectType === "MULTITRACK" ? "multitrack mixer" : "waveform editor"}, wait until it is ready, then select it here. Submission starts review; it is not approval.</p><label>Completed Studio render<select value={renderId} onChange={(event) => setRenderId(event.target.value)}><option value="">Choose a completed render from this session</option>{reviewRenders.map((item) => <option key={item.id} value={item.id}>{item.preset} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>{renders.some((item) => item.status === "QUEUED" || item.status === "RUNNING") && <p>A render is being prepared. This list refreshes automatically.</p>}<button disabled={busy || !reviewRenders.some((item) => item.id === renderId)} onClick={submit}>Submit for Review</button></section>
      </>}
    </div>}
  </main>;
}
