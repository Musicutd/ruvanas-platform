"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WorkflowProgress from "@/app/components/WorkflowProgress";
import ContextHelp from "@/app/components/ContextHelp";
import { safeWorkflowMessage, stationWorkflowSteps } from "@/lib/guided-workflows.mjs";

export default function StationSetupPage({ params }) {
  const router = useRouter();
  const [form, setForm] = useState({
    centovaUsername: "",
    serverHost: "",
    serverPort: "",
    mountPoint: "",
    streamUrl: "",
    bitrateKbps: "",
    adminPassword: "",
    sourcePassword: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/stations/${params.stationId}/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Unable to save streaming details.");
        return;
      }

      router.push(`/stations/${params.stationId}`);
      router.refresh();
    } catch (submitError) {
      setError(safeWorkflowMessage(submitError, "A connection error occurred. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <a href={`/stations/${params.stationId}`} style={styles.backLink}>
          ← Back to station
        </a>

        <p style={styles.eyebrow}>MANUAL SETUP</p>
        <h1 style={styles.title}>Connect streaming server</h1>
        <p style={styles.subtitle}>
          Enter the Centova Cast account details for this station. These
          values are stored privately and used to control the stream.
        </p>

        <WorkflowProgress
          title="Station setup"
          steps={stationWorkflowSteps({ stationCreated: true })}
        />

        <aside style={styles.guidance}>
          <strong>Before you begin</strong>
          <span>Keep the streaming-server welcome email nearby. Ruvanas stores these credentials privately and never displays the passwords again.</span>
        </aside>

        <ContextHelp
          title="Where do I find these streaming details?"
          introduction="Use the welcome or account information supplied for this station by the approved streaming provider. Ask Ruvanas operations if any field is unclear."
          items={[
            { title: "Host and port", description: "Copy them exactly from the station's streaming account details." },
            { title: "Public stream URL", description: "Use the listener-facing stream address, including its secure protocol and mount point when supplied." },
            { title: "Passwords", description: "Enter the private admin and source passwords here only. They are not displayed again after saving." }
          ]}
        />

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Centova username
            <input
              style={styles.input}
              type="text"
              name="centovaUsername"
              value={form.centovaUsername}
              onChange={updateField}
              placeholder="e.g. radio105_country"
              required
            />
          </label>

          <div style={styles.row}>
            <label style={styles.label}>
              Server host
              <input
                style={styles.input}
                type="text"
                name="serverHost"
                value={form.serverHost}
                onChange={updateField}
                placeholder="pollux.shoutca.st"
                required
              />
            </label>

            <label style={styles.label}>
              Server port
              <input
                style={styles.input}
                type="number"
                name="serverPort"
                value={form.serverPort}
                onChange={updateField}
                placeholder="8274"
                required
              />
            </label>
          </div>

          <label style={styles.label}>
            Mount point (if applicable)
            <input
              style={styles.input}
              type="text"
              name="mountPoint"
              value={form.mountPoint}
              onChange={updateField}
              placeholder="/stream"
            />
          </label>

          <label style={styles.label}>
            Public stream URL
            <input
              style={styles.input}
              type="text"
              name="streamUrl"
              value={form.streamUrl}
              onChange={updateField}
              placeholder="https://pollux.shoutca.st:8274/stream"
              required
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
              placeholder="320"
              required
            />
          </label>

          <label style={styles.label}>
            Admin password
            <input
              style={styles.input}
              type="password"
              name="adminPassword"
              value={form.adminPassword}
              onChange={updateField}
              placeholder="Centova account login password"
              required
            />
          </label>

          <label style={styles.label}>
            Source password
            <input
              style={styles.input}
              type="password"
              name="sourcePassword"
              value={form.sourcePassword}
              onChange={updateField}
              placeholder="Password for broadcasting sources"
              required
            />
          </label>

          {error ? <p style={styles.error} role="alert">{error}</p> : null}

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? "Saving…" : "Save and activate station"}
          </button>
        </form>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#101827",
    color: "#ffffff",
    display: "grid",
    placeItems: "center",
    padding: "32px 20px",
    fontFamily: "Arial, sans-serif"
  },
  card: {
    width: "100%",
    maxWidth: 640,
    background: "#182235",
    border: "1px solid #26344d",
    borderRadius: 16,
    padding: 36,
    boxSizing: "border-box"
  },
  backLink: {
    color: "#b8c3d6",
    textDecoration: "none"
  },
  eyebrow: {
    color: "#f4b942",
    letterSpacing: 1.5,
    fontSize: 12,
    fontWeight: 700,
    marginTop: 34,
    marginBottom: 10
  },
  title: {
    fontSize: 32,
    margin: "0 0 12px"
  },
  subtitle: {
    color: "#b8c3d6",
    lineHeight: 1.6,
    margin: "0 0 28px"
  },
  form: {
    display: "grid",
    gap: 20
  },
  guidance: {
    display: "grid",
    gap: 6,
    marginBottom: 22,
    borderLeft: "4px solid #f4b942",
    borderRadius: 8,
    background: "#111c2e",
    color: "#d8e0ec",
    padding: "13px 15px",
    lineHeight: 1.45
  },
  row: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr",
    gap: 16
  },
  label: {
    display: "grid",
    gap: 8,
    color: "#d8e0ec",
    fontSize: 14,
    fontWeight: 700
  },
  input: {
    border: "1px solid #42526b",
    borderRadius: 8,
    background: "#0f1725",
    color: "#ffffff",
    padding: "13px 14px",
    fontSize: 16
  },
  error: {
    margin: 0,
    border: "1px solid #a63e4a",
    background: "#3c1d27",
    color: "#fecdd3",
    borderRadius: 8,
    padding: 12,
    lineHeight: 1.45
  },
  button: {
    border: "none",
    borderRadius: 8,
    background: "#f4b942",
    color: "#101827",
    padding: "14px 18px",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer"
  }
};
