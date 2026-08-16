"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminStationSetupForm({ stationId, stationName, initialData }) {
  const router = useRouter();
  const [form, setForm] = useState(initialData || {
    streamUrl: "",
    mountPoint: "",
    serverHost: "",
    serverPort: "",
    bitrateKbps: "",
    centovaUsername: "",
    adminPassword: "",
    sourcePassword: ""
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      const response = await fetch(`/api/stations/${stationId}/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({ type: "error", text: data.error || "Failed to save configuration." });
        return;
      }

      setMessage({ type: "success", text: "Streaming configuration saved successfully." });

      // Clear password fields after successful save
      setForm((current) => ({
        ...current,
        adminPassword: "",
        sourcePassword: ""
      }));
    } catch {
      setMessage({ type: "error", text: "A connection error occurred. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Stream connection</h2>

        <label style={styles.label}>
          Stream URL
          <input
            style={styles.input}
            type="url"
            name="streamUrl"
            value={form.streamUrl}
            onChange={updateField}
            placeholder="https://stream.example.com/live"
          />
        </label>

        <label style={styles.label}>
          Mount point
          <input
            style={styles.input}
            type="text"
            name="mountPoint"
            value={form.mountPoint}
            onChange={updateField}
            placeholder="/live"
          />
        </label>

        <label style={styles.label}>
          Server host
          <input
            style={styles.input}
            type="text"
            name="serverHost"
            value={form.serverHost}
            onChange={updateField}
            placeholder="stream.example.com"
          />
        </label>

        <div style={styles.row}>
          <label style={styles.label}>
            Server port
            <input
              style={styles.input}
              type="number"
              name="serverPort"
              value={form.serverPort}
              onChange={updateField}
              placeholder="8000"
            />
          </label>

          <label style={styles.label}>
            Bitrate (kbps)
            <input
              style={styles.input}
              type="number"
              name="bitrateKbps"
              value={form.bitrateKbps}
              onChange={updateField}
              placeholder="128"
            />
          </label>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Centova credentials</h2>

        <label style={styles.label}>
          Centova username
          <input
            style={styles.input}
            type="text"
            name="centovaUsername"
            value={form.centovaUsername}
            onChange={updateField}
            placeholder="centova_admin"
          />
        </label>

        <label style={styles.label}>
          Admin password (leave blank to keep existing)
          <input
            style={styles.input}
            type="password"
            name="adminPassword"
            value={form.adminPassword}
            onChange={updateField}
            placeholder="••••••••"
          />
        </label>

        <label style={styles.label}>
          Source password (leave blank to keep existing)
          <input
            style={styles.input}
            type="password"
            name="sourcePassword"
            value={form.sourcePassword}
            onChange={updateField}
            placeholder="••••••••"
          />
        </label>
      </section>

      {message.text ? (
        <p style={{
          ...styles.message,
          ...(message.type === "error" ? styles.messageError : styles.messageSuccess)
        }}>
          {message.text}
        </p>
      ) : null}

      <button type="submit" style={styles.button} disabled={saving}>
        {saving ? "Saving…" : "Save configuration"}
      </button>
    </form>
  );
}

const styles = {
  form: {
    display: "grid",
    gap: 28
  },
  section: {
    background: "#182235",
    border: "1px solid #2b3a54",
    borderRadius: 14,
    padding: 24,
    display: "grid",
    gap: 18
  },
  sectionTitle: {
    color: "#f4b942",
    fontSize: 14,
    fontWeight: 700,
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  label: {
    display: "grid",
    gap: 8,
    color: "#d8e0ec",
    fontSize: 14,
    fontWeight: 700
  },
  input: {
    width: "100%",
    border: "1px solid #42526b",
    borderRadius: 8,
    background: "#0f1725",
    color: "#ffffff",
    padding: "13px 14px",
    boxSizing: "border-box",
    fontSize: 15
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16
  },
  message: {
    margin: 0,
    borderRadius: 8,
    padding: 12,
    lineHeight: 1.45,
    fontSize: 14
  },
  messageError: {
    border: "1px solid #a63e4a",
    background: "#3c1d27",
    color: "#fecdd3"
  },
  messageSuccess: {
    border: "1px solid #2d7a4f",
    background: "#1a3a2f",
    color: "#c6f6d5"
  },
  button: {
    border: "none",
    borderRadius: 8,
    background: "#f4b942",
    color: "#101827",
    padding: "14px 18px",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    alignSelf: "start"
  }
};
