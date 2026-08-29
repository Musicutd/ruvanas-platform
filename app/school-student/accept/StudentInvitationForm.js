"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function StudentInvitationForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(String(fragment.get("token") || ""));
    window.history.replaceState(null, "", window.location.pathname);
    setTokenReady(true);
  }, []);

  async function accept(event) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setWorking(true);
    try {
      const response = await fetch("/api/school-student/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The invitation could not be accepted.");
      router.replace(payload.destination || "/school-student");
      router.refresh();
    } catch (acceptError) {
      setError(acceptError.message);
    } finally {
      setWorking(false);
    }
  }

  const tokenLooksValid = /^[a-f0-9]{64}$/.test(token);
  return <main style={styles.page}>
    <section style={styles.card}>
      <a href="/" style={styles.brand}>RUVANAS</a>
      <p style={styles.eyebrow}>PRIVATE SCHOOL RADIO</p>
      <h1 style={styles.title}>Accept your school invitation</h1>
      <p style={styles.body}>Create a password for your private student workspace. Your school controls this invitation and can revoke access at any time.</p>
      {!tokenReady ? <p style={styles.body}>Checking the private invitation…</p> : !tokenLooksValid ? <div style={styles.error}>This invitation link is incomplete. Ask your school for a new private link.</div> : <form onSubmit={accept} style={styles.form}>
        <label style={styles.label}>Password (at least 12 characters)<input style={styles.input} type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label style={styles.label}>Confirm password<input style={styles.input} type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
        {error ? <div style={styles.error}>{error}</div> : null}
        <button style={styles.button} disabled={working}>{working ? "Creating private access…" : "Accept invitation"}</button>
      </form>}
      <p style={styles.safety}>Safety boundary: no staff dashboard, direct messaging, public publishing, or access to another school.</p>
    </section>
  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#fff", display: "grid", placeItems: "center", padding: "32px 20px", fontFamily: "Arial, sans-serif" },
  card: { width: "100%", maxWidth: 560, boxSizing: "border-box", background: "#182235", border: "1px solid #34445f", borderRadius: 18, padding: 36 },
  brand: { color: "#f4b942", textDecoration: "none", fontWeight: 900, letterSpacing: 2 },
  eyebrow: { color: "#f4b942", fontWeight: 900, fontSize: 12, letterSpacing: 1.3, margin: "28px 0 10px" },
  title: { fontSize: "clamp(32px,6vw,46px)", margin: "0 0 14px" },
  body: { color: "#c3cddd", lineHeight: 1.6, margin: "0 0 24px" },
  form: { display: "grid", gap: 16 },
  label: { display: "grid", gap: 8, fontWeight: 800, fontSize: 14 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "12px 13px", fontSize: 16 },
  button: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "13px 16px", fontWeight: 900, cursor: "pointer" },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, lineHeight: 1.45 },
  safety: { color: "#8ea0b8", fontSize: 12, lineHeight: 1.5, margin: "24px 0 0" }
};
