"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function initialDates() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function storageLabel(bytes) {
  return `${(Number(bytes || 0) / (1024 ** 3)).toFixed(2)} GB`;
}

export default function OperationalAnalyticsClient({ organisationName, canExport }) {
  const initial = useMemo(initialDates, []);
  const [filters, setFilters] = useState(initial);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportState, setExportState] = useState({ status: "IDLE", message: "" });

  const loadReport = useCallback(async (nextFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(nextFilters).toString();
      const response = await fetch(`/api/reports/operational?${query}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load operational analytics.");
      setPayload(body);
    } catch (reportError) {
      setError(reportError.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadReport(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestExport() {
    setExportState({ status: "QUEUED", message: "Preparing a protected CSV…" });
    try {
      const response = await fetch("/api/reports/operational/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(filters)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to queue the export.");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const statusResponse = await fetch(body.job.statusUrl, { cache: "no-store" });
        const statusBody = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusBody.error || "Unable to check the export.");
        if (statusBody.job.status === "READY") {
          setExportState({ status: "READY", message: `Protected CSV ready (${statusBody.job.rowCount} rows).` });
          window.location.assign(statusBody.job.downloadUrl);
          return;
        }
        if (["FAILED", "EXPIRED"].includes(statusBody.job.status)) throw new Error(statusBody.job.error || "The export could not be completed.");
        setExportState({ status: statusBody.job.status, message: "Preparing a protected CSV…" });
      }
      throw new Error("The export is taking longer than expected. Please try again.");
    } catch (exportError) {
      setExportState({ status: "FAILED", message: exportError.message });
    }
  }

  const report = payload?.report;
  return <main style={styles.page}>
    <header style={styles.header}>
      <div>
        <a href="/dashboard" style={styles.back}>← Client dashboard</a>
        <p style={styles.eyebrow}>STAGE 5C · OPERATIONAL ANALYTICS</p>
        <h1 style={styles.title}>One evidence-led view</h1>
        <p style={styles.subtitle}>{organisationName} · playback, player health, content, storage, and school operations without audience inflation.</p>
      </div>
      {canExport ? <button type="button" onClick={requestExport} disabled={loading || ["QUEUED", "PROCESSING"].includes(exportState.status)} style={styles.exportButton}>
        {["QUEUED", "PROCESSING"].includes(exportState.status) ? "Preparing CSV…" : "Export protected CSV"}
      </button> : null}
    </header>

    <section style={styles.notice}><strong>Evidence boundary:</strong> {report?.evidenceNotice || "Operational totals are not audience measurements."}</section>
    <section style={styles.filters} aria-label="Analytics date range">
      <label style={styles.label}>From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} style={styles.input} /></label>
      <label style={styles.label}>To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} style={styles.input} /></label>
      <button type="button" onClick={() => loadReport(filters)} disabled={loading} style={styles.applyButton}>{loading ? "Refreshing…" : "Apply range"}</button>
    </section>
    {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    {exportState.message ? <p role="status" style={exportState.status === "FAILED" ? styles.error : styles.status}>{exportState.message}</p> : null}
    {report?.aggregation?.pending ? <p role="status" style={styles.status}>Historical evidence is still being aggregated. Refresh again to complete the backfill.</p> : null}

    {report ? <>
      <section style={styles.metrics} aria-label="Operational summary">
        <Metric label="Planned insertions" value={report.summary.plannedCount} />
        <Metric label="Confirmed complete" value={report.summary.playbackCompletedCount} />
        <Metric label="Playback failures" value={report.summary.playbackFailedCount} warning={report.summary.playbackFailedCount > 0} />
        <Metric label="Confirmation rate" value={percent(report.summary.confirmationRate)} />
        <Metric label="Players online now" value={`${report.players.onlineNow} / ${report.players.enrolled}`} />
        <Metric label="Heartbeat coverage" value={percent(report.players.observedHeartbeatCoverage)} />
        <Metric label="Protected audio" value={storageLabel(report.storage.bytes)} />
        <Metric label="Media records" value={report.storage.assetCount} />
      </section>

      <section style={styles.cards}>
        <article style={styles.card}><h2 style={styles.sectionTitle}>Content operations</h2><KeyValue label="Campaigns" value={report.content.campaigns} /><KeyValue label="Promotions" value={report.content.promotions} /><KeyValue label="Studio orders" value={report.content.productionOrders} /></article>
        <article style={styles.card}><h2 style={styles.sectionTitle}>Player health</h2><KeyValue label="Online now" value={report.players.onlineNow} /><KeyValue label="Offline now" value={report.players.offlineNow} /><p style={styles.muted}>Historical heartbeat coverage begins with this Stage 5C release; earlier uptime is not invented.</p></article>
        {report.school ? <article style={styles.card}><h2 style={styles.sectionTitle}>School Radio · aggregate only</h2><KeyValue label="Programmes / episodes" value={`${report.school.programmes} / ${report.school.episodes}`} /><KeyValue label="Assignments / submissions" value={`${report.school.assignments} / ${report.school.submissions}`} /><KeyValue label="Assessments / portfolios" value={`${report.school.assessments} / ${report.school.portfolios}`} /><KeyValue label="Reviews / consent actions" value={`${report.school.pendingReviews} / ${report.school.consentActions}`} /><p style={styles.safe}>No student identities or rankings included.</p></article> : null}
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Daily operational evidence</h2>
        {report.days.length === 0 ? <p style={styles.muted}>No aggregate evidence exists in this period yet.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}>
          <thead><tr>{["UTC day", "Planned", "Started", "Confirmed", "Failed", "Interrupted", "Heartbeat samples"].map((label) => <th key={label} style={styles.th}>{label}</th>)}</tr></thead>
          <tbody>{report.days.map((day) => <tr key={day.date}><td style={styles.tdStrong}>{day.date}</td><td style={styles.number}>{day.plannedCount}</td><td style={styles.number}>{day.playbackStartedCount}</td><td style={styles.number}>{day.playbackCompletedCount}</td><td style={styles.number}>{day.playbackFailedCount}</td><td style={styles.number}>{day.playbackInterruptedCount}</td><td style={styles.number}>{day.heartbeatCount}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <p style={styles.retention}>{report.retentionNotice}</p>
    </> : null}
  </main>;
}

function Metric({ label, value, warning = false }) {
  return <article style={{ ...styles.metric, ...(warning ? styles.metricWarning : {}) }}><span style={styles.metricLabel}>{label}</span><strong style={styles.metricValue}>{value}</strong></article>;
}

function KeyValue({ label, value }) {
  return <div style={styles.keyValue}><span>{label}</span><strong>{value}</strong></div>;
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#fff", padding: "40px max(20px, calc((100% - 1160px) / 2)) 72px", fontFamily: "Arial, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", gap: 24, alignItems: "end", flexWrap: "wrap" },
  back: { color: "#b8c3d6", textDecoration: "none", fontWeight: 700 },
  eyebrow: { color: "#f4b942", letterSpacing: 1.5, fontSize: 12, fontWeight: 800, margin: "24px 0 10px" },
  title: { fontSize: "clamp(34px, 5vw, 52px)", margin: 0 },
  subtitle: { color: "#b8c3d6", lineHeight: 1.6, fontSize: 17, margin: "14px 0 0", maxWidth: 780 },
  notice: { marginTop: 24, padding: 16, border: "1px solid #6b5729", borderRadius: 10, background: "#2c2416", color: "#f8e3ae", lineHeight: 1.5 },
  filters: { display: "grid", gridTemplateColumns: "repeat(2, minmax(160px, 240px)) auto", gap: 12, marginTop: 18, padding: 18, border: "1px solid #2b3a54", borderRadius: 12, background: "#182235", alignItems: "end" },
  label: { display: "grid", gap: 7, color: "#cbd5e1", fontSize: 12, fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #52627d", borderRadius: 7, background: "#fff", color: "#0f172a", padding: "10px 9px" },
  applyButton: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "11px 14px", fontWeight: 900, cursor: "pointer" },
  exportButton: { border: "1px solid #f4b942", borderRadius: 8, background: "transparent", color: "#f4b942", padding: "12px 16px", fontWeight: 900, cursor: "pointer" },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 12, marginTop: 20 },
  metric: { border: "1px solid #2b3a54", borderRadius: 12, padding: 18, background: "#182235", display: "grid", gap: 8 },
  metricWarning: { borderColor: "#9f4b4b", background: "#321f27" },
  metricLabel: { color: "#aebbd0", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6 },
  metricValue: { fontSize: 27 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 20 },
  card: { marginTop: 20, border: "1px solid #2b3a54", borderRadius: 12, padding: 20, background: "#182235" },
  sectionTitle: { margin: "0 0 16px", fontSize: 21 },
  keyValue: { display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: "1px solid #2b3a54", color: "#dbe3ee" },
  safe: { color: "#bbf7d0", lineHeight: 1.5, margin: "14px 0 0" },
  muted: { color: "#aebbd0", lineHeight: 1.5 },
  table: { width: "100%", minWidth: 850, borderCollapse: "collapse" },
  th: { textAlign: "left", padding: 10, borderBottom: "2px solid #52627d", color: "#aebbd0", fontSize: 12 },
  tdStrong: { padding: 10, borderBottom: "1px solid #2b3a54", color: "#fff", fontWeight: 800 },
  number: { padding: 10, borderBottom: "1px solid #2b3a54", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  status: { color: "#bbf7d0", margin: "14px 0 0" },
  error: { color: "#fecaca", background: "#3f1d27", border: "1px solid #9f4b4b", borderRadius: 8, padding: 12, margin: "14px 0 0" },
  retention: { color: "#94a3b8", fontSize: 13, lineHeight: 1.5, marginTop: 18 }
};
