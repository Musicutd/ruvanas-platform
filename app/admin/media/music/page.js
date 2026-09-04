"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const labels = {
  DRAFT: "Draft",
  IN_REVIEW: "Awaiting review",
  APPROVED: "Approved",
  REJECTED: "Changes requested"
};

export default function AdminOrganisationMusicPage() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/media/music", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load the review queue.");
      setTracks(payload.tracks || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function review(track, decision) {
    const notes = window.prompt(
      decision === "REJECT" ? "Explain what must be corrected:" : "Optional internal review note:",
      ""
    );
    if (notes === null || (decision === "REJECT" && !notes.trim())) return;
    setWorkingId(track.id); setError("");
    try {
      const response = await fetch(`/api/admin/media/music/${track.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The review decision could not be saved.");
      await load();
    } catch (reviewError) {
      setError(reviewError.message);
    } finally { setWorkingId(""); }
  }

  return (
    <main style={s.page}>
      <header style={s.header}>
        <div><p style={s.eyebrow}>MEDIA LIBRARY PRO</p><h1 style={s.title}>Organisation music rights</h1><p style={s.intro}>Review subscriber declarations before organisation-owned music becomes available to programming. Approval records evidence; it does not grant a licence.</p></div>
        <div style={s.actions}><Link href="/admin/media" style={s.secondary}>Promo Library</Link><Link href="/admin/catalogue" style={s.secondary}>Ruvanas Catalogue</Link></div>
      </header>
      <section style={s.safety}><strong>Review checklist</strong><span>Confirm the named rights holder, agreement reference, territories, permitted Ruvanas services and active licence window. Request changes when evidence is incomplete.</span></section>
      {error ? <div style={s.error}>{error}</div> : null}
      {loading ? <p>Loading music rights…</p> : tracks.length === 0 ? <section style={s.empty}><h2>No organisation music yet</h2><p>Subscriber music submitted through Media Library Pro will appear here.</p></section> : (
        <div style={s.list}>{tracks.map((track) => (
          <article style={s.card} key={track.id}>
            <div style={s.cardTop}><div><span style={s.organisation}>{track.organisation?.name || "Unknown organisation"}</span><h2 style={s.track}>{track.artist} — {track.title}</h2><p style={s.muted}>{track.file.originalName} · {track.file.durationSeconds ? `${track.file.durationSeconds}s` : "duration pending"}</p></div><span style={{...s.badge,...(track.rightsReviewStatus === "APPROVED" ? s.good : track.rightsReviewStatus === "REJECTED" ? s.bad : s.waiting)}}>{labels[track.rightsReviewStatus]}</span></div>
            <div style={s.grid}><span><strong>Basis</strong>{track.rightsBasis?.replaceAll("_", " ")}</span><span><strong>Rights holder</strong>{track.rightsHolder}</span><span><strong>Reference</strong>{track.rightsReference}</span><span><strong>Territories</strong>{track.permittedTerritories}</span><span><strong>Permitted services</strong>{track.permittedUses.map((use) => use.replaceAll("_", " ")).join(", ")}</span><span><strong>Licence window</strong>{track.licenceStartsAt || "Open"} to {track.licenceExpiresAt || "Open"}</span></div>
            {track.rightsReviewNotes ? <div style={s.note}><strong>Review note</strong>{track.rightsReviewNotes}</div> : null}
            <audio controls preload="none" src={track.file.previewUrl} style={s.audio}>Secure audio preview unavailable.</audio>
            {track.rightsReviewStatus === "IN_REVIEW" ? <div style={s.actions}><button disabled={workingId === track.id} onClick={() => review(track, "APPROVE")} style={s.approve}>Approve for programming</button><button disabled={workingId === track.id} onClick={() => review(track, "REJECT")} style={s.reject}>Request changes</button></div> : null}
          </article>
        ))}</div>
      )}
    </main>
  );
}

const s = {
  page:{maxWidth:1240,margin:"0 auto",padding:"40px 18px 70px",color:"#172033"},header:{display:"flex",justifyContent:"space-between",gap:24,alignItems:"flex-start",flexWrap:"wrap"},eyebrow:{margin:"0 0 8px",color:"#9a6400",fontSize:12,fontWeight:950,letterSpacing:1.3},title:{margin:0,fontSize:36},intro:{maxWidth:760,color:"#526075",lineHeight:1.6},actions:{display:"flex",gap:9,flexWrap:"wrap"},secondary:{border:"1px solid #64748b",borderRadius:8,color:"#172033",padding:"9px 12px",fontWeight:850,textDecoration:"none"},safety:{display:"grid",gap:5,margin:"22px 0",borderLeft:"5px solid #f4b942",borderRadius:8,background:"#fff8e7",padding:16,lineHeight:1.5},error:{margin:"16px 0",border:"1px solid #fca5a5",borderRadius:8,background:"#fef2f2",color:"#991b1b",padding:14},empty:{border:"1px dashed #94a3b8",borderRadius:12,background:"#f8fafc",padding:24},list:{display:"grid",gap:18},card:{display:"grid",gap:16,border:"1px solid #cbd5e1",borderRadius:13,background:"#f8fafc",padding:20,boxShadow:"0 3px 10px rgba(15,23,42,.06)"},cardTop:{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"},organisation:{color:"#9a6400",fontSize:12,fontWeight:950,textTransform:"uppercase"},track:{margin:"5px 0",fontSize:22},muted:{margin:0,color:"#64748b"},badge:{borderRadius:999,padding:"7px 10px",fontSize:11,fontWeight:950},good:{background:"#dcfce7",color:"#166534"},bad:{background:"#fee2e2",color:"#991b1b"},waiting:{background:"#fef3c7",color:"#92400e"},grid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,border:"1px solid #e2e8f0",borderRadius:9,background:"#fff",padding:14},note:{display:"grid",gap:5,borderLeft:"4px solid #f97316",background:"#fff7ed",padding:12},audio:{width:"min(100%,620px)"},approve:{border:0,borderRadius:7,background:"#166534",color:"#fff",padding:"10px 13px",fontWeight:900,cursor:"pointer"},reject:{border:"1px solid #dc2626",borderRadius:7,background:"#fff",color:"#b91c1c",padding:"10px 13px",fontWeight:900,cursor:"pointer"}
};
