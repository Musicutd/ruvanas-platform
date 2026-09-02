"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/app/components/PageHeader";
import EmptyState from "@/app/components/EmptyState";
import { interfaceMessages, safeInterfaceMessage } from "@/lib/interface-guidance.mjs";

function initialDates() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function asPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function reportQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params.toString();
}

export default function CampaignProofReportClient({ organisationName }) {
  const dates = useMemo(initialDates, []);
  const [filters, setFilters] = useState({ ...dates, campaignId: "", locationId: "", locationGroupId: "" });
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportState, setExportState] = useState({ status: "IDLE", message: "" });

  const loadReport = useCallback(async (nextFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/campaign-proof?${reportQuery(nextFilters)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load the report.");
      setPayload(body);
    } catch (reportError) {
      setError(safeInterfaceMessage(reportError?.message, "Unable to load proof-of-play reporting."));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadReport(filters); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestExport() {
    setExportState({ status: "QUEUED", message: "Preparing CSV export…" });
    try {
      const response = await fetch("/api/reports/campaign-proof/exports", {
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
          setExportState({ status: "READY", message: `CSV ready (${statusBody.job.rowCount} rows). Download starting…` });
          window.location.assign(statusBody.job.downloadUrl);
          return;
        }
        if (new Set(["FAILED", "EXPIRED"]).has(statusBody.job.status)) {
          throw new Error(statusBody.job.error || "The export could not be completed.");
        }
        setExportState({ status: statusBody.job.status, message: "Preparing CSV export…" });
      }
      throw new Error("The export is taking longer than expected. Please try again.");
    } catch (exportError) {
      setExportState({ status: "FAILED", message: safeInterfaceMessage(exportError?.message, "Unable to prepare the report export.") });
    }
  }

  const report = payload?.report;
  const dimensions = payload?.dimensions || { campaigns: [], locations: [], locationGroups: [] };
  return <main style={styles.page}>
    <PageHeader eyebrow="Campaign performance" title={interfaceMessages.reports.title} description={`${organisationName} · planned insertions reconciled with device-confirmed playback.`} backHref="/dashboard" backLabel="Client dashboard" tone="dark">
      <button type="button" onClick={requestExport} disabled={loading || ["QUEUED", "PROCESSING"].includes(exportState.status)} style={styles.exportButton}>
        {["QUEUED", "PROCESSING"].includes(exportState.status) ? "Preparing CSV…" : "Export CSV"}
      </button>
    </PageHeader>

    <section style={styles.notice} aria-label="Measurement notice">
      <strong>Measurement basis:</strong> device-confirmed playback. These figures do not measure listeners, audience, impressions, or reach.
    </section>

    <section style={styles.filters} aria-label="Report filters">
      <label style={styles.label}>From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} style={styles.input} /></label>
      <label style={styles.label}>To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} style={styles.input} /></label>
      <label style={styles.label}>Campaign<select value={filters.campaignId} onChange={(event) => setFilters({ ...filters, campaignId: event.target.value })} style={styles.input}>
        <option value="">All campaigns</option>{dimensions.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select></label>
      <label style={styles.label}>Location<select value={filters.locationId} onChange={(event) => setFilters({ ...filters, locationId: event.target.value })} style={styles.input}>
        <option value="">All locations</option>{dimensions.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select></label>
      <label style={styles.label}>Location group<select value={filters.locationGroupId} onChange={(event) => setFilters({ ...filters, locationGroupId: event.target.value })} style={styles.input}>
        <option value="">All groups</option>{dimensions.locationGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></label>
      <button type="button" onClick={() => loadReport(filters)} disabled={loading} style={styles.applyButton}>{loading ? "Loading…" : "Apply filters"}</button>
    </section>

    {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    {exportState.message ? <p role="status" style={exportState.status === "FAILED" ? styles.error : styles.status}>{exportState.message}</p> : null}

    {report ? <>
      <section style={styles.metrics} aria-label="Campaign proof summary">
        <Metric label="Planned" value={report.summary.planned} />
        <Metric label="Started" value={report.summary.started} />
        <Metric label="Confirmed complete" value={report.summary.completed} />
        <Metric label="Failed" value={report.summary.failed} warning={report.summary.failed > 0} />
        <Metric label="Awaiting confirmation" value={report.summary.awaitingConfirmation} />
        <Metric label="Completion rate" value={asPercent(report.summary.completionRate)} />
      </section>
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Hourly campaign detail</h2>
        {report.truncated ? <p style={styles.notice}>Showing the first 2,000 of {report.totalRows} rows. Use the CSV export for the complete result.</p> : null}
        {report.rows.length === 0 ? <EmptyState compact tone="dark" title={interfaceMessages.reports.emptyTitle} description={interfaceMessages.reports.emptyDescription} /> : <div style={{ overflowX: "auto" }}><table style={styles.table}>
          <thead><tr>{["Local time", "Campaign / promo", "Location / group", "Planned", "Started", "Confirmed", "Failed"].map((label) => <th key={label} style={styles.th}>{label}</th>)}</tr></thead>
          <tbody>{report.rows.map((row) => <tr key={[row.campaignId, row.promoVersionId, row.locationId, row.locationGroupId, row.localDate, row.localHour].join("-")}>
            <td style={styles.tdStrong}>{row.localDate}<small style={styles.detail}>{String(row.localHour).padStart(2, "0")}:00 · {row.timezone}</small></td>
            <td style={styles.tdStrong}>{row.campaignName}<small style={styles.detail}>{row.promoName} · version {row.promoVersion}</small></td>
            <td style={styles.td}>{row.locationName}<small style={styles.detail}>{row.locationGroupName}</small></td>
            <td style={styles.number}>{row.planned}</td><td style={styles.number}>{row.started}</td><td style={styles.number}>{row.completed}</td><td style={styles.number}>{row.failed}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </> : null}
  </main>;
}

function Metric({ label, value, warning = false }) {
  return <article style={{ ...styles.metric, ...(warning ? styles.metricWarning : {}) }}><span style={styles.metricLabel}>{label}</span><strong style={styles.metricValue}>{value}</strong></article>;
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#fff", padding: "40px max(20px, calc((100% - 1160px) / 2)) 72px", fontFamily: "Arial, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", gap: 24, alignItems: "end", flexWrap: "wrap" },
  back: { color: "#b8c3d6", textDecoration: "none", fontWeight: 700 },
  eyebrow: { color: "#f4b942", letterSpacing: 1.5, fontSize: 12, fontWeight: 800, margin: "24px 0 10px" },
  title: { fontSize: "clamp(34px, 5vw, 52px)", margin: 0 },
  subtitle: { color: "#b8c3d6", lineHeight: 1.6, fontSize: 17, margin: "14px 0 0" },
  notice: { marginTop: 24, padding: 16, border: "1px solid #6b5729", borderRadius: 10, background: "#2c2416", color: "#f8e3ae", lineHeight: 1.5 },
  filters: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 18, padding: 18, border: "1px solid #2b3a54", borderRadius: 12, background: "#182235", alignItems: "end" },
  label: { display: "grid", gap: 7, color: "#cbd5e1", fontSize: 12, fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #52627d", borderRadius: 7, background: "#fff", color: "#0f172a", padding: "10px 9px" },
  applyButton: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "11px 14px", fontWeight: 900, cursor: "pointer" },
  exportButton: { border: "1px solid #f4b942", borderRadius: 8, background: "transparent", color: "#f4b942", padding: "12px 16px", fontWeight: 900, cursor: "pointer" },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginTop: 20 },
  metric: { border: "1px solid #2b3a54", borderRadius: 12, padding: 18, background: "#182235", display: "grid", gap: 8 },
  metricWarning: { borderColor: "#9f4b4b", background: "#321f27" },
  metricLabel: { color: "#aebbd0", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6 },
  metricValue: { fontSize: 29 },
  card: { marginTop: 20, border: "1px solid #2b3a54", borderRadius: 12, padding: 20, background: "#182235" },
  sectionTitle: { margin: "0 0 16px", fontSize: 22 },
  table: { width: "100%", minWidth: 980, borderCollapse: "collapse" },
  th: { textAlign: "left", padding: 10, borderBottom: "2px solid #52627d", color: "#aebbd0", fontSize: 12 },
  td: { padding: 10, borderBottom: "1px solid #2b3a54", color: "#dbe3ee", verticalAlign: "top" },
  tdStrong: { padding: 10, borderBottom: "1px solid #2b3a54", color: "#fff", fontWeight: 800, verticalAlign: "top" },
  number: { padding: 10, borderBottom: "1px solid #2b3a54", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  detail: { display: "block", marginTop: 4, color: "#9cacbf", fontWeight: 500 },
  muted: { color: "#aebbd0" },
  status: { color: "#bbf7d0", margin: "14px 0 0" },
  error: { color: "#fecaca", background: "#3f1d27", border: "1px solid #9f4b4b", borderRadius: 8, padding: 12, margin: "14px 0 0" }
};

