"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChannelStatusButton({
  channelId,
  channelName,
  currentStatus,
  canActivate
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const isActive = currentStatus === "ACTIVE";
  const nextStatus = isActive ? "PAUSED" : "ACTIVE";

  async function updateStatus() {
    if (!isActive && !canActivate) {
      setMessage(
        "This channel needs a configured station and at least one assigned zone before it can be activated."
      );
      return;
    }

    const actionLabel = isActive ? "pause" : "activate";

    const confirmed = window.confirm(
      `Are you sure you want to ${actionLabel} "${channelName}"?`
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/channels/${channelId}/status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: nextStatus
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Unable to update channel status.");
        return;
      }

      router.refresh();
    } catch {
      setMessage("A connection error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        onClick={updateStatus}
        disabled={saving}
        style={{
          border: "none",
          borderRadius: 7,
          background: isActive ? "#991b1b" : "#f4b942",
          color: isActive ? "#ffffff" : "#101827",
          padding: "8px 10px",
          fontSize: 13,
          fontWeight: 800,
          cursor: saving ? "wait" : "pointer",
          opacity: saving ? 0.7 : 1,
          whiteSpace: "nowrap"
        }}
      >
        {saving ? "Saving…" : isActive ? "Pause" : "Activate"}
      </button>

      {message ? (
        <p
          style={{
            margin: 0,
            maxWidth: 210,
            color: "#fecdd3",
            fontSize: 12,
            lineHeight: 1.35
          }}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
