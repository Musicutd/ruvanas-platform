"use client";

import { useState } from "react";

function initialDates() {
  const to = new Date();
  const from = new Date(to); from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function CombinedDeliveryReportClient() {
  const dates = initialDates();
  const [from, setFrom] = useState(dates.from);
  const [to, setTo] = useState(dates.to);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(event) {
    event?.preventDefault(); setLoading(true); setMessage("");
    try {
      const query = new URLSearchParams({ from, to });
      const response = await fetch(`/api/reports/combined-delivery?${query}`, { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Unable to load combined delivery evidence.");
      setResult(value);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load combined delivery evidence."); }
    finally { setLoading(false); }
  }

  const summary = result?.report?.summary;
  const query = new URLSearchParams({ from, to }).toString();
  return <section style={styles.section}>
    <p style={styles.eyebrow}>Stage 7D</p>
    <h2 style={styles.title}>Combined audio and visual delivery</h2>
    <p style={styles.copy}>Review device-confirmed promotional audio and digital-signage delivery in one evidence view. Audio and visual totals remain separate so the report never implies audience measurement.</p>
    <form onSubmit={load} style={styles.filters}>
      <label style={styles.label}>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required style={styles.input} /></label>
      <label style={styles.label}>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required style={styles.input} /></label>
      <button disabled={loading} style={styles.button}>{loading ? "Loading…" : "Build report"}</button>
      {result ? <a href={`/api/reports/combined-delivery/export?${query}`} style={styles.link}>Download verified CSV</a> : null}
    </form>
    {message ? <p style={styles.error}>{message}</p> : null}
    {summary ? <>
      <div style={styles.cards}>
        <div style={styles.metric}><strong>{summary.audioCompleted}</strong><span>Audio completed</span></div>
        <div style={styles.metric}><strong>{summary.visualCompleted}</strong><span>Visual completed</span></div>
        <div style={styles.metric}><strong>{summary.takeoverCompleted}</strong><span>Takeover visuals</span></div>
        <div style={styles.metric}><strong>{summary.retailMediaVisualCompleted}</strong><span>Retail Media visuals</span></div>
      </div>
      <p style={styles.notice}>{result.notice}</p>
      <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th>Time</th><th>Medium</th><th>Content</th><th>Device</th><th>Location / zone</th><th>Campaign / order</th><th>Status</th></tr></thead><tbody>{result.report.rows.slice(0, 100).map((row, index) => <tr key={`${row.medium}:${row.occurredAt}:${index}`}><td>{new Date(row.occurredAt).toLocaleString()}</td><td>{row.medium}</td><td>{row.content}</td><td>{row.device}</td><td>{row.location} / {row.zone}</td><td>{row.campaignOrOrder || row.takeover || "—"}</td><td>{row.eventType}</td></tr>)}</tbody></table></div>
    </> : null}
  </section>;
}

const styles = {
  section: { marginTop: 36, padding: 24, border: "1px solid #cbd5e1", borderRadius: 14, background: "#fff" },
  eyebrow: { margin: 0, color: "#9a6400", fontWeight: 900, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" },
  title: { margin: "7px 0", color: "#0f172a", fontSize: 28 },
  copy: { maxWidth: 850, color: "#475569", lineHeight: 1.6 },
  filters: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginTop: 18 },
  label: { display: "grid", gap: 5, color: "#334155", fontSize: 13, fontWeight: 800 },
  input: { minHeight: 40, border: "1px solid #94a3b8", borderRadius: 7, padding: "7px 9px" },
  button: { minHeight: 40, border: 0, borderRadius: 7, padding: "8px 14px", background: "#0f172a", color: "#fff", fontWeight: 900 },
  link: { minHeight: 40, display: "inline-flex", alignItems: "center", padding: "0 12px", border: "1px solid #0f172a", borderRadius: 7, color: "#0f172a", fontWeight: 800, textDecoration: "none" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginTop: 20 },
  metric: { display: "grid", gap: 3, padding: 16, borderRadius: 10, background: "#f8fafc", color: "#475569" },
  notice: { padding: 12, borderRadius: 8, background: "#fffbeb", color: "#78350f", fontSize: 13, fontWeight: 700 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#334155" },
  error: { color: "#b91c1c", fontWeight: 800 }
};
