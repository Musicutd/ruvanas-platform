"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./free-access.module.css";

export default function FreeAccessRegistration() {
  const router = useRouter();
  const [form, setForm] = useState({ code: "", name: "", organisationName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (form.password.length < 8) return setError("Your password must contain at least 8 characters.");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/complimentary-access/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const result = await response.json();
      if (!response.ok) return setError(result.error || "Unable to create the free account.");
      router.push(result.recommendedDashboardRoute || "/dashboard");
      router.refresh();
    } catch {
      setError("A connection error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="free-account-title">
        <a href="/" className={styles.brand}>RUVANAS</a>
        <p className={styles.eyebrow}>ELIGIBLE FREE ACCESS</p>
        <h1 id="free-account-title">Create your free account</h1>
        <p className={styles.intro}>Use the one-use code sent by a Ruvanas Super Admin. Your email must match the eligible recipient attached to the code.</p>

        <div className={styles.promise}>
          <span><strong>No payment details</strong>No billing event is created.</span>
          <span><strong>No automatic expiry</strong>Access remains active until a Super Admin stops it.</span>
        </div>

        <form onSubmit={submit} className={styles.form}>
          <label className={styles.full}>Free-access code<input name="code" value={form.code} onChange={update} autoComplete="off" placeholder="RUV-XXXXXXXX-XXXXXXXX-XXXXXXXX" required /></label>
          <label>Your name<input name="name" value={form.name} onChange={update} autoComplete="name" maxLength="120" required /></label>
          <label>Organisation name<input name="organisationName" value={form.organisationName} onChange={update} autoComplete="organization" maxLength="160" required /></label>
          <label>Email address<input type="email" name="email" value={form.email} onChange={update} autoComplete="email" maxLength="320" required /></label>
          <label>Password<input type="password" name="password" value={form.password} onChange={update} autoComplete="new-password" minLength="8" maxLength="200" required /><small>Use at least 8 characters.</small></label>
          {error ? <p className={`${styles.error} ${styles.full}`} role="alert">{error}</p> : null}
          <button className={styles.submit} disabled={loading}>{loading ? "Creating free account…" : "Create free account"}</button>
        </form>

        <p className={styles.footer}>Already registered? <a href="/login">Return to log in</a></p>
      </section>
    </main>
  );
}
