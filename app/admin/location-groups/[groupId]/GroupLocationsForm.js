"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GroupLocationsForm({ groupId, locations }) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => locations.filter((location) => location.selected).map((location) => location.id));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setMessage("");
  }

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/admin/location-groups/${groupId}/locations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationIds: selected })
    });
    const result = await response.json();
    setSaving(false);

    if (!response.ok) {
      setMessage(result.error || "Unable to save locations.");
      return;
    }

    setMessage("Group locations saved.");
    router.refresh();
  }

  return (
    <div>
      {locations.length === 0 ? (
        <p style={{ color: "#475569" }}>This organisation has no locations yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {locations.map((location) => (
            <label key={location.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={selected.includes(location.id)} onChange={() => toggle(location.id)} />
              <span><strong>{location.name}</strong>{location.city ? ` · ${location.city}` : ""}</span>
            </label>
          ))}
        </div>
      )}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" onClick={save} disabled={saving} style={{ padding: "10px 15px", border: 0, borderRadius: 7, background: "#f4b942", fontWeight: 800, cursor: "pointer" }}>
          {saving ? "Saving…" : "Save locations"}
        </button>
        {message ? <span role="status" style={{ color: message.includes("saved") ? "#166534" : "#b91c1c" }}>{message}</span> : null}
      </div>
    </div>
  );
}

