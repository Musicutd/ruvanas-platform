"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const fieldStyle = {
  width: "100%",
  padding: 10,
  border: "1px solid #cbd5e1",
  borderRadius: 7,
  boxSizing: "border-box"
};

export default function NewLocationGroupForm({ organisations }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);

    const response = await fetch("/api/admin/location-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(data.entries()))
    });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error || "Unable to create the group.");
      setSaving(false);
      return;
    }

    router.push(`/admin/location-groups/${result.group.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 16, maxWidth: 620 }}>
      <label>
        <span style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Organisation</span>
        <select name="organisationId" required style={fieldStyle}>
          <option value="">Select organisation</option>
          {organisations.map((organisation) => (
            <option key={organisation.id} value={organisation.id}>{organisation.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Group name</span>
        <input name="name" required placeholder="Malta Stores" style={fieldStyle} />
      </label>
      <label>
        <span style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Description (optional)</span>
        <textarea name="description" rows={3} placeholder="Locations managed as one operational group" style={fieldStyle} />
      </label>
      {error ? <p role="alert" style={{ color: "#b91c1c", margin: 0 }}>{error}</p> : null}
      <button disabled={saving} style={{ padding: "11px 16px", border: 0, borderRadius: 7, background: "#f4b942", fontWeight: 800, cursor: "pointer" }}>
        {saving ? "Creating…" : "Create group"}
      </button>
    </form>
  );
}

