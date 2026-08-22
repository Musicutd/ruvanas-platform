"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AssignChannelForm({ locationId, zoneId, channels }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({
    type: "",
    text: ""
  });

  async function handleSubmit(event) {
    event.preventDefault();

    if (!channelId) {
      setMessage({
        type: "error",
        text: "Please select a Ruvanas channel."
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
        `/api/admin/locations/${locationId}/zones/${zoneId}/channel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            channelId
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage({
          type: "error",
          text: data.error || "Unable to assign the channel."
        });
        return;
      }

      setMessage({
        type: "success",
        text: "Channel assigned successfully."
      });

      router.refresh();

      window.setTimeout(() => {
        setOpen(false);
        setChannelId("");
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

  if (channels.length === 0) {
    return (
      <span style={{ color: "#9fb3c8", fontSize: 13 }}>
        No channels available
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={styles.openButton}
      >
        Assign channel
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <label style={styles.label}>
        Ruvanas channel
        <select
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
          style={styles.input}
          autoFocus
          required
        >
          <option value="">Select a channel</option>

          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
              {channel.station
                ? channel.station.streamConfig?.streamUrl
                  ? " — stream configured"
                  : " — stream needs setup"
                : " — no technical stream linked"}
            </option>
          ))}
        </select>
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
          {saving ? "Assigning…" : "Save assignment"}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setOpen(false);
            setChannelId("");
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
    border: "1px solid #f4b942",
    borderRadius: 7,
    background: "transparent",
    color: "#f4b942",
    padding: "7px 10px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer"
  },
  form: {
    display: "grid",
    gap: 10,
    minWidth: 260,
    padding: 12,
    border: "1px solid #42526b",
    borderRadius: 9,
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
    padding: "9px 10px",
    fontSize: 13
  },
  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap"
  },
  submitButton: {
    border: "none",
    borderRadius: 7,
    background: "#f4b942",
    color: "#101827",
    padding: "8px 10px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer"
  },
  cancelButton: {
    border: "1px solid #42526b",
    borderRadius: 7,
    background: "transparent",
    color: "#d8e0ec",
    padding: "8px 10px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer"
  },
  message: {
    margin: 0,
    padding: 8,
    borderRadius: 7,
    fontSize: 12,
    lineHeight: 1.35
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
