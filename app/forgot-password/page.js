"use client";

import { useState } from "react";
import styles from "../auth-recovery.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/password-recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const body = await response.json();
      if (!response.ok) setError(body.error || "Unable to request a recovery link.");
      else setMessage(body.message);
    } catch {
      setError("A connection error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page} id="main-content">
      <section className={styles.card} aria-labelledby="recovery-title">
        <a className={styles.brand} href="/">RUVANAS</a>
        <p className={styles.eyebrow}>ACCOUNT RECOVERY</p>
        <h1 className={styles.title} id="recovery-title">Reset your password</h1>
        <p className={styles.subtitle}>Enter your account email. If password recovery is available, we will send a private link that expires in 30 minutes.</p>
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.label}>
            Email address
            <input className={styles.input} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          {message ? <p className={styles.notice} role="status">{message}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <button className={styles.button} type="submit" disabled={loading}>{loading ? "Sending securely…" : "Send recovery link"}</button>
        </form>
        <p className={styles.footer}><a className={styles.link} href="/login">Return to sign in</a></p>
        <p className={styles.security}>For privacy, Ruvanas shows the same confirmation whether or not an eligible account exists. Company-managed accounts should continue with their organisation&apos;s sign-in method.</p>
      </section>
    </main>
  );
}
