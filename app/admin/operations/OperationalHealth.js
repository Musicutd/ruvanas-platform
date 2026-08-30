"use client";

import { useCallback, useEffect, useState } from "react";

const FINDING_LABELS = {
  SERVICE_HEARTBEAT_MISSING: "An expected service is not reporting a current heartbeat.",
  DEAD_LETTER_JOBS: "Background jobs require controlled recovery.",
  CRITICAL_PLAYER_INCIDENTS: "Critical player incidents are unresolved.",
  CRITICAL_STREAM_INCIDENTS: "Critical stream-source incidents are unresolved.",
  MIXED_ACTIVE_RELEASES: "Active web and worker processes are running different releases.",
  ABANDONED_WEBHOOKS: "Outgoing webhook deliveries are abandoned.",
  RECENT_MEDIA_FAILURES: "Protected media processing failed during the last 24 hours.",
  OFFLINE_PLAYERS: "One or more enrolled players are offline."
};

export default function OperationalHealth() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/operations/health", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load platform health.");
      setReport(body);
    } catch (loadError) {
      setError(loadError.message || "Unable to load platform health.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <section style={styles.stack}>
    <div style={styles.overview}>
      <div><p style={styles.label}>Overall readiness</p><span style={{ ...styles.status, ...statusStyle(report?.status) }}>{report?.status || (loading ? "LOADING" : "UNKNOWN")}</span>{report?.generatedAt ? <p style={styles.muted}>Generated {formatDate(report.generatedAt)}</p> : null}</div>
      <button type="button" onClick={load} disabled={loading} style={styles.secondary}>{loading ? "Refreshing…" : "Refresh health"}</button>
    </div>
    {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    {report?.findings?.length ? <div style={styles.findings}>{report.findings.map((finding) => <div key={finding.code} style={finding.severity === "CRITICAL" ? styles.criticalFinding : styles.warningFinding}><strong>{finding.severity}</strong><span>{FINDING_LABELS[finding.code] || finding.code} ({finding.count})</span></div>)}</div> : report ? <p style={styles.good}>No current operational findings.</p> : null}

    {report ? <>
      <div style={styles.card}><Header title="Release consistency" text={`Environment: ${report.deployment.environment}. Mixed releases are highlighted before operational changes are made.`} /><div style={styles.metrics}><Metric label="Active versions" value={report.deployment.activeVersions.length} warning={report.deployment.mixedVersions} /><Metric label="Expected services" value={report.deployment.expectedServices.length} /><Metric label="Missing services" value={report.deployment.missingServices.length} warning={report.deployment.missingServices.length > 0} /></div><div style={styles.tableWrap}><table style={styles.table}><thead><tr><th style={styles.th}>Service</th><th style={styles.th}>Version</th><th style={styles.th}>Instance</th><th style={styles.th}>State</th><th style={styles.th}>Last seen</th></tr></thead><tbody>{report.deployment.instances.map((item) => <tr key={`${item.service}-${item.instanceKey}`}><td style={styles.tdStrong}>{item.service.replaceAll("_", " ")}</td><td style={styles.td}><code>{item.version}</code></td><td style={styles.td}><code>{item.instanceKey}</code></td><td style={styles.td}><span style={{ ...styles.smallBadge, ...(item.state === "CURRENT" ? styles.current : styles.stale) }}>{item.state}</span></td><td style={styles.td}>{formatDate(item.lastSeenAt)}</td></tr>)}</tbody></table></div></div>

      <div style={styles.card}><Header title="Queues and delivery" text="Counts are aggregate operational evidence; payloads and recipient data are excluded." /><div style={styles.metrics}><Metric label="Jobs queued" value={report.queues.jobs.queued} /><Metric label="Jobs retrying" value={report.queues.jobs.retryScheduled} warning={report.queues.jobs.retryScheduled > 0} /><Metric label="Dead letter" value={report.queues.jobs.deadLetter} warning={report.queues.jobs.deadLetter > 0} /><Metric label="Webhooks pending" value={report.queues.webhooks.pending} /><Metric label="Webhooks failed" value={report.queues.webhooks.failed} warning={report.queues.webhooks.failed > 0} /><Metric label="Webhooks abandoned" value={report.queues.webhooks.abandoned} warning={report.queues.webhooks.abandoned > 0} /></div><p style={styles.muted}>Oldest due job: {formatDate(report.queues.jobs.oldestPendingAt)} · Oldest due webhook: {formatDate(report.queues.webhooks.oldestPendingAt)}</p></div>

      <div style={styles.twoColumns}>
        <div style={styles.card}><Header title="Playback operations" text="Current player and provider-neutral source health." /><div style={styles.metrics}><Metric label="Players online" value={report.players.online} /><Metric label="Players offline" value={report.players.offline} warning={report.players.offline > 0} /><Metric label="Player incidents" value={report.players.unresolvedIncidents} warning={report.players.criticalIncidents > 0} /><Metric label="Monitored streams" value={report.streams.monitored} /><Metric label="Stream incidents" value={report.streams.unresolvedIncidents} warning={report.streams.criticalIncidents > 0} /></div></div>
        <div style={styles.card}><Header title="Processing and proof freshness" text={`Media failures cover the last ${report.media.windowHours} hours. Proof lag is informational and is not an audience measure.`} /><div style={styles.metrics}><Metric label="Audio queued" value={report.media.audioQueued} /><Metric label="Audio failed" value={report.media.audioFailed} warning={report.media.audioFailed > 0} /><Metric label="Signage queued" value={report.media.signageQueued} /><Metric label="Signage failed" value={report.media.signageFailed} warning={report.media.signageFailed > 0} /></div><p style={styles.muted}>Latest device-confirmed proof received: {formatDate(report.proof.latestReceivedAt)}{report.proof.ingestLagSeconds != null ? ` · ${formatDuration(report.proof.ingestLagSeconds)} ago` : ""}</p></div>
      </div>
    </> : null}
  </section>;
}

function Header({ title, text }) { return <div><h2 style={styles.title}>{title}</h2><p style={styles.muted}>{text}</p></div>; }
function Metric({ label, value, warning }) { return <div style={{ ...styles.metric, ...(warning ? styles.metricWarning : {}) }}><strong style={styles.metricValue}>{value}</strong><span>{label}</span></div>; }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "None recorded"; }
function formatDuration(seconds) { if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`; }
function statusStyle(status) { if (status === "HEALTHY") return { background: "#dcfce7", color: "#166534" }; if (status === "ATTENTION") return { background: "#fef3c7", color: "#92400e" }; if (status === "CRITICAL") return { background: "#fee2e2", color: "#991b1b" }; return { background: "#e2e8f0", color: "#334155" }; }

const styles = {
  stack: { display: "grid", gap: 18 }, overview: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap", border: "1px solid #cbd5e1", borderRadius: 12, padding: 20, background: "#f8fafc" }, label: { margin: "0 0 7px", color: "#475569", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1 }, status: { display: "inline-block", borderRadius: 999, padding: "7px 12px", fontWeight: 900, fontSize: 13 }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" }, findings: { display: "grid", gap: 8 }, criticalFinding: { display: "flex", gap: 10, padding: 12, borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b" }, warningFinding: { display: "flex", gap: 10, padding: 12, borderRadius: 8, border: "1px solid #fcd34d", background: "#fffbeb", color: "#92400e" }, good: { padding: 12, borderRadius: 8, background: "#f0fdf4", color: "#166534", fontWeight: 800 }, error: { padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontWeight: 800 }, card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 20, background: "#fff", minWidth: 0 }, title: { margin: 0, fontSize: 23 }, muted: { color: "#475569", lineHeight: 1.5, margin: "6px 0" }, metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 9, marginTop: 15 }, metric: { display: "grid", gap: 3, padding: 12, borderRadius: 8, border: "1px solid #dbe3ec", background: "#f8fafc", color: "#334155", fontSize: 12 }, metricWarning: { borderColor: "#fca5a5", background: "#fef2f2", color: "#991b1b" }, metricValue: { fontSize: 24 }, twoColumns: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 18 }, tableWrap: { overflowX: "auto", marginTop: 14 }, table: { width: "100%", borderCollapse: "collapse", minWidth: 720 }, th: { padding: 9, borderBottom: "2px solid #cbd5e1", textAlign: "left", color: "#475569", fontSize: 12 }, td: { padding: 9, borderBottom: "1px solid #e2e8f0", color: "#334155", fontSize: 13 }, tdStrong: { padding: 9, borderBottom: "1px solid #e2e8f0", color: "#0f172a", fontWeight: 800 }, smallBadge: { display: "inline-block", padding: "4px 7px", borderRadius: 999, fontSize: 11, fontWeight: 900 }, current: { background: "#dcfce7", color: "#166534" }, stale: { background: "#fee2e2", color: "#991b1b" }
};
