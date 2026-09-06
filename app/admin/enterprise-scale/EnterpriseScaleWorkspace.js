"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const FIELD_SETS = {
  TENANT_ISOLATION_REVIEW: [["testedRoutes", "Tenant-scoped routes tested"], ["crossTenantLeaks", "Cross-tenant leaks found"]],
  CAPACITY_BASELINE: [["testedStations", "Stations represented"], ["testedConcurrentListeners", "Concurrent listeners represented"], ["sampleCount", "Samples"], ["p95ManifestMs", "Manifest p95 (ms)"], ["errorRatePercent", "Error rate (%)"]],
  SOAK_RUN: [["durationHours", "Duration (hours)"], ["sampleCount", "Samples"], ["availabilityPercent", "Availability (%)"], ["errorRatePercent", "Error rate (%)"], ["continuityGapSeconds", "Longest continuity gap (seconds)"]],
  FAILOVER_DRILL: [["recoverySeconds", "Recovery time (seconds)"], ["continuityGapSeconds", "Continuity gap (seconds)"]]
};

export default function EnterpriseScaleWorkspace() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState("TENANT_ISOLATION_REVIEW");
  const fields = useMemo(() => FIELD_SETS[type] || [], [type]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/enterprise-scale", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load readiness.");
      setReport(body);
    } catch (loadError) { setError(loadError.message || "Unable to load readiness."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const metrics = Object.fromEntries(fields.map(([key]) => [key, Number(form.get(key))]));
    try {
      const response = await fetch("/api/admin/enterprise-scale", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RECORD_EVIDENCE", evidenceType: type, result: form.get("result"), reference: form.get("reference"), performedAt: form.get("performedAt"), note: form.get("note"), metrics })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to record evidence.");
      setReport(body.report); setMessage("Evidence recorded. Readiness has been recalculated."); formElement.reset();
      setType("TENANT_ISOLATION_REVIEW");
    } catch (submitError) { setError(submitError.message || "Unable to record evidence."); }
    finally { setSaving(false); }
  }

  return <section style={styles.stack}>
    <div style={styles.overview}>
      <div><p style={styles.label}>Controlled scale status</p><span style={{ ...styles.status, ...statusStyle(report?.status) }}>{report?.status?.replaceAll("_", " ") || (loading ? "LOADING" : "UNKNOWN")}</span><p style={styles.muted}>Environment: {report?.environment || "Checking…"}{report?.generatedAt ? ` · Updated ${formatDate(report.generatedAt)}` : ""}</p></div>
      <button type="button" onClick={load} disabled={loading} style={styles.secondary}>{loading ? "Refreshing…" : "Refresh evidence"}</button>
    </div>
    {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    {message ? <p role="status" style={styles.good}>{message}</p> : null}
    {report?.findings?.length ? <div style={styles.findings}>{report.findings.map((item, index) => <div key={`${item.code}-${index}`} style={item.severity === "CRITICAL" ? styles.criticalFinding : styles.warningFinding}><strong>{item.severity}</strong><span>{item.message}</span></div>)}</div> : report ? <p style={styles.good}>All automated scale gates are current.</p> : null}

    {report ? <>
      <div style={styles.card}><Header title="Fleet and capacity guardrails" text="Platform-wide totals only. Customer names, identities, content and listening histories are excluded." /><div style={styles.capacityGrid}>{report.capacity.map((item) => <div key={item.id} style={styles.capacity}><div style={styles.metricTop}><strong>{item.current.toLocaleString()}</strong><span>{item.utilisationPercent}%</span></div><span>{item.label}</span><progress aria-label={`${item.label} capacity used`} max="100" value={Math.min(100, item.utilisationPercent)} style={styles.progress} /><small>Review at {item.warningAt.toLocaleString()} · Guardrail {item.hardLimit.toLocaleString()}</small></div>)}</div></div>
      <div style={styles.twoColumns}>
        <div style={styles.card}><Header title="Internal continuity objectives" text="Engineering objectives for readiness decisions; they are not customer-facing contractual SLAs." /><div style={styles.sloList}>{report.slos.map((slo) => <div key={slo.id} style={styles.slo}><span>{slo.label}</span><strong>{slo.operator === "atLeast" ? "≥" : "≤"} {slo.target}{slo.unit === "%" ? "%" : ` ${slo.unit}`}</strong></div>)}</div></div>
        <div style={styles.card}><Header title="Required evidence" text="The latest passing, current result for every gate is required." />{report.evidence.map((item) => <div key={item.id} style={styles.evidence}><div><strong>{item.label}</strong><p style={styles.muted}>{item.reference ? `${item.reference} · ${formatDate(item.performedAt)}` : `No current evidence · valid for ${item.maxAgeDays} days`}</p>{item.problems?.length ? <small style={styles.problem}>{item.problems[0]}</small> : null}</div><span style={{ ...styles.smallBadge, ...(item.status === "CURRENT" ? styles.current : styles.incomplete) }}>{item.status}</span></div>)}</div>
      </div>
      <form onSubmit={submit} style={styles.card}>
        <Header title="Record controlled evidence" text="Record only a result backed by an approved, retrievable report. Entries are appended to the audit log and do not change the running service." />
        <div style={styles.formGrid}>
          <label style={styles.field}>Evidence type<select name="evidenceType" value={type} onChange={(event) => setType(event.target.value)} style={styles.input}>{report.evidence.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label style={styles.field}>Result<select name="result" defaultValue="PASS" style={styles.input}><option>PASS</option><option>FAIL</option></select></label>
          <label style={styles.field}>Evidence reference<input name="reference" required minLength="3" maxLength="160" placeholder="Approved report or ticket reference" style={styles.input} /></label>
          <label style={styles.field}>Performed at<input name="performedAt" type="datetime-local" required style={styles.input} /></label>
          {fields.map(([key, label]) => <label key={key} style={styles.field}>{label}<input name={key} type="number" min="0" step="any" required style={styles.input} /></label>)}
          <label style={{ ...styles.field, gridColumn: "1 / -1" }}>Review note<textarea name="note" required minLength="8" maxLength="500" rows="3" style={styles.input} /></label>
        </div>
        <button disabled={saving} style={styles.primary}>{saving ? "Recording…" : "Record evidence"}</button>
      </form>
    </> : null}
  </section>;
}

function Header({ title, text }) { return <div><h2 style={styles.title}>{title}</h2><p style={styles.muted}>{text}</p></div>; }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "Not recorded"; }
function statusStyle(status) { if (status === "READY_FOR_CONTROLLED_SCALE") return { background: "#dcfce7", color: "#166534" }; if (status === "ATTENTION") return { background: "#fef3c7", color: "#92400e" }; if (status === "BLOCKED") return { background: "#fee2e2", color: "#991b1b" }; return { background: "#e2e8f0", color: "#334155" }; }

const styles = {
  stack: { display: "grid", gap: 18 }, overview: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap", border: "1px solid #cbd5e1", borderRadius: 12, padding: 20, background: "#f8fafc" }, label: { margin: "0 0 7px", color: "#475569", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1 }, status: { display: "inline-block", borderRadius: 999, padding: "7px 12px", fontWeight: 900, fontSize: 13 }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" }, primary: { border: 0, borderRadius: 8, padding: "11px 16px", background: "#fbbf24", color: "#111827", fontWeight: 900, cursor: "pointer", marginTop: 16 }, findings: { display: "grid", gap: 8 }, criticalFinding: { display: "flex", gap: 10, padding: 12, borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b" }, warningFinding: { display: "flex", gap: 10, padding: 12, borderRadius: 8, border: "1px solid #fcd34d", background: "#fffbeb", color: "#92400e" }, good: { padding: 12, borderRadius: 8, background: "#f0fdf4", color: "#166534", fontWeight: 800 }, error: { padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontWeight: 800 }, card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 20, background: "#fff", minWidth: 0 }, title: { margin: 0, fontSize: 23 }, muted: { color: "#475569", lineHeight: 1.5, margin: "6px 0" }, capacityGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 15 }, capacity: { display: "grid", gap: 7, padding: 14, border: "1px solid #dbe3ec", borderRadius: 9, background: "#f8fafc", color: "#334155" }, metricTop: { display: "flex", justifyContent: "space-between", fontSize: 20 }, progress: { width: "100%", accentColor: "#f59e0b" }, twoColumns: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 18 }, sloList: { display: "grid", gap: 8, marginTop: 14 }, slo: { display: "flex", justifyContent: "space-between", gap: 14, borderBottom: "1px solid #e2e8f0", padding: "9px 0" }, evidence: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", borderBottom: "1px solid #e2e8f0", padding: "11px 0" }, smallBadge: { display: "inline-block", whiteSpace: "nowrap", padding: "4px 7px", borderRadius: 999, fontSize: 11, fontWeight: 900 }, current: { background: "#dcfce7", color: "#166534" }, incomplete: { background: "#fee2e2", color: "#991b1b" }, problem: { color: "#991b1b" }, formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 13, marginTop: 16 }, field: { display: "grid", gap: 6, color: "#334155", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #94a3b8", borderRadius: 7, padding: "10px 11px", background: "#fff", color: "#0f172a", font: "inherit" }
};
