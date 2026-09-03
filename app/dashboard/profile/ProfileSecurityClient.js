"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./profile-security.module.css";

function formatDate(value) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function ProfileSecurityClient() {
  const [data, setData] = useState(null);
  const [name, setName] = useState("");
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmation: "" });
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const request = await fetch("/api/me/security", { cache: "no-store" });
      const payload = await request.json();
      if (!request.ok) throw new Error(payload.error || "Unable to load your profile.");
      setData(payload);
      setName(payload.profile.name);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function send(method, body, successMessage) {
    const action = body.action || "SESSION";
    setWorking(action === "SESSION" ? body.sessionId : action);
    setError("");
    setNotice("");
    try {
      const request = await fetch("/api/me/security", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await request.json();
      if (!request.ok) throw new Error(payload.error || "The security change could not be saved.");
      setNotice(successMessage);
      await load();
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setWorking("");
    }
  }

  async function updateProfile(event) {
    event.preventDefault();
    await send("PATCH", { action: "PROFILE", name }, "Your display name has been updated.");
  }

  async function updatePassword(event) {
    event.preventDefault();
    const changed = await send("PATCH", { action: "PASSWORD", ...passwords }, "Your password was changed and other sessions were signed out.");
    if (changed) setPasswords({ currentPassword: "", newPassword: "", confirmation: "" });
  }

  async function signOutSession(session) {
    if (!window.confirm(`Sign out the ${session.authentication.toLowerCase()} session last active ${formatDate(session.lastSeenAt)}?`)) return;
    await send("DELETE", { action: "SESSION", sessionId: session.id }, "The selected session has been signed out.");
  }

  async function signOutOthers() {
    if (!window.confirm("Sign out every other active Ruvanas session? This device will remain signed in.")) return;
    await send("DELETE", { action: "OTHERS" }, "All other active sessions have been signed out.");
  }

  if (!data) {
    return <main className={styles.page}><div className={styles.shell}><Link href="/dashboard" className={styles.back}>← Dashboard</Link><p className={styles.loading} role="status">{error || "Loading your secure profile…"}</p></div></main>;
  }

  const otherSessions = data.sessions.filter((session) => !session.current);

  return (
    <main className={styles.page} id="main-content">
      <div className={styles.shell}>
        <nav className={styles.topNav} aria-label="Profile navigation">
          <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
          <div><Link href="/dashboard">Dashboard</Link><Link href="/dashboard/account">Account</Link><Link href="/dashboard/team">Team</Link><Link href="/dashboard/help">Help</Link></div>
        </nav>

        <header className={styles.hero}>
          <div><p className={styles.eyebrow}>PERSONAL ACCOUNT</p><h1>Profile & security</h1><p>Keep your personal details current and control where your Ruvanas account is signed in.</p></div>
          <span className={styles.roleBadge}>{data.profile.role.replaceAll("_", " ").toLowerCase()}</span>
        </header>

        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <section className={styles.grid}>
          <article className={styles.card}>
            <p className={styles.eyebrow}>YOUR DETAILS</p>
            <h2>Personal profile</h2>
            <p>This name identifies you to colleagues inside your organisation. Your sign-in email cannot be changed here.</p>
            <form onSubmit={updateProfile} className={styles.form}>
              <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} minLength="2" maxLength="80" autoComplete="name" required /></label>
              <label>Email address<input value={data.profile.email} type="email" autoComplete="email" readOnly aria-describedby="email-help" /></label>
              <small id="email-help">Contact Ruvanas support if your sign-in identity needs to change.</small>
              <button disabled={Boolean(working) || name.trim() === data.profile.name}>{working === "PROFILE" ? "Saving…" : "Save profile"}</button>
            </form>
          </article>

          <article className={styles.card}>
            <p className={styles.eyebrow}>PASSWORD</p>
            <h2>Change your password</h2>
            {data.passwordChangeAllowed ? (
              <>
                <p>Use at least 12 characters with a letter and a number. Other signed-in devices will be disconnected.</p>
                <form onSubmit={updatePassword} className={styles.form}>
                  <label>Current password<input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" maxLength="128" required /></label>
                  <label>New password<input type="password" value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} autoComplete="new-password" minLength="12" maxLength="128" required /></label>
                  <label>Confirm new password<input type="password" value={passwords.confirmation} onChange={(event) => setPasswords((current) => ({ ...current, confirmation: event.target.value }))} autoComplete="new-password" minLength="12" maxLength="128" required /></label>
                  <button disabled={Boolean(working)}>{working === "PASSWORD" ? "Changing…" : "Change password"}</button>
                </form>
              </>
            ) : <div className={styles.policyNotice}><strong>Company sign-in is required.</strong><span>Your organisation manages passwords through its identity provider.</span></div>}
          </article>
        </section>

        <section className={styles.sessions} aria-labelledby="sessions-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>ACTIVE SIGN-INS</p><h2 id="sessions-title">Where you are signed in</h2><p>Only a safe session summary is shown. Ruvanas never displays session tokens or internal provider details.</p></div>
            <button className={styles.secondaryButton} onClick={signOutOthers} disabled={Boolean(working) || otherSessions.length === 0}>{working === "OTHERS" ? "Signing out…" : "Sign out other sessions"}</button>
          </div>
          <div className={styles.sessionList}>
            {data.sessions.map((session) => (
              <article key={session.id} className={styles.sessionCard} data-current={session.current}>
                <div className={styles.sessionIcon} aria-hidden="true">{session.current ? "✓" : "•"}</div>
                <div className={styles.sessionDetails}>
                  <div><strong>{session.current ? "This device" : "Active Ruvanas session"}</strong>{session.current ? <span>Current</span> : null}</div>
                  <p>{session.authentication} · {session.organisationName}</p>
                  <small>Last active {formatDate(session.lastSeenAt)} · Expires {formatDate(session.expiresAt)}</small>
                </div>
                {!session.current ? <button onClick={() => signOutSession(session)} disabled={Boolean(working)}>{working === session.id ? "Signing out…" : "Sign out"}</button> : null}
              </article>
            ))}
          </div>
        </section>

        <footer className={styles.footer}><strong>See something unexpected?</strong><span>Sign out other sessions, change your password, then <Link href="/dashboard/support">contact Ruvanas support</Link>.</span></footer>
      </div>
    </main>
  );
}
