"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./programme-director.module.css";

const INITIAL_FORM = { channelId: "", fallbackMusicModeId: "", objective: "CONTINUITY", title: "", brief: "", timezone: "Europe/Malta" };

function label(value) {
  return String(value || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ProgrammeDirectorWorkspace() {
  const [data, setData] = useState({ jobs: [], sources: { channels: [], musicModes: [] }, permissions: {}, dailyLimit: 20 });
  const [form, setForm] = useState(INITIAL_FORM);
  const [edits, setEdits] = useState({});
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function request(path, options) {
    const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options?.headers || {}) } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The operation could not be completed.");
    return body;
  }

  async function load() {
    try {
      const body = await request("/api/programming/programme-director");
      setData(body);
      setForm((current) => ({ ...current, channelId: current.channelId || body.sources.channels[0]?.id || "", fallbackMusicModeId: current.fallbackMusicModeId || body.sources.musicModes[0]?.id || "" }));
      setEdits(Object.fromEntries(body.jobs.map((job) => [job.id, job.approvedText || job.draftText])));
    } catch (caught) { setError(caught.message); }
  }

  useEffect(() => { load(); }, []);
  const pendingCount = useMemo(() => data.jobs.filter((job) => job.status === "NEEDS_REVIEW").length, [data.jobs]);

  async function createRecommendation(event) {
    event.preventDefault(); setBusy("create"); setError(""); setMessage("");
    try {
      const body = await request("/api/programming/programme-director", { method: "POST", body: JSON.stringify(form) });
      setData((current) => ({ ...current, jobs: [body.job, ...current.jobs] }));
      setEdits((current) => ({ ...current, [body.job.id]: body.job.draftText }));
      setForm((current) => ({ ...INITIAL_FORM, channelId: current.channelId, fallbackMusicModeId: current.fallbackMusicModeId, timezone: current.timezone }));
      setMessage(body.notice);
    } catch (caught) { setError(caught.message); } finally { setBusy(""); }
  }

  async function review(jobId, decision) {
    if (decision === "REJECTED" && !window.confirm("Reject and close this recommendation?")) return;
    setBusy(jobId); setError(""); setMessage("");
    try {
      const body = await request(`/api/programming/programme-director/${jobId}/review`, { method: "PATCH", body: JSON.stringify({ decision, editedText: edits[jobId], reviewNote: notes[jobId] || "" }) });
      setData((current) => ({ ...current, jobs: current.jobs.map((job) => job.id === jobId ? { ...job, ...body.job, plan: body.job.plan || job.plan, applied: false } : job) }));
      setMessage(body.notice);
    } catch (caught) { setError(caught.message); } finally { setBusy(""); }
  }

  async function apply(jobId) {
    if (!window.confirm("Create a new schedule draft from this recommendation? Live radio will not change.")) return;
    setBusy(jobId); setError(""); setMessage("");
    try {
      const body = await request(`/api/programming/programme-director/${jobId}/apply`, { method: "POST", body: "{}" });
      setData((current) => ({ ...current, jobs: current.jobs.map((job) => job.id === jobId ? { ...job, applied: true } : job) }));
      setMessage(body.notice);
    } catch (caught) { setError(caught.message); } finally { setBusy(""); }
  }

  const ready = data.sources.channels.length > 0 && data.sources.musicModes.length > 0;
  return <div className={styles.workspace}>
    {message && <div role="status" className={styles.notice}>{message}</div>}
    {error && <div role="alert" className={styles.error}>{error}</div>}
    <section className={styles.metrics} aria-label="Programme Director status"><div><strong>{data.jobs.length}</strong><span>Recommendations</span></div><div><strong>{pendingCount}</strong><span>Awaiting review</span></div><div><strong>{data.sources.channels.length}</strong><span>Eligible channels</span></div><div><strong>{data.dailyLimit}</strong><span>Daily safety limit</span></div></section>

    <form className={styles.panel} onSubmit={createRecommendation}>
      <div className={styles.heading}><div><p className={styles.kicker}>NEW REVIEW</p><h2>Prepare a programme recommendation</h2><p className={styles.muted}>The local rules engine uses scheduling metadata only and carries no external AI cost.</p></div><span>Draft only</span></div>
      {!ready && <div className={styles.guidance}>Activate at least one channel and one playable Music Mode before requesting a recommendation.</div>}
      <div className={styles.formGrid}>
        <label>Channel<select required value={form.channelId} onChange={(event) => setForm({ ...form, channelId: event.target.value })}><option value="">Select channel</option>{data.sources.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        <label>Continuity Music Mode<select required value={form.fallbackMusicModeId} onChange={(event) => setForm({ ...form, fallbackMusicModeId: event.target.value })}><option value="">Select Music Mode</option>{data.sources.musicModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}</select></label>
        <label>Programming objective<select value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })}><option value="CONTINUITY">24/7 continuity</option><option value="DAYPART_BALANCE">Daypart balance</option><option value="ROTATION_VARIETY">Rotation variety</option></select></label>
        <label>Timezone<input required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label>
        <label className={styles.wide}>Plan title<input required maxLength="160" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Weekday continuity review" /></label>
        <label className={styles.wide}>Programming brief<textarea required minLength="10" maxLength="2000" rows="4" value={form.brief} onChange={(event) => setForm({ ...form, brief: event.target.value })} placeholder="Describe the audience, sound, dayparts and constraints. Do not include personal or student data." /></label>
      </div>
      <div className={styles.actions}><button disabled={!ready || !data.permissions.canRequest || busy === "create"}>{busy === "create" ? "Preparing…" : "Create recommendation"}</button></div>
    </form>

    <section className={styles.recommendations}>
      <div className={styles.heading}><div><p className={styles.kicker}>GOVERNED WORKFLOW</p><h2>Recommendations and decisions</h2></div></div>
      {!data.jobs.length && <div className={styles.empty}>No programme recommendations yet.</div>}
      {data.jobs.map((job) => <article className={styles.card} key={job.id}>
        <div className={styles.cardHead}><div><p className={styles.kicker}>{label(job.plan?.objective)}</p><h3>{job.plan?.title || "Programme recommendation"}</h3><p className={styles.muted}>{[job.plan?.stationName, job.plan?.channelName].filter(Boolean).join(" / ")} · requested by {job.requestedBy?.name || job.requestedBy?.email}</p></div><span className={`${styles.badge} ${job.status === "APPROVED" ? styles.approved : job.status === "REJECTED" ? styles.rejected : ""}`}>{job.applied ? "Applied to draft" : label(job.status)}</span></div>
        {job.plan?.evidence && <dl className={styles.evidence}><div><dt>Existing items</dt><dd>{job.plan.evidence.baselineItemCount}</dd></div><div><dt>Continuity items</dt><dd>{job.plan.evidence.continuityItemsAdded}</dd></div><div><dt>External data</dt><dd>None</dd></div><div><dt>Live change</dt><dd>Not allowed</dd></div></dl>}
        <label>Recommendation<textarea rows="13" disabled={job.status !== "NEEDS_REVIEW"} value={edits[job.id] ?? job.approvedText ?? job.draftText} onChange={(event) => setEdits({ ...edits, [job.id]: event.target.value })} /></label>
        {job.status === "NEEDS_REVIEW" && data.permissions.canReview && <><label>Decision note<input value={notes[job.id] || ""} onChange={(event) => setNotes({ ...notes, [job.id]: event.target.value })} placeholder="Record what you checked or changed" /></label><div className={styles.actions}><button disabled={busy === job.id} onClick={() => review(job.id, "APPROVED")} type="button">Approve recommendation</button><button disabled={busy === job.id} className={styles.danger} onClick={() => review(job.id, "REJECTED")} type="button">Reject</button></div></>}
        {job.status === "APPROVED" && data.permissions.canApply && <div className={styles.actions}><button type="button" disabled={busy === job.id || job.applied} onClick={() => apply(job.id)}>{job.applied ? "Schedule draft created" : "Create schedule draft"}</button>{job.applied && <a href="/dashboard/programming">Open Programming</a>}</div>}
        <p className={styles.guardrail}>Approval and draft creation are recorded separately. Publishing remains available only through the normal schedule preview and approval workflow.</p>
      </article>)}
    </section>
  </div>;
}
