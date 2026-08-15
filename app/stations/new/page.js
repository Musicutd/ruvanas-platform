"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewStationPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    description: ""
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
      const response = await fetch("/api/stations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Unable to create station.");
        return;
      }

      router.push(`/stations/${data.station.id}`);
      router.refresh();
    } catch {
      setError("A connection error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <a href="/dashboard" style={styles.backLink}>
          ← Back to dashboard
        </a>

        <p style={styles.eyebrow}>ONLINE RADIO</p>
        <h1 style={styles.title}>Create your station</h1>
        <p style={styles.subtitle}>
          Set up the basic identity of your station. Streaming infrastructure
          will be configured privately after creation.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Station name
            <input
              style={styles.input}
              type="text"
              name="name"
              value={form.name}
              onChange={updateField}
              placeholder="Example: Ruvanas Hits"
              required
            />
          </label>

          <label style={styles.label}>
            Description
            <textarea
              style={styles.textarea}
              name="description"
              value={form.description}
              onChange={updateField}
              placeholder="Tell listeners about your station."
              rows={5}
            />
          </label>

          {error ? <p style={styles.error}>{error}</p> : null}

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? "Creating station…" : "Create station"}
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
    maxWidth: 620,
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
    fontSize: 36,
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
  textarea: {
    border: "1px solid #42526b",
    borderRadius: 8,
    background: "#0f1725",
    color: "#ffffff",
    padding: "13px 14px",
    fontSize: 16,
    resize: "vertical",
    fontFamily: "inherit"
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
