"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function makeSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function CreateBrandForm({ organisations }) {
  const router = useRouter();
  const [organisationId, setOrganisationId] = useState(
    organisations[0]?.id || ""
  );
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({
    type: "",
    text: ""
  });

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedName = name.trim();

    if (!organisationId) {
      setMessage({
        type: "error",
        text: "Please select an organisation."
      });
      return;
    }

    if (!trimmedName) {
      setMessage({
        type: "error",
        text: "Please enter a brand name."
      });
      return;
    }

    setSaving(true);
    setMessage({
      type: "",
      text: ""
    });

    try {
      const response = await fetch("/api/admin/brands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          organisationId,
          name: trimmedName,
          slug: makeSlug(trimmedName)
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({
          type: "error",
          text: data.error || "Unable to create the brand."
        });
        return;
      }

      router.push("/admin/brands");
      router.refresh();
    } catch {
      setMessage({
        type: "error",
        text: "A connection error occurred. Please try again."
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <label style={styles.label}>
        Organisation
        <select
          value={organisationId}
          onChange={(event) => setOrganisationId(event.target.value)}
          style={styles.input}
          disabled={saving}
          required
        >
          {organisations.map((organisation) => (
            <option key={organisation.id} value={organisation.id}>
              {organisation.name}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.label}>
        Brand name
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Example: Fashion K Outlet"
          style={styles.input}
          disabled={saving}
          required
          autoFocus
        />
      </label>

      {message.text ? (
        <p
          style={{
            ...styles.message,
            ...(message.type === "error"
              ? styles.messageError
              : styles.messageSuccess)
          }}
        >
          {message.text}
        </p>
      ) : null}

      <button type="submit" disabled={saving} style={styles.submitButton}>
        {saving ? "Creating…" : "Create brand"}
      </button>
    </form>
  );
}

const styles = {
  form: {
    display: "grid",
    gap: 16,
    maxWidth: 520
  },
  label: {
    display: "grid",
    gap: 7,
    color: "#172033",
    fontSize: 14,
    fontWeight: 800
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #94a3b8",
    borderRadius: 7,
    background: "#ffffff",
    color: "#111827",
    padding: "10px 11px",
    fontSize: 15,
    fontFamily: "inherit"
  },
  submitButton: {
    justifySelf: "start",
    border: "none",
    borderRadius: 7,
    background: "#f4b942",
    color: "#172033",
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer"
  },
  message: {
    margin: 0,
    padding: 10,
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 700
  },
  messageError: {
    border: "1px solid #dc2626",
    background: "#fef2f2",
    color: "#991b1b"
  },
  messageSuccess: {
    border: "1px solid #16a34a",
    background: "#f0fdf4",
    color: "#166534"
  }
};
