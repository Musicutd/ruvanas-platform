"use client";

import { useCallback, useEffect, useState } from "react";

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function SchoolStudentAccessClient() {
  const [data, setData] = useState(null);
  const [emails, setEmails] = useState({});
  const [invitationUrl, setInvitationUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/student-access", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Student access could not be loaded.");
    setData(payload);
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  async function invite(contributor) {
    setWorking(true); setError(""); setNotice(""); setInvitationUrl("");
    try {
      const response = await fetch("/api/school-radio/student-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "INVITE", contributorId: contributor.id, email: emails[contributor.id] || "" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The invitation could not be created.");
      const url = `${window.location.origin}${payload.invitationPath}`;
      setInvitationUrl(url);
      setNotice("Private invitation created. Copy it now; Ruvanas will not show this link again after you leave this page.");
      await load();
    } catch (inviteError) { setError(inviteError.message); } finally { setWorking(false); }
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setNotice("Invitation link copied. Share it only through the school's approved private channel.");
    } catch {
      setNotice("Select and copy the invitation link manually.");
    }
  }

  async function revoke(item) {
    const reason = window.prompt("Why is this student access being revoked?", "Student access withdrawn by the school.");
    if (!reason?.trim()) return;
    setWorking(true); setError(""); setNotice(""); setInvitationUrl("");
    try {
      const response = await fetch("/api/school-radio/student-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVOKE", accessId: item.studentAccess.id, reason })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Student access could not be revoked.");
      setNotice("Student access revoked and active sessions closed.");
      await load();
    } catch (revokeError) { setError(revokeError.message); } finally { setWorking(false); }
  }

  if (!data) return <section style={styles.card}><p style={styles.eyebrow}>GUARDED STUDENT ACCESS</p><p style={styles.hint}>{error || "Loading invitation controls…"}</p></section>;

  return <section style={styles.card}>
    <p style={styles.eyebrow}>STAGE 9B2 · GUARDED STUDENT ACCESS</p>
    <h2 style={styles.title}>School-managed invitations</h2>
    <p style={styles.body}>Invite an existing student contributor only after safeguarding approval and current school-level consent. Student access remains separate from every staff and administration workspace.</p>
    <div style={data.canInvite ? styles.ready : styles.blocked}>{data.canInvite ? "Invitation access approved for this school." : `Invitations locked · safeguarding ${String(data.readiness?.status || "NOT SUBMITTED").replaceAll("_", " ")} · identity ${String(data.readiness?.studentIdentityMode || "DISABLED").replaceAll("_", " ")}`}</div>
    {error ? <div style={styles.error}>{error}</div> : null}
    {notice ? <div style={styles.notice}>{notice}</div> : null}
    {invitationUrl ? <div style={styles.linkBox}><label style={styles.label}>One-time private invitation link<input style={styles.input} readOnly value={invitationUrl} onFocus={(event) => event.target.select()} /></label><button style={styles.secondary} onClick={copyInvitation}>Copy link</button></div> : null}
    {!data.contributors.length ? <p style={styles.hint}>Create student contributor profiles in the editorial workspace before issuing access.</p> : <div style={styles.list}>{data.contributors.map((item) => {
      const canIssue = data.canInvite && item.status === "ACTIVE" && item.hasCurrentConsent && (!item.studentAccess || item.studentAccess.status === "INVITED");
      return <article key={item.id} style={styles.item}>
        <div style={styles.row}><div><strong>{item.displayName}</strong><p style={styles.hint}>{item.studentGroup.name}{item.studentGroup.academicYear ? ` · ${item.studentGroup.academicYear}` : ""} · consent {item.hasCurrentConsent ? "current" : "required"}</p></div><span style={styles.badge}>{item.studentAccess?.status || "NOT INVITED"}</span></div>
        {item.studentAccess ? <p style={styles.hint}>{item.studentAccess.email}{item.studentAccess.invitationExpiresAt ? ` · expires ${formatDate(item.studentAccess.invitationExpiresAt)}` : ""}{item.studentAccess.acceptedAt ? ` · accepted ${formatDate(item.studentAccess.acceptedAt)}` : ""}</p> : null}
        {canIssue ? <div style={styles.actions}><input style={styles.input} type="email" value={emails[item.id] ?? item.studentAccess?.email ?? ""} onChange={(event) => setEmails((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="student@school.example" aria-label={`Email for ${item.displayName}`} /><button style={styles.primary} disabled={working} onClick={() => invite(item)}>{item.studentAccess ? "Reissue private link" : "Create invitation"}</button></div> : null}
        {item.studentAccess && item.studentAccess.status !== "REVOKED" ? <button style={styles.danger} disabled={working} onClick={() => revoke(item)}>Revoke access</button> : null}
      </article>;
    })}</div>}
    <p style={styles.safety}>Hard boundary: read-only private workspace · no staff dashboard · no direct messaging · no public publishing · no cross-school authority.</p>
  </section>;
}

const styles = {
  card: { border: "1px solid #2b3a54", borderRadius: 14, background: "#182235", padding: 22, marginBottom: 20, color: "#fff" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.2, margin: "0 0 8px" },
  title: { margin: "0 0 10px" },
  body: { color: "#cbd5e1", lineHeight: 1.55, maxWidth: 850 },
  ready: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 11, margin: "14px 0" },
  blocked: { border: "1px solid #f59e0b", background: "#3b2506", color: "#fde68a", borderRadius: 8, padding: 11, margin: "14px 0" },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 11, margin: "12px 0" },
  notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 11, margin: "12px 0" },
  linkBox: { border: "1px solid #f4b942", borderRadius: 10, padding: 14, margin: "14px 0", display: "grid", gap: 10 },
  list: { display: "grid", gap: 12, marginTop: 16 },
  item: { border: "1px solid #34445f", borderRadius: 10, padding: 15, background: "#131e30" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  hint: { color: "#9facbf", fontSize: 13, lineHeight: 1.45, margin: "6px 0" },
  badge: { borderRadius: 5, background: "#dbeafe", color: "#1e40af", padding: "4px 7px", fontSize: 10, fontWeight: 900, whiteSpace: "nowrap" },
  actions: { display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto", gap: 10, marginTop: 10 },
  label: { display: "grid", gap: 7, color: "#dce5f3", fontWeight: 800, fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" },
  primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" },
  secondary: { border: "1px solid #94a3b8", borderRadius: 8, background: "transparent", color: "#e2e8f0", padding: "9px 12px", fontWeight: 800, cursor: "pointer", justifySelf: "start" },
  danger: { border: 0, background: "transparent", color: "#fca5a5", padding: "9px 0 0", fontWeight: 800, cursor: "pointer" },
  safety: { color: "#8ea0b8", fontSize: 12, lineHeight: 1.5, margin: "18px 0 0" }
};
