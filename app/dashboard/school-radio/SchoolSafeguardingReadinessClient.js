"use client";

import { useCallback, useEffect, useState } from "react";

const emptyForm = {
  targetCountries: "",
  minimumStudentAge: "",
  maximumStudentAge: "",
  consentModel: "",
  studentIdentityMode: "DISABLED",
  privacyContactEmail: "",
  rawRecordingRetentionDays: "",
  consentEvidenceRetentionDays: "",
  localPolicyReference: "",
  notes: "",
  staffModerationConfirmed: false,
  noDirectMessagingConfirmed: false,
  privateByDefaultConfirmed: false
};

function formFromReadiness(value) {
  return {
    ...emptyForm,
    ...value,
    targetCountries: Array.isArray(value?.targetCountries) ? value.targetCountries.join(", ") : "",
    minimumStudentAge: value?.minimumStudentAge ?? "",
    maximumStudentAge: value?.maximumStudentAge ?? "",
    consentModel: value?.consentModel || "",
    privacyContactEmail: value?.privacyContactEmail || "",
    rawRecordingRetentionDays: value?.rawRecordingRetentionDays ?? "",
    consentEvidenceRetentionDays: value?.consentEvidenceRetentionDays ?? "",
    localPolicyReference: value?.localPolicyReference || "",
    notes: value?.notes || ""
  };
}

function Badge({ value }) {
  const labels = { DRAFT: "DRAFT", READY_FOR_REVIEW: "UNDER REVIEW", CHANGES_REQUESTED: "CHANGES REQUESTED", APPROVED: "APPROVED" };
  const palette = value === "APPROVED" ? ["#dcfce7", "#166534"] : value === "CHANGES_REQUESTED" ? ["#ffedd5", "#9a3412"] : value === "READY_FOR_REVIEW" ? ["#dbeafe", "#1d4ed8"] : ["#fef3c7", "#92400e"];
  return <span style={{ ...styles.badge, background: palette[0], color: palette[1] }}>{labels[value] || value}</span>;
}

export default function SchoolSafeguardingReadinessClient() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/safeguarding-readiness", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The safeguarding readiness pack could not be loaded.");
    setData(payload);
    setForm(formFromReadiness(payload.readiness));
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(action) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/safeguarding-readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          action,
          targetCountries: form.targetCountries.split(",").map((value) => value.trim()).filter(Boolean),
          consentModel: form.consentModel || null
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The readiness pack could not be saved.");
      setNotice(action === "SUBMIT_FOR_REVIEW" ? "Safeguarding readiness pack submitted for Ruvanas review." : "Safeguarding readiness draft saved.");
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  if (!data) return <section style={styles.section}><p style={styles.muted}>{error || "Loading safeguarding readiness…"}</p></section>;
  const canManage = data.permissions.canManage;
  const disabled = !canManage || working;

  return <section style={styles.section}>
    <div style={styles.heading}>
      <div><p style={styles.eyebrow}>STAGE 9A · SAFEGUARDING READINESS</p><h2 style={styles.title}>Prepare the school policy pack before student access</h2><p style={styles.muted}>Record the local rules that a later guarded student workspace must obey. Saving or submitting this pack does not enable student login, messaging, or public publishing.</p></div>
      <Badge value={data.readiness.status} />
    </div>
    {error ? <div style={styles.error}>{error}</div> : null}
    {notice ? <div style={styles.notice}>{notice}</div> : null}
    {data.permissions.lockedReason ? <div style={styles.reviewNotice}>{data.permissions.lockedReason}</div> : null}
    {data.readiness.reviews?.[0] ? <div style={styles.reviewDecision}><strong>Latest Ruvanas decision: {data.readiness.reviews[0].decision.replaceAll("_", " ")}</strong><span>{data.readiness.reviews[0].notes || "No additional notes."}</span><small>{new Date(data.readiness.reviews[0].createdAt).toLocaleString()} · {data.readiness.reviews[0].reviewer?.name || "Ruvanas reviewer"}</small></div> : null}

    <div style={styles.lockGrid}>
      <div style={styles.lock}><strong>Student login</strong><span>Locked</span></div>
      <div style={styles.lock}><strong>Direct messaging</strong><span>Disabled</span></div>
      <div style={styles.lock}><strong>Public publishing</strong><span>Disabled</span></div>
      <div style={styles.lock}><strong>Current operation</strong><span>Staff managed</span></div>
    </div>

    <div style={styles.columns}>
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Territory, age, and consent</h3>
        <label style={styles.label}>Target countries — two-letter codes<input style={styles.input} value={form.targetCountries} onChange={(event) => setField("targetCountries", event.target.value)} placeholder="MT, GB" disabled={disabled} /></label>
        <div style={styles.twoColumns}><label style={styles.label}>Minimum age<input style={styles.input} type="number" min="3" max="24" value={form.minimumStudentAge} onChange={(event) => setField("minimumStudentAge", event.target.value)} disabled={disabled} /></label><label style={styles.label}>Maximum age<input style={styles.input} type="number" min="3" max="24" value={form.maximumStudentAge} onChange={(event) => setField("maximumStudentAge", event.target.value)} disabled={disabled} /></label></div>
        <label style={styles.label}>Consent model<select style={styles.input} value={form.consentModel} onChange={(event) => setField("consentModel", event.target.value)} disabled={disabled}><option value="">Choose…</option><option value="SCHOOL_POLICY">School policy</option><option value="PARENT_OR_GUARDIAN">Parent or guardian</option><option value="BOTH">School and parent/guardian</option></select></label>
        <label style={styles.label}>Intended identity method<select style={styles.input} value={form.studentIdentityMode} onChange={(event) => setField("studentIdentityMode", event.target.value)} disabled={disabled}><option value="DISABLED">No student access planned</option><option value="INVITATION_ONLY">School-managed invitations</option><option value="IDENTITY_FEDERATION">School identity federation</option></select></label>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Privacy and retention</h3>
        <label style={styles.label}>School privacy contact<input style={styles.input} type="email" value={form.privacyContactEmail} onChange={(event) => setField("privacyContactEmail", event.target.value)} placeholder="privacy@school.example" disabled={disabled} /></label>
        <div style={styles.twoColumns}><label style={styles.label}>Raw recordings — days<input style={styles.input} type="number" min="1" max="3650" value={form.rawRecordingRetentionDays} onChange={(event) => setField("rawRecordingRetentionDays", event.target.value)} disabled={disabled} /></label><label style={styles.label}>Consent evidence — days<input style={styles.input} type="number" min="30" max="3650" value={form.consentEvidenceRetentionDays} onChange={(event) => setField("consentEvidenceRetentionDays", event.target.value)} disabled={disabled} /></label></div>
        <label style={styles.label}>Local policy reference<input style={styles.input} value={form.localPolicyReference} onChange={(event) => setField("localPolicyReference", event.target.value)} placeholder="Policy title, version, approval date or controlled link" disabled={disabled} /></label>
        <label style={styles.label}>Review notes<textarea style={styles.textarea} value={form.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Local requirements or questions for the Ruvanas review" disabled={disabled} /></label>
      </div>
    </div>

    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Mandatory safety declarations</h3>
      <label style={styles.check}><input type="checkbox" checked={form.staffModerationConfirmed} onChange={(event) => setField("staffModerationConfirmed", event.target.checked)} disabled={disabled} /><span>School staff will review content before any publishing or cross-school sharing.</span></label>
      <label style={styles.check}><input type="checkbox" checked={form.noDirectMessagingConfirmed} onChange={(event) => setField("noDirectMessagingConfirmed", event.target.checked)} disabled={disabled} /><span>Direct messaging between students or between students and external users remains disabled.</span></label>
      <label style={styles.check}><input type="checkbox" checked={form.privateByDefaultConfirmed} onChange={(event) => setField("privateByDefaultConfirmed", event.target.checked)} disabled={disabled} /><span>Student work and portfolios remain private by default.</span></label>
      {data.gaps.length ? <div style={styles.gaps}><strong>Still needed before review</strong><ul>{data.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div> : <p style={styles.ready}>All required policy details are present. An owner or manager can submit the pack for review.</p>}
      {canManage ? <div style={styles.actions}><button type="button" style={styles.secondary} disabled={working} onClick={() => save("SAVE_DRAFT")}>Save draft</button><button type="button" style={styles.primary} disabled={working} onClick={() => save("SUBMIT_FOR_REVIEW")}>Submit for review</button></div> : <p style={styles.muted}>{data.permissions.locked ? "This policy pack is read-only while its reviewed state is preserved." : "An organisation owner or manager maintains this policy pack."}</p>}
    </div>
    <p style={styles.privacy}>Safety boundary: safeguarding approval unlocks only the separate Stage 9B2 invitation workflow. Staff permissions, direct messaging, public publishing, and cross-school authority remain disabled for students.</p>
  </section>;
}

const styles = {
  section: { border: "1px solid #2b3a54", borderRadius: 16, background: "#111c2f", padding: 22, marginBottom: 24 },
  heading: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 18 },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.2, margin: "0 0 8px" },
  title: { margin: "0 0 8px", fontSize: 26 }, muted: { color: "#aebbd0", lineHeight: 1.55, margin: 0 },
  badge: { display: "inline-block", borderRadius: 5, padding: "5px 9px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" },
  lockGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 16 },
  lock: { border: "1px solid #34445f", borderRadius: 10, background: "#18243a", padding: 12, display: "grid", gap: 5, color: "#dce5f3", fontSize: 13 },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 14, marginBottom: 14 },
  twoColumns: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 },
  card: { border: "1px solid #34445f", borderRadius: 12, background: "#18243a", padding: 17, marginBottom: 14 }, cardTitle: { margin: "0 0 15px" },
  label: { display: "grid", gap: 7, marginBottom: 12, color: "#dce5f3", fontWeight: 800, fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" },
  textarea: { width: "100%", minHeight: 82, boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" },
  check: { display: "flex", gap: 10, alignItems: "flex-start", color: "#dce5f3", lineHeight: 1.45, marginBottom: 10 },
  gaps: { color: "#fed7aa", borderLeft: "3px solid #fb923c", paddingLeft: 12, marginTop: 15, lineHeight: 1.5 }, ready: { color: "#bbf7d0", marginTop: 15 },
  actions: { display: "flex", flexWrap: "wrap", gap: 9, marginTop: 16 },
  primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "11px 15px", fontWeight: 900, cursor: "pointer" },
  secondary: { border: "1px solid #94a3b8", borderRadius: 8, background: "transparent", color: "#e2e8f0", padding: "10px 14px", fontWeight: 800, cursor: "pointer" },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 11, marginBottom: 14 },
  notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 11, marginBottom: 14 },
  reviewNotice: { border: "1px solid #60a5fa", background: "#172554", color: "#bfdbfe", borderRadius: 8, padding: 11, marginBottom: 14 },
  reviewDecision: { display: "grid", gap: 5, border: "1px solid #475569", background: "#18243a", color: "#dce5f3", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 },
  privacy: { color: "#8ea0b8", fontSize: 12, margin: "6px 0 0" }
};
