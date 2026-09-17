"use client";

import { useState } from "react";
import styles from "../partner-demo.module.css";

export default function PartnerDemoAccess() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/partner-demo/redeem", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to open the demo.");
      window.location.assign(result.destination || "/partner-demo");
    } catch (caught) {
      setError(caught.message);
      setLoading(false);
    }
  }

  return <main className={styles.accessPage}>
    <section className={styles.accessCard}>
      <a className={styles.brand} href="/">RUVANAS</a>
      <p className={styles.eyebrow}>PRIVATE PARTNER TOUR</p>
      <h1>Explore how Ruvanas works</h1>
      <p>Use the one-use invitation code from Ruvanas. This tour contains sample information and cannot change a live service.</p>
      <form onSubmit={submit} className={styles.accessForm}>
        <label>Invited email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Invitation code<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" placeholder="RVDEMO-…" required /></label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button disabled={loading}>{loading ? "Opening demo…" : "Open read-only demo"}</button>
      </form>
      <p className={styles.small}>Invitations expire after 48 hours. Ask your Ruvanas contact for a new code if yours has expired.</p>
    </section>
  </main>;
}
