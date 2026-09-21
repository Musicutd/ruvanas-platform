"use client";

import { useEffect, useState } from "react";
import { studioLibraryGenreLabel } from "@/lib/studio-library-browser.mjs";
import styles from "./studio-pro.module.css";

function duration(seconds) {
  if (!seconds) return "Duration unavailable";
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

export default function StudioLibraryClient({ active }) {
  const [data, setData] = useState(null);
  const [channelId, setChannelId] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page) });
    if (channelId) params.set("channelId", channelId);
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (genre) params.set("genre", genre);
    setLoading(true);
    setError("");
    fetch(`/api/studio/library?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "The library could not be loaded.");
        setData(body);
      })
      .catch((loadError) => { if (loadError.name !== "AbortError") setError(loadError.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, channelId, debouncedQuery, genre, page]);

  const selectedChannel = channelId || data?.selectedChannelId || "";
  const pageCount = Math.ceil((data?.total || 0) / (data?.pageSize || 60));
  return <section className={styles.librarySection} aria-labelledby="studio-library-heading">
    <div className={styles.libraryIntro}>
      <div><p className={styles.eyebrow}>YOUR SOUND COLLECTION</p><h2 id="studio-library-heading">Explore the music library</h2><p>Find music approved for your service. Browse track details here, then use playlists or Studio Pro to prepare your programme.</p></div>
      <div className={styles.libraryProtection}><span aria-hidden="true">♪</span><strong>Protected library</strong><small>Browse track details here. Audio files cannot be downloaded from this view.</small></div>
    </div>
    <div className={styles.libraryControls}>
      <label className={styles.librarySearch}>Search songs, artists or albums<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Try an artist or song title" maxLength={100} /></label>
      <label className={styles.librarySearch}>Channel<select value={selectedChannel} onChange={(event) => { setChannelId(event.target.value); setGenre(""); setPage(1); }} disabled={!data?.channels?.length}><option value="">{data?.channels?.length ? "Choose a channel" : "No channel yet"}</option>{data?.channels?.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      <label className={styles.librarySearch}>Genre<select value={genre} onChange={(event) => { setGenre(event.target.value); setPage(1); }}><option value="">All genres</option>{data?.genres?.map((item) => <option key={item} value={item}>{studioLibraryGenreLabel(item)}</option>)}</select></label>
    </div>
    <div className={styles.libraryCount} aria-live="polite"><strong>{loading ? "Finding music…" : `${data?.total ?? 0} ${data?.total === 1 ? "track" : "tracks"}`}</strong><span>Available for this account and channel</span></div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {!data && !error ? <p className={styles.muted}>Loading your music library…</p> : null}
    {data && !loading && !data.tracks.length ? <div className={styles.libraryEmpty}><strong>No music to show yet</strong><p>{!data.territoryKnown && data.channels.length ? "This channel has no confirmed territory. Ruvanas can set it before region-restricted tracks become available." : "Try another search or genre. Only music cleared for this account and channel appears here."}</p></div> : null}
    {data?.tracks?.length ? <div className={styles.libraryCards}>{data.tracks.map((track, index) => <article className={styles.libraryTrack} key={track.id}>
      <div className={styles.trackArtwork} aria-hidden="true"><span>♪</span><i /></div>
      <div className={styles.trackInfo}><small>{track.source} · {String((page - 1) * (data.pageSize || 60) + index + 1).padStart(2, "0")}</small><h3>{track.title}</h3><p>{track.artist}{track.album ? ` · ${track.album}` : ""}</p><div className={styles.trackTags}>{track.mix ? <span>{track.mix}</span> : null}{track.genres.map((item) => <span key={item}>{studioLibraryGenreLabel(item)}</span>)}{track.explicit ? <span>Explicit</span> : null}</div></div>
      <div className={styles.trackFacts}><strong>{duration(track.durationSeconds)}</strong>{track.bpm ? <small>{track.bpm} BPM</small> : null}<span>Browse only</span></div>
    </article>)}</div> : null}
    {pageCount > 1 ? <div className={styles.libraryPagination}><button type="button" disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={loading || page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div> : null}
  </section>;
}
