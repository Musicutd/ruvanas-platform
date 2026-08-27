"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MusicModeStatusButton({ modeId, status, trackCount }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nextStatus = status === "ACTIVE" ? "ARCHIVED" : "ACTIVE";

  async function update() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/admin/music-modes/${modeId}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the music mode.");
      router.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update the music mode.");
    } finally { setSaving(false); }
  }

  return <div><button type="button" disabled={saving || (nextStatus === "ACTIVE" && trackCount === 0)} onClick={update} style={{border:"1px solid #94a3b8",borderRadius:6,padding:"7px 10px",fontWeight:800,background:"#fff",cursor:"pointer"}}>{saving ? "Saving…" : nextStatus === "ACTIVE" ? "Activate" : "Archive"}</button>{error ? <div style={{color:"#991b1b",fontSize:12,marginTop:5}}>{error}</div> : null}</div>;
}
