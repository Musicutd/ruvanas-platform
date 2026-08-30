"use client";

import { useCallback, useEffect, useState } from "react";

export default function StreamSourceOperations() {
  const [report, setReport] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/streams/health", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load stream source health.");
      setReport(data);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load stream source health.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function probe(station) {
    setBusy(`probe:${station.id}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/streams/${station.id}/probe`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to probe this stream.");
      await load();
    } catch (probeError) {
      setError(probeError.message || "Unable to probe this stream.");
    } finally {
      setBusy("");
    }
  }

  async function act(incident, action) {
    const note = String(notes[incident.id] || "").trim();
    if (note.length < 3) return setError("Add a short operational note before changing an incident.");
    setBusy(`${incident.id}:${action}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/streams/health/${incident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the stream incident.");
      setNotes((current) => ({ ...current, [incident.id]: "" }));
      await load();
    } catch (actionError) {
      setError(actionError.message || "Unable to update the stream incident.");
    } finally {
      setBusy("");
    }
  }

  if (!report) return <section style={styles.card}><p style={styles.muted}>{error || "Loading stream source health…"}</p></section>;
  const unresolved = report.incidents.filter((incident) => incident.status !== "RESOLVED");

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>STAGE 11C · SOURCE RELIABILITY</p>
          <h2 style={styles.title}>Stream source health</h2>
          <p style={styles.muted}>Public stream sources are checked separately from player heartbeats. Repeated failures open an operational incident; a healthy recovery resolves it automatically.</p>
        </div>
        <button type="button" onClick={load} style={styles.secondary}>Refresh</button>
      </div>

      <div style={styles.metrics}>
        <Metric label="Configured" value={report.summary.configuredStations} />
        <Metric label="Healthy" value={report.summary.healthyStations} tone="good" />
        <Metric label="Failing checks" value={report.summary.failingStations} tone={report.summary.failingStations ? "warning" : "good"} />
        <Metric label="Open incidents" value={report.summary.openIncidents} tone={report.summary.openIncidents ? "danger" : "good"} />
      </div>

      {error ? <p style={styles.error}>{error}</p> : null}
      <h3 style={styles.subheading}>Configured sources</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={styles.table}>
          <thead><tr><th style={styles.th}>Station</th><th style={styles.th}>Provider</th><th style={styles.th}>Source status</th><th style={styles.th}>Last probe</th><th style={styles.th}>Failures</th><th style={styles.th}>Action</th></tr></thead>
          <tbody>{report.stations.map((station) => {
            const config = station.streamConfig;
            return <tr key={station.id}>
              <td style={styles.tdStrong}>{station.name}<small style={styles.small}>{station.organisation.name}</small></td>
              <td style={styles.td}>{config ? config.providerKey.replaceAll("_", " ") : "Not configured"}</td>
              <td style={styles.td}><Status value={config?.sourceConnectionStatus || "NOT CONFIGURED"} /></td>
              <td style={styles.td}>{formatDate(config?.lastProbeAt)}{config?.lastProbeLatencyMs != null ? <small style={styles.small}>{config.lastProbeLatencyMs} ms · HTTP {config.lastProbeHttpStatus || "—"}</small> : null}</td>
              <td style={styles.td}>{config?.consecutiveFailures || 0}{config?.lastError ? <small style={styles.small}>{config.lastError}</small> : null}</td>
              <td style={styles.td}><button type="button" disabled={!config?.streamUrl || Boolean(busy)} onClick={() => probe(station)} style={styles.secondary}>{busy === `probe:${station.id}` ? "Checking…" : "Probe now"}</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      <h3 style={styles.subheading}>Unresolved source incidents</h3>
      {unresolved.length === 0 ? <p style={styles.goodMessage}>No unresolved stream-source incidents.</p> : unresolved.map((incident) => (
        <article key={incident.id} style={styles.incident}>
          <div style={styles.incidentHeader}><strong>{incident.station.name}</strong><Status value={incident.severity} /><span style={styles.status}>{incident.status}</span></div>
          <p style={styles.summary}>{incident.summary}</p>
          <p style={styles.meta}>{incident.organisation.name} · first observed {formatDate(incident.firstObservedAt)} · last checked {formatDate(incident.lastObservedAt)}</p>
          <textarea value={notes[incident.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [incident.id]: event.target.value }))} maxLength={2000} placeholder="Operational acknowledgement or resolution note" style={styles.textarea} />
          <div style={styles.actions}>
            {incident.status === "OPEN" ? <button type="button" disabled={Boolean(busy)} onClick={() => act(incident, "ACKNOWLEDGE")} style={styles.secondary}>Acknowledge</button> : null}
            <button type="button" disabled={Boolean(busy)} onClick={() => act(incident, "RESOLVE")} style={styles.primary}>Resolve with note</button>
          </div>
        </article>
      ))}
    </section>
  );
}

function Metric({ label, value, tone = "neutral" }) {
  const colors = tone === "danger" ? styles.metricDanger : tone === "warning" ? styles.metricWarning : tone === "good" ? styles.metricGood : styles.metricNeutral;
  return <div style={{ ...styles.metric, ...colors }}><strong style={styles.metricValue}>{value}</strong><span>{label}</span></div>;
}

function Status({ value }) {
  const status = String(value || "UNKNOWN");
  const tone = new Set(["CONNECTED", "HEALTHY", "LOW"]).has(status) ? styles.statusGood : new Set(["ERROR", "UNREACHABLE", "CRITICAL", "HIGH"]).has(status) ? styles.statusDanger : styles.statusWarning;
  return <span style={{ ...styles.badge, ...tone }}>{status.replaceAll("_", " ")}</span>;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not checked yet";
}

const styles = {
  card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 22, background: "#fff", marginBottom: 24 },
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
  error: { padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontWeight: 800 },
  goodMessage: { padding: 12, borderRadius: 8, background: "#f0fdf4", color: "#166534", fontWeight: 800 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
  th: { padding: 10, textAlign: "left", borderBottom: "2px solid #cbd5e1", color: "#475569", fontSize: 13 },
  td: { padding: 10, borderBottom: "1px solid #e2e8f0", color: "#334155", verticalAlign: "top" },
  tdStrong: { padding: 10, borderBottom: "1px solid #e2e8f0", fontWeight: 800, verticalAlign: "top" },
  small: { display: "block", color: "#64748b", fontWeight: 500, marginTop: 4 },
  badge: { display: "inline-block", padding: "4px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900 },
  statusGood: { background: "#dcfce7", color: "#166534" },
  statusWarning: { background: "#fef3c7", color: "#92400e" },
  statusDanger: { background: "#fee2e2", color: "#991b1b" },
  status: { color: "#475569", fontSize: 12, fontWeight: 900 },
  incident: { border: "1px solid #cbd5e1", borderRadius: 10, padding: 16, marginBottom: 12, background: "#f8fafc" },
  incidentHeader: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  summary: { margin: "10px 0 4px", color: "#0f172a", fontWeight: 700 },
  meta: { margin: "0 0 12px", color: "#64748b", fontSize: 13 },
  textarea: { width: "100%", minHeight: 72, boxSizing: "border-box", border: "1px solid #94a3b8", borderRadius: 7, padding: 10, resize: "vertical" },
  actions: { display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" },
  primary: { border: 0, borderRadius: 7, padding: "9px 14px", background: "#0f172a", color: "#fff", fontWeight: 800, cursor: "pointer" },
  secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" }
};
