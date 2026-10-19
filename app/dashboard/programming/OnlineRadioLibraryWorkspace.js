"use client";

import { useEffect, useState } from "react";
import { catalogueSearchPath, musicDuration, onlineRadioPlanningData } from "@/lib/online-radio-workspace.mjs";
import MusicLibraryPro from "../media/MusicLibraryPro";
import styles from "./online-radio-library.module.css";

export default function OnlineRadioLibraryWorkspace({ sandboxDraftOnly = false }) {
  const [view, setView] = useState("catalogue");
  const [setup, setSetup] = useState(null);
  const [channelId, setChannelId] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ query: "", genre: "" });
  const [genre, setGenre] = useState("");
  const [catalogue, setCatalogue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (sandboxDraftOnly) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/programming/simple", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Music setup could not be loaded."); return onlineRadioPlanningData(payload); })
      .then((payload) => { setSetup(payload); setChannelId((current) => payload.channels.some((channel) => channel.id === current) ? current : payload.channels[0]?.id || ""); })
      .catch((issue) => { if (!controller.signal.aborted) { setError(issue.message); setLoading(false); } });
    return () => controller.abort();
  }, [sandboxDraftOnly, retry]);

  useEffect(() => {
    if (sandboxDraftOnly || !setup || view !== "catalogue") return;
    const controller = new AbortController();
    setLoading(true); setError(""); setCatalogue(null);
    fetch(catalogueSearchPath({ channelId, ...search }), { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Approved music could not be loaded."); return payload; })
      .then((payload) => { if (!controller.signal.aborted) setCatalogue(payload); })
      .catch((issue) => { if (!controller.signal.aborted) setError(issue.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [setup, channelId, search, view, sandboxDraftOnly]);

  if (sandboxDraftOnly) return <section className={styles.panel} aria-labelledby="radio-library-title">
    <p className={styles.eyebrow}>1 · MUSIC LIBRARY</p><h2 id="radio-library-title">Plan with genres in your private test</h2>
    <div className={styles.boundary} role="note"><strong>Audio access is not enabled for this draft-only workspace.</strong><p>You can create genre-based playlist drafts and preview your weekly plan. The actual music catalogue, uploads, downloads and playback stay unavailable.</p></div>
    <p>No songs have disappeared: this test account deliberately has planning access only. Your administrator manages catalogue and listening permissions separately.</p>
    <a href="#workspace-simple" className={styles.primary}>Next: create a playlist</a>
  </section>;

  return <section className={styles.layout} aria-labelledby="radio-library-title">
    <div className={styles.heading}><div><p className={styles.eyebrow}>1 · MUSIC LIBRARY</p><h2 id="radio-library-title">Find music for your station</h2><p>Browse your plan&apos;s approved catalogue or manage your organisation&apos;s own recordings. Browsing never starts audio.</p></div><a href="#workspace-simple" className={styles.primary}>Next: create a playlist</a></div>
    <div className={styles.views} role="group" aria-label="Music source">
      <button type="button" aria-pressed={view === "catalogue"} onClick={() => setView("catalogue")}>Approved catalogue</button>
      <button type="button" aria-pressed={view === "uploads"} onClick={() => setView("uploads")}>Your uploaded music</button>
    </div>
    {view === "uploads" ? <MusicLibraryPro onlineRadioContext /> : <div className={styles.panel}>
      <div className={styles.boundary}><strong>Already included where your plan and rights allow</strong><p>You do not need to copy these tracks into your uploads. Playlists select eligible music by genre; they are not manually ordered lists of these song files.</p></div>
      <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setSearch({ query, genre }); }}>
        {setup?.channels.length ? <label>Station / channel<select value={channelId} onChange={(event) => setChannelId(event.target.value)}>{setup.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.stationName ? `${channel.stationName} / ` : ""}{channel.name}</option>)}</select></label> : null}
        <label>Search music<input type="search" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Song, artist, album or mix" /></label>
        <label>Genre<select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="">All available genres</option>{(setup?.genres || []).map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select></label>
        <button type="submit" disabled={loading || !setup}>Search</button>
        {query || genre || search.query || search.genre ? <button type="button" className={styles.secondary} onClick={() => { setQuery(""); setGenre(""); setSearch({ query: "", genre: "" }); }}>Clear filters</button> : null}
      </form>
      {error ? <div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={() => setRetry((current) => current + 1)}>Try again</button></div> : null}
      {loading ? <p role="status">Finding approved music…</p> : catalogue ? <>
        <p className={styles.results} role="status">{catalogue.total} matching track{catalogue.total === 1 ? "" : "s"}{catalogue.total > catalogue.tracks.length ? ` · showing the first ${catalogue.tracks.length}; narrow your search to find more` : ""}</p>
        {!catalogue.territoryKnown ? <p className={styles.hint}>A listening territory is not confirmed. Country-restricted music is hidden until your administrator completes that setup.</p> : null}
        {catalogue.tracks.length ? <ul className={styles.tracks}>{catalogue.tracks.map((track) => <li key={track.id}><div><h3>{track.title}</h3><p>{track.artist}{track.mix ? ` · ${track.mix}` : ""}</p><small>{track.album || "Single / no album"}</small></div><div className={styles.trackMeta}><span>{musicDuration(track.durationSeconds)}</span><span>{track.bpm ? `${track.bpm} BPM` : "BPM not supplied"}</span><span>{track.genreCodes.map((code) => setup.genres.find((entry) => entry.code === code)?.name || code.replaceAll("_", " ")).join(" · ") || "Genre not supplied"}</span>{track.explicit ? <span>Explicit</span> : null}<small>{track.source}</small></div></li>)}</ul> : <div className={styles.empty}><strong>{search.query || search.genre ? "No music matches these filters" : "No catalogue music is available for this channel yet"}</strong><p>{search.query || search.genre ? "Try a different title, artist or genre, or clear your filters." : "Your plan, listening territory and current music rights determine this list. Your own approved recordings are kept separately under Your uploaded music."}</p></div>}
      </> : null}
      <p className={styles.hint}>Catalogue access is metadata-only here. No download or playback is enabled by this screen, and music-rights checks remain in place.</p>
    </div>}
  </section>;
}
