"use client";

import { useEffect, useState } from "react";

export default function StudioDestinationsClient({ renderId }) {
  const [data, setData] = useState(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch(`/api/school-radio/studio-destinations?renderId=${encodeURIComponent(renderId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Product destinations could not be loaded.");
    setData(payload);
  }

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [renderId]);

  async function handoff(destination) {
    setWorking(destination); setError("");
    try {
      const response = await fetch("/api/school-radio/studio-destinations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ renderId, destination }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The product handoff could not be created.");
      await load();
    } catch (actionError) { setError(actionError.message); }
    finally { setWorking(""); }
  }

  if (!data && !error) return <p style={s.loading}>Loading product destinations…</p>;
  return <section style={s.panel} aria-label="Product destinations">
    <div><strong style={s.title}>Send to a Ruvanas product</strong><p style={s.help}>One approved master, no duplicate audio. Every handoff is recorded and opens the correct private workflow.</p></div>
    {error ? <p style={s.error}>{error}</p> : null}
    <div style={s.grid}>{data?.destinations.map((destination) => {
      const completed = data.handoffs.find((handoff) => handoff.destination === destination.key);
      return <article key={destination.key} style={s.card}>
        <small style={s.product}>{destination.product}</small><strong>{destination.label}</strong><span style={s.description}>{destination.description}</span>
        {completed ? <a href={completed.workflowPath} style={s.open}>Open workflow</a> : <button type="button" style={s.send} disabled={!destination.available || Boolean(working)} onClick={() => handoff(destination.key)}>{working === destination.key ? "Sending…" : "Send approved master"}</button>}
        {!destination.available ? <small style={s.reason}>{destination.reason}</small> : null}
      </article>;
    })}</div>
  </section>;
}

const s = {
  panel: { width: "100%", border: "1px solid #2f6f72", borderRadius: 10, background: "var(--rv-info-bg)", padding: 12, marginTop: 8 },
  title: { color: "#e6fffb" }, help: { color: "#a5c9cc", fontSize: 12, lineHeight: 1.45, margin: "4px 0 10px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 },
  card: { display: "grid", gap: 5, border: "1px solid #2f5961", borderRadius: 8, background: "var(--rv-info-bg)", padding: 10 },
  product: { color: "#f4b942", fontWeight: 900, letterSpacing: 0.7 }, description: { color: "#b8cbd0", fontSize: 11, lineHeight: 1.35 },
  send: { border: 0, borderRadius: 6, background: "#f4b942", color: "#101827", padding: "8px 9px", fontWeight: 900, cursor: "pointer" },
  open: { borderRadius: 6, background: "#15803d", color: "#fff", padding: "8px 9px", fontWeight: 900, textDecoration: "none", textAlign: "center" },
  reason: { color: "#fbcfe8", lineHeight: 1.35 }, error: { color: "var(--rv-error-text)", fontSize: 12 }, loading: { color: "var(--rv-text-muted)", fontSize: 12 }
};
