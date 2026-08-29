"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DigitalSignageEntitlementControl({ organisationId, effectiveEnabled, overrideEnabled, planDefaultEnabled, canManage }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const source = overrideEnabled == null ? "plan default" : "organisation override";
  async function update(enabled) {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/admin/organisations/${organisationId}/digital-signage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update Digital Signage access.");
      router.refresh();
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : "Unable to update Digital Signage access."); }
    finally { setSaving(false); }
  }
  return <div>
    <div style={effectiveEnabled ? styles.enabled : styles.disabled}>{effectiveEnabled ? "Enabled" : "Disabled"} · {source}</div>
    {canManage ? <div style={styles.actions}>
      <button type="button" disabled={saving} onClick={() => update(!effectiveEnabled)} style={styles.button}>{saving ? "Saving…" : effectiveEnabled ? "Disable for organisation" : "Enable for organisation"}</button>
      {overrideEnabled != null ? <button type="button" disabled={saving} onClick={() => update(null)} style={styles.resetButton}>Use plan default ({planDefaultEnabled ? "enabled" : "disabled"})</button> : null}
    </div> : null}
    {error ? <div style={styles.error}>{error}</div> : null}
  </div>;
}

const styles = {
  enabled: { color: "#166534", fontSize: 13, fontWeight: 900 },
  disabled: { color: "#64748b", fontSize: 13, fontWeight: 900 },
  actions: { display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" },
  button: { border: "1px solid #94a3b8", borderRadius: 6, padding: "6px 8px", background: "#ffffff", color: "#172033", cursor: "pointer", fontSize: 12, fontWeight: 800 },
  resetButton: { border: 0, padding: "6px 2px", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 11, fontWeight: 700, textDecoration: "underline" },
  error: { color: "#991b1b", fontSize: 12, marginTop: 5, maxWidth: 220 }
};
