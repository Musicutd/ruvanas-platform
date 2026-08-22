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

export default function CreateStationForm({ organisations }) {
  const router = useRouter();

  const [organisationId, setOrganisationId] = useState(
    organisations[0]?.id || ""
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [listenerLimit, setListenerLimit] = useState("100");
  const [storageLimitGb, setStorageLimitGb] = useState("10");
  const [maxBitrateKbps, setMaxBitrateKbps] = useState("128");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({
    type: "",
    text: ""
  });

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedName = name.trim();
    const parsedListenerLimit = Number(listenerLimit);
    const parsedStorageLimitGb = Number(storageLimitGb);
    const parsedMaxBitrateKbps = Number(maxBitrateKbps);

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
        text: "Please enter a station name."
      });
      return;
    }

    if (!Number.isInteger(parsedListenerLimit) || parsedListenerLimit < 1) {
      setMessage({
        type: "error",
        text: "Listener limit must be a whole number of at least 1."
      });
      return;
    }

    if (!Number.isInteger(parsedStorageLimitGb) || parsedStorageLimitGb < 1) {
      setMessage({
        type: "error",
        text: "Storage limit must be a whole number of at least 1 GB."
      });
      return;
    }

    if (!Number.isInteger(parsedMaxBitrateKbps) || parsedMaxBitrateKbps < 1) {
      setMessage({
        type: "error",
        text: "Maximum bitrate must be a whole number of at least 1 kbps."
      });
      return;
    }

    setSaving(true);
    setMessage({
      type: "",
      text: ""
    });

    try {
      const response = await fetch("/api/admin/stations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          organisationId,
          name: trimmedName,
          slug: makeSlug(trimmedName),
          description: description.trim() || null,
          listenerLimit: parsedListenerLimit,
          storageLimitGb: parsedStorageLimitGb,
          maxBitrateKbps: parsedMaxBitrateKbps
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({
          type: "error",
          text: data.error || "Unable to create the station."
        });
        return;
      }

      router.push("/admin/stations");
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
        Station name
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Example: Music Utd Marsa Radio"
          style={styles.input}
          disabled={saving}
          required
          autoFocus
        />
      </label>

      <label style={styles.label}>
        Description <span style={styles.optional}>(optional)</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional internal description"
          style={{ ...styles.input, minHeight: 88, resize: "vertical" }}
          disabled={saving}
        />
      </label>

      <div style={styles.limitGrid}>
        <label style={styles.label}>
          Listener limit
          <input
            type="number"
            min="1"
            step="1"
            value={listenerLimit}
            onChange={(event) => setListenerLimit(event.target.value)}
            style={styles.input}
            disabled={saving}
            required
          />
        </label>

        <label style={styles.label}>
          Storage limit (GB)
          <input
            type="number"
            min="1"
            step="1"
            value={storageLimitGb}
            onChange={(event) => setStorageLimitGb(event.target.value)}
            style={styles.input}
            disabled={saving}
            required
          />
        </label>

        <label style={styles.label}>
          Maximum bitrate (kbps)
          <input
            type="number"
            min="1"
            step="1"
            value={maxBitrateKbps}
            onChange={(event) => setMaxBitrateKbps(event.target.value)}
            style={styles.input}
            disabled={saving}
            required
          />
        </label>
      </div>

      <p style={styles.helpText}>
        Stream URL and Centova credentials are added after the station is
        created.
      </p>

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
        {saving ? "Creating…" : "Create station"}
      </button>
    </form>
  );
}

const styles = {
  form: {
    display: "grid",
    gap: 16,
    maxWidth: 680
  },
  label: {
    display: "grid",
    gap: 7,
    color: "#172033",
    fontSize: 14,
    fontWeight: 800
  },
  optional: {
    color: "#64748b",
    fontWeight: 600
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
  limitGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14
  },
  helpText: {
    margin: "-4px 0 0",
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.45
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
