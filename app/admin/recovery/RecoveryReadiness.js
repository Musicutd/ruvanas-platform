"use client";

import { useCallback, useEffect, useState } from "react";

const ASSETS = ["DATABASE", "OBJECT_STORAGE"];
const FINDINGS = {
  RECOVERY_STRATEGY_UNCONFIRMED: "Recovery strategy has not been confirmed.",
  RECOVERY_CONTROL_REVIEW_OVERDUE: "The recovery control review is overdue.",
  AUTOMATED_BACKUP_UNCONFIRMED: "Automated database backups have not been confirmed.",
  OBJECT_RECOVERY_UNCONFIRMED: "Protected-storage versioning or backup recovery has not been confirmed.",
  BACKUP_VERIFICATION_MISSING: "No passed backup verification is recorded.",
  BACKUP_VERIFICATION_STALE: "The last passed backup verification is stale.",
  LATEST_BACKUP_VERIFICATION_FAILED: "The latest backup verification failed.",
  LATEST_BACKUP_VERIFICATION_PARTIAL: "The latest backup verification was only partial.",
  RESTORE_DRILL_MISSING: "No passed restore drill is recorded.",
  RESTORE_DRILL_OVERDUE: "The last passed restore drill is older than 90 days.",
  LATEST_RESTORE_DRILL_FAILED: "The latest restore drill failed.",
  LATEST_RESTORE_DRILL_PARTIAL: "The latest restore drill was only partial.",
  RECOVERY_TARGETS_UNCONFIRMED: "RPO and RTO targets are not both confirmed.",
  RPO_TARGET_MISSED: "The latest verified backup exceeded the RPO target.",
  RTO_TARGET_MISSED: "The latest restore drill exceeded the RTO target."
};

function blankControl() {
  return { strategyConfirmed: false, automatedBackupConfirmed: false, versioningConfirmed: false, targetRpoMinutes: "", targetRtoMinutes: "", retentionDays: "", notes: "" };
}

function blankEvidence() {
  return { evidenceKind: "BACKUP_VERIFICATION", result: "PASSED", evidenceReference: "", performedAt: localDateTime(new Date()), backupCapturedAt: "", restoreCompletedMinutes: "", notes: "" };
}

export default function RecoveryReadiness() {
  const [report, setReport] = useState(null);
  const [controls, setControls] = useState(() => Object.fromEntries(ASSETS.map((asset) => [asset, blankControl()])));
  const [evidence, setEvidence] = useState(() => Object.fromEntries(ASSETS.map((asset) => [asset, blankEvidence()])));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/recovery", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load recovery readiness.");
      setReport(body);
      setControls((current) => Object.fromEntries(ASSETS.map((assetKind) => {
        const saved = body.assets.find((item) => item.assetKind === assetKind)?.control;
        return [assetKind, saved ? {
          strategyConfirmed: saved.strategyConfirmed,
          automatedBackupConfirmed: saved.automatedBackupConfirmed,
          versioningConfirmed: saved.versioningConfirmed,
          targetRpoMinutes: saved.targetRpoMinutes ?? "",
          targetRtoMinutes: saved.targetRtoMinutes ?? "",
          retentionDays: saved.retentionDays ?? "",
          notes: saved.notes || current[assetKind]?.notes || ""
        } : current[assetKind] || blankControl()];
      })));
    } catch (loadError) {
      setError(loadError.message || "Unable to load recovery readiness.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(assetKind, payload, actionLabel) {
    setBusy(`${assetKind}:${payload.action}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, assetKind }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save recovery evidence.");
      setNotice(actionLabel);
      if (payload.action === "RECORD_EVIDENCE") setEvidence((current) => ({ ...current, [assetKind]: blankEvidence() }));
      await load();
    } catch (submitError) {
      setError(submitError.message || "Unable to save recovery evidence.");
    } finally { setBusy(""); }
  }

  return <section style={styles.stack}>
    <div style={styles.overview}>
      <div><p style={styles.label}>Current environment</p><strong>{report?.environment || "Loading…"}</strong><p style={styles.muted}>Evidence is isolated by deployment environment.</p></div>
      <div><p style={styles.label}>Recovery status</p><span style={{ ...styles.status, ...statusStyle(report?.status) }}>{report?.status || "LOADING"}</span></div>
      <button type="button" onClick={load} style={styles.secondary}>Refresh readiness</button>
    </div>
    {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    {notice ? <p role="status" style={styles.good}>{notice}</p> : null}
    {report?.findings?.length ? <div style={styles.findings}>{report.findings.map((finding, index) => <div key={`${finding.assetKind}-${finding.code}-${index}`} style={finding.severity === "CRITICAL" ? styles.criticalFinding : styles.warningFinding}><strong>{finding.severity}</strong><span>{assetLabel(finding.assetKind)}: {FINDINGS[finding.code] || finding.code}</span></div>)}</div> : report ? <p style={styles.good}>All recorded recovery controls are current.</p> : null}

    {ASSETS.map((assetKind) => {
      const asset = report?.assets?.find((item) => item.assetKind === assetKind);
      const control = controls[assetKind];
      const record = evidence[assetKind];
      return <article key={assetKind} style={styles.card}>
        <header style={styles.cardHeader}><div><p style={styles.label}>{assetLabel(assetKind)}</p><h2 style={styles.title}>{assetKind === "DATABASE" ? "Database continuity" : "Protected media and evidence"}</h2><p style={styles.muted}>{assetKind === "DATABASE" ? "Confirm managed backups only after checking the active paid production database." : "Confirm versioning or a recovery mechanism for critical masters and evidence. Do not paste a private storage URL."}</p></div><span style={{ ...styles.smallBadge, ...statusStyle(assetStatus(report, assetKind)) }}>{assetStatus(report, assetKind)}</span></header>

        <div style={styles.formGrid}>
          <label style={styles.check}><input type="checkbox" checked={control.strategyConfirmed} onChange={(event) => updateStrategy(setControls, assetKind, event.target.checked)} /> Recovery strategy confirmed</label>
          <label style={styles.check}><input type="checkbox" checked={control.automatedBackupConfirmed} onChange={(event) => updateControl(setControls, assetKind, "automatedBackupConfirmed", event.target.checked)} /> Automated backups confirmed</label>
          {assetKind === "OBJECT_STORAGE" ? <label style={styles.check}><input type="checkbox" checked={control.versioningConfirmed} onChange={(event) => updateControl(setControls, assetKind, "versioningConfirmed", event.target.checked)} /> Object versioning confirmed</label> : null}
          <Field label="RPO target (minutes)" value={control.targetRpoMinutes} onChange={(value) => updateControl(setControls, assetKind, "targetRpoMinutes", value)} type="number" />
          <Field label="RTO target (minutes)" value={control.targetRtoMinutes} onChange={(value) => updateControl(setControls, assetKind, "targetRtoMinutes", value)} type="number" />
          <Field label="Retention (days)" value={control.retentionDays} onChange={(value) => updateControl(setControls, assetKind, "retentionDays", value)} type="number" />
          <label style={styles.wideField}>Review note<textarea value={control.notes} onChange={(event) => updateControl(setControls, assetKind, "notes", event.target.value)} maxLength={500} placeholder="What was checked, by whom, and against which approved operating procedure?" style={styles.textarea} /></label>
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={() => submit(assetKind, { action: "UPDATE_CONTROL", ...control }, `${assetLabel(assetKind)} recovery control saved with audit evidence.`)} style={styles.primary}>{busy === `${assetKind}:UPDATE_CONTROL` ? "Saving…" : "Save recovery control"}</button>

        <div style={styles.divider} />
        <h3 style={styles.subtitleHeading}>Record verification or restore drill</h3>
        <div style={styles.formGrid}>
          <Select label="Evidence type" value={record.evidenceKind} onChange={(value) => updateEvidence(setEvidence, assetKind, "evidenceKind", value)} options={["BACKUP_VERIFICATION", "RESTORE_DRILL"]} />
          <Select label="Result" value={record.result} onChange={(value) => updateEvidence(setEvidence, assetKind, "result", value)} options={["PASSED", "PARTIAL", "FAILED"]} />
          <Field label="Safe evidence reference" value={record.evidenceReference} onChange={(value) => updateEvidence(setEvidence, assetKind, "evidenceReference", value)} placeholder="snapshot-2026-08-30-001" />
          <Field label="Performed at" value={record.performedAt} onChange={(value) => updateEvidence(setEvidence, assetKind, "performedAt", value)} type="datetime-local" />
          <Field label="Backup captured at (optional)" value={record.backupCapturedAt} onChange={(value) => updateEvidence(setEvidence, assetKind, "backupCapturedAt", value)} type="datetime-local" />
          {record.evidenceKind === "RESTORE_DRILL" ? <Field label="Restore duration (minutes)" value={record.restoreCompletedMinutes} onChange={(value) => updateEvidence(setEvidence, assetKind, "restoreCompletedMinutes", value)} type="number" /> : null}
          <label style={styles.wideField}>Evidence note<textarea value={record.notes} onChange={(event) => updateEvidence(setEvidence, assetKind, "notes", event.target.value)} maxLength={500} placeholder="Describe the verification result without credentials, customer content, or private links." style={styles.textarea} /></label>
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={() => submit(assetKind, { action: "RECORD_EVIDENCE", ...record, performedAt: toIso(record.performedAt), backupCapturedAt: record.backupCapturedAt ? toIso(record.backupCapturedAt) : null }, `${assetLabel(assetKind)} recovery evidence recorded.`)} style={styles.primary}>{busy === `${assetKind}:RECORD_EVIDENCE` ? "Recording…" : "Record evidence"}</button>

        <h3 style={styles.subtitleHeading}>Recent evidence</h3>
        {!asset?.evidence?.length ? <p style={styles.muted}>No evidence recorded.</p> : <div style={styles.tableWrap}><table style={styles.table}><thead><tr><th style={styles.th}>Performed</th><th style={styles.th}>Type</th><th style={styles.th}>Result</th><th style={styles.th}>Reference</th><th style={styles.th}>Recorded by</th></tr></thead><tbody>{asset.evidence.map((item) => <tr key={item.id}><td style={styles.td}>{formatDate(item.performedAt)}</td><td style={styles.td}>{item.evidenceKind.replaceAll("_", " ")}</td><td style={styles.td}><span style={{ ...styles.smallBadge, ...resultStyle(item.result) }}>{item.result}</span></td><td style={styles.td}><code>{item.evidenceReference}</code></td><td style={styles.td}>{item.recordedBy?.name || "Super Admin"}</td></tr>)}</tbody></table></div>}
      </article>;
    })}
  </section>;
}

function Field({ label, value, onChange, type = "text", placeholder }) { return <label style={styles.field}>{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} min={type === "number" ? 1 : undefined} style={styles.input} /></label>; }
function Select({ label, value, onChange, options }) { return <label style={styles.field}>{label}<select value={value} onChange={(event) => onChange(event.target.value)} style={styles.input}>{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select></label>; }
function updateControl(setter, asset, key, value) { setter((current) => ({ ...current, [asset]: { ...current[asset], [key]: value } })); }
function updateStrategy(setter, asset, confirmed) { setter((current) => ({ ...current, [asset]: { ...current[asset], strategyConfirmed: confirmed, ...(!confirmed ? { targetRpoMinutes: "", targetRtoMinutes: "" } : {}) } })); }
function updateEvidence(setter, asset, key, value) { setter((current) => ({ ...current, [asset]: { ...current[asset], [key]: value } })); }
function assetLabel(asset) { return asset === "DATABASE" ? "Database" : "Protected storage"; }
function assetStatus(report, assetKind) { const findings = report?.findings?.filter((item) => item.assetKind === assetKind) || []; return findings.some((item) => item.severity === "CRITICAL") ? "NOT READY" : findings.length ? "ATTENTION" : report ? "READY" : "LOADING"; }
function statusStyle(status) { if (["READY"].includes(status)) return { background: "#dcfce7", color: "#166534" }; if (["ATTENTION"].includes(status)) return { background: "#fef3c7", color: "#92400e" }; if (["NOT_READY", "NOT READY"].includes(status)) return { background: "#fee2e2", color: "#991b1b" }; return { background: "#e2e8f0", color: "#334155" }; }
function resultStyle(result) { return result === "PASSED" ? { background: "#dcfce7", color: "#166534" } : result === "FAILED" ? { background: "#fee2e2", color: "#991b1b" } : { background: "#fef3c7", color: "#92400e" }; }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "None recorded"; }
function localDateTime(date) { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16); }
function toIso(value) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString(); }

const styles = {
  stack: { display: "grid", gap: 18 }, overview: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap", border: "1px solid #cbd5e1", borderRadius: 12, padding: 20, background: "#f8fafc" }, label: { margin: "0 0 7px", color: "#475569", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1 }, status: { display: "inline-block", borderRadius: 999, padding: "7px 12px", fontWeight: 900, fontSize: 13 }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" }, primary: { border: 0, borderRadius: 7, padding: "10px 14px", background: "#0f172a", color: "#fff", fontWeight: 800, cursor: "pointer" }, findings: { display: "grid", gap: 8 }, criticalFinding: { display: "flex", gap: 10, padding: 12, borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b" }, warningFinding: { display: "flex", gap: 10, padding: 12, borderRadius: 8, border: "1px solid #fcd34d", background: "#fffbeb", color: "#92400e" }, good: { padding: 12, borderRadius: 8, background: "#f0fdf4", color: "#166534", fontWeight: 800 }, error: { padding: 12, borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontWeight: 800 }, card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 22, background: "#fff", minWidth: 0 }, cardHeader: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }, title: { margin: 0, fontSize: 25 }, muted: { color: "#475569", lineHeight: 1.5, margin: "6px 0" }, formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, margin: "18px 0" }, field: { display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 }, wideField: { display: "grid", gridColumn: "1 / -1", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 }, check: { display: "flex", alignItems: "center", gap: 8, minHeight: 42, color: "#334155", fontWeight: 800 }, input: { border: "1px solid #94a3b8", borderRadius: 7, padding: "10px 11px", background: "#fff", color: "#0f172a" }, textarea: { minHeight: 72, border: "1px solid #94a3b8", borderRadius: 7, padding: 10, resize: "vertical" }, divider: { height: 1, background: "#e2e8f0", margin: "24px 0" }, subtitleHeading: { margin: "24px 0 8px", fontSize: 19 }, smallBadge: { display: "inline-block", padding: "4px 7px", borderRadius: 999, fontSize: 11, fontWeight: 900 }, tableWrap: { overflowX: "auto", marginTop: 12 }, table: { width: "100%", borderCollapse: "collapse", minWidth: 760 }, th: { padding: 9, borderBottom: "2px solid #cbd5e1", textAlign: "left", color: "#475569", fontSize: 12 }, td: { padding: 9, borderBottom: "1px solid #e2e8f0", color: "#334155", fontSize: 13 }
};
