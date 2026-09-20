"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChannelRightsProfile({ channelId }) {
  const router = useRouter();
  const [musicRightsUse, setMusicRightsUse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function classify() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/channels/${channelId}/rights-profile`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ musicRightsUse })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the rights profile.");
      router.refresh();
    } catch (issue) { setError(issue.message); }
    finally { setBusy(false); }
  }

  return <div>
    <select aria-label="Music-rights profile" value={musicRightsUse} disabled={busy} onChange={(event) => setMusicRightsUse(event.target.value)}>
      <option value="">Classify pillar…</option>
      <option value="RETAIL_RADIO">Retail</option><option value="SCHOOL_RADIO">School</option>
      <option value="ONLINE_RADIO">Online Radio</option><option value="HEALTH_RADIO">Health</option>
      <option value="FAITH_RADIO">Faith</option><option value="ORGANISATIONS_RADIO">Organisations</option>
    </select>
    <button type="button" disabled={busy || !musicRightsUse} onClick={classify}>Save</button>
    {error ? <small role="alert">{error}</small> : null}
  </div>;
}
