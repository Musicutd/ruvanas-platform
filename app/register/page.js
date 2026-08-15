"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    organisationName: "",
    email: "",
    password: ""
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
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Unable to create your account.");
        return;
      }

      router.push("/dashboard");
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
        <a href="/" style={styles.brand}>RUVANAS</a>

        <p style={styles.eyebrow}>START YOUR PLATFORM</p>
        <h1 style={styles.title}>Create your account</h1>
        <p style={styles.subtitle}>
          Start your Ruvanas 30-day trial and manage your radio service from one place.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Your name
            <input
              style={styles.input}
              type="text"
              name="name"
              value={form.name}
              onChange={updateField}
              autoComplete="name"
              required
            />
          </label>

          <label style={styles.label}>
            Business or organisation name
            <input
              style={styles.input}
              type="text"
              name="organisationName"
              value={form.organisationName}
              onChange={updateField}
              autoComplete="organization"
              required
            />
          </label>

          <label style={styles.label}>
            Email address
            <input
              style={styles.input}
              type="email"
              name="email"
              value={form.email}
              onChange={updateField}
              autoComplete="email"
              required
            />
          </label>

          <label style={styles.label}>
            Password
            <input
              style={styles.input}
              type="password"
              name="password"
              value={form.password}
              onChange={updateField}
              autoComplete="new-password"
              minLength="8"
              required
            />
          </label>

          {error ? <p style={styles.error}>{error}</p> : null}

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? "Creating account…" : "Create my account"}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account? <a href="/login" style={styles.link}>Sign in</a>
        </p>
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
    maxWidth: 520,
    background: "#182235",
    border: "1px solid #26344d",
    borderRadius: 16,
    padding: 36,
    boxSizing: "border-box"
  },
  brand: {
    color: "#f4b942",
    fontWeight: 800,
    letterSpacing: 2,
    textDecoration: "none"
  },
  eyebrow: {
    color: "#f4b942",
    letterSpacing: 1.5,
    fontSize: 12,
    fontWeight: 700,
    marginTop: 32,
    marginBottom: 10
  },
  title: {
    fontSize: 34,
    margin: "0 0 12px"
  },
  subtitle: {
    margin: "0 0 28px",
    color: "#b8c3d6",
    lineHeight: 1.55
  },
  form: {
    display: "grid",
    gap: 18
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
    fontSize: 16
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
    marginTop: 4
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
  footer: {
    margin: "24px 0 0",
    color: "#b8c3d6",
    textAlign: "center"
  },
  link: {
    color: "#f4b942",
    fontWeight: 700
  }
};
