"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ActivateLocationButton({ locationId }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleActivate() {
    const confirmed = window.confirm(
      "Activate this retail location? Its configured audio zones will be ready for use."
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/locations/${locationId}/activate`,
        {
          method: "POST"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Unable to activate this location.");
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
    <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
      <button
        type="button"
        onClick={handleActivate}
        disabled={saving}
        style={{
          border: "none",
          borderRadius: 7,
          background: saving ? "#94a3b8" : "#166534",
          color: "#ffffff",
          padding: "10px 14px",
          fontSize: 14,
          fontWeight: 900,
          cursor: saving ? "not-allowed" : "pointer"
        }}
      >
        {saving ? "Activating…" : "Activate location"}
      </button>

      {message ? (
        <p
          style={{
            maxWidth: 260,
            margin: 0,
            color: "#b91c1c",
            fontSize: 13,
            fontWeight: 700,
            textAlign: "right"
          }}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
