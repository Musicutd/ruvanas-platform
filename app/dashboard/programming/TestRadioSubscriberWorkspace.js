"use client";

import { useEffect, useRef, useState } from "react";
import TestRadioWeeklyPlanner from "@/app/admin/stations/[stationId]/setup/TestRadioWeeklyPlanner";
import { TEST_RADIO_PLANNER_STATION_ID } from "@/lib/test-radio-weekly-planner-ui.mjs";
import { musicDuration } from "@/lib/online-radio-workspace.mjs";
import styles from "./online-radio-library.module.css";
import pageStyles from "./programming.module.css";

export function testRadioCataloguePath({ query = "", genre = "", offset = 0 } = {}) {
  const parameters = new URLSearchParams({ limit: "50", offset: String(Number.isInteger(offset) && offset >= 0 && offset <= 2000 ? offset : 0) });
  if (query.trim()) parameters.set("q", query.trim().slice(0, 100));
  if (genre && /^[a-zA-Z0-9_-]{1,80}$/.test(genre)) parameters.set("genre", genre);
  return `/api/programming/test-radio/catalogue?${parameters}`;
}

export function testRadioCatalogueMetadata(body) {
  const text = value => typeof value === "string" && value.length <= 500;
  const codes = value => Array.isArray(value) && value.length <= 48 && value.every(code => typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code));
  if (body?.stationId !== TEST_RADIO_PLANNER_STATION_ID || body.metadataOnly !== true || body.territory !== "MT" ||
      !Array.isArray(body.tracks) || body.tracks.length > 50 || !Number.isInteger(body.total) || body.total < body.tracks.length || body.total > 2000 ||
      !Number.isInteger(body.offset) || body.offset < 0 || body.offset > 2000 || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50 ||
      !Array.isArray(body.genres) || body.genres.length > 250 || body.genres.some(genre => !codes([genre.code]) || !text(genre.name)) ||
      body.tracks.some(track => !text(track.id) || !track.id || !text(track.title) || !text(track.artist) || !codes(track.genreCodes) ||
        !Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0 || track.durationSeconds > 3600) ||
      new Set(body.tracks.map(track => track.id)).size !== body.tracks.length) throw new Error("The Test Radio catalogue response could not be verified. Refresh the library.");
  // Copy display fields only; never render media URLs, credentials or a player.
  return { total: body.total, limit: body.limit, offset: body.offset,
    genres: body.genres.map(genre => ({ code: genre.code, name: genre.name })),
    warnings: Array.isArray(body.warnings) ? body.warnings.filter(value => typeof value === "string").slice(0, 20) : [],
    tracks: body.tracks.map(track => ({ id: track.id, title: track.title, artist: track.artist,
      mix: text(track.mix) ? track.mix : "", album: text(track.album) ? track.album : "", durationSeconds: track.durationSeconds,
      bpm: Number.isFinite(track.bpm) && track.bpm > 0 && track.bpm <= 400 ? track.bpm : null,
      genreCodes: [...track.genreCodes], explicit: track.explicit === true, source: text(track.source) ? track.source : "Approved catalogue" })) };
}

export function TestRadioSubscriberCatalogueResults({ catalogue }) {
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

export function TestRadioSubscriberCatalogue({ stationId }) {
  const [query, setQuery] = useState(""), [genre, setGenre] = useState("");
  const [search, setSearch] = useState({ query: "", genre: "", offset: 0 }), [catalogue, setCatalogue] = useState(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const requestSequence = useRef(0);
  useEffect(() => {
    if (stationId !== TEST_RADIO_PLANNER_STATION_ID) return;
    const sequence = ++requestSequence.current, controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setLoading(true); setError("");
    fetch(testRadioCataloguePath(search), { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "The Test Radio music library could not be loaded."); return testRadioCatalogueMetadata(body); })
      .then(body => { if (sequence === requestSequence.current && !controller.signal.aborted) setCatalogue(body); })
      .catch(caught => { if (sequence === requestSequence.current) { setCatalogue(null); setError(caught.name === "AbortError" ? "The catalogue request timed out. Try again." : caught.message); } })
      .finally(() => { clearTimeout(timeout); if (sequence === requestSequence.current) setLoading(false); });
    return () => { requestSequence.current += 1; clearTimeout(timeout); controller.abort(); };
  }, [stationId, search, retry]);
  if (stationId !== TEST_RADIO_PLANNER_STATION_ID) return null;
  return <section id="workspace-library" className={styles.layout} aria-labelledby="test-radio-catalogue-title">
    <div className={styles.heading}><div><p className={styles.eyebrow}>1 · MUSIC LIBRARY</p><h2 id="test-radio-catalogue-title">Your approved music catalogue</h2><p>Find the songs available for Test Radio, then use their genres to build a programme.</p></div><a href="#workspace-simple" className={styles.primary}>Next: build a playlist</a></div>
    <div className={styles.panel}>
      <div className={styles.boundary}><strong>Catalogue browsing · Malta · metadata only</strong><p>This library shows song details, not a listening player. Browsing and saving drafts do not interrupt the separate live AutoDJ service. Only an administrator can approve an on-air schedule.</p></div>
      <form className={styles.filters} onSubmit={event => { event.preventDefault(); setSearch({ query, genre, offset: 0 }); }}>
        <label>Search music<input type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} placeholder="Song, artist, album or mix" /></label>
        <label>Genre<select value={genre} onChange={event => setGenre(event.target.value)}><option value="">All available genres</option>{(catalogue?.genres || []).map(entry => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select></label>
        <button type="submit" disabled={loading}>Search</button>
        {(query || genre || search.query || search.genre) && <button type="button" className={styles.secondary} disabled={loading} onClick={() => { setQuery(""); setGenre(""); setSearch({ query: "", genre: "", offset: 0 }); }}>Clear filters</button>}
        <button type="button" className={styles.secondary} disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh library</button>
      </form>
      {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {loading ? <p role="status">Finding approved Test Radio music…</p> : catalogue && <>
        <TestRadioSubscriberCatalogueResults catalogue={catalogue} />
        {(catalogue.total > catalogue.limit || catalogue.offset > 0) && <nav className={styles.filters} aria-label="Catalogue pages"><button type="button" className={styles.secondary} disabled={catalogue.offset === 0} onClick={() => setSearch({ ...search, offset: Math.max(0, catalogue.offset - catalogue.limit) })}>Previous songs</button><button type="button" className={styles.secondary} disabled={catalogue.offset + catalogue.tracks.length >= catalogue.total || catalogue.tracks.length === 0} onClick={() => setSearch({ ...search, offset: catalogue.offset + catalogue.limit })}>Next songs</button></nav>}
      </>}
      <p className={styles.hint}>No file upload, download, audio playback or new music permission is enabled by this screen.</p>
    </div>
  </section>;
}

export default function TestRadioSubscriberWorkspace({ stationId }) {
  if (stationId !== TEST_RADIO_PLANNER_STATION_ID) return null;
  return <>
    <div className={pageStyles.hero}><div><p className={pageStyles.eyebrow}>ONLINE RADIO · TEST RADIO PLANNING</p><h1>Your music. Your programmes. Your week.</h1><p className={pageStyles.intro}>Browse the catalogue, build reusable playlists and prepare your weekly plan. Your drafts stay separate from the on-air version until an administrator approves them.</p></div><div className={pageStyles.safetyNote}><strong>Live stream unchanged</strong><span>These are catalogue and draft-planning controls, not live audio controls.</span></div></div>
    <nav className={styles.heading} aria-label="Test Radio planning steps" style={{ marginBottom: 24 }}><a className={styles.primary} href="#workspace-library">1 · Music library</a><a className={styles.primary} href="#workspace-simple">2 · Playlists</a><a className={styles.primary} href="#workspace-planner">3 · Weekly planner</a></nav>
    <TestRadioSubscriberCatalogue stationId={stationId} />
    <TestRadioWeeklyPlanner stationId={stationId} draftOnly />
  </>;
}
