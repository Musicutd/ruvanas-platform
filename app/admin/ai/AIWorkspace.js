"use client";

import { useMemo, useState } from "react";

const TYPES = [
  ["PROMO_SCRIPT", "Retail promo script"],
  ["SCHEDULE_RULES", "Schedule proposal"],
  ["ANALYTICS_SUMMARY", "Analytics narrative"],
  ["SCHOOL_SCRIPT", "School radio script"],
  ["SCHOOL_SHOW_PLAN", "School show plan"],
  ["SCHOOL_PRONUNCIATION", "Pronunciation preparation"]
];

const INITIAL_FORM = {
  organisationId: "",
  assistantType: "PROMO_SCRIPT",
  dataClassification: "INTERNAL",
  title: "",
  audience: "",
  brief: "",
  callToAction: "",
  tone: "clear and professional",
  durationSeconds: 30
};

function label(value) {
  return String(value || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AIWorkspace({ organisations, initialJobs }) {
  const [form, setForm] = useState({ ...INITIAL_FORM, organisationId: organisations[0]?.id || "" });
  const [jobs, setJobs] = useState(initialJobs);
  const [edits, setEdits] = useState(Object.fromEntries(initialJobs.map((job) => [job.id, job.approvedText || job.draftText])));
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pendingCount = useMemo(() => jobs.filter((job) => job.status === "NEEDS_REVIEW").length, [jobs]);

  async function request(path, options) {
    const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options?.headers || {}) } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The operation could not be completed.");
    return body;
  }

  async function createDraft(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const body = await request("/api/admin/ai/jobs", { method: "POST", body: JSON.stringify(form) });
      setJobs((current) => [body.job, ...current]);
      setEdits((current) => ({ ...current, [body.job.id]: body.job.draftText }));
      setForm((current) => ({ ...INITIAL_FORM, organisationId: current.organisationId, assistantType: current.assistantType, dataClassification: current.dataClassification }));
      setMessage(body.notice);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function review(jobId, decision) {
    if (decision === "REJECTED" && !window.confirm("Reject and close this assistant draft?")) return;
    setBusy(true);
    setMessage("");
    try {
      const body = await request(`/api/admin/ai/jobs/${jobId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ decision, editedText: edits[jobId], reviewNote: notes[jobId] || "" })
      });
      setJobs((current) => current.map((job) => job.id === jobId ? body.job : job));
      setMessage(body.notice);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={styles.stack}>
      {message && <div role="status" style={styles.message}>{message}</div>}
      <form onSubmit={createDraft} style={styles.panel}>
        <div style={styles.panelHeading}>
          <div><h2 style={styles.heading}>Create an assistant draft</h2><p style={styles.help}>Local template provider · no third-party data sharing · review required</p></div>
          <span style={styles.badge}>{pendingCount} awaiting review</span>
        </div>
        <div style={styles.grid}>
          <label style={styles.label}>Organisation<select required style={styles.input} value={form.organisationId} onChange={(event) => setForm({ ...form, organisationId: event.target.value })}>{organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}{organisation.schoolProfile ? " · School enabled" : ""}</option>)}</select></label>
          <label style={styles.label}>Assistant<select style={styles.input} value={form.assistantType} onChange={(event) => setForm({ ...form, assistantType: event.target.value })}>{TYPES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
          <label style={styles.label}>Data classification<select style={styles.input} value={form.dataClassification} onChange={(event) => setForm({ ...form, dataClassification: event.target.value })}><option value="INTERNAL">Internal</option><option value="CUSTOMER_CONTENT">Customer content</option><option value="SCHOOL_CONTENT">School content</option><option value="SCHOOL_STUDENT_DATA">School student data</option></select></label>
          <label style={styles.label}>Target duration (seconds)<input required style={styles.input} type="number" min="10" max="3600" value={form.durationSeconds} onChange={(event) => setForm({ ...form, durationSeconds: event.target.value })} /></label>
          <label style={styles.label}>Working title<input required style={styles.input} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label style={styles.label}>Audience<input required style={styles.input} value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} /></label>
          <label style={styles.label}>Tone<input required style={styles.input} value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value })} /></label>
          <label style={styles.label}>Call to action (optional)<input style={styles.input} value={form.callToAction} onChange={(event) => setForm({ ...form, callToAction: event.target.value })} /></label>
          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>Brief<textarea required style={styles.textarea} rows="5" value={form.brief} onChange={(event) => setForm({ ...form, brief: event.target.value })} placeholder="Describe the message, verified facts and constraints. Do not include unnecessary personal data." /></label>
        </div>
        <button style={styles.primary} disabled={busy || !form.organisationId}>{busy ? "Working…" : "Create review draft"}</button>
      </form>

      <div style={styles.jobs}>
        {jobs.length === 0 && <div style={styles.empty}>No assistant drafts have been created.</div>}
        {jobs.map((job) => <article key={job.id} style={styles.job}>
          <div style={styles.panelHeading}>
            <div><h3 style={styles.jobTitle}>{label(job.assistantType)} · {job.organisation.name}</h3><p style={styles.help}>Requested by {job.requestedBy.name || job.requestedBy.email} · {new Date(job.createdAt).toLocaleString()}</p></div>
            <span style={{ ...styles.badge, ...(job.status === "APPROVED" ? styles.approved : job.status === "REJECTED" ? styles.rejected : {}) }}>{label(job.status)}</span>
          </div>
          <div style={styles.meta}><span>{label(job.dataClassification)}</span><span>{job.providerKey}</span><span>{job.privateDataSent ? "External data shared" : "No external data shared"}</span><span>Auto-publish disabled</span></div>
          <label style={styles.label}>{job.status === "NEEDS_REVIEW" ? "Editable draft" : "Reviewed artifact"}<textarea style={styles.textarea} rows="12" disabled={job.status !== "NEEDS_REVIEW"} value={edits[job.id] ?? job.approvedText ?? job.draftText} onChange={(event) => setEdits({ ...edits, [job.id]: event.target.value })} /></label>
          {job.status === "NEEDS_REVIEW" && <><label style={styles.label}>Review note<input style={styles.input} value={notes[job.id] || ""} onChange={(event) => setNotes({ ...notes, [job.id]: event.target.value })} /></label><div style={styles.actions}><button type="button" style={styles.primary} disabled={busy} onClick={() => review(job.id, "APPROVED")}>Approve internal artifact</button><button type="button" style={styles.danger} disabled={busy} onClick={() => review(job.id, "REJECTED")}>Reject draft</button></div></>}
          {job.reviewedBy && <p style={styles.help}>Reviewed by {job.reviewedBy.name || job.reviewedBy.email}{job.reviewNote ? ` · ${job.reviewNote}` : ""}. Approval does not publish or schedule content.</p>}
        </article>)}
      </div>
    </section>
  );
}

const styles = {
  stack: { display: "grid", gap: 20 },
  panel: { padding: 20, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" },
  panelHeading: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  heading: { margin: 0, color: "#111827", fontSize: 22 },
  help: { margin: "5px 0", color: "#64748b", fontSize: 12, lineHeight: 1.45 },
  badge: { padding: "6px 9px", borderRadius: 999, background: "#fff3cd", color: "#765400", fontSize: 12, fontWeight: 900 },
  approved: { background: "#dcfce7", color: "#166534" },
  rejected: { background: "#fee2e2", color: "#991b1b" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 12, marginTop: 16 },
  label: { display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#111827", fontSize: 14 },
  textarea: { width: "100%", boxSizing: "border-box", padding: 12, border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#111827", font: "14px/1.5 system-ui, sans-serif", resize: "vertical" },
  primary: { marginTop: 12, padding: "10px 14px", border: 0, borderRadius: 7, background: "#172033", color: "#fff", fontWeight: 850, cursor: "pointer" },
  danger: { marginTop: 12, padding: "9px 13px", border: "1px solid #b42318", borderRadius: 7, background: "#fff", color: "#b42318", fontWeight: 850, cursor: "pointer" },
  message: { padding: 11, borderRadius: 8, background: "#e8f4ff", color: "#164e75", fontSize: 13, fontWeight: 750 },
  jobs: { display: "grid", gap: 14 },
  job: { display: "grid", gap: 13, padding: 20, border: "1px solid #cbd5e1", borderRadius: 12, background: "#fff" },
  jobTitle: { margin: 0, color: "#111827", fontSize: 18 },
  meta: { display: "flex", gap: 8, flexWrap: "wrap", color: "#475569", fontSize: 12 },
  actions: { display: "flex", gap: 9, flexWrap: "wrap" },
  empty: { padding: 20, border: "1px dashed #94a3b8", borderRadius: 10, color: "#64748b" }
};

