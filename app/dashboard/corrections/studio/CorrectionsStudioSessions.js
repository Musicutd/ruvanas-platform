"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../corrections.module.css";

async function send(path, method, body) {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

export default function CorrectionsStudioSessions() {
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [sourceChoices, setSourceChoices] = useState({});
  const [contributor, setContributor] = useState({ facilityId: "", displayName: "", localReference: "" });
  const [session, setSession] = useState({ facilityId: "", contributorId: "", programmeId: "", priorProjectId: "", title: "", projectType: "QUICK_RECORD" });
  const [minutes, setMinutes] = useState(120);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/corrections/studio-sessions", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Studio sessions could not be loaded.");
    setData(result);
  }, []);
  useEffect(() => { refresh().catch((error) => setNotice(error.message)); }, [refresh]);
  const act = async (operation, success) => {
    setBusy(true); setAccessCode("");
    try { const result = await operation(); setNotice(success); if (result?.accessCode) setAccessCode(result.accessCode); await refresh(); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const availableContributors = data?.contributors.filter((item) => item.facilityId === session.facilityId) || [];
  const availableProgrammes = data?.programmes.filter((item) => item.facilityId === session.facilityId) || [];
  const priorSessions = data?.sessions.filter((item) => item.facilityId === session.facilityId && item.contributorId === session.contributorId && item.programmeId === session.programmeId && item.projectType === session.projectType && item.status !== "ACTIVE") || [];
  return <main className={styles.page}>
    <div className={styles.hero}><span className={styles.eyebrow}>Ruvanas Inside · Studio</span><h1>Supervised Studio sessions</h1><p>Assign one contributor to one programme and Studio project for a limited time. Their work enters staff review; it does not go on air.</p><p><a href="/dashboard/corrections/programmes">Open programmes and review →</a></p></div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!data ? <p>Loading supervised Studio…</p> : <>
      <section className={styles.card}><span className={styles.eyebrow}>1 · Contributor</span><h2>Add a contributor</h2><p className={styles.muted}>Use a short display name or pseudonym. No email or ordinary Ruvanas account is created.</p>
        <div className={styles.fields}><label>Facility<select value={contributor.facilityId} onChange={(event) => setContributor({ ...contributor, facilityId: event.target.value })}><option value="">Choose a facility</option>{data.facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Display name<input value={contributor.displayName} maxLength={100} onChange={(event) => setContributor({ ...contributor, displayName: event.target.value })} /></label><label>Local reference (optional)<input value={contributor.localReference} maxLength={80} onChange={(event) => setContributor({ ...contributor, localReference: event.target.value })} /></label></div>
        <button type="button" disabled={busy || !contributor.facilityId || contributor.displayName.trim().length < 2} onClick={() => act(() => send("/api/corrections/contributors", "POST", contributor), "Contributor saved for this facility.")}>Add contributor</button>
      </section>
      <section className={styles.card}><span className={styles.eyebrow}>2 · Assignment</span><h2>Prepare a supervised session</h2><div className={styles.fields}>
        <label>Facility<select value={session.facilityId} onChange={(event) => setSession({ facilityId: event.target.value, contributorId: "", programmeId: "", priorProjectId: "", title: "", projectType: "QUICK_RECORD" })}><option value="">Choose a facility</option>{data.facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Contributor<select value={session.contributorId} onChange={(event) => setSession({ ...session, contributorId: event.target.value, priorProjectId: "" })}><option value="">Choose a contributor</option>{availableContributors.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <label>Programme<select value={session.programmeId} onChange={(event) => setSession({ ...session, programmeId: event.target.value, priorProjectId: "" })}><option value="">Choose a draft or returned programme</option>{availableProgrammes.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status.replaceAll("_", " ")}</option>)}</select></label>
        <label>Studio tool<select value={session.projectType} onChange={(event) => setSession({ ...session, projectType: event.target.value, priorProjectId: "" })}><option value="QUICK_RECORD">Waveform editor · Tier 2+</option>{data.studioProEnabled && <option value="MULTITRACK">Multitrack mixer · Tier 3+</option>}</select></label>
        <label>Studio project<select value={session.priorProjectId} onChange={(event) => setSession({ ...session, priorProjectId: event.target.value })}><option value="">Create a new protected project</option>{priorSessions.map((item) => <option key={item.id} value={item.projectId}>Continue {item.projectTitle}</option>)}</select></label>
        {!session.priorProjectId && <label>Project title (optional)<input value={session.title} maxLength={160} onChange={(event) => setSession({ ...session, title: event.target.value })} placeholder="Use programme title" /></label>}
      </div><button type="button" disabled={busy || !session.facilityId || !session.contributorId || !session.programmeId} onClick={() => act(() => send("/api/corrections/studio-sessions", "POST", session), "Draft session created. Activate it when a supervisor is present.")}>Prepare session</button></section>
      <section className={styles.card}><span className={styles.eyebrow}>3 · Supervise</span><h2>Sessions</h2><p className={styles.muted}>Open the contributor workspace in a separate private browser window without your staff sign-in. Give the access code only to the assigned contributor while supervising.</p><label>Session length (minutes)<input type="number" min="15" max="240" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
        {accessCode && <div className={styles.notice} role="status"><strong>Time-limited session code — copy it now</strong><p><code>{accessCode}</code></p><p>Open <a href="/corrections-contributor" target="_blank" rel="noreferrer">Contributor Studio</a> in a separate private browser window. This code will not be shown again; revoke the session if it is exposed.</p></div>}
        {!data.sessions.length ? <p>No supervised sessions yet.</p> : data.sessions.map((item) => <div key={item.id} className={styles.staffRow}><div><strong>{item.programmeTitle}</strong><p className={styles.muted}>{item.facilityName} · {item.contributorName} · {item.projectTitle} · {item.status.toLowerCase()}</p>{item.expiresAt && <small>Expires {new Date(item.expiresAt).toLocaleString()}</small>}{item.submission && <p><a href="/dashboard/corrections/programmes">Review revision {item.submission.revision} →</a></p>}{["DRAFT", "ACTIVE"].includes(item.status) && (data.approvedSources?.length ? <div><label>Approved jingle, voice or announcement<select value={sourceChoices[item.id] || ""} onChange={(event) => setSourceChoices({ ...sourceChoices, [item.id]: event.target.value })}><option value="">Choose a sound to add</option>{data.approvedSources.map((source) => <option key={source.id} value={source.id}>{source.label} · {source.mediaType.toLowerCase()}</option>)}</select></label><button type="button" disabled={busy || !sourceChoices[item.id]} onClick={() => act(() => send(`/api/corrections/studio-sessions/${item.id}/sources`, "POST", { promoVersionId: sourceChoices[item.id] }), "Approved sound added to this project. The contributor can now use it in the editor.")}>Add approved sound</button></div> : <small>No approved organisation jingles or voice sounds are ready.</small>)}</div><div>{item.status === "DRAFT" && <button type="button" disabled={busy} onClick={() => act(() => send(`/api/corrections/studio-sessions/${item.id}`, "POST", { action: "ACTIVATE", minutes }), "Session active. Copy the code below now.")}>Activate</button>}{["ACTIVE", "EXPIRED"].includes(item.status) && <><button type="button" disabled={busy} onClick={() => act(() => send(`/api/corrections/studio-sessions/${item.id}`, "POST", { action: "CLOSE" }), "Session closed. Saved work remains available.")}>Close</button> {item.status === "ACTIVE" && <button type="button" disabled={busy} onClick={() => act(() => send(`/api/corrections/studio-sessions/${item.id}`, "POST", { action: "REVOKE" }), "Access revoked immediately. Saved work remains.")}>Revoke</button>}</>}</div></div>)}
      </section>
    </>}
  </main>;
}
