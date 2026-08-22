"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function makeSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function AddZoneForm({ locationId }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({
    type: "",
    text: ""
  });

  function handleNameChange(event) {
    const value = event.target.value;

    setName(value);
    setSlug(makeSlug(value));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!name.trim()) {
      setMessage({
        type: "error",
        text: "Please enter a zone name."
      });
      return;
    }

    if (!slug.trim()) {
      setMessage({
        type: "error",
        text: "Please enter a zone slug."
      });
      return;
    }

    setSaving(true);
    setMessage({
      type: "",
      text: ""
    });

    try {
      const response = await fetch(
        `/api/admin/locations/${locationId}/zones`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name,
            slug
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage({
          type: "error",
          text: data.error || "Unable to add the audio zone."
        });
        return;
      }

      setName("");
      setSlug("");
      setMessage({
        type: "success",
        text: "Audio zone added successfully."
      });

      router.refresh();

      window.setTimeout(() => {
        setOpen(false);
        setMessage({
          type: "",
          text: ""
        });
      }, 800);
    } catch {
      setMessage({
        type: "error",
        text: "A connection error occurred. Please try again."
      });
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={styles.openButton}
      >
        Add zone
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <label style={styles.label}>
        Zone name
        <input
          type="text"
          value={name}
          onChange={handleNameChange}
          placeholder="Sales Floor"
          style={styles.input}
          autoFocus
          required
        />
      </label>

      <label style={styles.label}>
        Zone slug
        <input
          type="text"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="sales-floor"
          style={styles.input}
          required
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

      <div style={styles.actions}>
        <button type="submit" disabled={saving} style={styles.submitButton}>
          {saving ? "Adding…" : "Add audio zone"}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setOpen(false);
            setName("");
            setSlug("");
            setMessage({
              type: "",
              text: ""
            });
          }}
          style={styles.cancelButton}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const styles = {
  openButton: {
    border: "none",
    borderRadius: 8,
    background: "#f4b942",
    color: "#101827",
    padding: "10px 13px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer"
  },
  form: {
    display: "grid",
    gap: 12,
    width: "100%",
    maxWidth: 380,
    padding: 16,
    border: "1px solid #42526b",
    borderRadius: 10,
    background: "#101827"
  },
  label: {
    display: "grid",
    gap: 7,
    color: "#d8e0ec",
    fontSize: 13,
    fontWeight: 800
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #42526b",
    borderRadius: 7,
    background: "#0b1220",
    color: "#ffffff",
    padding: "10px 11px",
    fontSize: 14
  },
  actions: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap"
  },
  submitButton: {
    border: "none",
    borderRadius: 7,
    background: "#f4b942",
    color: "#101827",
    padding: "9px 12px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer"
  },
  cancelButton: {
    border: "1px solid #42526b",
    borderRadius: 7,
    background: "transparent",
    color: "#d8e0ec",
    padding: "9px 12px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer"
  },
  message: {
    margin: 0,
    padding: 10,
    borderRadius: 7,
    fontSize: 13,
    lineHeight: 1.4
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
  }
};
