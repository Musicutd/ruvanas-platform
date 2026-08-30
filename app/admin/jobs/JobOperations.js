"use client";

import { useCallback, useEffect, useState } from "react";

const STATUSES = ["QUEUED", "LEASED", "RETRY_SCHEDULED", "SUCCEEDED", "DEAD_LETTER"];

export default function JobOperations() {
  const [report, setReport] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/jobs", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load background jobs.");
      setReport(body);
    } catch (loadError) {
      setError(loadError.message || "Unable to load background jobs.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function retry(job) {
    const note = String(notes[job.id] || "").trim();
    if (note.length < 8) {
      setError("Add an operational note of at least eight characters before retrying a dead-letter job.");
      return;
    }
    setBusy(job.id);
    setError("");
    try {
      const response = await fetch("/api/admin/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "RETRY", note })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to retry the background job.");
      setNotes((current) => ({ ...current, [job.id]: "" }));
      await load();
    } catch (retryError) {
      setError(retryError.message || "Unable to retry the background job.");
    } finally {
      setBusy("");
    }
  }

  return <section style={styles.card}>
    <div style={styles.header}>
      <div>
        <h2 style={styles.title}>Worker queue</h2>
        <p style={styles.muted}>Retries use bounded exponential backoff. Manual recovery is limited to dead-letter jobs and produces an audit record.</p>
      </div>
      <button type="button" onClick={load} style={styles.secondary}>Refresh</button>
    </div>
    {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    <div style={styles.metrics}>{STATUSES.map((status) => <Metric key={status} label={status.replaceAll("_", " ")} value={report?.summary?.[status] || 0} warning={status === "DEAD_LETTER" && (report?.summary?.[status] || 0) > 0} />)}</div>
    {!report ? <p style={styles.muted}>Loading queue state…</p> : report.jobs.length === 0 ? <p style={styles.good}>No background jobs are recorded.</p> : <div style={{ overflowX: "auto" }}>
      <table style={styles.table}>
        <thead><tr><th style={styles.th}>Created</th><th style={styles.th}>Organisation</th><th style={styles.th}>Type / status</th><th style={styles.th}>Attempts</th><th style={styles.th}>Correlation</th><th style={styles.th}>Recovery</th></tr></thead>
        <tbody>{report.jobs.map((job) => <tr key={job.id}>
          <td style={styles.td}>{formatDate(job.createdAt)}</td>
          <td style={styles.tdStrong}>{job.organisation?.name || "Platform"}</td>
          <td style={styles.td}><strong>{job.type.replaceAll("_", " ")}</strong><br /><span style={{ ...styles.badge, ...statusStyle(job.status) }}>{job.status.replaceAll("_", " ")}</span>{job.lastErrorCode ? <><br /><small>{job.lastErrorCode}</small></> : null}</td>
          <td style={styles.td}>{job.attempts} / {job.maxAttempts}</td>
          <td style={styles.td}><code style={styles.code}>{job.correlationId}</code></td>
          <td style={styles.td}>{job.status === "DEAD_LETTER" ? <div style={styles.retryBox}><textarea value={notes[job.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [job.id]: event.target.value }))} maxLength={500} placeholder="Reason for manual retry" style={styles.textarea} /><button type="button" disabled={Boolean(busy)} onClick={() => retry(job)} style={styles.primary}>{busy === job.id ? "Queuing…" : "Retry safely"}</button></div> : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

function Metric({ label, value, warning }) {
  return <div style={{ ...styles.metric, ...(warning ? styles.metricWarning : {}) }}><strong style={styles.metricValue}>{value}</strong><span>{label}</span></div>;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function statusStyle(status) {
  if (status === "SUCCEEDED") return { background: "#dcfce7", color: "#166534" };
  if (status === "DEAD_LETTER") return { background: "#fee2e2", color: "#991b1b" };
  if (status === "LEASED") return { background: "#dbeafe", color: "#1e40af" };
  return { background: "#fef3c7", color: "#92400e" };
}

const styles = {
  card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 22, background: "#fff" },
  header: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "start", flexWrap: "wrap" },
  title: { margin: 0, fontSize: 24 },
  muted: { color: "#475569", lineHeight: 1.55, maxWidth: 820 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10, margin: "18px 0 22px" },
  metric: { display: "grid", gap: 4, padding: 13, borderRadius: 9, border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155" },
  metricWarning: { background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" },
  metricValue: { fontSize: 25 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 980 },
  th: { padding: 10, textAlign: "left", borderBottom: "2px solid #cbd5e1", color: "#475569", fontSize: 13 },
  td: { padding: 10, borderBottom: "1px solid #e2e8f0", color: "#334155", verticalAlign: "top" },
  tdStrong: { padding: 10, borderBottom: "1px solid #e2e8f0", fontWeight: 800, verticalAlign: "top" },
  badge: { display: "inline-block", marginTop: 5, padding: "4px 7px", borderRadius: 999, fontSize: 11, fontWeight: 900 },
  code: { fontSize: 11, overflowWrap: "anywhere" },
  retryBox: { display: "grid", gap: 7, minWidth: 210 },
  textarea: { minHeight: 58, border: "1px solid #94a3b8", borderRadius: 7, padding: 8, resize: "vertical" },
  primary: { border: 0, borderRadius: 7, padding: "9px 12px", background: "#0f172a", color: "#fff", fontWeight: 800, cursor: "pointer" },
  secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" },
  good: { padding: 12, borderRadius: 8, background: "#f0fdf4", color: "#166534", fontWeight: 800 },
  error: { padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontWeight: 800 }
};
