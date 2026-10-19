"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./media-library.module.css";
import ux from "./music-library-pro.module.css";

const USE_LABELS = {
  RETAIL_RADIO: "In-house / Retail Radio",
  SCHOOL_RADIO: "School Radio",
  ONLINE_RADIO: "Online Radio",
  HEALTH_RADIO: "Health Radio",
  FAITH_RADIO: "Faith Radio",
  ORGANISATIONS_RADIO: "Ruvanas Organisations"
};

const STATUS_LABELS = {
  DRAFT: "Draft · not submitted",
  IN_REVIEW: "Awaiting review",
  APPROVED: "Rights approved",
  REJECTED: "Changes requested"
};

const STATUS_HELP = {
  DRAFT: "Check the recording and declaration, then submit it for review.",
  IN_REVIEW: "Your declaration is with Ruvanas. It is not yet available for programming.",
  APPROVED: "Rights have been reviewed. Scheduling still checks the licence dates, territory and permitted service.",
  REJECTED: "Read the review note before resubmitting. Ask your administrator if the declaration needs correcting."
};

function searchKey(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export function filterOrganisationMusicTracks(tracks, { query = "", status = "ALL", use = "ALL" } = {}) {
  const words = searchKey(query).trim().split(/\s+/).filter(Boolean);
  return tracks.filter((track) => {
    const statusMatches = status === "ALL" || (status === "NEEDS_ACTION"
      ? ["DRAFT", "REJECTED"].includes(track.rightsReviewStatus) : track.rightsReviewStatus === status);
    if (!statusMatches || (use !== "ALL" && !track.permittedUses.includes(use))) return false;
    const text = searchKey([track.title, track.artist, track.album, track.file?.originalName].filter(Boolean).join(" "));
    return words.every((word) => text.includes(word));
  });
}

export function dateLabel(value, emptyLabel = "Not set") {
  if (!value) return emptyLabel;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC"
  }).format(date) : "Date unavailable";
}

function durationLabel(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Duration not set";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function organisationMusicCatalogueNavigation(onlineRadioContext = false) {
  return onlineRadioContext === true
    ? { href: "/dashboard/programming?product=ONLINE#workspace-library", label: "Browse Online Radio catalogue →" }
    : { href: "/dashboard/programming", label: "Browse music for your service →" };
}

export function validateOrganisationMusicLibrary(payload) {
  if (!Array.isArray(payload?.tracks) || !payload.permissions ||
      typeof payload.organisation?.name !== "string" || !payload.organisation.name.trim()) {
    throw new Error("Your music library could not be read. Please try refreshing.");
  }
  return payload;
}

export function observeHiddenMusicPanel(list, Observer = globalThis.MutationObserver) {
  const panel = list?.closest('[role="tabpanel"]');
  if (!panel) return () => {};
  const pauseWhenHidden = () => {
    if (panel.hidden) for (const audio of list.querySelectorAll("audio")) audio.pause();
  };
  pauseWhenHidden();
  if (typeof Observer !== "function") return () => {};
  const observer = new Observer(pauseWhenHidden);
  observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  return () => observer.disconnect();
}

async function readMusicResponse(response, fallback) {
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("Ruvanas could not read the server response. Try refreshing before repeating an upload or submission."); }
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : fallback);
  return payload;
}

export default function MusicLibraryPro({ onlineRadioContext = false } = {}) {
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [submittingId, setSubmittingId] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [useFilter, setUseFilter] = useState("ALL");
  const requestNumber = useRef(0);
  const audioList = useRef(null);
  const catalogueNavigation = organisationMusicCatalogueNavigation(onlineRadioContext);

  async function load() {
    const current = ++requestNumber.current;
    setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/media/music", { cache: "no-store" });
      const payload = validateOrganisationMusicLibrary(await readMusicResponse(response, "Unable to load your music library."));
      if (current === requestNumber.current) setLibrary(payload);
    } catch (loadError) {
      if (current === requestNumber.current) setError(loadError instanceof Error ? loadError.message : "Unable to load your music library.");
    } finally {
      if (current === requestNumber.current) { setLoading(false); setRefreshing(false); }
    }
  }

  useEffect(() => {
    load();
    return () => { requestNumber.current += 1; };
  }, []);

  useEffect(() => observeHiddenMusicPanel(audioList.current), [library]);

  const totals = useMemo(() => ({
    all: library?.tracks.length || 0,
    action: library?.tracks.filter((track) => ["DRAFT", "REJECTED"].includes(track.rightsReviewStatus)).length || 0,
    review: library?.tracks.filter((track) => track.rightsReviewStatus === "IN_REVIEW").length || 0,
    approved: library?.tracks.filter((track) => track.rightsReviewStatus === "APPROVED").length || 0
  }), [library]);
  const visibleTracks = useMemo(() => filterOrganisationMusicTracks(library?.tracks || [], {
    query, status: statusFilter, use: useFilter
  }), [library, query, statusFilter, useFilter]);
  const filtersActive = Boolean(query.trim() || statusFilter !== "ALL" || useFilter !== "ALL");

  function clearFilters() { setQuery(""); setStatusFilter("ALL"); setUseFilter("ALL"); }
  function previewOne(event) {
    for (const audio of audioList.current?.querySelectorAll("audio") || []) {
      if (audio !== event.currentTarget) audio.pause();
    }
  }

  async function upload(event) {
    event.preventDefault();
    setWorking(true); setError(""); setNotice("");
    try {
      const form = event.currentTarget;
      const file = form.file.files?.[0];
      if (!file) throw new Error("Choose a music file before uploading.");
      const formData = new FormData(form);
      const response = await fetch("/api/media/music", { method: "POST", body: formData });
      const payload = await readMusicResponse(response, "The music upload could not be completed.");
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
      await readMusicResponse(response, "The track could not be submitted.");
      setNotice("Rights declaration submitted. Ruvanas will review it before this music can enter programming.");
      await load();
    } catch (submitError) {
      setError(submitError.message);
    } finally { setSubmittingId(""); }
  }

  if (loading) return <section className={styles.uploadPanel} aria-busy="true"><p role="status" className={styles.panelIntro}>Loading your organisation music…</p></section>;
  if (!library) return <section className={styles.uploadPanel}><div className={styles.error} role="alert">{error || "Music library unavailable."}</div><button type="button" className={styles.textButton} disabled={refreshing} onClick={load}>{refreshing ? "Trying again…" : "Try again"}</button></section>;

  return (
    <section className={`${styles.musicPro} ${ux.root}`} aria-labelledby="music-pro-title" aria-busy={refreshing}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>YOUR PRIVATE MUSIC LIBRARY</p><h2 id="music-pro-title">Your uploaded music</h2></div>
        <button type="button" className={styles.textButton} disabled={refreshing || working || Boolean(submittingId)} onClick={load}>{refreshing ? "Refreshing…" : "Refresh library"}</button>
      </div>
      <p className={styles.panelIntro}>Music uploaded by {library.organisation.name}, visible only within your organisation. Upload, check the details, then submit your rights declaration for Ruvanas review.</p>
      <aside className={ux.catalogueNote} aria-label="Two separate music sources">
        <div><span className={ux.sourceLabel}>You are here</span><strong>Your organisation’s recordings</strong><p>The files below are your private uploads. A draft or pending review does not make a recording ready for programming.</p></div>
        <div><span className={ux.sourceLabel}>Separate music source</span><strong>Ruvanas music catalogue</strong><p>Catalogue music is provided separately according to your plan, pillar and music rights. Choose available catalogue tracks when building playlists; they are not copied into this list.</p><a href={catalogueNavigation.href}>{catalogueNavigation.label}</a></div>
      </aside>
      <div className={ux.metrics} aria-label="Filter organisation music by review status">
        {[["ALL", totals.all, "All tracks"], ["NEEDS_ACTION", totals.action, "Need your attention"], ["IN_REVIEW", totals.review, "Awaiting review"], ["APPROVED", totals.approved, "Rights approved"]].map(([value, count, label]) => <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}><strong>{count}</strong><span>{label}</span></button>)}
      </div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      {library.permissions.canUpload ? (
        <details className={styles.musicUpload}>
          <summary>Upload organisation music</summary>
          <form onSubmit={upload} className={styles.form}>
            <fieldset disabled={working} className={ux.uploadFields}><legend className={ux.visuallyHidden}>Organisation music upload and rights declaration</legend>
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
              <fieldset className={styles.useCases}><legend>Permitted Ruvanas services</legend>{Object.entries(USE_LABELS).map(([value, label]) => <label key={value}><input type="checkbox" name="permittedUses" value={value} /><span>{label}</span></label>)}<p className={ux.serviceHint}>Select only the services explicitly covered by your documented permission. Nothing is selected automatically; this declaration does not grant music rights.</p></fieldset>
              <label className={styles.declaration}><input type="checkbox" name="rightsConfirmed" required /><span>I confirm that this organisation has documented authority to store and use this recording for the selected services and territories.</span></label>
            </div>
            <button type="submit" disabled={working || !fileName}>{working ? "Uploading securely…" : "Upload private music draft"}</button>
            </fieldset>
          </form>
        </details>
      ) : <div className={styles.readOnly}>View-only access: uploads and rights submission are unavailable for this account or plan. Your administrator can confirm your access.</div>}

      <div className={ux.filters} role="search" aria-label="Find organisation music">
        <label className={ux.searchField}><span>Search your music</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Track, artist, album or filename" /></label>
        <label><span>Review status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All review statuses</option><option value="NEEDS_ACTION">Needs your attention</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Declared service</span><select value={useFilter} onChange={(event) => setUseFilter(event.target.value)}><option value="ALL">All declared services</option>{Object.entries(USE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className={ux.resultHeading}><p role="status" aria-live="polite">Showing <strong>{visibleTracks.length}</strong> of {totals.all} {totals.all === 1 ? "track" : "tracks"}</p>{filtersActive ? <button type="button" className={styles.textButton} onClick={clearFilters}>Clear filters</button> : null}</div>
      <p className={ux.previewHint}>Private previews play only when you press Play. Previewing or approving a track does not add it to a schedule or start a broadcast.</p>
      <div className={styles.musicList} ref={audioList}>
        {visibleTracks.map((track) => (
          <article className={styles.musicCard} key={track.id}>
            <div className={styles.assetHeading}><div><span className={styles.type}>{track.artist}</span><h3>{track.title}</h3><p>{track.album || "Single / no album"} · {durationLabel(track.file.durationSeconds)}{track.isExplicit ? " · Explicit" : ""}</p></div><span className={`${styles.status} ${styles[`status${track.rightsReviewStatus}`] || ""}`}>{STATUS_LABELS[track.rightsReviewStatus] || "Review status unavailable"}</span></div>
            <p className={ux.statusHelp}>{STATUS_HELP[track.rightsReviewStatus] || "Ask your administrator to confirm this recording’s review status."}</p>
            <div className={styles.musicDetails}>
              <span><strong>Rights holder</strong>{track.rightsHolder}</span><span><strong>Reference</strong>{track.rightsReference}</span><span><strong>Territories</strong>{track.permittedTerritories}</span><span><strong>Licence window</strong>{dateLabel(track.licenceStartsAt, "No start date")} – {dateLabel(track.licenceExpiresAt, "No expiry recorded")}</span>
            </div>
            <div className={styles.usePills}>{track.permittedUses.map((use) => <span key={use}>{USE_LABELS[use]}</span>)}</div>
            {track.rightsReviewNotes ? <div className={styles.reviewNote}><strong>Ruvanas review note</strong><span>{track.rightsReviewNotes}</span></div> : null}
            <audio controls preload="none" aria-label={`Private preview of ${track.title} by ${track.artist}`} src={track.file.previewUrl} onPlay={previewOne}>Your browser does not support secure audio preview.</audio>
            {library.permissions.canSubmit && ["DRAFT", "REJECTED"].includes(track.rightsReviewStatus) ? <button className={styles.primaryButton} type="button" disabled={Boolean(submittingId) || working || refreshing} onClick={() => submit(track.id)}>{submittingId === track.id ? "Submitting…" : "Submit rights for Ruvanas review"}</button> : null}
          </article>
        ))}
        {!library.tracks.length ? <div className={styles.empty}><strong>No private music uploads yet</strong><span>{library.permissions.canUpload ? "Open “Upload organisation music” above to add a private draft, then submit its rights for review." : "Your organisation has not added any music here. Ask your administrator about authorised uploads."}</span><span>Music from the Ruvanas catalogue remains separate and depends on your plan and rights.</span></div> : !visibleTracks.length ? <div className={styles.empty}><strong>No tracks match these filters</strong><span>Try a different title or artist, choose another status, or clear the filters.</span><button type="button" className={styles.textButton} onClick={clearFilters}>Show all organisation music</button></div> : null}
      </div>
    </section>
  );
}
