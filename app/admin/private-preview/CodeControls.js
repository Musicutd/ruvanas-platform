"use client";

import { useState } from "react";

const endpoint = "/api/admin/private-preview/codes";

export default function CodeControls() {
  const [email, setEmail] = useState("");
  const [issued, setIssued] = useState(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function changeAccess(action) {
    if (working) return;
    const target = email.trim().toLowerCase();
    if (!target) return;
    if (action === "revoke" && !window.confirm("Revoke this account's pending codes and code-based sessions?")) return;
    setIssued(null);
    setMessage("");
    setWorking(true);
    try {
      const response = await fetch(endpoint, {
        method: action === "issue" ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: target }),
        credentials: "same-origin",
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error || "Unable to update private preview access.");
        return;
      }
      if (action === "issue") {
        setIssued({ code: result.code, email: result.email, expiresAt: result.expiresAt });
        setMessage("Code issued. Copy it now; it will not be shown again after leaving this page.");
      } else {
        setMessage(`Access revoked: ${result.pendingRevokedCount} pending code(s) and ${result.sessionsRevokedCount} session(s).`);
      }
    } catch {
      setMessage("Unable to update private preview access.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div style={{ border: "1px solid #42526b", borderRadius: 12, padding: 24, marginTop: 24 }}>
      <label htmlFor="preview-target-email" style={{ display: "block", fontWeight: 700 }}>Existing allowed account email</label>
      <input id="preview-target-email" type="email" autoComplete="email" required maxLength={254}
        value={email} onChange={(event) => setEmail(event.target.value)}
        style={{ display: "block", width: "100%", maxWidth: 440, marginTop: 8, padding: 10 }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
        <button type="button" disabled={working || !email.trim()} onClick={() => changeAccess("issue")}>Issue one-use code</button>
        <button type="button" disabled={working || !email.trim()} onClick={() => changeAccess("revoke")}>Revoke codes and sessions</button>
      </div>
      {message ? <p role="status" aria-live="polite">{message}</p> : null}
      {issued ? <div style={{ marginTop: 20, padding: 16, border: "1px solid #f4b942", borderRadius: 8 }}>
        <strong>Copy this code now and send it privately. It is displayed only this once.</strong>
        <p>For {issued.email}; expires {new Date(issued.expiresAt).toLocaleString()}.</p>
        <code style={{ display: "block", overflowWrap: "anywhere", userSelect: "all", fontSize: "1.1rem" }}>{issued.code}</code>
      </div> : null}
    </div>
  );
}
