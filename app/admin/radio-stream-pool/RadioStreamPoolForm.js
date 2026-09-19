"use client";

import { useEffect, useState } from "react";

const initial = {
  centovaUsername: "", streamUrl: "", serverHost: "", serverPort: "",
  sourcePort: "", sourceUsername: "", sourcePassword: "",
  listenerLimit: "", maxBitrateKbps: ""
};

const labels = {
  centovaUsername: "Centova account username",
  streamUrl: "Public HTTPS listener URL",
  serverHost: "Live-source hostname",
  serverPort: "Listener port",
  sourcePort: "Live-source port",
  sourceUsername: "Live-source username (if supplied)",
  sourcePassword: "Source password",
  listenerLimit: "Listener capacity",
  maxBitrateKbps: "Maximum bitrate (kbps)"
};

export default function RadioStreamPoolForm() {
  const [fields, setFields] = useState(initial);
  const [slots, setSlots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/admin/preprovisioned-radio-streams", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load the stream pool.");
    setSlots(body.slots || []);
  }

  useEffect(() => {
    refresh().catch((failure) => setError(failure.message));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/preprovisioned-radio-streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to register this stream.");
      setFields(initial);
      setNotice(body.notice);
      await refresh();
    } catch (failure) {
      setError(failure.message || "Unable to register this stream.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section style={box}>
      <h2 style={{ marginTop: 0 }}>Register a prepared account</h2>
      <p style={{ color: "#475569" }}>Use the exact listener and live-source details supplied by Centova. This does not connect an encoder, switch on AutoDJ or change an existing station.</p>
      {error ? <p role="alert" style={{ color: "#a51d16" }}>{error}</p> : null}
      {notice ? <p role="status" style={{ color: "#13673d" }}>{notice}</p> : null}
      <form onSubmit={submit} autoComplete="off">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
          {Object.entries(labels).map(([name, label]) => <label key={name} style={{ display: "grid", gap: 6, fontWeight: 700 }}>
            {label}
            <input
              name={name}
              type={name === "sourcePassword" ? "password" : ["serverPort", "sourcePort", "listenerLimit", "maxBitrateKbps"].includes(name) ? "number" : name === "streamUrl" ? "url" : "text"}
              min={["serverPort", "sourcePort", "listenerLimit", "maxBitrateKbps"].includes(name) ? 1 : undefined}
              required={name !== "sourceUsername"}
              autoComplete={name === "sourcePassword" ? "new-password" : "off"}
              value={fields[name]}
              onChange={(event) => setFields((current) => ({ ...current, [name]: event.target.value }))}
              style={{ padding: 10, border: "1px solid #aab8cb", borderRadius: 7, font: "inherit" }}
            />
          </label>)}
        </div>
        <button disabled={busy} style={{ marginTop: 20, padding: "11px 18px", border: 0, borderRadius: 7, background: "#f4b942", color: "#172033", fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Recording…" : "Register in quarantine"}
        </button>
      </form>
    </section>
    <section style={{ ...box, marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Pool inventory</h2>
      <p style={{ color: "#475569" }}>Quarantined accounts are not eligible for automatic station assignment. Source passwords are never shown here.</p>
      {!slots.length ? <p>No accounts registered yet.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
        <thead><tr><th style={cell}>Account</th><th style={cell}>Public listener</th><th style={cell}>Capacity</th><th style={cell}>Status</th></tr></thead>
        <tbody>{slots.map((slot) => <tr key={slot.id}>
          <td style={cell}>{slot.centovaUsername}</td>
          <td style={cell}>{slot.streamUrl}</td>
          <td style={cell}>{slot.listenerLimit} listeners · {slot.maxBitrateKbps} kbps</td>
          <td style={cell}>{slot.status}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </>;
}

const box = { padding: 24, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" };
const cell = { padding: "12px 8px", borderBottom: "1px solid #cbd5e1", verticalAlign: "top" };
