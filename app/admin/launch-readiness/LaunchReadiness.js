"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const FINDING_LABELS = {
  OPERATIONAL_EVIDENCE_UNAVAILABLE: "Platform health evidence is unavailable.",
  UNAPPROVED_DEPLOYMENT_ENVIRONMENT: "The evidence is not from the approved paid Ruvanas service.",
  DEPLOYMENT_COMMIT_UNAVAILABLE: "The active web release is missing an attributable commit.",
  MIXED_ACTIVE_RELEASES: "Web and worker processes are running different releases.",
  EXPECTED_SERVICE_MISSING: "A required paid-service process is not reporting a current heartbeat.",
  PLATFORM_HEALTH_CRITICAL: "Critical platform findings must be resolved.",
  PLATFORM_HEALTH_ATTENTION: "Operational warnings require review.",
  RECOVERY_EVIDENCE_UNAVAILABLE: "Backup and recovery evidence is unavailable.",
  RECOVERY_NOT_READY: "Backup or recovery controls are not ready.",
  RECOVERY_ATTENTION: "Recovery warnings or overdue evidence require review."
};

export default function LaunchReadiness() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/launch-readiness", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load launch readiness.");
      setReport(body);
    } catch (loadError) {
      setError(loadError.message || "Unable to load launch readiness.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <section style={styles.stack}>
    <div style={styles.overview}>
      <div>
        <p style={styles.label}>Automated launch evidence</p>
        <span style={{ ...styles.status, ...statusStyle(report?.status) }}>{report?.status?.replaceAll("_", " ") || (loading ? "LOADING" : "UNKNOWN")}</span>
        {report?.generatedAt ? <p style={styles.muted}>Generated {formatDate(report.generatedAt)}</p> : null}
      </div>
      <button type="button" onClick={load} disabled={loading} style={styles.secondary}>{loading ? "Refreshing…" : "Refresh readiness"}</button>
    </div>

    {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    {report?.findings?.length ? <div style={styles.findings}>{report.findings.map((item) => <div key={item.code} style={item.severity === "CRITICAL" ? styles.criticalFinding : styles.warningFinding}><strong>{item.severity}</strong><span>{FINDING_LABELS[item.code] || item.message || item.code}</span></div>)}</div> : report ? <p style={styles.good}>Automated evidence is clear. Complete every operator confirmation before launch.</p> : null}

    {report ? <>
      <div style={styles.card}>
        <h2 style={styles.title}>Paid-service evidence</h2>
        <p style={styles.muted}>This evidence is generated from the current Ruvanas service and its existing operational and recovery controls.</p>
        <div style={styles.metrics}>
          <Metric label="Environment" value={report.deployment.environment || "Unavailable"} warning={report.deployment.environment !== report.deployment.expectedEnvironment} />
          <Metric label="Release commit" value={report.deployment.commitSha?.slice(0, 12) || "Unavailable"} warning={!report.deployment.commitSha} mono />
          <Metric label="Platform health" value={report.evidence.operationalStatus} warning={report.evidence.operationalStatus !== "HEALTHY"} />
          <Metric label="Recovery" value={report.evidence.recoveryStatus} warning={report.evidence.recoveryStatus !== "READY"} />
          <Metric label="Active versions" value={report.deployment.activeVersions.length} warning={report.deployment.activeVersions.length !== 1} />
          <Metric label="Missing services" value={report.deployment.missingServices.length} warning={report.deployment.missingServices.length > 0} />
        </div>
        <div style={styles.links}><Link href="/admin/operations" style={styles.link}>Review platform health</Link><Link href="/admin/recovery" style={styles.link}>Review backup & recovery</Link></div>
      </div>

      <div style={styles.card}>
        <h2 style={styles.title}>Required operator handover</h2>
        <p style={styles.muted}>These confirmations depend on GitHub, the paid hosting service, a bounded live smoke, and business approval. Ruvanas deliberately does not mark them complete automatically.</p>
        <ol style={styles.checks}>{report.operatorChecks.map((item) => <li key={item.id} style={styles.check}><div><strong>{item.label}</strong><p style={styles.checkText}>{item.description}</p></div><span style={styles.required}>Required</span></li>)}</ol>
      </div>

      <div style={styles.notice}><strong>Safety boundary</strong><p style={styles.checkText}>Do not launch while this page is blocked, while a required operator confirmation is incomplete, or while licensing, privacy, safeguarding, retention, pricing, or customer commitments remain unapproved.</p></div>
    </> : null}
  </section>;
}

function Metric({ label, value, warning, mono = false }) {
  return <div style={{ ...styles.metric, ...(warning ? styles.metricWarning : {}) }}><strong style={{ ...styles.metricValue, ...(mono ? styles.mono : {}) }}>{value}</strong><span>{label}</span></div>;
}

function formatDate(value) { return value ? new Date(value).toLocaleString() : "None recorded"; }
function statusStyle(status) {
  if (status === "READY_FOR_OPERATOR_SIGN_OFF") return { background: "#dcfce7", color: "#166534" };
  if (status === "ATTENTION") return { background: "#fef3c7", color: "#92400e" };
  if (status === "BLOCKED") return { background: "#fee2e2", color: "#991b1b" };
  return { background: "#e2e8f0", color: "#334155" };
}

const styles = {
  stack: { display: "grid", gap: 18 },
  overview: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap", border: "1px solid #cbd5e1", borderRadius: 12, padding: 20, background: "#f8fafc" },
  label: { margin: "0 0 7px", color: "#475569", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1 },
  status: { display: "inline-block", borderRadius: 999, padding: "7px 12px", fontWeight: 900, fontSize: 13 },
  secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" },
  findings: { display: "grid", gap: 8 },
  criticalFinding: { display: "flex", gap: 10, padding: 12, borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b" },
  warningFinding: { display: "flex", gap: 10, padding: 12, borderRadius: 8, border: "1px solid #fcd34d", background: "#fffbeb", color: "#92400e" },
  good: { padding: 12, borderRadius: 8, background: "#f0fdf4", color: "#166534", fontWeight: 800 },
  error: { padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontWeight: 800 },
  card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 20, background: "#fff" },
  title: { margin: 0, fontSize: 23 },
  muted: { color: "#475569", lineHeight: 1.5, margin: "6px 0" },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9, marginTop: 15 },
  metric: { display: "grid", gap: 3, padding: 12, borderRadius: 8, border: "1px solid #dbe3ec", background: "#f8fafc", color: "#334155", fontSize: 12, minWidth: 0 },
  metricWarning: { borderColor: "#fca5a5", background: "#fef2f2", color: "#991b1b" },
  metricValue: { fontSize: 18, overflowWrap: "anywhere" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  links: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 },
  link: { display: "inline-block", padding: "8px 11px", border: "1px solid #cbd5e1", borderRadius: 7, color: "#1e293b", fontWeight: 800, textDecoration: "none" },
  checks: { display: "grid", gap: 10, margin: "18px 0 0", padding: 0, listStyle: "none" },
  check: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, border: "1px solid #dbe3ec", borderRadius: 9, padding: 14, background: "#f8fafc" },
  checkText: { margin: "5px 0 0", color: "#475569", lineHeight: 1.5 },
  required: { flex: "0 0 auto", display: "inline-block", borderRadius: 999, padding: "5px 8px", background: "#e2e8f0", color: "#334155", fontSize: 11, fontWeight: 900, textTransform: "uppercase" },
  notice: { border: "1px solid #fcd34d", borderRadius: 12, padding: 18, background: "#fffbeb", color: "#78350f" }
};
