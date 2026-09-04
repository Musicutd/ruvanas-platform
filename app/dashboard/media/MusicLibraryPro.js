"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./media-library.module.css";

const USE_LABELS = {
  RETAIL_RADIO: "In-house / Retail Radio",
  SCHOOL_RADIO: "School Radio",
  ONLINE_RADIO: "Online Radio"
};

const STATUS_LABELS = {
  DRAFT: "Draft declaration",
  IN_REVIEW: "With Ruvanas",
  APPROVED: "Approved to programme",
  REJECTED: "Changes requested"
};

function dateLabel(value) {
  return value ? new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Open-ended";
}

export default function MusicLibraryPro() {
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [submittingId, setSubmittingId] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch("/api/media/music", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load your music library.");
    setLibrary(payload);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/media/music", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load your music library.");
        if (!cancelled) setLibrary(payload);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totals = useMemo(() => ({
    all: library?.tracks.length || 0,
    review: library?.tracks.filter((track) => track.rightsReviewStatus === "IN_REVIEW").length || 0,
    approved: library?.tracks.filter((track) => track.rightsReviewStatus === "APPROVED").length || 0
  }), [library]);

  async function upload(event) {
    event.preventDefault();
    setWorking(true); setError(""); setNotice("");
    try {
      const form = event.currentTarget;
      const file = form.file.files?.[0];
      if (!file) throw new Error("Choose a music file before uploading.");
      const formData = new FormData(form);
      const response = await fetch("/api/media/music", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The music upload could not be completed.");
      setNotice(`${payload.track.artist} — ${payload.track.title} is stored privately. Listen to it, then submit the rights declaration.`);
      form.reset(); setFileName("");
      await load();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally { setWorking(false); }
  }

  async function submit(trackId) {
    setSubmittingId(trackId); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/media/music/${trackId}/submit`, { method: "PATCH" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The track could not be submitted.");
      setNotice("Rights declaration submitted. Ruvanas will review it before this music can enter programming.");
      await load();
    } catch (submitError) {
      setError(submitError.message);
    } finally { setSubmittingId(""); }
  }

  if (loading) return <section className={styles.uploadPanel}><p className={styles.panelIntro}>Loading Media Library Pro…</p></section>;
  if (!library) return <section className={styles.uploadPanel}><div className={styles.error}>{error || "Music library unavailable."}</div></section>;

  return (
    <section className={styles.musicPro} aria-labelledby="music-pro-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>MEDIA LIBRARY PRO</p><h2 id="music-pro-title">Organisation music</h2></div>
        <button type="button" className={styles.textButton} onClick={load}>Refresh</button>
      </div>
      <p className={styles.panelIntro}>Upload music your organisation is authorised to use. Every recording stays private and unavailable to programming until its rights declaration is approved.</p>
      <div className={styles.musicMetrics} aria-label="Organisation music summary">
        <span><strong>{totals.all}</strong> tracks</span><span><strong>{totals.review}</strong> in review</span><span><strong>{totals.approved}</strong> approved</span>
      </div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      {library.permissions.canUpload ? (
        <details className={styles.musicUpload}>
          <summary>Upload organisation music</summary>
          <form onSubmit={upload} className={styles.form}>
            <label><span>Music file</span><input type="file" name="file" accept="audio/*" required disabled={working} onChange={(event) => setFileName(event.target.files?.[0]?.name || "")} /><small>{fileName || "MP3, WAV, M4A or supported audio · maximum 100 MB"}</small></label>
            <div className={styles.columns}>
              <label><span>Track title</span><input name="title" required maxLength="200" /></label>
              <label><span>Artist</span><input name="artist" required maxLength="200" /></label>
              <label><span>Album <em>optional</em></span><input name="album" maxLength="200" /></label>
              <label><span>Release year <em>optional</em></span><input name="releaseYear" type="number" min="1877" max="2200" /></label>
              <label><span>Duration in seconds <em>optional</em></span><input name="durationSeconds" type="number" min="1" max="86400" /></label>
              <label className={styles.checkLine}><input name="isExplicit" type="checkbox" /><span>Contains explicit content</span></label>
            </div>
            <div className={styles.rightsBox}>
              <h3>Rights declaration</h3>
              <p>This records your declaration and supports Ruvanas review. It does not grant or replace a licence.</p>
              <div className={styles.columns}>
                <label><span>Rights holder</span><input name="rightsHolder" required maxLength="200" /></label>
                <label><span>Licence / agreement reference</span><input name="rightsReference" required maxLength="500" /></label>
                <label><span>Rights basis</span><select name="rightsBasis" defaultValue="DIRECT_LICENCE"><option value="OWNED_MASTER">We own/control the master</option><option value="DIRECT_LICENCE">Direct licence</option><option value="DISTRIBUTOR_LICENCE">Distributor licence</option><option value="OTHER">Other documented permission</option></select></label>
                <label><span>Permitted territories</span><input name="permittedTerritories" required placeholder="Worldwide, or MT, GB…" maxLength="500" /></label>
                <label><span>Licence starts <em>optional</em></span><input name="licenceStartsAt" type="date" /></label>
                <label><span>Licence expires <em>optional</em></span><input name="licenceExpiresAt" type="date" /></label>
              </div>
              <fieldset className={styles.useCases}><legend>Permitted Ruvanas services</legend>{Object.entries(USE_LABELS).map(([value, label]) => <label key={value}><input type="checkbox" name="permittedUses" value={value} defaultChecked /><span>{label}</span></label>)}</fieldset>
              <label className={styles.declaration}><input type="checkbox" name="rightsConfirmed" required /><span>I confirm that this organisation has documented authority to store and use this recording for the selected services and territories.</span></label>
            </div>
            <button type="submit" disabled={working || !fileName}>{working ? "Uploading securely…" : "Upload private music draft"}</button>
          </form>
        </details>
      ) : <div className={styles.readOnly}>You can view organisation music. An owner, manager or content editor can upload and submit it.</div>}

      <div className={styles.musicList}>
        {library.tracks.map((track) => (
          <article className={styles.musicCard} key={track.id}>
            <div className={styles.assetHeading}><div><span className={styles.type}>{track.artist}</span><h3>{track.title}</h3><p>{track.album || "Single / no album"}{track.isExplicit ? " · Explicit" : ""}</p></div><span className={`${styles.status} ${styles[`status${track.rightsReviewStatus}`] || ""}`}>{STATUS_LABELS[track.rightsReviewStatus]}</span></div>
            <div className={styles.musicDetails}>
              <span><strong>Rights holder</strong>{track.rightsHolder}</span><span><strong>Reference</strong>{track.rightsReference}</span><span><strong>Territories</strong>{track.permittedTerritories}</span><span><strong>Window</strong>{dateLabel(track.licenceStartsAt)} – {dateLabel(track.licenceExpiresAt)}</span>
            </div>
            <div className={styles.usePills}>{track.permittedUses.map((use) => <span key={use}>{USE_LABELS[use]}</span>)}</div>
            {track.rightsReviewNotes ? <div className={styles.reviewNote}><strong>Ruvanas review note</strong><span>{track.rightsReviewNotes}</span></div> : null}
            <audio controls preload="none" src={track.file.previewUrl}>Your browser does not support secure audio preview.</audio>
            {library.permissions.canSubmit && ["DRAFT", "REJECTED"].includes(track.rightsReviewStatus) ? <button className={styles.primaryButton} type="button" disabled={submittingId === track.id} onClick={() => submit(track.id)}>{submittingId === track.id ? "Submitting…" : "Submit rights for Ruvanas review"}</button> : null}
          </article>
        ))}
        {!library.tracks.length ? <div className={styles.empty}><strong>No organisation music yet</strong><span>Upload rights-cleared music above. The Ruvanas catalogue remains separate.</span></div> : null}
      </div>
    </section>
  );
}
