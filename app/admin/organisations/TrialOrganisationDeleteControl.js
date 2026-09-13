"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TrialOrganisationDeleteControl({ organisationId, organisationName, organisationSlug, subscriptionStatus, canManage }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const required = `DELETE ${organisationSlug}`;
  const eligible = !subscriptionStatus || subscriptionStatus === "TRIAL";

  if (!canManage) return <span style={styles.muted}>Super Admin only</span>;
  if (!eligible) return <span style={styles.protected}>Protected paid account</span>;

  async function removeOrganisation() {
    if (working || confirmation !== required) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/organisations/${organisationId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to delete the trial organisation.");
      router.refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to delete the trial organisation.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      {!open ? (
        <button type="button" style={styles.openButton} onClick={() => setOpen(true)}>Delete test organisation</button>
      ) : (
        <div style={styles.confirmPanel}>
          <strong>Delete {organisationName}?</strong>
          <span>This removes the organisation and its tenant data. User accounts remain.</span>
          <label style={styles.label}>Type <code>{required}</code>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck="false" style={styles.input} />
          </label>
          <div style={styles.actions}>
            <button type="button" style={styles.deleteButton} disabled={confirmation !== required || working} onClick={removeOrganisation}>{working ? "Deleting…" : "Delete permanently"}</button>
            <button type="button" style={styles.cancelButton} disabled={working} onClick={() => { setOpen(false); setConfirmation(""); setError(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {error ? <span style={styles.error} role="alert">{error}</span> : null}
    </div>
  );
}

const styles = {
  wrapper: { display: "grid", gap: 7, minWidth: 230 },
  openButton: { border: "1px solid #dc6b62", borderRadius: 7, background: "#fff", color: "#9f1d16", padding: "7px 9px", fontSize: 12, fontWeight: 850, cursor: "pointer" },
  confirmPanel: { display: "grid", gap: 8, padding: 10, border: "1px solid #dc6b62", borderRadius: 8, background: "#fff7f6", color: "#5f1712", fontSize: 11, lineHeight: 1.4 },
  label: { display: "grid", gap: 5, fontWeight: 800 },
  input: { width: "100%", minHeight: 34, boxSizing: "border-box", border: "1px solid #b9c2cf", borderRadius: 6, padding: "5px 7px", font: "inherit" },
  actions: { display: "flex", gap: 6, flexWrap: "wrap" },
  deleteButton: { border: 0, borderRadius: 6, background: "#b42318", color: "#fff", padding: "7px 8px", fontSize: 11, fontWeight: 900, cursor: "pointer" },
  cancelButton: { border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", color: "#334155", padding: "7px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer" },
  error: { color: "#991b1b", fontSize: 11, fontWeight: 750 },
  protected: { color: "#64748b", fontSize: 11, fontWeight: 750 },
  muted: { color: "#64748b", fontSize: 11 }
};
