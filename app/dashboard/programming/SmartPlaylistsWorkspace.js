"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./programming.module.css";

const EMPTY_RULE = { field: "GENRE", operator: "IS", value: "" };
const DEFAULT_FORM = {
  name: "",
  description: "",
  maxTracks: 250,
  defaultWeight: 100,
  sort: "ARTIST_TITLE",
  rightsUse: "ONLINE_RADIO",
  territory: "Worldwide",
  rules: [{ ...EMPTY_RULE }]
};
const FIELD_LABELS = {
  GENRE: "Genre",
  ARTIST: "Artist",
  ALBUM: "Album",
  RELEASE_YEAR: "Release year",
  EXPLICIT: "Content rating",
  LIBRARY_TYPE: "Music library"
};
const OPERATORS = {
  GENRE: [["IS", "is"], ["IS_NOT", "is not"]],
  ARTIST: [["IS", "is"], ["IS_NOT", "is not"], ["CONTAINS", "contains"]],
  ALBUM: [["IS", "is"], ["IS_NOT", "is not"], ["CONTAINS", "contains"]],
  RELEASE_YEAR: [["IS", "is"], ["AT_LEAST", "is at least"], ["AT_MOST", "is at most"]],
  EXPLICIT: [["IS", "is"]],
  LIBRARY_TYPE: [["IS", "is"]]
};

function valueControl(rule, onChange) {
  if (rule.field === "EXPLICIT") {
    return <select value={rule.value} onChange={(event) => onChange(event.target.value)}><option value="">Choose</option><option value="false">Clean</option><option value="true">Explicit</option></select>;
  }
  if (rule.field === "LIBRARY_TYPE") {
    return <select value={rule.value} onChange={(event) => onChange(event.target.value)}><option value="">Choose</option><option value="RUVANAS_CATALOGUE">Ruvanas catalogue</option><option value="ORGANISATION_MUSIC">Organisation music</option></select>;
  }
  return <input value={rule.value} type={rule.field === "RELEASE_YEAR" ? "number" : "text"} min={rule.field === "RELEASE_YEAR" ? 1877 : undefined} max={rule.field === "RELEASE_YEAR" ? 2200 : undefined} placeholder={rule.field === "GENRE" ? "e.g. Pop" : rule.field === "ARTIST" ? "e.g. Artist name" : rule.field === "ALBUM" ? "e.g. Album title" : "e.g. 2020"} onChange={(event) => onChange(event.target.value)} />;
}

function statusLabel(playlist) {
  if (playlist.status === "DRAFT") return "Draft — not live";
  if (playlist.needsPublish) return "Changes need publishing";
  return "Live in rotation";
}

export default function SmartPlaylistsWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editingId, setEditingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/programming/smart-playlists", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load Smart Playlists.");
      setData(payload);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => { load(); }, []);
  const playlists = data?.playlists || [];
  const selected = useMemo(() => playlists.find((playlist) => playlist.id === editingId) || null, [playlists, editingId]);

  function resetForm() {
    setEditingId(null);
    setPreview(null);
    setForm({ ...DEFAULT_FORM, rules: [{ ...EMPTY_RULE }] });
  }

  function edit(playlist) {
    setEditingId(playlist.id);
    setPreview(null);
    setNotice("");
    setForm({
      name: playlist.name,
      description: playlist.description || "",
      maxTracks: playlist.maxTracks,
      defaultWeight: playlist.defaultWeight,
      sort: playlist.sort,
      rightsUse: playlist.rightsUse,
      territory: playlist.territory || "",
      rules: playlist.rules.map(({ field, operator, value }) => ({ field, operator, value }))
    });
  }

  function updateRule(index, field, value) {
    setForm((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) => {
        if (ruleIndex !== index) return rule;
        if (field === "field") return { field: value, operator: OPERATORS[value][0][0], value: "" };
        return { ...rule, [field]: value };
      })
    }));
  }

  async function save(event) {
    event.preventDefault();
    setError(""); setNotice(""); setPreview(null); setBusy("save");
    try {
      const response = await fetch(editingId ? `/api/programming/smart-playlists/${editingId}` : "/api/programming/smart-playlists", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the Smart Playlist.");
      setEditingId(payload.playlist.id);
      setNotice(editingId ? "Rules saved. Preview and publish the new version when ready." : "Draft created. Preview it before publishing.");
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy("");
    }
  }

  async function previewPlaylist(id) {
    setError(""); setNotice(""); setBusy(`preview:${id}`);
    try {
      const response = await fetch(`/api/programming/smart-playlists/${id}/preview`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to preview this Smart Playlist.");
      setPreview(payload);
      setEditingId(id);
    } catch (previewError) {
      setError(previewError.message);
    } finally {
      setBusy("");
    }
  }

  async function action(id, actionName) {
    setError(""); setNotice(""); setBusy(`${actionName}:${id}`);
    try {
      const response = await fetch(`/api/programming/smart-playlists/${id}/${actionName}`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Unable to ${actionName} this Smart Playlist.`);
      setNotice(actionName === "publish" ? `${payload.playlist.trackCount} eligible tracks are now feeding the live music mode.` : "Smart Playlist archived and removed from live use.");
      if (actionName === "archive") resetForm();
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="smart-playlists-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>SMART PLAYLISTS</p><h2 id="smart-playlists-title">Build a rotation from clear rules</h2></div>
        <span className={styles.count}>{playlists.length} saved</span>
      </div>
      <p className={styles.panelIntro}>Choose rules once and Ruvanas builds an explainable music mode from tracks that are ready, approved and cleared for the selected service. Rule changes never affect live playback until an owner or manager publishes them.</p>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      {playlists.length ? <div className={styles.smartPlaylistGrid}>{playlists.map((playlist) => (
        <article className={`${styles.smartPlaylistCard} ${editingId === playlist.id ? styles.selectedCard : ""}`} key={playlist.id}>
          <div className={styles.smartPlaylistTitle}><div><strong>{playlist.name}</strong><span>{statusLabel(playlist)}</span></div><span className={playlist.status === "ACTIVE" && !playlist.needsPublish ? styles.publishedBadge : styles.draftBadge}>{playlist.status === "ACTIVE" && !playlist.needsPublish ? "LIVE" : "REVIEW"}</span></div>
          <p>{playlist.rules.map((rule) => `${FIELD_LABELS[rule.field]} ${rule.operator.toLowerCase().replaceAll("_", " ")} ${String(rule.value).replaceAll("_", " ")}`).join(" · ")}</p>
          <small>{playlist.trackCount} live tracks · maximum {playlist.maxTracks} · {playlist.rightsUse.replaceAll("_", " ").toLowerCase()}</small>
          <div className={styles.cardActions}>
            {data.canAuthor ? <button type="button" className={styles.secondaryButton} onClick={() => edit(playlist)}>Edit rules</button> : null}
            <button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => previewPlaylist(playlist.id)}>{busy === `preview:${playlist.id}` ? "Checking…" : "Preview matches"}</button>
            {data.canPublish && (playlist.status === "DRAFT" || playlist.needsPublish) ? <button type="button" className={styles.primaryButton} disabled={busy !== ""} onClick={() => action(playlist.id, "publish")}>{busy === `publish:${playlist.id}` ? "Publishing…" : "Publish to rotation"}</button> : null}
            {data.canPublish ? <button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => action(playlist.id, "archive")}>Archive</button> : null}
          </div>
        </article>
      ))}</div> : <div className={styles.emptyState}>No Smart Playlists yet. Create a draft below, preview the matching tracks and publish it when the selection looks right.</div>}

      {data?.canAuthor ? <form className={styles.smartPlaylistForm} onSubmit={save}>
        <div className={styles.smartFormHeader}><div><h3>{selected ? `Edit ${selected.name}` : "Create a Smart Playlist"}</h3><p>All rules must match. Rights and availability checks are always applied afterwards.</p></div>{editingId ? <button type="button" className={styles.secondaryButton} onClick={resetForm}>Create another</button> : null}</div>
        <div className={styles.formGrid}>
          <label><span>Name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Clean upbeat pop" /></label>
          <label><span>Purpose</span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Where and when this rotation is used" /></label>
          <label><span>Cleared service</span><select value={form.rightsUse} onChange={(event) => setForm({ ...form, rightsUse: event.target.value })}><option value="ONLINE_RADIO">Online Radio</option><option value="RETAIL_RADIO">Retail Radio</option><option value="SCHOOL_RADIO">School Radio</option></select></label>
          <label><span>Territory</span><input value={form.territory} onChange={(event) => setForm({ ...form, territory: event.target.value })} placeholder="Worldwide or country code" /></label>
          <label><span>Maximum tracks</span><input type="number" min="1" max="1000" value={form.maxTracks} onChange={(event) => setForm({ ...form, maxTracks: event.target.value })} /></label>
          <label><span>Rotation weight</span><input type="number" min="1" max="1000" value={form.defaultWeight} onChange={(event) => setForm({ ...form, defaultWeight: event.target.value })} /></label>
          <label><span>Order</span><select value={form.sort} onChange={(event) => setForm({ ...form, sort: event.target.value })}><option value="ARTIST_TITLE">Artist and title</option><option value="RELEASE_YEAR_DESC">Newest release first</option><option value="RELEASE_YEAR_ASC">Oldest release first</option><option value="RECENTLY_ADDED">Recently added</option></select></label>
        </div>
        <div className={styles.ruleHeader}><h3>Matching rules</h3><button type="button" className={styles.secondaryButton} disabled={form.rules.length >= 12} onClick={() => setForm({ ...form, rules: [...form.rules, { ...EMPTY_RULE }] })}>Add rule</button></div>
        <div className={styles.ruleList}>{form.rules.map((rule, index) => <div className={styles.ruleRow} key={index}>
          <select aria-label={`Rule ${index + 1} field`} value={rule.field} onChange={(event) => updateRule(index, "field", event.target.value)}>{Object.entries(FIELD_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select aria-label={`Rule ${index + 1} comparison`} value={rule.operator} onChange={(event) => updateRule(index, "operator", event.target.value)}>{OPERATORS[rule.field].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          {valueControl(rule, (value) => updateRule(index, "value", value))}
          <button type="button" className={styles.removeButton} disabled={form.rules.length === 1} onClick={() => setForm({ ...form, rules: form.rules.filter((_, ruleIndex) => ruleIndex !== index) })}>Remove</button>
        </div>)}</div>
        <div className={styles.actionBar}><span className={styles.safeClaim}>Draft → preview → owner/manager publish</span><button className={styles.primaryButton} disabled={busy !== ""}>{busy === "save" ? "Saving…" : editingId ? "Save new rule version" : "Create draft"}</button></div>
      </form> : <div className={styles.readOnlyMessage}>You can preview Smart Playlists. An owner, manager or content editor can change the rules.</div>}

      {preview ? <div className={styles.smartPreview}>
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>EXPLAINABLE PREVIEW</p><h3>{preview.count} playable tracks match</h3></div><span className={styles.count}>Checked {new Date(preview.generatedAt).toLocaleString()}</span></div>
        {preview.tracks.length ? <div className={styles.previewTrackList}>{preview.tracks.map((track) => <div className={styles.previewTrack} key={track.id}><div><strong>{track.artist} — {track.title}</strong><span>{[track.album, track.releaseYear, track.libraryType.replaceAll("_", " ")].filter(Boolean).join(" · ")}</span></div><small>{track.explanations.join(" · ")}</small></div>)}</div> : <div className={styles.emptyState}>No eligible tracks match. Adjust the rules or complete the track rights review before publishing.</div>}
      </div> : null}
    </section>
  );
}
