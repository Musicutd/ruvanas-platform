"use client";

import { useCallback, useEffect, useState } from "react";

const EMPTY_CHECKLIST = {
  staffTrainingConfirmed: false,
  emergencyWithdrawalDrillConfirmed: false,
  retentionReviewConfirmed: false,
  supportContactsConfirmed: false,
  recoveryPlanConfirmed: false,
  notes: ""
};

const CHECKS = [
  ["staffTrainingConfirmed", "Staff training completed", "Managers and supervising staff understand approval, privacy, and escalation procedures."],
  ["emergencyWithdrawalDrillConfirmed", "Emergency withdrawal tested", "The team has rehearsed removing public school content and recording the reason."],
  ["retentionReviewConfirmed", "Retention preview reviewed", "Aggregate candidate counts and approved retention periods have been checked."],
  ["supportContactsConfirmed", "Support contacts confirmed", "Operational and safeguarding escalation contacts are current."],
  ["recoveryPlanConfirmed", "Recovery plan confirmed", "The school knows how to restore service safely after an incident." ]
];

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function statusLabel(value) {
  return String(value || "IN_PROGRESS").replaceAll("_", " ");
}

export default function SchoolPilotReadinessClient() {
  const [report, setReport] = useState(null);
  const [checklist, setChecklist] = useState(EMPTY_CHECKLIST);
  const [hold, setHold] = useState({ scope: "ORGANISATION", referenceId: "", reason: "" });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const acceptPayload = useCallback((payload) => {
    setReport(payload.report);
    const saved = payload.report?.checklist || EMPTY_CHECKLIST;
    setChecklist({
      staffTrainingConfirmed: saved.staffTrainingConfirmed === true,
      emergencyWithdrawalDrillConfirmed: saved.emergencyWithdrawalDrillConfirmed === true,
      retentionReviewConfirmed: saved.retentionReviewConfirmed === true,
      supportContactsConfirmed: saved.supportContactsConfirmed === true,
      recoveryPlanConfirmed: saved.recoveryPlanConfirmed === true,
      notes: saved.notes || ""
    });
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/pilot-readiness", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Pilot readiness could not be loaded.");
    acceptPayload(payload);
  }, [acceptPayload]);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  async function saveChecklist(event) {
    event.preventDefault();
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/pilot-readiness", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checklist)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Pilot readiness could not be saved.");
      acceptPayload(payload);
      setNotice(payload.report.readiness.readyForPilot ? "Pilot-readiness checks are complete." : "Pilot-readiness progress saved.");
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function createHold(event) {
    event.preventDefault();
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/retention-holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...hold, referenceId: hold.scope === "ORGANISATION" ? null : hold.referenceId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The retention hold could not be created.");
      acceptPayload(payload);
      setHold({ scope: "ORGANISATION", referenceId: "", reason: "" });
      setNotice("Retention hold created and recorded in the audit trail.");
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function releaseHold(item) {
    const reason = window.prompt("Why is this hold safe to release? This action is recorded.", "");
    if (!reason?.trim()) return;
    if (!window.confirm("Release this retention hold? No school record will be deleted or changed.")) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/school-radio/retention-holds/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The retention hold could not be released.");
      acceptPayload(payload);
      setNotice("Retention hold released and recorded in the audit trail.");
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  if (!report) return <section style={styles.shell}><p style={styles.muted}>{error || "Loading controlled retention and pilot readiness…"}</p></section>;
  const readiness = report.readiness;
  const statusStyle = readiness.readyForPilot ? styles.ready : readiness.status === "BLOCKED" ? styles.blocked : styles.progress;

  return <section style={styles.shell}>
    <div style={styles.header}><div><p style={styles.eyebrow}>STAGE 10B · CONTROLLED RETENTION</p><h2 style={styles.title}>Pilot readiness and safeguarding holds</h2><p style={styles.muted}>Review aggregate retention candidates, preserve records under a formal hold, and complete the operational checks required for a supervised pilot.</p></div><span style={{ ...styles.status, ...statusStyle }}>{statusLabel(readiness.status)}</span></div>
    <div style={styles.safety}><strong>No deletion controls are available.</strong> Candidate counts are previews only, and this workflow never changes school recordings, consent evidence, episodes, contributors, or media.</div>
    {error ? <div style={styles.error}>{error}</div> : null}{notice ? <div style={styles.notice}>{notice}</div> : null}

    <div style={styles.metrics}>
      <article style={styles.metric}><span style={styles.metricValue}>{report.retention.rawRecordings.candidateCount}</span><strong>Raw recording candidates</strong><small>Before {dateTime(report.retention.rawRecordings.cutoff)} · preview only</small></article>
      <article style={styles.metric}><span style={styles.metricValue}>{report.retention.consentEvidence.candidateCount}</span><strong>Consent evidence candidates</strong><small>Before {dateTime(report.retention.consentEvidence.cutoff)} · preview only</small></article>
      <article style={styles.metric}><span style={styles.metricValue}>{readiness.activeHoldCount}</span><strong>Active safeguarding holds</strong><small>Held records are preserved; the newest 50 are listed below.</small></article>
      <article style={styles.metric}><span style={styles.metricValue}>{report.operations.currentPublicEpisodes}</span><strong>Current public episodes</strong><small>Emergency withdrawal remains a manager action.</small></article>
    </div>

    <div style={styles.columns}>
      <form onSubmit={saveChecklist} style={styles.card}><h3 style={styles.cardTitle}>Pilot-readiness checklist</h3><p style={styles.muted}>{readiness.completedChecks} of {readiness.totalChecks} operational checks confirmed.</p>
        {CHECKS.map(([key, label, description]) => <label key={key} style={styles.check}><input type="checkbox" checked={checklist[key]} onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))} /><span><strong>{label}</strong><small>{description}</small></span></label>)}
        <label style={styles.label}>Manager notes<textarea style={{ ...styles.input, minHeight: 86 }} value={checklist.notes} onChange={(event) => setChecklist((current) => ({ ...current, notes: event.target.value }))} maxLength={2000} /></label>
        {readiness.prerequisiteGaps.length ? <div style={styles.gaps}><strong>Prerequisites still required</strong>{readiness.prerequisiteGaps.map((gap) => <span key={gap}>• {gap}</span>)}</div> : null}
        <button style={styles.primary} disabled={working}>Save readiness checks</button>
      </form>

      <form onSubmit={createHold} style={styles.card}><h3 style={styles.cardTitle}>Create a retention hold</h3><p style={styles.muted}>Use an organisation-wide hold or identify one episode, contributor, or media asset. The reference must belong to this school.</p>
        <label style={styles.label}>Scope<select style={styles.input} value={hold.scope} onChange={(event) => setHold((current) => ({ ...current, scope: event.target.value, referenceId: "" }))}><option value="ORGANISATION">Entire organisation</option><option value="EPISODE">School episode</option><option value="CONTRIBUTOR">Student contributor record</option><option value="MEDIA_ASSET">Media asset</option></select></label>
        {hold.scope !== "ORGANISATION" ? <label style={styles.label}>Record reference ID<input style={styles.input} value={hold.referenceId} onChange={(event) => setHold((current) => ({ ...current, referenceId: event.target.value }))} maxLength={191} required /></label> : null}
        <label style={styles.label}>Safeguarding or legal reason<textarea style={{ ...styles.input, minHeight: 110 }} value={hold.reason} onChange={(event) => setHold((current) => ({ ...current, reason: event.target.value }))} minLength={10} maxLength={1000} required /></label>
        <button style={styles.secondary} disabled={working}>Create and audit hold</button>
      </form>
    </div>

    <div style={styles.card}><h3 style={styles.cardTitle}>Active retention holds</h3>{!report.holds.length ? <p style={styles.muted}>No active holds. Retention still remains preview-only.</p> : report.holds.map((item) => <article key={item.id} style={styles.hold}><div><strong>{statusLabel(item.scope)}</strong><p style={styles.holdReason}>{item.reason}</p><small>Created {dateTime(item.createdAt)} by {item.createdBy.name || item.createdBy.email}{item.referenceId ? ` · reference ${item.referenceId}` : ""}</small></div><button style={styles.release} disabled={working} onClick={() => releaseHold(item)}>Release hold</button></article>)}</div>
  </section>;
}

const styles = {
  shell: { margin: "0 0 24px", border: "1px solid #2b3a54", borderRadius: 16, background: "#121d30", padding: 22 }, header: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, muted: { color: "#aebbd0", lineHeight: 1.5, margin: "6px 0" },
  status: { borderRadius: 999, padding: "7px 11px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }, ready: { background: "#dcfce7", color: "#166534" }, blocked: { background: "#fee2e2", color: "#991b1b" }, progress: { background: "#fef3c7", color: "#92400e" },
  safety: { margin: "16px 0", border: "1px solid #f4b942", borderRadius: 10, padding: 13, background: "#322714", color: "#fde68a", lineHeight: 1.5 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 12 }, metric: { display: "grid", gap: 6, border: "1px solid #34445f", borderRadius: 10, padding: 15, background: "#131e30" }, metricValue: { color: "#f4b942", fontWeight: 900, fontSize: 26 },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, marginBottom: 12 }, card: { border: "1px solid #34445f", borderRadius: 10, padding: 15, background: "#131e30" }, cardTitle: { margin: "0 0 8px" },
  check: { display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid #2b3a54" }, label: { display: "grid", gap: 6, margin: "11px 0", color: "#dce5f3", fontWeight: 800, fontSize: 12 }, input: { border: "1px solid #61708a", borderRadius: 8, padding: "9px 10px", font: "inherit" },
  gaps: { display: "grid", gap: 5, border: "1px solid #7f1d1d", background: "#35191f", color: "#fecaca", borderRadius: 8, padding: 11, margin: "12px 0" }, primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #60a5fa", borderRadius: 8, background: "transparent", color: "#bfdbfe", padding: "9px 12px", fontWeight: 800, cursor: "pointer" },
  hold: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", borderTop: "1px solid #34445f", padding: "13px 0" }, holdReason: { color: "#dce5f3", margin: "5px 0" }, release: { border: "1px solid #fca5a5", borderRadius: 8, background: "transparent", color: "#fecaca", padding: "8px 10px", fontWeight: 800, cursor: "pointer" }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, margin: "12px 0" }, notice: { border: "1px solid #22c55e", background: "#12351f", color: "#bbf7d0", borderRadius: 8, padding: 12, margin: "12px 0" }
};
