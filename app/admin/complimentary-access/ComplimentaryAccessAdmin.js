"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function ComplimentaryAccessAdmin({ plans, organisations, accessCodes }) {
  const router = useRouter();
  const [form, setForm] = useState({ organisationId: organisations[0]?.id || "", planId: plans[0]?.id || "", note: "" });
  const [codeForm, setCodeForm] = useState({ recipientEmail: "", planId: plans[0]?.id || "", note: "" });
  const [issuedCode, setIssuedCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selectedPlan = plans.find((plan) => plan.id === form.planId) || null;

  async function grant(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/complimentary-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, mode: "DIRECT" })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to grant complimentary access.");
      setMessage(`${result.plan.name} complimentary access is now active for ${result.organisation.name}.`);
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function issueCode(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setIssuedCode(null);
    try {
      const response = await fetch("/api/admin/complimentary-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...codeForm, mode: "CODE" })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create a free-account code.");
      setIssuedCode({ code: result.code, email: result.recipientEmail, planName: result.plan.name });
      setCodeForm((current) => ({ ...current, recipientEmail: "", note: "" }));
      setMessage("Free-account code created. Copy it now; only its protected hash is stored.");
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyIssuedCode() {
    if (!issuedCode?.code) return;
    try {
      await navigator.clipboard.writeText(issuedCode.code);
      setMessage("Code copied. Send it only to the eligible recipient shown below.");
    } catch {
      setMessage("Select and copy the code manually.");
    }
  }

  async function revoke(id) {
    if (!window.confirm("Stop this complimentary access or cancel the unused code? The client will immediately return to their normal subscription state.")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/complimentary-access/${id}`, { method: "PATCH" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to stop access.");
      setMessage("Complimentary access stopped. The client now follows their normal subscription state.");
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={s.page}>
      <p style={s.eyebrow}>CUSTOMERS & BUSINESS</p>
      <h1 style={s.title}>Complimentary access</h1>
      <p style={s.intro}>Grant an active service tier directly to a client organisation. This is not a timed trial and no charge is created. Only a Super Admin can start or stop this access.</p>

      <section style={s.section} aria-labelledby="code-heading">
        <div style={s.headingRow}>
          <div><p style={s.eyebrow}>NEW FREE ACCOUNT</p><h2 id="code-heading" style={s.h2}>Create a one-use registration code</h2></div>
          <span style={s.permanentBadge}>No automatic expiry</span>
        </div>
        <p style={s.sectionIntro}>Issue a code for one eligible email address. The recipient creates a new account from the login page, and the selected service remains free until a Super Admin stops it.</p>
        <form onSubmit={issueCode} style={s.form}>
          <label style={s.label}>Eligible recipient email<input required type="email" value={codeForm.recipientEmail} onChange={(event) => setCodeForm({ ...codeForm, recipientEmail: event.target.value })} placeholder="person@example.com" style={s.input} /></label>
          <label style={s.label}>Free service tier<select required value={codeForm.planId} onChange={(event) => setCodeForm({ ...codeForm, planId: event.target.value })} style={s.input}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} ({plan.code})</option>)}</select></label>
          <label style={s.label}>Internal note (optional)<input value={codeForm.note} maxLength={160} onChange={(event) => setCodeForm({ ...codeForm, note: event.target.value })} placeholder="Eligibility reason" style={s.input} /></label>
          <button disabled={busy || !codeForm.recipientEmail || !codeForm.planId} style={s.primary}>Create free-account code</button>
        </form>
        {issuedCode ? <div style={s.codeReveal} role="status">
          <div><strong>{issuedCode.planName} for {issuedCode.email}</strong><span>This code is shown once. It is bound to this email and can be used only once.</span></div>
          <code style={s.codeValue}>{issuedCode.code}</code>
          <button type="button" onClick={copyIssuedCode} style={s.secondary}>Copy code</button>
        </div> : null}
      </section>

      <section style={s.section} aria-labelledby="tier-heading">
        <div style={s.headingRow}>
          <div><p style={s.eyebrow}>TIER CATALOGUE</p><h2 id="tier-heading" style={s.h2}>{plans.length} active tier{plans.length === 1 ? "" : "s"}</h2></div>
          <span style={s.permanentBadge}>No automatic expiry</span>
        </div>
        <div style={s.tierGrid}>
          {plans.map((plan) => <article key={plan.id} style={s.tierCard}>
            <h3 style={s.h3}>{plan.name}</h3><p style={s.code}>{plan.code}</p>
            <div style={s.productTags}>{plan.products.map((product) => <span key={product} style={s.productTag}>{product}</span>)}</div>
            <ul style={s.list}>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          </article>)}
        </div>
      </section>

      <section style={s.section} aria-labelledby="issue-heading">
        <p style={s.eyebrow}>GRANT ACCESS</p><h2 id="issue-heading" style={s.h2}>Activate complimentary access</h2>
        <form onSubmit={grant} style={s.form}>
          <label style={s.label}>Client organisation<select required value={form.organisationId} onChange={(event) => setForm({ ...form, organisationId: event.target.value })} style={s.input}>{organisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label style={s.label}>Complimentary tier<select required value={form.planId} onChange={(event) => setForm({ ...form, planId: event.target.value })} style={s.input}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} ({plan.code})</option>)}</select></label>
          <label style={s.label}>Internal note (optional)<input value={form.note} maxLength={160} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Reason or agreement reference" style={s.input} /></label>
          <button disabled={busy || !form.organisationId || !form.planId} style={s.primary}>Grant free access</button>
        </form>
        {selectedPlan ? <div style={s.validityNotice}><strong>Access rule:</strong> {selectedPlan.name} becomes active immediately and remains free until a Ruvanas Super Admin stops it.</div> : null}
        {message ? <p role="status" style={s.message}>{message}</p> : null}
      </section>

      <section style={s.section} aria-labelledby="history-heading">
        <p style={s.eyebrow}>CONTROL & HISTORY</p><h2 id="history-heading" style={s.h2}>Access history</h2>
        <div style={s.tableWrap}><table style={s.table}><thead><tr>{["Client", "Tier", "Status", "Validity", "Granted", "Activated", "Note", "Control"].map((label) => <th key={label} style={s.th}>{label}</th>)}</tr></thead>
          <tbody>{accessCodes.map((item) => <tr key={item.id}><td style={s.tdStrong}>{item.organisationName || item.recipientEmail || "Awaiting registration"}</td><td style={s.td}>{item.planName}</td><td style={s.td}><span style={item.status === "ACTIVE" ? s.active : item.status === "ISSUED" ? s.issued : s.revoked}>{item.status}</span></td><td style={s.td}>{item.status === "REVOKED" ? "Stopped" : item.status === "ISSUED" ? "One use · no expiry" : "Until Super Admin disables"}</td><td style={s.td}>{formatDate(item.createdAt)}</td><td style={s.td}>{formatDate(item.redeemedAt)}</td><td style={s.td}>{item.note || "—"}</td><td style={s.td}>{item.status !== "REVOKED" ? <button disabled={busy} onClick={() => revoke(item.id)} style={s.danger}>{item.status === "ACTIVE" ? "Stop free access" : "Cancel code"}</button> : "Stopped"}</td></tr>)}</tbody>
        </table>{accessCodes.length === 0 ? <p style={s.empty}>No complimentary access has been granted.</p> : null}</div>
      </section>
    </main>
  );
}

const s = {
  page: { maxWidth: 1220, margin: "0 auto", padding: "40px 16px 72px", color: "#172033" }, eyebrow: { margin: "0 0 7px", color: "#9a6400", fontSize: 12, fontWeight: 900, letterSpacing: 1.1 }, title: { margin: 0, fontSize: 34, fontWeight: 950 }, intro: { maxWidth: 820, margin: "10px 0 28px", color: "#475569", lineHeight: 1.6 }, section: { marginTop: 22, padding: 22, border: "1px solid #cbd5e1", borderRadius: 14, background: "#f8fafc" }, sectionIntro: { maxWidth: 850, color: "#475569", lineHeight: 1.55 }, headingRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }, h2: { margin: 0, fontSize: 23 }, h3: { margin: 0, fontSize: 19 }, code: { margin: "5px 0 12px", color: "#7c5200", fontWeight: 900 }, tierGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14, marginTop: 16 }, tierCard: { padding: 18, border: "1px solid #94a3b8", borderRadius: 10, background: "#fff" }, list: { margin: 0, paddingLeft: 20, color: "#334155", lineHeight: 1.75 }, form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "end", marginTop: 16 }, label: { display: "grid", gap: 6, fontSize: 13, fontWeight: 850 }, input: { minHeight: 42, padding: "9px 10px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#172033" }, primary: { minHeight: 42, border: 0, borderRadius: 7, padding: "10px 15px", background: "#f4b942", color: "#172033", fontWeight: 900, cursor: "pointer" }, secondary: { minHeight: 40, border: "1px solid #64748b", borderRadius: 7, padding: "9px 13px", background: "#fff", color: "#172033", fontWeight: 850, cursor: "pointer" }, codeReveal: { display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto auto", gap: 14, alignItems: "center", marginTop: 18, padding: 16, border: "1px solid #3b8060", borderRadius: 9, background: "#effbf3" }, codeValue: { padding: "10px 12px", border: "1px solid #86b99a", borderRadius: 7, background: "#fff", color: "#172033", fontSize: 14, fontWeight: 900, letterSpacing: 1 }, message: { color: "#334155", fontWeight: 750 }, tableWrap: { overflowX: "auto", marginTop: 16, border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" }, table: { width: "100%", minWidth: 1040, borderCollapse: "collapse" }, th: { padding: 12, borderBottom: "2px solid #94a3b8", background: "#e2e8f0", textAlign: "left", fontSize: 12, fontWeight: 900 }, td: { padding: 12, borderBottom: "1px solid #e2e8f0", fontSize: 13, verticalAlign: "top" }, tdStrong: { padding: 12, borderBottom: "1px solid #e2e8f0", fontSize: 13, fontWeight: 900 }, active: { color: "#067647", fontWeight: 900 }, issued: { color: "#8a5a00", fontWeight: 900 }, revoked: { color: "#64748b", fontWeight: 900 }, danger: { border: "1px solid #b42318", borderRadius: 6, padding: "7px 9px", background: "#fff", color: "#b42318", fontWeight: 850, cursor: "pointer" }, empty: { padding: 18, color: "#64748b" }, permanentBadge: { borderRadius: 999, background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 900, padding: "7px 10px" }, productTags: { display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }, productTag: { borderRadius: 999, background: "#e8eef7", color: "#334155", fontSize: 10, fontWeight: 850, padding: "5px 8px" }, validityNotice: { marginTop: 15, padding: 13, border: "1px solid #86b99a", borderRadius: 8, background: "#effbf3", color: "#23543a", fontSize: 13, lineHeight: 1.5 }
};
