"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../auth-recovery.module.css";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(raw);
    setReady(true);
    if (raw) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/password-recovery/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmation })
      });
      const body = await response.json();
      if (!response.ok) setError(body.error || "Unable to reset your password.");
      else router.replace(body.destination || "/login?password-reset=1");
    } catch {
      setError("A connection error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const missingToken = ready && !token;
  return (
    <main className={styles.page} id="main-content">
      <section className={styles.card} aria-labelledby="reset-title">
        <a className={styles.brand} href="/">RUVANAS</a>
        <p className={styles.eyebrow}>SECURE PASSWORD RESET</p>
        <h1 className={styles.title} id="reset-title">Choose a new password</h1>
        <p className={styles.subtitle}>Use at least 12 characters with a letter and a number. Completing this step signs the account out on every device.</p>
        {missingToken ? (
          <>
            <p className={styles.error} role="alert">This recovery link is incomplete. Request a new private link.</p>
            <p className={styles.footer}><a className={styles.link} href="/forgot-password">Request another link</a></p>
          </>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <label className={styles.label}>
              New password
              <input className={styles.input} type="password" autoComplete="new-password" minLength="12" maxLength="128" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <label className={styles.label}>
              Confirm new password
              <input className={styles.input} type="password" autoComplete="new-password" minLength="12" maxLength="128" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
            </label>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <button className={styles.button} type="submit" disabled={!ready || loading}>{loading ? "Resetting securely…" : "Reset password"}</button>
          </form>
        )}
        <p className={styles.security}>The private token is removed from the address bar immediately and cannot be reused after a successful reset.</p>
      </section>
    </main>
  );
}
