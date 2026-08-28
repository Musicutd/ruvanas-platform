"use client";

import { useMemo, useState } from "react";

const DEFAULT_RETENTION = { rawPlaybackDays: 395, playerHeartbeatDays: 90, audioProjectDays: 730, supportTicketDays: 730, auditDays: 2555 };

async function callApi(url, options) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The operation could not be completed.");
  return body;
}

function Field({ label, children }) {
  return <label style={styles.label}>{label}{children}</label>;
}

export default function ComplianceOperations({ role, organisations, supportTickets, administrators, rightsEvidence }) {
  const [organisationId, setOrganisationId] = useState(organisations[0]?.id || "");
  const selected = useMemo(() => organisations.find((item) => item.id === organisationId) || organisations[0], [organisationId, organisations]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canManageCompliance = role === "SUPER_ADMIN";

  async function run(work) {
    setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function submitCompliance(event, payload, success) {
    event.preventDefault();
    await run(async () => {
      const body = await callApi("/api/admin/compliance", { method: "POST", body: JSON.stringify(payload) });
      setMessage(body.notice || success);
      if (body.downloadUrl) window.location.assign(body.downloadUrl);
      else window.setTimeout(() => window.location.reload(), 500);
    });
  }

  async function submitTicket(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await callApi("/api/admin/support/tickets", { method: "POST", body: JSON.stringify({
        organisationId: form.get("organisationId") || null,
        priority: form.get("priority"),
        subject: form.get("subject"),
        description: form.get("description"),
        linkedEntityType: form.get("linkedEntityType") || null,
        linkedEntityId: form.get("linkedEntityId") || null,
        incidentStartedAt: form.get("incidentStartedAt") ? new Date(form.get("incidentStartedAt")).toISOString() : null
      }) });
      setMessage("Support ticket created and added to the audit trail.");
      window.setTimeout(() => window.location.reload(), 500);
    });
  }

  async function updateTicket(ticketId, status, priority, assignedToUserId) {
    await run(async () => {
      await callApi("/api/admin/support/tickets", { method: "PATCH", body: JSON.stringify({ ticketId, status, priority, assignedToUserId: assignedToUserId || null }) });
      setMessage("Support ticket updated.");
      window.setTimeout(() => window.location.reload(), 500);
    });
  }

  const policy = selected?.retentionPolicy || DEFAULT_RETENTION;
  const rights = rightsEvidence[selected?.id] || { tracks: 0, confirmed: 0, missing: 0, expiring: 0 };

  return <div style={styles.stack}>
    {message && <div style={styles.message}>{message}</div>}

    <section style={styles.card}>
      <h2 style={styles.heading}>Support & incident operations</h2>
      <p style={styles.help}>Available to Super Admin and Support. Link a case to an organisation and, when useful, a player, campaign, report, or other record.</p>
      <form onSubmit={submitTicket} style={styles.grid}>
        <Field label="Organisation"><select name="organisationId" style={styles.input}><option value="">Platform-wide</option>{organisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Priority"><select name="priority" style={styles.input} defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></Field>
        <Field label="Subject"><input name="subject" required minLength="3" maxLength="180" style={styles.input} /></Field>
        <Field label="Incident started (optional)"><input name="incidentStartedAt" type="datetime-local" style={styles.input} /></Field>
        <Field label="Linked record type"><input name="linkedEntityType" placeholder="Player, Campaign, ReportExportJob…" style={styles.input} /></Field>
        <Field label="Linked record ID"><input name="linkedEntityId" style={styles.input} /></Field>
        <label style={{ ...styles.label, gridColumn: "1 / -1" }}>Description<textarea name="description" required minLength="3" maxLength="8000" rows="4" style={styles.input} /></label>
        <button disabled={busy} style={styles.primary}>Create support ticket</button>
      </form>
      <div style={styles.list}>{supportTickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} administrators={administrators} busy={busy} onSave={updateTicket} />)}</div>
    </section>

    {canManageCompliance && selected && <>
      <section style={styles.card}>
        <div style={styles.row}><div><h2 style={styles.heading}>Organisation compliance evidence</h2><p style={styles.help}>Select the tenant before recording evidence or producing an export.</p></div><select style={styles.orgSelect} value={selected.id} onChange={(event) => setOrganisationId(event.target.value)}>{organisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div style={styles.metrics}><Metric label="Catalogue tracks" value={rights.tracks} /><Metric label="Rights confirmed" value={rights.confirmed} /><Metric label="Rights action needed" value={rights.missing} warning={rights.missing > 0} /><Metric label="Licences expiring in 30 days" value={rights.expiring} warning={rights.expiring > 0} /></div>
        <form onSubmit={(event) => { const form = new FormData(event.currentTarget); submitCompliance(event, { action: "RECORD_POLICY_ACCEPTANCE", organisationId: selected.id, key: form.get("key"), version: form.get("version"), title: form.get("title"), evidenceReference: form.get("evidenceReference") }, "Policy acceptance recorded."); }} style={styles.subsection}>
          <h3 style={styles.subheading}>Record policy acceptance</h3>
          <div style={styles.grid}><Field label="Policy key"><input required name="key" placeholder="terms-of-service" pattern="[a-z0-9-]+" style={styles.input} /></Field><Field label="Version"><input required name="version" placeholder="2026-09" style={styles.input} /></Field><Field label="Title"><input required name="title" placeholder="Ruvanas service terms" style={styles.input} /></Field><Field label="Document reference or exact version text"><input required name="evidenceReference" maxLength="4000" placeholder="Approved document URL, file reference, or exact version note" style={styles.input} /></Field></div>
          <button disabled={busy} style={styles.primary}>Record evidence</button>
          <div style={styles.compactList}>{selected.policyAcceptances?.map((item) => <p key={item.id}><strong>{item.policy.title}</strong> v{item.policy.version} · {new Date(item.acceptedAt).toLocaleString()} · {item.acceptedBy.name || item.acceptedBy.email}</p>)}</div>
        </form>
      </section>

      <section style={styles.card}>
        <h2 style={styles.heading}>Privacy data requests</h2>
        <form onSubmit={(event) => { const form = new FormData(event.currentTarget); submitCompliance(event, { action: "CREATE_DATA_REQUEST", organisationId: selected.id, type: form.get("type"), subjectEmail: form.get("subjectEmail"), notes: form.get("notes") || null, dueAt: form.get("dueAt") ? new Date(form.get("dueAt")).toISOString() : null }, "Data request created."); }} style={styles.grid}>
          <Field label="Request type"><select name="type" style={styles.input}><option>EXPORT</option><option>CORRECTION</option><option>DELETION</option><option>RESTRICTION</option></select></Field>
          <Field label="Subject email"><input name="subjectEmail" type="email" required style={styles.input} /></Field>
          <Field label="Response due (optional)"><input name="dueAt" type="datetime-local" style={styles.input} /></Field>
          <Field label="Internal notes"><input name="notes" maxLength="4000" style={styles.input} /></Field>
          <button disabled={busy} style={styles.primary}>Create tracked request</button>
        </form>
        <div style={styles.list}>{selected.dataRequests?.map((item) => <DataRequestRow key={item.id} item={item} busy={busy} submitCompliance={submitCompliance} />)}</div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.heading}>Retention policy & safe preview</h2>
        <p style={styles.help}>Saving changes records the reviewed policy. Preview counts records older than each cutoff; it never deletes them.</p>
        <form onSubmit={(event) => { const form = new FormData(event.currentTarget); submitCompliance(event, { action: "UPDATE_RETENTION", organisationId: selected.id, ...Object.fromEntries(Object.keys(DEFAULT_RETENTION).map((key) => [key, Number(form.get(key))])) }, "Retention policy saved."); }} style={styles.grid}>
          {Object.entries({ rawPlaybackDays: "Raw playback evidence", playerHeartbeatDays: "Inactive player heartbeat", audioProjectDays: "Audio projects", supportTicketDays: "Support tickets", auditDays: "Audit logs" }).map(([key, label]) => <Field key={key} label={`${label} (days)`}><input name={key} type="number" required min={key === "playerHeartbeatDays" ? 7 : key === "auditDays" ? 365 : key === "rawPlaybackDays" ? 30 : 90} max="3650" defaultValue={policy[key]} style={styles.input} /></Field>)}
          <button disabled={busy} style={styles.primary}>Save reviewed policy</button>
          <button type="button" disabled={busy} style={styles.secondary} onClick={(event) => submitCompliance(event, { action: "PREVIEW_RETENTION", organisationId: selected.id }, "Retention preview completed. No records were deleted.")}>Run no-delete preview</button>
        </form>
        <div style={styles.compactList}>{selected.retentionJobs?.map((job) => <p key={job.id}><strong>{job.status}</strong> · {new Date(job.createdAt).toLocaleString()} · No deletion · {JSON.stringify(job.candidateCounts || {})}</p>)}</div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.heading}>Tamper-evident audit export</h2>
        <p style={styles.help}>Exports redact secret-like fields, neutralize spreadsheet formulas, and receive a SHA-256 seal chained to the previous export. This detects later changes; it does not make the source database legally immutable.</p>
        <form onSubmit={(event) => { const form = new FormData(event.currentTarget); submitCompliance(event, { action: "CREATE_AUDIT_EXPORT", organisationId: selected.id, ...(form.get("fromAt") ? { fromAt: new Date(form.get("fromAt")).toISOString() } : {}), ...(form.get("untilAt") ? { untilAt: new Date(form.get("untilAt")).toISOString() } : {}) }, "Audit export prepared."); }} style={styles.grid}>
          <Field label="From (optional)"><input name="fromAt" type="datetime-local" style={styles.input} /></Field><Field label="Until (optional)"><input name="untilAt" type="datetime-local" style={styles.input} /></Field><button disabled={busy} style={styles.primary}>Create & download CSV</button>
        </form>
        <div style={styles.compactList}>{selected.auditExportSeals?.map((seal) => <p key={seal.id}><strong>Seal #{seal.sequence}</strong> · {seal.rowCount} rows · {seal.sealHash.slice(0, 16)}… · {seal.exportJob.status}</p>)}</div>
      </section>
    </>}
  </div>;
}

function Metric({ label, value, warning }) { return <div style={{ ...styles.metric, ...(warning ? styles.metricWarning : {}) }}><strong style={styles.metricValue}>{value}</strong><span>{label}</span></div>; }

function TicketRow({ ticket, administrators, busy, onSave }) {
  const [status, setStatus] = useState(ticket.status); const [priority, setPriority] = useState(ticket.priority); const [assigned, setAssigned] = useState(ticket.assignedToUserId || "");
  return <div style={styles.listRow}><div><strong>{ticket.reference} · {ticket.subject}</strong><p style={styles.help}>{ticket.organisation?.name || "Platform-wide"} · {ticket.linkedEntityType ? `${ticket.linkedEntityType} ${ticket.linkedEntityId || ""}` : "No linked record"} · Opened {new Date(ticket.createdAt).toLocaleString()}</p></div><div style={styles.controls}><select value={priority} onChange={(e) => setPriority(e.target.value)} style={styles.smallInput}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select><select value={status} onChange={(e) => setStatus(e.target.value)} style={styles.smallInput}><option>OPEN</option><option>IN_PROGRESS</option><option>WAITING_CUSTOMER</option><option>RESOLVED</option><option>CLOSED</option></select><select value={assigned} onChange={(e) => setAssigned(e.target.value)} style={styles.smallInput}><option value="">Unassigned</option>{administrators.map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select><button disabled={busy} style={styles.secondary} onClick={() => onSave(ticket.id, status, priority, assigned)}>Save</button></div></div>;
}

function DataRequestRow({ item, busy, submitCompliance }) {
  const [status, setStatus] = useState(item.status);
  return <div style={styles.listRow}><div><strong>{item.reference} · {item.type}</strong><p style={styles.help}>{item.subjectEmail || item.subjectUserId} · due {new Date(item.dueAt).toLocaleString()}</p></div><div style={styles.controls}><select value={status} onChange={(e) => setStatus(e.target.value)} style={styles.smallInput}><option>OPEN</option><option>IN_REVIEW</option><option>AWAITING_INFORMATION</option><option>APPROVED</option><option>COMPLETED</option><option>REJECTED</option><option>CANCELLED</option></select><button disabled={busy} style={styles.secondary} onClick={(event) => submitCompliance(event, { action: "UPDATE_DATA_REQUEST", requestId: item.id, status }, "Data-request status updated.")}>Update</button></div></div>;
}

const styles = {
  stack: { display: "grid", gap: 20 }, card: { padding: 20, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" }, heading: { margin: "0 0 7px", fontSize: 21, color: "#111827" }, subheading: { margin: "0 0 12px", fontSize: 17 }, subsection: { marginTop: 18, paddingTop: 18, borderTop: "1px solid #cbd5e1" },
  row: { display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "start" }, orgSelect: { minWidth: 260, padding: 10, border: "1px solid #64748b", borderRadius: 7, background: "#fff" }, grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "end", marginTop: 14 }, label: { display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 }, input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#111827", fontSize: 14 }, smallInput: { padding: "7px 8px", border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", fontSize: 12 },
  primary: { padding: "10px 14px", border: 0, borderRadius: 7, background: "#172033", color: "#fff", fontWeight: 850, cursor: "pointer" }, secondary: { padding: "9px 12px", border: "1px solid #64748b", borderRadius: 7, background: "#fff", color: "#172033", fontWeight: 800, cursor: "pointer" }, help: { margin: "5px 0", color: "#64748b", fontSize: 12, lineHeight: 1.45 }, message: { padding: 12, border: "1px solid #0ea5e9", borderRadius: 8, background: "#e8f4ff", color: "#164e75", fontWeight: 750 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 15 }, metric: { display: "grid", gap: 4, padding: 13, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", color: "#475569", fontSize: 12 }, metricWarning: { borderColor: "#f0b429", background: "#fff8e6" }, metricValue: { color: "#111827", fontSize: 24 }, list: { display: "grid", gap: 8, marginTop: 18 }, listRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: 12, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", flexWrap: "wrap" }, controls: { display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }, compactList: { marginTop: 12, color: "#475569", fontSize: 12 }
};

