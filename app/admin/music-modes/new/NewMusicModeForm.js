"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function NewMusicModeForm({ organisations, tracks }) {
  const router = useRouter();
  const [form, setForm] = useState({ organisationId:"", name:"", slug:"", description:"" });
  const [selected, setSelected] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);
  const availableTracks = useMemo(() => tracks.filter((track) =>
    track.mediaAsset.libraryType === "RUVANAS_CATALOGUE" ||
    track.mediaAsset.organisationId === form.organisationId
  ), [form.organisationId, tracks]);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    if (event.target.name === "organisationId") setSelected({});
  }

  function toggleTrack(trackId) {
    setSelected((current) => ({ ...current, [trackId]: current[trackId] ? undefined : 100 }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/music-modes", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ ...form, tracks:Object.entries(selected).filter(([,weight]) => weight).map(([trackId,weight]) => ({trackId,weight})) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create the music mode.");
      router.push("/admin/music-modes"); router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create the music mode.");
    } finally { setSaving(false); }
  }

  return (
    <main style={styles.page}>
      <p style={styles.eyebrow}>Radio Control</p><h1 style={styles.title}>Create music mode</h1>
      <p style={styles.description}>Start with a draft programming profile. An empty draft is safe when no rights-cleared catalogue tracks are available yet.</p>
      {error ? <div style={styles.error}>{error}</div> : null}
      <form onSubmit={submit} style={styles.form}>
        <label style={styles.label}>Organisation<select required name="organisationId" value={form.organisationId} onChange={updateField} style={styles.input}><option value="">Choose an organisation</option>{organisations.map((organisation)=><option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}</select></label>
        <label style={styles.label}>Name<input required maxLength={120} name="name" value={form.name} onChange={updateField} style={styles.input} /></label>
        <label style={styles.label}>Slug (optional)<input maxLength={120} name="slug" value={form.slug} onChange={updateField} placeholder="generated-from-name" style={styles.input} /></label>
        <label style={styles.label}>Description<textarea maxLength={500} name="description" value={form.description} onChange={updateField} rows={4} style={styles.input} /></label>
        <fieldset style={styles.fieldset}><legend style={styles.legend}>Approved tracks ({selectedCount} selected)</legend>
          {!form.organisationId ? <p style={styles.empty}>Choose an organisation to see its approved music and the shared Ruvanas catalogue.</p> : availableTracks.length === 0 ? <p style={styles.empty}>No rights-cleared music is ready. You can still save this mode as a draft.</p> : availableTracks.map((track)=><label key={track.id} style={styles.track}><input type="checkbox" checked={Boolean(selected[track.id])} onChange={()=>toggleTrack(track.id)} /><span><strong>{track.artist} — {track.title}</strong>{track.isExplicit ? " (explicit)" : ""}<small>{track.mediaAsset.libraryType === "ORGANISATION_MUSIC" ? " · Organisation music" : " · Ruvanas catalogue"}</small></span></label>)}
        </fieldset>
        <div style={styles.actions}><button disabled={saving} style={styles.button}>{saving ? "Creating…" : "Create draft mode"}</button><Link href="/admin/music-modes">Cancel</Link></div>
      </form>
    </main>
  );
}

const styles={page:{maxWidth:760,margin:"0 auto",padding:"40px 16px 64px",color:"#172033"},eyebrow:{margin:"0 0 8px",color:"#9a6400",fontWeight:900,textTransform:"uppercase"},title:{margin:0,fontSize:32},description:{color:"#475569",lineHeight:1.55},error:{padding:12,background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:7,color:"#991b1b"},form:{display:"grid",gap:18,marginTop:24,padding:24,border:"1px solid #cbd5e1",borderRadius:12,background:"#f8fafc"},label:{display:"grid",gap:7,fontWeight:800},input:{padding:10,border:"1px solid #94a3b8",borderRadius:7,font:"inherit",background:"#fff"},fieldset:{border:"1px solid #cbd5e1",borderRadius:8,padding:16},legend:{fontWeight:900},track:{display:"flex",gap:10,alignItems:"center",padding:"7px 0"},empty:{margin:0,color:"#64748b"},actions:{display:"flex",alignItems:"center",gap:16},button:{border:0,borderRadius:7,background:"#f4b942",color:"#172033",padding:"11px 15px",fontWeight:900,cursor:"pointer"}};

