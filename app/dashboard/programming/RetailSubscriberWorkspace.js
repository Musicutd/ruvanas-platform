"use client";

import { useEffect, useRef, useState } from "react";
import RetailWeeklyPlanner from "./RetailWeeklyPlanner";
import RetailCommercialDesk from "./RetailCommercialDesk";
import { RETAIL_PLANNER_STATION_ID } from "@/lib/retail-weekly-planner-ui.mjs";
import { musicDuration } from "@/lib/online-radio-workspace.mjs";
import styles from "./online-radio-library.module.css";

import retailStyles from "./retail-control-tabs.module.css";

export function retailCataloguePath({ query = "", genre = "", offset = 0 } = {}) {
  const parameters = new URLSearchParams({ limit: "50", offset: String(Number.isInteger(offset) && offset >= 0 && offset <= 2000 ? offset : 0) });
  if (query.trim()) parameters.set("q", query.trim().slice(0, 100));
  if (genre && /^[a-zA-Z0-9_-]{1,80}$/.test(genre)) parameters.set("genre", genre);
  return `/api/programming/test-retail/catalogue?${parameters}`;
}

export function retailCatalogueMetadata(body) {
  const text = value => typeof value === "string" && value.length <= 500;
  const codes = value => Array.isArray(value) && value.length <= 48 && value.every(code => typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code));
  if (body?.stationId !== RETAIL_PLANNER_STATION_ID || body.metadataOnly !== true || body.territory !== "MT" ||
      !Array.isArray(body.tracks) || body.tracks.length > 50 || !Number.isInteger(body.total) || body.total < body.tracks.length || body.total > 2000 ||
      !Number.isInteger(body.offset) || body.offset < 0 || body.offset > 2000 || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50 ||
      !Array.isArray(body.genres) || body.genres.length > 250 || body.genres.some(genre => !codes([genre.code]) || !text(genre.name)) ||
      body.tracks.some(track => !text(track.id) || !track.id || !text(track.title) || !text(track.artist) || !codes(track.genreCodes) ||
        !Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0 || track.durationSeconds > 3600) ||
      new Set(body.tracks.map(track => track.id)).size !== body.tracks.length) throw new Error("The Test Retail catalogue response could not be verified. Refresh the library.");
  // Copy display fields only; never render media URLs, credentials or a player.
  return { total: body.total, limit: body.limit, offset: body.offset,
    genres: body.genres.map(genre => ({ code: genre.code, name: genre.name })),
    warnings: Array.isArray(body.warnings) ? body.warnings.filter(value => typeof value === "string").slice(0, 20) : [],
    tracks: body.tracks.map(track => ({ id: track.id, title: track.title, artist: track.artist,
      mix: text(track.mix) ? track.mix : "", album: text(track.album) ? track.album : "", durationSeconds: track.durationSeconds,
      bpm: Number.isFinite(track.bpm) && track.bpm > 0 && track.bpm <= 400 ? track.bpm : null,
      genreCodes: [...track.genreCodes], explicit: track.explicit === true, source: text(track.source) ? track.source : "Approved catalogue" })) };
}

export function RetailSubscriberCatalogueResults({ catalogue }) {
  return <>
    <p className={styles.results} role="status">{catalogue.total} matching track{catalogue.total === 1 ? "" : "s"}{catalogue.tracks.length > 0 && catalogue.total > catalogue.tracks.length ? ` · showing ${catalogue.offset + 1}–${catalogue.offset + catalogue.tracks.length}` : ""}</p>
    {catalogue.warnings.map((warning, index) => <p className={styles.hint} role="note" key={index}>{warning}</p>)}
    {catalogue.tracks.length ? <div className={styles.subscriberTrackViewport} role="region" aria-label="Matching catalogue songs" tabIndex={0}><ul className={styles.tracks}>{catalogue.tracks.map(track => <li key={track.id}>
      <div><h3>{track.title}</h3><p>{track.artist}{track.mix ? ` · ${track.mix}` : ""}</p><small>{track.album || "Single / no album"}</small></div>
      <div className={styles.trackMeta}><span>{musicDuration(track.durationSeconds)}</span><span>{track.bpm ? `${track.bpm} BPM` : "BPM not supplied"}</span>
        <span>{track.genreCodes.map(code => catalogue.genres.find(genre => genre.code === code)?.name || code.replaceAll("_", " ")).join(" · ") || "Genre not supplied"}</span>
        {track.explicit && <span>Explicit</span>}<small>{track.source}</small></div>
    </li>)}</ul></div> : <div className={styles.empty}><strong>No approved songs match this search.</strong><p>Clear your filters or try a different song, artist or genre. Current music-rights checks still apply.</p></div>}
  </>;
}

export function RetailSubscriberCatalogue({ stationId }) {
  const [query, setQuery] = useState(""), [genre, setGenre] = useState("");
  const [search, setSearch] = useState({ query: "", genre: "", offset: 0 }), [catalogue, setCatalogue] = useState(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const requestSequence = useRef(0);
  useEffect(() => {
    if (stationId !== RETAIL_PLANNER_STATION_ID) return;
    const sequence = ++requestSequence.current, controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setLoading(true); setError("");
    fetch(retailCataloguePath(search), { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "The Test Retail music library could not be loaded."); return retailCatalogueMetadata(body); })
      .then(body => { if (sequence === requestSequence.current && !controller.signal.aborted) setCatalogue(body); })
      .catch(caught => { if (sequence === requestSequence.current) { setCatalogue(null); setError(caught.name === "AbortError" ? "The catalogue request timed out. Try again." : caught.message); } })
      .finally(() => { clearTimeout(timeout); if (sequence === requestSequence.current) setLoading(false); });
    return () => { requestSequence.current += 1; clearTimeout(timeout); controller.abort(); };
  }, [stationId, search, retry]);
  if (stationId !== RETAIL_PLANNER_STATION_ID) return null;
  return <section id="workspace-library" className={styles.layout} aria-labelledby="test-retail-catalogue-title">
    <div className={styles.heading}><div><p className={styles.eyebrow}>1 · MUSIC LIBRARY</p><h2 id="test-retail-catalogue-title">Your approved music catalogue</h2><p>Find the songs available for Test Retail, then use their genres to build one programme for all your shops.</p></div><a href="#workspace-simple" className={styles.primary}>Next: build a playlist</a></div>
    <div className={styles.panel}>
      <div className={styles.boundary}><strong>Catalogue browsing · Malta · song details</strong><p>Browse your approved recordings and prepare drafts without changing the Retail stream. Weekly music schedules need administrator approval. You review and approve your own commercial schedules separately.</p></div>
      <form className={styles.filters} onSubmit={event => { event.preventDefault(); setSearch({ query, genre, offset: 0 }); }}>
        <label>Search music<input type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} placeholder="Song, artist, album or mix" /></label>
        <label>Genre<select value={genre} onChange={event => setGenre(event.target.value)}><option value="">All available genres</option>{(catalogue?.genres || []).map(entry => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select></label>
        <button type="submit" disabled={loading}>Search</button>
        {(query || genre || search.query || search.genre) && <button type="button" className={styles.secondary} disabled={loading} onClick={() => { setQuery(""); setGenre(""); setSearch({ query: "", genre: "", offset: 0 }); }}>Clear filters</button>}
        <button type="button" className={styles.secondary} disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh library</button>
      </form>
      {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {loading ? <p role="status">Finding approved Test Retail music…</p> : catalogue && <>
        <RetailSubscriberCatalogueResults catalogue={catalogue} />
        {(catalogue.total > catalogue.limit || catalogue.offset > 0) && <nav className={styles.filters} aria-label="Catalogue pages"><button type="button" className={styles.secondary} disabled={catalogue.offset === 0} onClick={() => setSearch({ ...search, offset: Math.max(0, catalogue.offset - catalogue.limit) })}>Previous songs</button><button type="button" className={styles.secondary} disabled={catalogue.offset + catalogue.tracks.length >= catalogue.total || catalogue.tracks.length === 0} onClick={() => setSearch({ ...search, offset: catalogue.offset + catalogue.limit })}>Next songs</button></nav>}
      </>}
      <p className={styles.hint}>No file upload, download, audio playback or new music permission is enabled by this screen.</p>
    </div>
  </section>;
}

export function retailPlanningWorkspace(body) {
  if (body?.stationId !== RETAIL_PLANNER_STATION_ID || body.draftOnly !== true || !Array.isArray(body.channels) || body.channels.length > 1 ||
    body.channels.some(channel => !channel || typeof channel.id !== "string" || !channel.id || typeof channel.name !== "string" || !["DRAFT", "ACTIVE"].includes(channel.status)) ||
    body.channelId !== (body.channels.length === 1 ? body.channels[0].id : null) || typeof body.canPrepare !== "boolean")
    throw new Error("Your Retail planning workspace could not be verified. Refresh before making changes.");
  return { stationId: body.stationId, channelId: body.channelId, channels: body.channels.map(({ id, name, status }) => ({ id, name, status })), canPrepare: body.canPrepare };
}

export function RetailPlanningWorkspace({ stationId, view = "all", onShowPlanner, onShowPlaylists }) {
  const [workspace, setWorkspace] = useState(null), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const attempt = useRef(null), sequence = useRef(0), controller = useRef(null), pending = useRef(false);
  async function load(prepare = false) {
    if (stationId !== RETAIL_PLANNER_STATION_ID || pending.current) return;
    pending.current = true;
    const request = ++sequence.current; controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20000); setBusy(prepare ? "prepare" : "load"); setError("");
    try {
      if (prepare && !attempt.current) attempt.current = crypto.randomUUID();
      const response = await fetch("/api/programming/test-retail/workspace", { credentials: "same-origin", cache: "no-store", signal: abort.signal,
        ...(prepare ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", requestId: attempt.current }) } : {}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Your Retail planning workspace could not be loaded.");
      const next = retailPlanningWorkspace(body);
      if (prepare && (!body.preparedChannelId || body.preparedChannelId !== next.channelId)) throw new Error("Preparation is not yet confirmed. Try again to recover the same planning workspace.");
      if (request === sequence.current) { setWorkspace(next); if (next.channelId) attempt.current = null; }
    } catch (caught) { if (request === sequence.current) setError(caught.name === "AbortError" ? "The request timed out. Try again; preparing the planner does not start audio." : caught.message); }
    finally { clearTimeout(timeout); pending.current = false; if (request === sequence.current) setBusy(""); }
  }
  useEffect(() => { void load(); return () => { sequence.current += 1; controller.current?.abort(); }; }, [stationId]);
  if (stationId !== RETAIL_PLANNER_STATION_ID) return null;
  if (workspace?.channelId) return <RetailWeeklyPlanner stationId={stationId} view={view} onShowPlanner={onShowPlanner} onShowPlaylists={onShowPlaylists} />;
  return <section id="workspace-simple" className={styles.panel} aria-labelledby="retail-prepare-title">
    <h2 id="retail-prepare-title">Prepare your playlists and weekly planner</h2>
    <p>Use one shared music plan for all your shops. Preparing this workspace creates a private draft area; it does not start streaming or change your plan.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {busy === "load" && <p role="status">Checking your saved planning workspace…</p>}
    {workspace?.canPrepare && <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => load(true)}>{busy === "prepare" ? "Preparing…" : "Prepare my planner — audio stays unchanged"}</button>}
    {!workspace?.canPrepare && !busy && <button type="button" className={styles.secondary} onClick={() => load()}>Refresh planning access</button>}
    {workspace && !workspace.canPrepare && <p>Your administrator can check your Retail planning access.</p>}
    <div id="workspace-planner"><p className={styles.hint}>After preparation: Generate Playlist → save a playlist → add it to your week → save a draft for administrator approval.</p></div>
  </section>;
}

export const RETAIL_WORKSPACE_TABS = Object.freeze([
  { id: "autodj", label: "AutoDJ", hash: "workspace-autodj", panel: "retail-panel-autodj" },
  { id: "schedule", label: "Music schedule", hash: "workspace-planner", panel: "retail-panel-planning" },
  { id: "playlists", label: "Playlists", hash: "workspace-simple", panel: "retail-panel-planning" },
  { id: "commercials", label: "Commercials", hash: "workspace-commercials", panel: "retail-panel-commercials" },
  { id: "library", label: "Music library", hash: "workspace-library", panel: "retail-panel-library" }
]);

export function RetailAutoDjOverview({ onChoose }) {
  return <section className={retailStyles.autodj} aria-labelledby="retail-autodj-title">
    <div className={retailStyles.autodjMain}><p className={retailStyles.eyebrow}>YOUR EVERYDAY MUSIC</p><h2 id="retail-autodj-title">Let the music keep going.</h2>
      <p>AutoDJ plays a random mix from your administrator-approved catalogue selection. One shared programme serves all your shops.</p>
      <ol className={retailStyles.flow}><li><b>01</b><span><strong>Random music</strong><small>Between scheduled programmes</small></span></li><li><b>02</b><span><strong>Your scheduled mix</strong><small>Starts at its approved time</small></span></li><li><b>03</b><span><strong>Back to random</strong><small>Automatically when the programme ends</small></span></li></ol>
      <div className={retailStyles.actions}><button type="button" onClick={() => onChoose("schedule")}>Schedule a genre mix</button><button type="button" className={retailStyles.secondary} onClick={() => onChoose("library")}>Browse music</button></div>
    </div>
    <aside className={retailStyles.autodjSide}><span className={retailStyles.badge}>Continuous AutoDJ</span><h3>No need to fill every hour</h3><p>Leave gaps in the music schedule for random AutoDJ. Use timed programmes for a different mood, such as morning Pop or afternoon Rock.</p><hr /><p><strong>Planning leaves your stream playing.</strong><br />New music playlists and weekly programmes are drafts until approved by your administrator.</p><p className={retailStyles.hint}>This explains the playback behaviour. It is not a live connection report or a start/stop control.</p></aside>
  </section>;
}

export default function RetailSubscriberWorkspace({ stationId }) {
  const [activeTab, setActiveTab] = useState("autodj"), tabs = useRef({});
  useEffect(() => {
    const adoptHash = () => { const tab = RETAIL_WORKSPACE_TABS.find(item => `#${item.hash}` === window.location.hash); if (tab) setActiveTab(tab.id); };
    adoptHash(); window.addEventListener("hashchange", adoptHash);
    return () => window.removeEventListener("hashchange", adoptHash);
  }, []);
  function choose(id, focus = false) {
    const tab = RETAIL_WORKSPACE_TABS.find(item => item.id === id); if (!tab) return;
    setActiveTab(id); window.history.replaceState(null, "", `#${tab.hash}`);
    if (focus) tabs.current[id]?.focus();
  }
  function keyNavigate(event, index) {
    const next = event.key === "ArrowRight" ? (index + 1) % RETAIL_WORKSPACE_TABS.length : event.key === "ArrowLeft" ? (index + RETAIL_WORKSPACE_TABS.length - 1) % RETAIL_WORKSPACE_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? RETAIL_WORKSPACE_TABS.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); choose(RETAIL_WORKSPACE_TABS[next].id, true); }
  }
  if (stationId !== RETAIL_PLANNER_STATION_ID) return null;
  return <div className={retailStyles.shell}>
    <div className={retailStyles.workspaceHeader}><div><p className={retailStyles.eyebrow}>RETAIL · ONE PROGRAMME FOR ALL YOUR SHOPS</p><h1>The right music. At the right time.</h1><p className={retailStyles.intro}>Keep everyday music simple. Plan a mood for each part of the day and choose when your shop messages should play.</p></div><div className={retailStyles.draftNote}><strong>Your stream keeps playing</strong><span>Music plans need administrator approval. You approve your own recordings and commercial schedules.</span></div></div>
    <div className={retailStyles.tabs} role="tablist" aria-label="Retail music and messages">{RETAIL_WORKSPACE_TABS.map((tab, index) => <button key={tab.id} ref={node => { tabs.current[tab.id] = node; }} type="button" role="tab" id={`retail-tab-${tab.id}`} aria-controls={tab.panel} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => choose(tab.id)} onKeyDown={event => keyNavigate(event, index)}>{tab.label}</button>)}</div>
    <div id="retail-panel-autodj" role="tabpanel" aria-labelledby="retail-tab-autodj" hidden={activeTab !== "autodj"}><RetailAutoDjOverview onChoose={choose} /></div>
    <div id="retail-panel-planning" role="tabpanel" aria-labelledby={`retail-tab-${activeTab === "playlists" ? "playlists" : "schedule"}`} hidden={!["schedule", "playlists"].includes(activeTab)}><RetailPlanningWorkspace stationId={stationId} view={activeTab === "playlists" ? "playlists" : "schedule"} onShowPlanner={() => choose("schedule")} onShowPlaylists={() => choose("playlists")} /></div>
    <div id="retail-panel-commercials" role="tabpanel" aria-labelledby="retail-tab-commercials" hidden={activeTab !== "commercials"}><RetailCommercialDesk stationId={stationId} /></div>
    <div id="retail-panel-library" role="tabpanel" aria-labelledby="retail-tab-library" hidden={activeTab !== "library"}><RetailSubscriberCatalogue stationId={stationId} /></div>
  </div>;
}
