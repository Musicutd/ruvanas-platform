"use client";

import { useMemo, useState } from "react";

export default function PublicPlayerSettings({ station, canManage }) {
  const [enabled, setEnabled] = useState(station.publicPlayerEnabled);
  const [tagline, setTagline] = useState(station.publicPlayerTagline || "");
  const [accent, setAccent] = useState(station.publicPlayerAccent || "#f4b942");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const listenUrl = `${origin}/listen/${station.slug}`;
  const embedUrl = `${origin}/embed/${station.slug}`;
  const embedCode = useMemo(() => `<iframe src="${embedUrl}" title="Listen to ${station.name}" width="100%" height="420" loading="lazy" allow="autoplay"></iframe>`, [embedUrl, station.name]);

  async function save() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/stations/${station.id}/public-player`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, tagline, accent }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save the public player.");
      setMessage(enabled ? "Public player published." : "Public player is private.");
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  return <div style={styles.grid}>
    <section style={styles.card}>
      <div style={styles.statusRow}><div><strong>Public availability</strong><p style={styles.muted}>{enabled ? "Listeners can open the public and embedded players." : "Only your private station tools are available."}</p></div><span style={{ ...styles.badge, ...(enabled ? styles.live : {}) }}>{enabled ? "LIVE" : "PRIVATE"}</span></div>
      <label style={styles.toggle}><input type="checkbox" checked={enabled} disabled={!canManage} onChange={(event) => setEnabled(event.target.checked)} /> Publish this station’s public player</label>
      <label style={styles.label}>Listener-facing tagline<input style={styles.input} value={tagline} maxLength={160} disabled={!canManage} onChange={(event) => setTagline(event.target.value)} placeholder="Live music, shows and stories from our station." /></label>
      <label style={styles.label}>Accent colour<input style={{ ...styles.input, maxWidth: 180 }} type="color" value={accent} disabled={!canManage} onChange={(event) => setAccent(event.target.value)} /></label>
      <p style={styles.muted}>Capacity: up to {station.listenerLimit.toLocaleString("en-MT")} simultaneous public listeners, subject to the organisation plan.</p>
      {canManage ? <button style={styles.button} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save public player"}</button> : <p style={styles.notice}>An organisation owner or manager can change these settings.</p>}
      {message ? <p aria-live="polite" style={styles.notice}>{message}</p> : null}
    </section>
    <section style={styles.card}>
      <p style={styles.kicker}>SHARE</p><h2 style={styles.subheading}>Listener links</h2>
      <label style={styles.label}>Public page<input style={styles.input} readOnly value={listenUrl} /></label>
      <label style={styles.label}>Embeddable player<textarea style={{ ...styles.input, minHeight: 110 }} readOnly value={embedCode} /></label>
      <div style={styles.actions}><a style={styles.linkButton} href={`/listen/${station.slug}`} target="_blank" rel="noreferrer">Preview player</a><button style={styles.secondary} onClick={() => navigator.clipboard.writeText(embedCode).then(() => setMessage("Embed code copied."))}>Copy embed code</button></div>
      <p style={styles.muted}>The player creates anonymous, short-lived listening sessions. It does not expose subscriber accounts, streaming credentials or enrolled shop-player controls.</p>
    </section>
  </div>;
}

const styles = {
  grid: { display: "grid", gap: 18, marginTop: 34 },
  card: { background: "#131e31", border: "1px solid #2a3a54", borderRadius: 18, padding: 26 },
  statusRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18 },
  badge: { borderRadius: 999, padding: "7px 11px", background: "#273449", color: "#cbd5e1", fontSize: 11, fontWeight: 900, letterSpacing: 1 },
  live: { background: "#153a2d", color: "#7bf0ba" },
  toggle: { display: "flex", gap: 10, alignItems: "center", margin: "22px 0", fontWeight: 800 },
  label: { display: "grid", gap: 8, marginTop: 18, color: "#dbe5f3", fontWeight: 700, fontSize: 14 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #3a4b67", borderRadius: 10, background: "#0d1728", color: "#f8fafc", padding: "12px 13px", font: "inherit" },
  muted: { color: "#9fb0c7", lineHeight: 1.55, margin: "6px 0 0" },
  notice: { color: "#f4c766", lineHeight: 1.5 },
  button: { marginTop: 22, border: 0, borderRadius: 9, padding: "12px 17px", background: "#f4b942", color: "#111827", fontWeight: 900, cursor: "pointer" },
  kicker: { color: "#f4b942", fontWeight: 900, letterSpacing: 1.4, fontSize: 12 },
  subheading: { fontSize: 28, margin: "5px 0" },
  actions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 },
  linkButton: { borderRadius: 9, padding: "11px 15px", background: "#f4b942", color: "#111827", fontWeight: 900, textDecoration: "none" },
  secondary: { border: "1px solid #52627a", borderRadius: 9, padding: "11px 15px", background: "transparent", color: "#f8fafc", fontWeight: 800, cursor: "pointer" }
};
