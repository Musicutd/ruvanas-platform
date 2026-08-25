"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OrganisationSwitcher({ organisations, activeOrganisationId }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function changeOrganisation(event) {
    const organisationId = event.target.value;
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/me/organisation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Unable to change organisation.");
        return;
      }

      router.refresh();
    } catch {
      setError("A connection error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (organisations.length < 2) return null;

  return (
    <div style={styles.wrapper}>
      <label style={styles.label}>
        Active organisation
        <select
          value={activeOrganisationId}
          onChange={changeOrganisation}
          disabled={saving}
          style={styles.select}
        >
          {organisations.map((organisation) => (
            <option key={organisation.id} value={organisation.id}>
              {organisation.name}
            </option>
          ))}
        </select>
      </label>
      {saving ? <span style={styles.status}>Switching...</span> : null}
      {error ? <span style={styles.error}>{error}</span> : null}
    </div>
  );
}

const styles = {
  wrapper: { display: "flex", alignItems: "end", gap: 12, flexWrap: "wrap", margin: "0 0 28px" },
  label: { display: "grid", gap: 7, color: "#d8e0ec", fontSize: 13, fontWeight: 800 },
  select: { minWidth: 260, border: "1px solid #485a76", borderRadius: 8, background: "#182235", color: "#fff", padding: "10px 12px", fontSize: 15 },
  status: { color: "#f4b942", paddingBottom: 10, fontWeight: 700 },
  error: { color: "#fecdd3", paddingBottom: 10, fontWeight: 700 }
};

