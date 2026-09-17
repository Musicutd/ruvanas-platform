"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./partner-demos.module.css";

function formatExpiry(value) {
  return `${new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Malta" })} Malta time`;
}

export default function PartnerDemoAdmin({ invitations }) {
  const router = useRouter();
  const [partnerName, setPartnerName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function create(event) {
    event.preventDefault();
    setError("");
    setIssued(null);
    setWorking(true);
    try {
      const response = await fetch("/api/admin/partner-demos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerName, recipientEmail })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create invitation.");
      setIssued({ code: result.code, email: recipientEmail.trim().toLowerCase(), expiresAt: result.expiresAt });
      setPartnerName("");
      setRecipientEmail("");
      router.refresh();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setWorking(false);
    }
  }

  async function revoke(id) {
    if (!window.confirm("Revoke this invitation and end any active demo session?")) return;
    setError("");
    setWorking(true);
    try {
      const response = await fetch(`/api/admin/partner-demos/${id}`, { method: "PATCH" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to revoke invitation.");
      router.refresh();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setWorking(false);
    }
  }

  return <div className={styles.page}>
    <header><p className={styles.eyebrow}>PARTNER PRESENTATIONS</p><h1>Read-only partner demos</h1>
      <p>Show potential partners how Ruvanas works without sharing Super Admin access or real subscriber records. The demo contains sample data only.</p>
      <Link href="/partner-demo">Preview the demo →</Link>
    </header>

    <section className={styles.card} aria-labelledby="invite-title">
      <h2 id="invite-title">Invite a partner</h2>
      <p>The one-use code expires after 48 hours. After redemption, demo access lasts seven days or until you revoke it. Send the code privately to the named recipient; this sample-only tour does not verify ownership of the email address.</p>
      <form onSubmit={create} className={styles.form}>
        <label>Partner or company name<input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} minLength={2} maxLength={120} required /></label>
        <label>Recipient email<input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} maxLength={320} required /></label>
        <button disabled={working}>{working ? "Creating…" : "Create demo invitation"}</button>
      </form>
      {issued ? <div className={styles.issued} role="status"><strong>Copy this code now—it will not be shown again.</strong><code>{issued.code}</code><span>For {issued.email} · expires {formatExpiry(issued.expiresAt)}</span><span>Partner opens <Link href="/partner-demo/access">/partner-demo/access</Link> and enters the code and matching email.</span><button type="button" onClick={() => navigator.clipboard?.writeText(issued.code)}>Copy code</button></div> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>

    <section className={styles.card} aria-labelledby="history-title"><h2 id="history-title">Invitation history</h2>
      {!invitations.length ? <p>No partner demos have been invited yet.</p> : <div className={styles.tableScroll}><table><thead><tr><th>Partner</th><th>Recipient</th><th>Status</th><th>Code ending</th><th>Valid until</th><th>Control</th></tr></thead><tbody>{invitations.map((item) => <tr key={item.id}>
        <td>{item.partnerName}</td><td>{item.recipientEmail}</td><td>{item.status}</td><td>…{item.codeSuffix}</td>
        <td>{formatExpiry(item.sessionExpiresAt || item.codeExpiresAt)}</td>
        <td>{item.status === "REVOKED" ? "Revoked" : <button type="button" className={styles.revoke} disabled={working} onClick={() => revoke(item.id)}>Revoke</button>}</td>
      </tr>)}</tbody></table></div>}
    </section>
  </div>;
}
