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
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [drafts, setDrafts] = useState({});
  const [finalDraft, setFinalDraft] = useState({ launchScope: "", note: "" });

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

  async function submit(payload, successMessage) {
    setBusy(payload.action === "CONFIRM_CHECK" || payload.action === "REVOKE_CHECK" ? payload.checkId : payload.action);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/launch-readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update launch sign-off evidence.");
      setReport(body.report);
      setNotice(successMessage);
      if (payload.checkId) setDrafts((current) => ({ ...current, [payload.checkId]: { evidenceReference: "", note: "" } }));
      if (payload.action === "FINALIZE_SIGNOFF") setFinalDraft({ launchScope: "", note: "" });
    } catch (submitError) {
      setError(submitError.message || "Unable to update launch sign-off evidence.");
    } finally {
      setBusy("");
    }
  }

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
    {notice ? <p role="status" style={styles.good}>{notice}</p> : null}
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
        <p style={styles.muted}>Record a safe reference and accountable note for each external confirmation. Ruvanas never infers these approvals and the record does not override automated blockers.</p>
        <p style={styles.progress}>{report.signoff?.confirmedCount || 0} of {report.signoff?.requiredCount || report.operatorChecks.length} confirmations recorded</p>
        <ol style={styles.checks}>{(report.signoff?.operatorConfirmations || report.operatorChecks).map((item) => {
          const draft = drafts[item.id] || { evidenceReference: "", note: "" };
          return <li key={item.id} style={styles.check}>
            <div style={styles.checkBody}>
              <div style={styles.checkHeader}><strong>{item.label}</strong><span style={item.confirmed ? styles.confirmed : styles.required}>{item.confirmed ? "Confirmed" : "Required"}</span></div>
              <p style={styles.checkText}>{item.description}</p>
              {item.confirmed ? <div style={styles.evidenceSummary}><strong>{item.evidenceReference}</strong><span>Confirmed {formatDate(item.confirmedAt)} by {item.confirmedBy}</span>{item.note ? <span>{item.note}</span> : null}</div> : <div style={styles.confirmationForm}>
                <input aria-label={`${item.label} evidence reference`} value={draft.evidenceReference} onChange={(event) => setDraftValue(setDrafts, item.id, "evidenceReference", event.target.value)} placeholder="Safe evidence reference" style={styles.input} />
                <textarea aria-label={`${item.label} confirmation note`} value={draft.note} onChange={(event) => setDraftValue(setDrafts, item.id, "note", event.target.value)} placeholder="What was checked and by whom? Do not include credentials or private links." style={styles.textarea} />
                <button type="button" disabled={Boolean(busy)} onClick={() => submit({ action: "CONFIRM_CHECK", checkId: item.id, ...draft }, `${item.label} confirmation recorded.`)} style={styles.primary}>{busy === item.id ? "Recording…" : "Record confirmation"}</button>
              </div>}
              {item.confirmed ? <div style={styles.revokeRow}><input aria-label={`${item.label} revocation reason`} value={draft.note} onChange={(event) => setDraftValue(setDrafts, item.id, "note", event.target.value)} placeholder="Reason if this confirmation must be revoked" style={styles.input} /><button type="button" disabled={Boolean(busy)} onClick={() => submit({ action: "REVOKE_CHECK", checkId: item.id, note: draft.note }, `${item.label} confirmation revoked.`)} style={styles.dangerSecondary}>{busy === item.id ? "Revoking…" : "Revoke"}</button></div> : null}
            </div>
          </li>;
        })}</ol>
      </div>

      <div style={styles.card}>
        <h2 style={styles.title}>Final controlled sign-off</h2>
        {report.signoff?.finalSignoff ? <div style={styles.signedOff}><strong>Signed off for {report.signoff.finalSignoff.launchScope}</strong><span>{formatDate(report.signoff.finalSignoff.signedOffAt)} by {report.signoff.finalSignoff.signedOffBy}</span><span>{report.signoff.finalSignoff.note}</span><div style={styles.revokeRow}><input aria-label="Sign-off withdrawal reason" value={finalDraft.note} onChange={(event) => setFinalDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Reason for withdrawing this sign-off" style={styles.input} /><button type="button" disabled={Boolean(busy)} onClick={() => submit({ action: "WITHDRAW_SIGNOFF", note: finalDraft.note }, "Final launch sign-off withdrawn.")} style={styles.dangerSecondary}>{busy === "WITHDRAW_SIGNOFF" ? "Withdrawing…" : "Withdraw sign-off"}</button></div></div> : <>
          <p style={styles.muted}>Final sign-off is enabled only when automated readiness is clear and every required operator confirmation is current.</p>
          <div style={styles.confirmationForm}>
            <input aria-label="Approved launch scope" value={finalDraft.launchScope} onChange={(event) => setFinalDraft((current) => ({ ...current, launchScope: event.target.value }))} placeholder="Approved launch scope, such as internal pilot" style={styles.input} />
            <textarea aria-label="Final sign-off note" value={finalDraft.note} onChange={(event) => setFinalDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Record the accountable final decision without credentials or customer content." style={styles.textarea} />
            <button type="button" disabled={!report.signoff?.canFinalize || Boolean(busy)} onClick={() => submit({ action: "FINALIZE_SIGNOFF", ...finalDraft }, "Final launch sign-off recorded for this release.")} style={styles.primary}>{busy === "FINALIZE_SIGNOFF" ? "Signing off…" : "Record final sign-off"}</button>
          </div>
          {!report.signoff?.canFinalize ? <p style={styles.blockedNote}>Resolve automated blockers and record all operator confirmations before final sign-off.</p> : null}
        </>}
      </div>

      <div style={styles.notice}><strong>Safety boundary</strong><p style={styles.checkText}>Do not launch while this page is blocked, while a required operator confirmation is incomplete, or while licensing, privacy, safeguarding, retention, pricing, or customer commitments remain unapproved.</p></div>
    </> : null}
  </section>;
}

function Metric({ label, value, warning, mono = false }) {
  return <div style={{ ...styles.metric, ...(warning ? styles.metricWarning : {}) }}><strong style={{ ...styles.metricValue, ...(mono ? styles.mono : {}) }}>{value}</strong><span>{label}</span></div>;
}

function setDraftValue(setter, id, key, value) {
  setter((current) => ({ ...current, [id]: { evidenceReference: "", note: "", ...current[id], [key]: value } }));
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
  progress: { display: "inline-block", margin: "12px 0 0", padding: "6px 10px", borderRadius: 999, background: "#e2e8f0", color: "#334155", fontSize: 12, fontWeight: 900 },
  checks: { display: "grid", gap: 10, margin: "18px 0 0", padding: 0, listStyle: "none" },
  check: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, border: "1px solid #dbe3ec", borderRadius: 9, padding: 14, background: "#f8fafc" },
  checkBody: { width: "100%", minWidth: 0 },
  checkHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  checkText: { margin: "5px 0 0", color: "#475569", lineHeight: 1.5 },
  required: { flex: "0 0 auto", display: "inline-block", borderRadius: 999, padding: "5px 8px", background: "#e2e8f0", color: "#334155", fontSize: 11, fontWeight: 900, textTransform: "uppercase" },
  confirmed: { flex: "0 0 auto", display: "inline-block", borderRadius: 999, padding: "5px 8px", background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 900, textTransform: "uppercase" },
  confirmationForm: { display: "grid", gap: 9, marginTop: 12 },
  evidenceSummary: { display: "grid", gap: 4, marginTop: 10, padding: 11, borderRadius: 8, background: "#f0fdf4", color: "#166534", fontSize: 13 },
  revokeRow: { display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 9, alignItems: "center", marginTop: 12 },
  input: { border: "1px solid #94a3b8", borderRadius: 7, padding: "10px 11px", background: "#fff", color: "#0f172a" },
  textarea: { minHeight: 72, border: "1px solid #94a3b8", borderRadius: 7, padding: 10, background: "#fff", color: "#0f172a", resize: "vertical" },
  primary: { border: 0, borderRadius: 7, padding: "10px 14px", background: "#0f172a", color: "#fff", fontWeight: 800, cursor: "pointer" },
  dangerSecondary: { border: "1px solid #fca5a5", borderRadius: 7, padding: "10px 14px", background: "#fff", color: "#991b1b", fontWeight: 800, cursor: "pointer" },
  blockedNote: { margin: "10px 0 0", color: "#991b1b", fontWeight: 800 },
  signedOff: { display: "grid", gap: 6, marginTop: 14, padding: 14, border: "1px solid #86efac", borderRadius: 9, background: "#f0fdf4", color: "#166534" },
  notice: { border: "1px solid #fcd34d", borderRadius: 12, padding: 18, background: "#fffbeb", color: "#78350f" }
};
