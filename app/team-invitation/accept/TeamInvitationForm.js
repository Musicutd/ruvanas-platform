"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./team-invitation.module.css";

export default function TeamInvitationForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    if (!/^[a-f0-9]{64}$/i.test(value)) {
      setError("This invitation link is incomplete. Ask your organisation owner for a new link.");
      setLoading(false);
      return;
    }
    setToken(value);
    fetch("/api/organisation/team/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "INSPECT", token: value })
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "This invitation cannot be opened.");
      setInvitation(payload.invitation);
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, []);

  async function acceptInvitation(event) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/organisation/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ACCEPT", token, name, password })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The invitation could not be accepted.");
      router.push(payload.destination || "/dashboard/team");
      router.refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <a href="/" className={styles.brand}>RUVANAS</a>
        <p className={styles.eyebrow}>PRIVATE TEAM INVITATION</p>
        <h1>Join your organisation</h1>
        {loading ? <p className={styles.subtitle}>Checking your secure invitation…</p> : null}
        {invitation ? <>
          <p className={styles.subtitle}>You have been invited to join <strong>{invitation.organisationName}</strong>.</p>
          <dl className={styles.summary}>
            <div><dt>Email</dt><dd>{invitation.email}</dd></div>
            <div><dt>Access</dt><dd>{invitation.roleLabel}</dd></div>
            <div><dt>Expires</dt><dd>{new Date(invitation.expiresAt).toLocaleDateString()}</dd></div>
          </dl>
          <form onSubmit={acceptInvitation} className={styles.form}>
            {!invitation.existingAccount ? <label>Your full name<input value={name} onChange={(event) => setName(event.target.value)} minLength="2" maxLength="100" autoComplete="name" required /></label> : null}
            <label>{invitation.existingAccount ? "Your existing Ruvanas password" : "Create a password"}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="8" autoComplete={invitation.existingAccount ? "current-password" : "new-password"} required /></label>
            <p className={styles.security}>{invitation.existingAccount ? "Your password confirms that this invitation belongs to you." : "Use at least 8 characters. Your new account will open directly in this organisation."}</p>
            {error ? <p className={styles.error}>{error}</p> : null}
            <button disabled={working}>{working ? "Joining organisation…" : "Accept and open portal"}</button>
          </form>
        </> : null}
        {!loading && !invitation && error ? <div className={styles.error}>{error}</div> : null}
        <p className={styles.footer}>Invitations are one-time, expire automatically and can be revoked by your organisation.</p>
      </section>
    </main>
  );
}
