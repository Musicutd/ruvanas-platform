"use client";

import { useEffect, useRef, useState } from "react";
import { RETAIL_PLANNER_STATION_ID } from "@/lib/retail-weekly-planner-ui.mjs";
import { RETAIL_COMMERCIAL_UPLOAD_ENDPOINT as ENDPOINT, RETAIL_COMMERCIAL_UPLOAD_KINDS as KINDS,
  RETAIL_COMMERCIAL_RECORDING_REVIEW_ENDPOINT as REVIEW_ENDPOINT,
  RETAIL_COMMERCIAL_UPLOAD_ACCEPT as ACCEPT, retailCommercialUploadView, retailCommercialUploadIssues,
  retailCommercialUploadStatus, retailCommercialUploadDuration, retailCommercialUploadSize,
  retailCommercialRecordingReviewBody, retailCommercialRecordingPreviewPath } from "@/lib/retail-commercial-upload-ui.mjs";
import styles from "./retail-commercial-upload.module.css";

export default function RetailCommercialUpload({ stationId, onApproved }) {
  const [data, setData] = useState(null), [name, setName] = useState(""), [mediaType, setMediaType] = useState("COMMERCIAL");
  const [file, setFile] = useState(null), [rightsConfirmed, setRightsConfirmed] = useState(false), [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [reviewConfirmations, setReviewConfirmations] = useState({}), [reviewNotes, setReviewNotes] = useState({}), [previewId, setPreviewId] = useState(null);
  const abort = useRef(null), sequence = useRef(0), pending = useRef(false), attempt = useRef(null);
  const issues = retailCommercialUploadIssues({ name, mediaType, file, rightsConfirmed }, data?.limits);
  const publicError = (body, fallback) => typeof body?.error === "string" && body.error.length <= 500 ? body.error : fallback;

  async function load() {
    if (pending.current || stationId !== RETAIL_PLANNER_STATION_ID) return;
    const read = ++sequence.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000); setBusy("load"); setError("");
    try {
      const response = await fetch(ENDPOINT, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const body = await response.json(); if (!response.ok) throw new Error(publicError(body, "Your uploaded recordings could not be loaded."));
      const next = retailCommercialUploadView(body); if (read === sequence.current) { setData(next); setReviewConfirmations({}); }
    } catch (caught) { if (read === sequence.current) setError(caught.name === "AbortError" ? "Loading timed out. Try Refresh upload status." : caught.message); }
    finally { clearTimeout(timer); if (read === sequence.current) setBusy(""); }
  }
  useEffect(() => { void load(); return () => { sequence.current++; abort.current?.abort(); }; }, [stationId]);

  async function upload(event) {
    event.preventDefault(); if (pending.current || busy || !data?.canUpload || issues.length || stationId !== RETAIL_PLANNER_STATION_ID) return;
    if (!attempt.current || attempt.current.file !== file || attempt.current.name !== name.trim() || attempt.current.mediaType !== mediaType)
      attempt.current = { file, name: name.trim(), mediaType, requestId: crypto.randomUUID() };
    const body = new FormData(); body.append("file", file); body.append("name", name.trim()); body.append("mediaType", mediaType);
    body.append("languageCode", "und"); body.append("rightsConfirmed", "true"); body.append("requestId", attempt.current.requestId);
    pending.current = true; const write = ++sequence.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 120000); setBusy("upload"); setError(""); setMessage("");
    try {
      const response = await fetch(ENDPOINT, { method: "POST", credentials: "same-origin", body, signal: controller.signal });
      const result = await response.json(); if (!response.ok) throw new Error(publicError(result, "The upload could not be confirmed. Retry with the same file."));
      const next = retailCommercialUploadView(result);
      if (!next.uploads.some(recording => recording.id === result.uploadedId)) throw new Error("The upload result is uncertain. Refresh upload status, or retry with the same file.");
      if (write !== sequence.current) return;
      setData(next); setFile(null); setFileKey(key => key + 1); setName(""); setRightsConfirmed(false); attempt.current = null;
      setMessage(result.duplicate === true ? "This recording is already in your audio library. Its approval status is shown below." : "Uploaded. Review and approve your recording below before using it in a break. Your music keeps playing.");
    } catch (caught) { if (write === sequence.current) setError(caught.name === "AbortError" ? "The upload timed out before confirmation. Keep the same file and retry to recover the result, or refresh upload status." : caught.message); }
    finally { clearTimeout(timer); pending.current = false; if (write === sequence.current) setBusy(""); }
  }
  async function reviewRecording(recording, decision) {
    if (pending.current || busy || stationId !== RETAIL_PLANNER_STATION_ID) return;
    let input; try { input = retailCommercialRecordingReviewBody(recording, decision, { rightsConfirmed: reviewConfirmations[recording.id] === true, notes: reviewNotes[recording.id] || "" }); }
    catch (caught) { setError(caught.message); return; }
    pending.current = true; const write = ++sequence.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 30000); setBusy("review"); setError(""); setMessage("");
    try {
      const response = await fetch(REVIEW_ENDPOINT, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
      const result = await response.json(); if (!response.ok) throw new Error(publicError(result, "The recording review could not be confirmed. Refresh its status before continuing."));
      const next = retailCommercialUploadView(result), reviewed = next.uploads.find(entry => entry.id === recording.id);
      if (result.reviewedId !== recording.id || result.decision !== decision || !reviewed || reviewed.status !== (decision === "APPROVE" ? "APPROVED" : "REJECTED") || decision === "APPROVE" && reviewed.qcStatus !== "PASSED")
        throw new Error("The review result is uncertain. Refresh upload status before continuing.");
      if (write !== sequence.current) return;
      setData(next); setReviewConfirmations({}); setReviewNotes(previous => ({ ...previous, [recording.id]: "" })); setPreviewId(null);
      setMessage(decision === "APPROVE" ? "Recording approved for your Retail library. Add it to a break, then review and approve the saved commercial schedule separately." : "Recording rejected. It will not be available for commercial breaks.");
      if (decision === "APPROVE") onApproved?.();
    } catch (caught) { if (write === sequence.current) setError(caught.name === "AbortError" ? "Review confirmation timed out. Refresh upload status, or retry the same decision." : caught.message); }
    finally { clearTimeout(timer); pending.current = false; if (write === sequence.current) setBusy(""); }
  }
  if (stationId !== RETAIL_PLANNER_STATION_ID) return null;
  return <section className={styles.panel} aria-labelledby="retail-commercial-upload-title">
    <div className={styles.heading}><div><p className={styles.eyebrow}>YOUR SHOP AUDIO</p><h3 id="retail-commercial-upload-title">Upload a commercial or announcement</h3></div><button type="button" disabled={Boolean(busy)} onClick={() => void load()}>Refresh upload status</button></div>
    <p className={styles.intro}>Add your own offers, announcements and jingles here. Files stay private to your Retail workspace. Music catalogue uploads remain managed by Ruvanas.</p>
    <ol className={styles.steps} aria-label="Commercial audio approval steps"><li><strong>1. Upload</strong><span>Choose your recording</span></li><li><strong>2. Review & approve</strong><span>You are responsible for your audio</span></li><li><strong>3. Plan a break</strong><span>Approve its schedule separately</span></li></ol>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success} role="status">{message}</p>}
    {!data ? <p role="status">{busy ? "Loading your commercial audio…" : "Refresh upload status to load your audio library."}</p> : <>
      <form onSubmit={upload} aria-label="Upload Retail commercial audio">
        <fieldset disabled={Boolean(busy) || !data.canUpload} className={styles.fields}>
          <div className={styles.row}><label>Recording name<input required maxLength={120} value={name} placeholder="For example, weekend special offer" onChange={event => { setName(event.target.value); setMessage(""); }} /></label><label>Recording type<select value={mediaType} onChange={event => { setMediaType(event.target.value); setMessage(""); }}>{KINDS.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label></div>
          <label>Audio file<input key={fileKey} required type="file" accept={ACCEPT} onChange={event => { setFile(event.target.files?.[0] || null); setMessage(""); setError(""); }} /></label>
          <p className={styles.hint}>MP3, WAV, OGG or M4A · up to {retailCommercialUploadSize(data.limits.maxFileBytes)} · up to {data.limits.maxDurationSeconds / 60} minutes. The file and its duration are checked when you upload.</p>
          {file && <p className={styles.selection}>Selected: <strong>{file.name}</strong> · {retailCommercialUploadSize(file.size)}</p>}
          <label className={styles.confirm}><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} /><span>I have permission to use this commercial or announcement, including any music or voices in it.</span></label>
          <button type="submit" className={styles.primary} disabled={issues.length > 0 || Boolean(busy) || !data.canUpload}>{busy === "upload" ? "Uploading and checking audio…" : "Upload recording"}</button>
        </fieldset>
        {busy === "upload" && <div role="status" className={styles.progress}><progress aria-label="Uploading and checking your commercial" /><span>Uploading and checking your recording. Keep this page open until it is confirmed.</span></div>}
        {file && issues.length > 0 && <ul className={styles.help} aria-live="polite">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {!data.canUpload && <p className={styles.notice}>New uploads are currently unavailable for this workspace. Your existing audio and music remain unchanged; ask your administrator to check the upload allowance.</p>}
      </form>
      <div className={styles.inventoryHeading}><h4>Your uploaded recordings</h4><p>{data.uploads.length} of {data.limits.maxUploads} recordings · {retailCommercialUploadSize(data.usedBytes)} used of {retailCommercialUploadSize(data.storageLimitBytes)}</p></div>
      {data.uploads.length ? <ul className={styles.inventory}>{data.uploads.map(recording => { const status = retailCommercialUploadStatus(recording); return <li key={recording.id}><div className={styles.recordingTop}><strong>{recording.name}</strong><span className={`${styles.badge} ${styles[status.tone]}`}>{status.label}</span></div><p>{KINDS.find(entry => entry.value === recording.mediaType)?.label} · {retailCommercialUploadDuration(recording.durationSeconds)} · {retailCommercialUploadSize(recording.sizeBytes)}</p><small>{status.detail}</small>
        {((recording.status === "IN_REVIEW" && recording.qcStatus === "PENDING") || (recording.status === "APPROVED" && recording.qcStatus === "PASSED")) && <div className={styles.preview}><button type="button" disabled={Boolean(busy)} onClick={() => setPreviewId(previous => previous === recording.id ? null : recording.id)}>{previewId === recording.id ? "Close private preview" : "Listen privately"}</button>{previewId === recording.id && <><audio controls preload="none" src={retailCommercialRecordingPreviewPath(recording)} aria-label={`Private preview of ${recording.name}`} onError={() => setError("The private preview is unavailable. Refresh upload status and try again.")} /><small>This preview plays only on your device. It is not sent to your shops.</small></>}</div>}
        {recording.status === "IN_REVIEW" && <fieldset className={styles.review} disabled={Boolean(busy)}><legend>Review this recording</legend><label className={styles.confirm}><input type="checkbox" checked={reviewConfirmations[recording.id] === true} onChange={event => setReviewConfirmations(previous => ({ ...previous, [recording.id]: event.target.checked }))} /><span>I have checked this recording and accept responsibility for its content and permission to use it in my shops.</span></label><label>Review note <small>(required if you reject)</small><input type="text" maxLength={1000} value={reviewNotes[recording.id] || ""} onChange={event => setReviewNotes(previous => ({ ...previous, [recording.id]: event.target.value }))} /></label><div className={styles.reviewActions}><button type="button" className={styles.primary} disabled={Boolean(busy) || reviewConfirmations[recording.id] !== true} onClick={() => void reviewRecording(recording, "APPROVE")}>Approve recording</button><button type="button" disabled={Boolean(busy) || !reviewNotes[recording.id]?.trim()} onClick={() => void reviewRecording(recording, "REJECT")}>Reject recording</button></div></fieldset>}
      </li>; })}</ul> : <p className={styles.empty}>No recordings uploaded yet. Use the form above to add your first shop message.</p>}
      <p className={styles.hint}>Uploading or approving a recording does not change your music. You choose approved recordings for a break, then explicitly approve the saved commercial schedule when it is ready to go on air.</p>
    </>}
  </section>;
}
