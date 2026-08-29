"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const EMPTY_RUN = { title: "", plannedStartAt: "", plannedEndAt: "", notes: "" };
const EMPTY_EVENT = {
  pilotRunId: "",
  kind: "DRILL",
  category: "EMERGENCY_WITHDRAWAL",
  severity: "LOW",
  outcome: "PASSED",
  summary: "",
  responseActions: "",
  occurredAt: ""
};

const RUN_ACTIONS = {
  PLANNED: ["START", "CANCEL"],
  ACTIVE: ["PAUSE", "COMPLETE", "CANCEL"],
  PAUSED: ["RESUME", "COMPLETE", "CANCEL"]
};

function label(value) {
  return String(value || "").replaceAll("_", " ");
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function localDateTimeValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function actorName(actor) {
  return actor?.name || actor?.email || "school manager";
}

export default function SchoolPilotOperationsClient() {
  const [report, setReport] = useState(null);
  const [run, setRun] = useState(EMPTY_RUN);
  const [event, setEvent] = useState({ ...EMPTY_EVENT, occurredAt: localDateTimeValue() });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const accept = useCallback((payload) => {
    setReport(payload.report);
    const firstRunId = payload.report?.runs?.[0]?.id || "";
    setEvent((current) => ({ ...current, pilotRunId: current.pilotRunId || firstRunId }));
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/pilot-operations", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Pilot operations could not be loaded.");
    accept(payload);
  }, [accept]);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  const selectableRuns = useMemo(() => report?.runs || [], [report]);

  async function submit(body, successMessage, method = "POST", recordId = null) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(recordId ? `/api/school-radio/pilot-operations/${recordId}` : "/api/school-radio/pilot-operations", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The pilot operation could not be saved.");
      accept(payload);
      setNotice(successMessage);
      return true;
    } catch (actionError) {
      setError(actionError.message);
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function createRun(eventObject) {
    eventObject.preventDefault();
    const plannedStartAt = new Date(run.plannedStartAt);
    const plannedEndAt = new Date(run.plannedEndAt);
    if (Number.isNaN(plannedStartAt.getTime()) || Number.isNaN(plannedEndAt.getTime())) {
      setError("Choose a valid pilot start and end time.");
      return;
    }
    const saved = await submit({
      action: "CREATE_RUN",
      ...run,
      plannedStartAt: plannedStartAt.toISOString(),
      plannedEndAt: plannedEndAt.toISOString()
    }, "Supervised pilot planned and added to the audit trail.");
    if (saved) setRun(EMPTY_RUN);
  }

  async function changeRun(item, action) {
    const reason = window.prompt(`Why should this pilot ${action.toLowerCase()}? This is recorded in the audit trail.`, "");
    if (!reason?.trim()) return;
    await submit({ entity: "RUN", action, reason }, `Pilot status changed to ${label(action)}.`, "PATCH", item.id);
  }

  async function recordEvent(eventObject) {
    eventObject.preventDefault();
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      setError("Choose a valid drill or incident time.");
      return;
    }
    const saved = await submit({
      action: "RECORD_EVENT",
      ...event,
      outcome: event.kind === "DRILL" ? event.outcome : null,
      occurredAt: occurredAt.toISOString()
    }, event.kind === "DRILL" ? "Operational drill recorded." : "Incident recorded for manager follow-up.");
    if (saved) setEvent((current) => ({ ...EMPTY_EVENT, pilotRunId: current.pilotRunId, occurredAt: localDateTimeValue() }));
  }

  async function changeIncident(item, action) {
    const notes = window.prompt(action === "RESOLVE" ? "Resolution evidence and recovery result:" : "Immediate response and acknowledgement note:", "");
    if (!notes?.trim()) return;
    await submit({ entity: "EVENT", action, notes }, action === "RESOLVE" ? "Incident resolved with audit evidence." : "Incident acknowledged.", "PATCH", item.id);
  }

  if (!report) return <section style={styles.shell}><p style={styles.muted}>{error || "Loading pilot operations…"}</p></section>;
  const summary = report.summary;

  return <section style={styles.shell}>
    <div style={styles.header}>
      <div><p style={styles.eyebrow}>STAGE 10C · SUPERVISED PILOT OPERATIONS</p><h2 style={styles.title}>Pilot register and incident readiness</h2><p style={styles.muted}>Plan a supervised school launch, record operational drills, and manage incident evidence through an auditable manager-only workflow.</p></div>
      <span style={{ ...styles.status, background: report.readiness.readyForPilot ? "#dcfce7" : "#fee2e2", color: report.readiness.readyForPilot ? "#166534" : "#991b1b" }}>{report.readiness.readyForPilot ? "READY TO OPERATE" : "READINESS REQUIRED"}</span>
    </div>
    <div style={styles.safety}><strong>Record-only control boundary.</strong> This section does not withdraw content, send notifications, shut down a service, delete records, or store student identities. Managers must complete any real operational action through the approved procedure.</div>
    {error ? <div style={styles.error}>{error}</div> : null}{notice ? <div style={styles.notice}>{notice}</div> : null}

    <div style={styles.metrics}>
      <article style={styles.metric}><span style={styles.metricValue}>{summary.operationalRunStatus ? label(summary.operationalRunStatus) : "NONE"}</span><strong>Current operational pilot</strong><small>Only one pilot can be active or paused per school.</small></article>
      <article style={styles.metric}><span style={styles.metricValue}>{summary.plannedRuns}</span><strong>Planned pilots</strong><small>Starting still requires current READY status.</small></article>
      <article style={styles.metric}><span style={styles.metricValue}>{summary.openIncidents}</span><strong>Open incidents</strong><small>{summary.criticalOpenIncidents} currently marked critical.</small></article>
      <article style={styles.metric}><span style={styles.metricValue}>{summary.recordedDrills}</span><strong>Recorded drills</strong><small>Newest 100 pilot events are shown below.</small></article>
    </div>

    <div style={styles.columns}>
      <form onSubmit={createRun} style={styles.card}><h3 style={styles.cardTitle}>Plan a supervised pilot</h3>
        <label style={styles.label}>Pilot title<input style={styles.input} value={run.title} onChange={(e) => setRun((current) => ({ ...current, title: e.target.value }))} minLength={3} maxLength={160} required /></label>
        <div style={styles.two}><label style={styles.label}>Planned start<input style={styles.input} type="datetime-local" value={run.plannedStartAt} onChange={(e) => setRun((current) => ({ ...current, plannedStartAt: e.target.value }))} required /></label><label style={styles.label}>Planned end<input style={styles.input} type="datetime-local" value={run.plannedEndAt} onChange={(e) => setRun((current) => ({ ...current, plannedEndAt: e.target.value }))} required /></label></div>
        <label style={styles.label}>Manager notes<textarea style={{ ...styles.input, minHeight: 90 }} value={run.notes} onChange={(e) => setRun((current) => ({ ...current, notes: e.target.value }))} maxLength={2000} /></label>
        <button style={styles.primary} disabled={working}>Add planned pilot</button>
      </form>

      <form onSubmit={recordEvent} style={styles.card}><h3 style={styles.cardTitle}>Record a drill or incident</h3>
        <label style={styles.label}>Pilot run<select style={styles.input} value={event.pilotRunId} onChange={(e) => setEvent((current) => ({ ...current, pilotRunId: e.target.value }))} required><option value="">Choose a pilot…</option>{selectableRuns.map((item) => <option key={item.id} value={item.id}>{item.title} · {label(item.status)}</option>)}</select></label>
        <div style={styles.two}><label style={styles.label}>Record type<select style={styles.input} value={event.kind} onChange={(e) => setEvent((current) => ({ ...current, kind: e.target.value }))}><option value="DRILL">Drill</option><option value="INCIDENT">Incident</option></select></label><label style={styles.label}>Severity<select style={styles.input} value={event.severity} onChange={(e) => setEvent((current) => ({ ...current, severity: e.target.value }))}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <label style={styles.label}>Category<select style={styles.input} value={event.category} onChange={(e) => setEvent((current) => ({ ...current, category: e.target.value }))}>{["EMERGENCY_WITHDRAWAL", "SERVICE_RECOVERY", "SUPPORT_ESCALATION", "CONTENT_SAFETY", "PLATFORM_AVAILABILITY", "OTHER"].map((value) => <option key={value}>{label(value)}</option>)}</select></label>
        {event.kind === "DRILL" ? <label style={styles.label}>Drill outcome<select style={styles.input} value={event.outcome} onChange={(e) => setEvent((current) => ({ ...current, outcome: e.target.value }))}><option value="PASSED">Passed</option><option value="NEEDS_ACTION">Needs action</option><option value="NOT_APPLICABLE">Not applicable</option></select></label> : null}
        <label style={styles.label}>Occurred at<input style={styles.input} type="datetime-local" value={event.occurredAt} onChange={(e) => setEvent((current) => ({ ...current, occurredAt: e.target.value }))} required /></label>
        <label style={styles.label}>Privacy-safe summary<textarea style={{ ...styles.input, minHeight: 78 }} value={event.summary} onChange={(e) => setEvent((current) => ({ ...current, summary: e.target.value }))} minLength={10} maxLength={1000} required /></label>
        <label style={styles.label}>Response actions or evidence<textarea style={{ ...styles.input, minHeight: 68 }} value={event.responseActions} onChange={(e) => setEvent((current) => ({ ...current, responseActions: e.target.value }))} maxLength={2000} /></label>
        <button style={styles.secondary} disabled={working || !selectableRuns.length}>Record with audit trail</button>
      </form>
    </div>

    <div style={styles.card}><h3 style={styles.cardTitle}>Pilot runs</h3>{!report.runs.length ? <p style={styles.muted}>No supervised pilot has been planned.</p> : report.runs.map((item) => <article key={item.id} style={styles.row}><div><strong>{item.title}</strong><p style={styles.body}>{dateTime(item.plannedStartAt)} → {dateTime(item.plannedEndAt)}</p><small>{label(item.status)} · {item._count.events} events · updated by {actorName(item.updatedBy)}</small>{item.transitionReason ? <p style={styles.reason}>Latest reason: {item.transitionReason}</p> : null}</div><div style={styles.actions}>{(RUN_ACTIONS[item.status] || []).map((action) => <button key={action} style={action === "CANCEL" ? styles.danger : styles.action} disabled={working || (new Set(["START", "RESUME"]).has(action) && !report.readiness.readyForPilot)} onClick={() => changeRun(item, action)}>{label(action)}</button>)}</div></article>)}</div>

    <div style={{ ...styles.card, marginTop: 12 }}><h3 style={styles.cardTitle}>Drills and incidents</h3>{!report.events.length ? <p style={styles.muted}>No pilot events have been recorded.</p> : report.events.map((item) => <article key={item.id} style={styles.row}><div><strong>{label(item.kind)} · {label(item.category)}</strong><p style={styles.body}>{item.summary}</p><small>{item.pilotRun.title} · {dateTime(item.occurredAt)} · {label(item.severity)} · {label(item.status)} · recorded by {actorName(item.createdBy)}</small>{item.outcome ? <p style={styles.reason}>Drill outcome: {label(item.outcome)}</p> : null}{item.responseActions ? <p style={styles.reason}>Response: {item.responseActions}</p> : null}{item.resolutionNotes ? <p style={styles.reason}>Resolution: {item.resolutionNotes}</p> : null}</div>{item.kind === "INCIDENT" && item.status !== "RESOLVED" ? <div style={styles.actions}>{item.status === "OPEN" ? <button style={styles.action} disabled={working} onClick={() => changeIncident(item, "ACKNOWLEDGE")}>Acknowledge</button> : null}<button style={styles.resolve} disabled={working} onClick={() => changeIncident(item, "RESOLVE")}>Resolve</button></div> : null}</article>)}</div>
  </section>;
}

const styles = {
  shell: { margin: "0 0 24px", border: "1px solid #2b3a54", borderRadius: 16, background: "#121d30", padding: 22 }, header: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, title: { margin: "0 0 8px", fontSize: 28 }, muted: { color: "#aebbd0", lineHeight: 1.5, margin: "6px 0" },
  status: { borderRadius: 999, padding: "7px 11px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }, safety: { margin: "16px 0", border: "1px solid #60a5fa", borderRadius: 10, padding: 13, background: "#132b48", color: "#bfdbfe", lineHeight: 1.5 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 12 }, metric: { display: "grid", gap: 6, border: "1px solid #34445f", borderRadius: 10, padding: 15, background: "#131e30" }, metricValue: { color: "#f4b942", fontWeight: 900, fontSize: 22 },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12, marginBottom: 12 }, card: { border: "1px solid #34445f", borderRadius: 10, padding: 15, background: "#131e30" }, cardTitle: { margin: "0 0 8px" }, two: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 },
  label: { display: "grid", gap: 6, margin: "11px 0", color: "#dce5f3", fontWeight: 800, fontSize: 12 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, padding: "9px 10px", font: "inherit" },
  primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #60a5fa", borderRadius: 8, background: "transparent", color: "#bfdbfe", padding: "9px 12px", fontWeight: 800, cursor: "pointer" },
  row: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", borderTop: "1px solid #34445f", padding: "13px 0" }, body: { color: "#dce5f3", margin: "5px 0", lineHeight: 1.45 }, reason: { color: "#aebbd0", margin: "6px 0 0", whiteSpace: "pre-wrap", fontSize: 13 }, actions: { display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "flex-end" },
  action: { border: "1px solid #94a3b8", borderRadius: 7, background: "transparent", color: "#e2e8f0", padding: "7px 9px", fontWeight: 800, cursor: "pointer" }, resolve: { border: "1px solid #22c55e", borderRadius: 7, background: "transparent", color: "#bbf7d0", padding: "7px 9px", fontWeight: 800, cursor: "pointer" }, danger: { border: "1px solid #f87171", borderRadius: 7, background: "transparent", color: "#fecaca", padding: "7px 9px", fontWeight: 800, cursor: "pointer" },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, margin: "12px 0" }, notice: { border: "1px solid #22c55e", background: "#12351f", color: "#bbf7d0", borderRadius: 8, padding: 12, margin: "12px 0" }
};
