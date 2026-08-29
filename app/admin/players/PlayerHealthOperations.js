"use client";

import { useCallback, useEffect, useState } from "react";

export default function PlayerHealthOperations() {
  const [report, setReport] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/players/health", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load player health.");
      setReport(data);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load player health.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(incident, action) {
    const note = String(notes[incident.id] || "").trim();
    if (note.length < 3) {
      setError("Add a short operational note before changing an incident.");
      return;
    }
    setBusy(`${incident.id}:${action}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/players/health/${incident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the incident.");
      setNotes((current) => ({ ...current, [incident.id]: "" }));
      await load();
    } catch (actionError) {
      setError(actionError.message || "Unable to update the incident.");
    } finally {
      setBusy(null);
    }
  }

  if (!report) return <section style={styles.card}><p style={styles.muted}>{error || "Loading sampled heartbeat history and incidents…"}</p></section>;
  const unresolved = report.incidents.filter((incident) => incident.status !== "RESOLVED");
  const recentResolved = report.incidents.filter((incident) => incident.status === "RESOLVED").slice(0, 10);

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>STAGE 11A · OPERATIONAL HEALTH</p>
          <h2 style={styles.title}>Heartbeat history and incident register</h2>
          <p style={styles.muted}>Five-minute heartbeat samples preserve useful history without storing every 30-second request. Missing-heartbeat incidents are opened by the operations worker and resolved automatically when the player recovers.</p>
        </div>
        <button type="button" onClick={load} style={styles.secondary}>Refresh</button>
      </div>

      <div style={styles.metrics}>
        <Metric label="Registered" value={report.summary.totalPlayers} />
        <Metric label="Currently offline" value={report.summary.offlinePlayers} tone={report.summary.offlinePlayers ? "warning" : "good"} />
        <Metric label="Open incidents" value={report.summary.openIncidents} tone={report.summary.openIncidents ? "warning" : "good"} />
        <Metric label="Critical" value={report.summary.criticalIncidents} tone={report.summary.criticalIncidents ? "danger" : "good"} />
      </div>

      {error ? <p style={styles.error}>{error}</p> : null}
      <h3 style={styles.subheading}>Unresolved incidents</h3>
      {unresolved.length === 0 ? <p style={styles.goodMessage}>No unresolved player-health incidents.</p> : unresolved.map((incident) => (
        <article key={incident.id} style={{ ...styles.incident, ...(incident.severity === "CRITICAL" ? styles.criticalIncident : {}) }}>
          <div style={styles.incidentHeader}>
            <strong>{incident.player.name}</strong>
            <span style={{ ...styles.badge, ...severityStyle(incident.severity) }}>{incident.severity}</span>
            <span style={styles.status}>{incident.status}</span>
          </div>
          <p style={styles.summary}>{incident.summary}</p>
          <p style={styles.meta}>{incident.organisation.name} · first observed {formatDate(incident.firstObservedAt)} · last checked {formatDate(incident.lastObservedAt)}</p>
          <textarea value={notes[incident.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [incident.id]: event.target.value }))} maxLength={2000} placeholder="Operational acknowledgement or resolution note" style={styles.textarea} />
          <div style={styles.actions}>
            {incident.status === "OPEN" ? <button type="button" disabled={Boolean(busy)} onClick={() => act(incident, "ACKNOWLEDGE")} style={styles.secondary}>{busy === `${incident.id}:ACKNOWLEDGE` ? "Saving…" : "Acknowledge"}</button> : null}
            <button type="button" disabled={Boolean(busy)} onClick={() => act(incident, "RESOLVE")} style={styles.primary}>{busy === `${incident.id}:RESOLVE` ? "Saving…" : "Resolve with note"}</button>
          </div>
        </article>
      ))}

      <h3 style={styles.subheading}>Recent resolved incidents</h3>
      {recentResolved.length === 0 ? <p style={styles.muted}>No resolved incidents are recorded yet.</p> : (
        <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th style={styles.th}>Player</th><th style={styles.th}>Organisation</th><th style={styles.th}>Severity</th><th style={styles.th}>Observed</th><th style={styles.th}>Resolution</th></tr></thead><tbody>{recentResolved.map((incident) => <tr key={incident.id}><td style={styles.tdStrong}>{incident.player.name}</td><td style={styles.td}>{incident.organisation.name}</td><td style={styles.td}>{incident.severity}</td><td style={styles.td}>{formatDate(incident.firstObservedAt)}</td><td style={styles.td}>{incident.resolutionNote || "Resolved"}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function Metric({ label, value, tone = "neutral" }) {
  const colors = tone === "danger" ? styles.metricDanger : tone === "warning" ? styles.metricWarning : tone === "good" ? styles.metricGood : styles.metricNeutral;
  return <div style={{ ...styles.metric, ...colors }}><strong style={styles.metricValue}>{value}</strong><span>{label}</span></div>;
}

function severityStyle(severity) {
  if (severity === "CRITICAL") return { background: "#fee2e2", color: "#991b1b" };
  if (severity === "HIGH") return { background: "#ffedd5", color: "#9a3412" };
  if (severity === "MEDIUM") return { background: "#fef3c7", color: "#92400e" };
  return { background: "#e0f2fe", color: "#075985" };
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

const styles = {
  card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 22, background: "#fff" },
  header: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "start", flexWrap: "wrap" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.3 },
  title: { margin: 0, fontSize: 24, color: "#0f172a" },
  muted: { color: "#475569", lineHeight: 1.55, maxWidth: 820 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "18px 0 24px" },
  metric: { display: "grid", gap: 4, padding: 14, borderRadius: 9, border: "1px solid" },
  metricValue: { fontSize: 26 },
  metricNeutral: { background: "#f8fafc", borderColor: "#cbd5e1", color: "#334155" },
  metricGood: { background: "#f0fdf4", borderColor: "#86efac", color: "#166534" },
  metricWarning: { background: "#fffbeb", borderColor: "#fcd34d", color: "#92400e" },
  metricDanger: { background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" },
  subheading: { margin: "24px 0 12px", fontSize: 18, color: "#0f172a" },
  goodMessage: { padding: 12, borderRadius: 8, background: "#f0fdf4", color: "#166534", fontWeight: 800 },
  error: { padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontWeight: 800 },
  incident: { border: "1px solid #cbd5e1", borderRadius: 10, padding: 16, marginBottom: 12, background: "#f8fafc" },
  criticalIncident: { borderColor: "#ef4444", background: "#fff7f7" },
  incidentHeader: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  badge: { padding: "4px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900 },
  status: { color: "#475569", fontSize: 12, fontWeight: 900 },
  summary: { margin: "10px 0 4px", color: "#0f172a", fontWeight: 700 },
  meta: { margin: "0 0 12px", color: "#64748b", fontSize: 13 },
  textarea: { width: "100%", minHeight: 72, boxSizing: "border-box", border: "1px solid #94a3b8", borderRadius: 7, padding: 10, resize: "vertical" },
  actions: { display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" },
  primary: { border: 0, borderRadius: 7, padding: "9px 14px", background: "#0f172a", color: "#fff", fontWeight: 800, cursor: "pointer" },
  secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 760 },
  th: { padding: 10, textAlign: "left", borderBottom: "2px solid #cbd5e1", color: "#475569", fontSize: 13 },
  td: { padding: 10, borderBottom: "1px solid #e2e8f0", color: "#334155", verticalAlign: "top" },
  tdStrong: { padding: 10, borderBottom: "1px solid #e2e8f0", fontWeight: 800, verticalAlign: "top" }
};
