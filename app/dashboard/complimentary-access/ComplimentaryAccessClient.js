"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ComplimentaryAccessClient({ organisationName, canRedeem, access }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function redeem(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/complimentary-access/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to activate the code.");
      setCode("");
      setMessage(`${result.access.planName} complimentary access is now active.`);
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={s.page}>
      <Link href="/dashboard" style={s.back}>← Client home</Link>
      <p style={s.eyebrow}>PLAN ACCESS</p>
      <h1 style={s.title}>Complimentary access</h1>
      <p style={s.intro}>{organisationName} · Activate a code issued specifically to your organisation by Ruvanas.</p>

      {access.active ? <section style={s.activeCard}>
        <p style={s.eyebrow}>ACTIVE — NO CHARGE</p>
        <h2 style={s.h2}>{access.planName}</h2>
        <p>This is complimentary access, not a timed trial. It remains available until Ruvanas ends the arrangement.</p>
        <div style={s.grid}>
          <span><strong>{access.stationLimit}</strong> shop stream{access.stationLimit === 1 ? "" : "s"}</span>
          <span><strong>{access.listenerLimit}</strong> listener capacity</span>
          <span><strong>{access.storageLimitGb} GB</strong> audio storage</span>
          <span><strong>{access.maxBitrateKbps} kbps</strong> maximum quality</span>
        </div>
        <ul style={s.list}>
          {access.schoolRadioEnabled ? <li>School Radio included</li> : null}
          {access.retailMediaEnabled ? <li>Retail Media included</li> : null}
          {access.digitalSignageEnabled ? <li>Digital Signage included</li> : null}
        </ul>
        <small>Activated {access.activatedAt ? new Date(access.activatedAt).toLocaleString() : "by Ruvanas"}</small>
      </section> : <section style={s.card}>
        <h2 style={s.h2}>Enter your complimentary code</h2>
        <p>The code is tied to this organisation and can only be used once. It does not start a paid subscription.</p>
        {canRedeem ? <form onSubmit={redeem} style={s.form}>
          <label style={s.label}>Complimentary access code<input required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="RUV-XXXXXXXX-XXXXXXXX-XXXXXXXX" autoComplete="off" style={s.input} /></label>
          <button disabled={busy || !code.trim()} style={s.button}>Activate access</button>
        </form> : <p style={s.notice}>Ask an organisation owner or manager to activate the code.</p>}
      </section>}
      {message ? <p role="status" style={s.message}>{message}</p> : null}

      <section style={s.info}><h2 style={s.h2}>How it works</h2><ol style={s.list}><li>Ruvanas chooses the client and the service tier.</li><li>An owner or manager activates the one-time code here.</li><li>The selected tier becomes available without charge or an automatic expiry date.</li><li>Only a Ruvanas Super Admin can stop the complimentary access.</li></ol></section>
    </main>
  );
}

const s = {
  page: { maxWidth: 860, margin: "0 auto", padding: "44px 18px 72px", color: "#172033" }, back: { color: "#7c5200", fontWeight: 850, textDecoration: "none" }, eyebrow: { margin: "24px 0 7px", color: "#9a6400", fontSize: 12, fontWeight: 900, letterSpacing: 1.1 }, title: { margin: 0, fontSize: 38, fontWeight: 950 }, intro: { color: "#475569", lineHeight: 1.6 }, card: { marginTop: 24, padding: 26, border: "1px solid #94a3b8", borderRadius: 14, background: "#f8fafc" }, activeCard: { marginTop: 24, padding: 26, border: "2px solid #16794a", borderRadius: 14, background: "#ecfdf5" }, h2: { margin: "0 0 10px", fontSize: 24 }, form: { display: "grid", gap: 14, marginTop: 18 }, label: { display: "grid", gap: 7, fontWeight: 850 }, input: { padding: 13, border: "1px solid #64748b", borderRadius: 8, fontSize: 16, letterSpacing: 1 }, button: { justifySelf: "start", border: 0, borderRadius: 8, padding: "12px 18px", background: "#f4b942", color: "#172033", fontWeight: 900, cursor: "pointer" }, grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, margin: "18px 0" }, list: { color: "#334155", lineHeight: 1.8 }, info: { marginTop: 22, padding: 22, border: "1px solid #cbd5e1", borderRadius: 12 }, message: { padding: 12, borderRadius: 8, background: "#fff7df", color: "#5f4100", fontWeight: 800 }, notice: { color: "#8a5a00", fontWeight: 800 }
};
