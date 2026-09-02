"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmActionButton from "@/app/components/ConfirmActionButton";
import { confirmationCopy, safeInterfaceMessage } from "@/lib/interface-guidance.mjs";

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
      setError(safeInterfaceMessage(updateError instanceof Error ? updateError.message : "", "Unable to update the music mode."));
    } finally { setSaving(false); }
  }

  const buttonStyle = {border:"1px solid #94a3b8",borderRadius:6,padding:"7px 10px",fontWeight:800,background:"#fff",cursor:"pointer"};
  return <div>{nextStatus === "ARCHIVED" ? <ConfirmActionButton disabled={saving} onConfirm={update} style={buttonStyle} {...confirmationCopy("ARCHIVE_MUSIC_MODE", "This music mode")}>{saving ? "Saving…" : "Archive"}</ConfirmActionButton> : <button type="button" disabled={saving || trackCount === 0} onClick={update} style={buttonStyle}>{saving ? "Saving…" : "Activate"}</button>}{error ? <div role="alert" style={{color:"#991b1b",fontSize:12,marginTop:5}}>{error}</div> : null}</div>;
}
