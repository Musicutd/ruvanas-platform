"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./podcasts.module.css";

const emptySeries = { stationId: "", channelId: "", title: "", description: "", feedSlug: "", author: "", artworkUrl: "" };
const emptyEpisode = { seriesId: "", mediaAssetId: "", title: "", summary: "", accessibleDescription: "", languageCode: "en", seasonNumber: "", episodeNumber: "", explicit: false, transcript: "", chapters: "" };

function clockToMs(value) {
  const parts = String(value || "0").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return Math.max(0, Math.round((parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + (parts[1] || 0)) * 1000));
}

function parseTranscript(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [timing = "0-1", speaker = "", ...words] = line.split("|").map((part) => part.trim());
    const [start, end] = timing.split("-").map(clockToMs);
    return { startMs: start, endMs: Math.max(start + 1, end), speaker: speaker || null, text: words.join(" | ") };
  });
}

function parseChapters(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [time = "0", ...title] = line.split("|").map((part) => part.trim());
    return { startMs: clockToMs(time), title: title.join(" | ") };
  });
}

function msToClock(value) {
  const seconds = Math.floor((Number(value) || 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function transcriptText(segments) {
  return (Array.isArray(segments) ? segments : []).map((item) => `${msToClock(item.startMs)}-${msToClock(item.endMs)} | ${item.speaker || ""} | ${item.text}`).join("\n");
}

function chaptersText(chapters) {
  return (Array.isArray(chapters) ? chapters : []).map((item) => `${msToClock(item.startMs)} | ${item.title}`).join("\n");
}

function requestBody(form) {
  return {
    title: form.title,
    summary: form.summary || null,
    accessibleDescription: form.accessibleDescription || null,
    languageCode: form.languageCode || "en",
    explicit: Boolean(form.explicit),
    seasonNumber: form.seasonNumber ? Number(form.seasonNumber) : null,
    episodeNumber: form.episodeNumber ? Number(form.episodeNumber) : null,
    transcriptSegments: parseTranscript(form.transcript),
    chapters: parseChapters(form.chapters)
  };
}

export default function PodcastWorkspace({ product = "ONLINE", initialMediaAssetId = "" }) {
  const [data, setData] = useState(null);
  const [seriesForm, setSeriesForm] = useState(emptySeries);
  const [episodeForm, setEpisodeForm] = useState(emptyEpisode);
  const [drafts, setDrafts] = useState({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch(`/api/podcasts?product=${encodeURIComponent(product)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Podcasts could not be loaded.");
    setData(payload);
    setSeriesForm((current) => ({ ...current, stationId: current.stationId || payload.stations[0]?.id || "" }));
    setEpisodeForm((current) => ({ ...current, seriesId: current.seriesId || payload.series[0]?.id || "", mediaAssetId: current.mediaAssetId || (payload.approvedAudio.some((item) => item.id === initialMediaAssetId) ? initialMediaAssetId : payload.approvedAudio[0]?.id || "") }));
  }

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [product]);

  async function act(body, message) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/podcasts?product=${encodeURIComponent(product)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The podcast action could not be completed.");
      setNotice(message); await load(); return true;
    } catch (actionError) { setError(actionError.message); return false; }
    finally { setWorking(false); }
  }

  async function createSeries(event) {
    event.preventDefault();
    if (await act({ action: "CREATE_SERIES", ...seriesForm, channelId: seriesForm.channelId || null, description: seriesForm.description || null, feedSlug: seriesForm.feedSlug || null, author: seriesForm.author || null, artworkUrl: seriesForm.artworkUrl || null }, "Podcast series created privately.")) setSeriesForm({ ...emptySeries, stationId: data.stations[0]?.id || "" });
  }

  async function createEpisode(event) {
    event.preventDefault();
    if (await act({ action: "CREATE_EPISODE", seriesId: episodeForm.seriesId, mediaAssetId: episodeForm.mediaAssetId, ...requestBody(episodeForm), submitTranscript: false }, "Episode created as a private draft.")) setEpisodeForm({ ...emptyEpisode, seriesId: data.series[0]?.id || "", mediaAssetId: data.approvedAudio[0]?.id || "" });
  }

  const allEpisodes = useMemo(() => (data?.series || []).flatMap((series) => series.episodes.map((episode) => ({ ...episode, series }))), [data]);

  function draftFor(episode) {
    return drafts[episode.id] || { title: episode.title || "", summary: episode.summary || "", accessibleDescription: episode.accessibleDescription || "", languageCode: episode.transcript?.languageCode || "en", seasonNumber: episode.seasonNumber || "", episodeNumber: episode.episodeNumber || "", explicit: episode.explicit, transcript: transcriptText(episode.transcript?.segmentsJson), chapters: chaptersText(episode.chaptersJson) };
  }

  async function saveEpisode(episode, submitTranscript) {
    const draft = draftFor(episode);
    await act({ action: "SAVE_EDITOR", podcastEpisodeId: episode.id, ...requestBody(draft), submitTranscript }, submitTranscript ? "Episode saved and transcript submitted for approval." : "Episode draft saved privately.");
  }

  if (!data) return <main className={styles.page}><p className={styles.loading}>{error || "Loading Podcasts…"}</p></main>;
  const eligibleChannels = data.channels.filter((channel) => !seriesForm.stationId || channel.stationId === seriesForm.stationId);
  const productCopy = product === "HEALTH"
    ? { eyebrow: "RUVANAS HEALTH · PODCASTS", title: "Health listen-again", description: "Prepare accessible, reviewed wellbeing and hospital-radio programmes. Public release is available only for channels explicitly marked public.", href: "/dashboard/health", back: "Health dashboard" }
    : product === "FAITH"
      ? { eyebrow: "RUVANAS FAITH · PODCASTS", title: "Sermons, teachings & podcasts", description: "Prepare reviewed listen-again audio and publish it only to the audience selected by your organisation.", href: "/dashboard/faith", back: "Faith dashboard" }
      : { eyebrow: "ONLINE RADIO · PODCASTS", title: "Podcast studio", description: "Create station-branded series, prepare accessible episodes and publish protected audio with a standards-based RSS feed.", href: "/dashboard/radio", back: "Online Radio dashboard" };
  return <main className={styles.page}>
    <header className={styles.hero}><div><p className={styles.eyebrow}>{productCopy.eyebrow}</p><h1>{productCopy.title}</h1><p>{productCopy.description}</p></div><Link href={productCopy.href} className={styles.back}>{productCopy.back}</Link></header>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    <section className={styles.metrics}><article><strong>{data.series.length}</strong><span>Series</span></article><article><strong>{allEpisodes.length}</strong><span>Episodes</span></article><article><strong>{allEpisodes.filter((item) => item.status === "PUBLISHED").length}</strong><span>Published</span></article><article><strong>{data.approvedAudio.length}</strong><span>Approved audio</span></article></section>
    <section className={styles.setup}>
      <form className={styles.card} onSubmit={createSeries}><p className={styles.eyebrow}>1 · SERIES</p><h2>Create a series</h2><label>Station<select value={seriesForm.stationId} onChange={(event) => setSeriesForm({ ...seriesForm, stationId: event.target.value, channelId: "" })} required><option value="">Choose station…</option>{data.stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Channel <small>optional</small><select value={seriesForm.channelId} onChange={(event) => setSeriesForm({ ...seriesForm, channelId: event.target.value })}><option value="">Whole station</option>{eligibleChannels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Series title<input value={seriesForm.title} onChange={(event) => setSeriesForm({ ...seriesForm, title: event.target.value })} required /></label><label>Description<textarea value={seriesForm.description} onChange={(event) => setSeriesForm({ ...seriesForm, description: event.target.value })} /></label><div className={styles.columns}><label>Feed address <small>optional</small><input value={seriesForm.feedSlug} onChange={(event) => setSeriesForm({ ...seriesForm, feedSlug: event.target.value })} placeholder="morning-show" /></label><label>Author<input value={seriesForm.author} onChange={(event) => setSeriesForm({ ...seriesForm, author: event.target.value })} placeholder={data.organisation.name} /></label></div><label>Square artwork URL <small>optional</small><input type="url" value={seriesForm.artworkUrl} onChange={(event) => setSeriesForm({ ...seriesForm, artworkUrl: event.target.value })} /></label><button disabled={working || !data.stations.length}>Create private series</button></form>
      <form className={styles.card} onSubmit={createEpisode}><p className={styles.eyebrow}>2 · EPISODE</p><h2>Start an episode</h2><label>Series<select value={episodeForm.seriesId} onChange={(event) => setEpisodeForm({ ...episodeForm, seriesId: event.target.value })} required><option value="">Choose series…</option>{data.series.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>Approved audio<select value={episodeForm.mediaAssetId} onChange={(event) => setEpisodeForm({ ...episodeForm, mediaAssetId: event.target.value })} required><option value="">Choose audio…</option>{data.approvedAudio.map((item) => <option value={item.id} key={item.id}>{item.name}{item.durationSeconds ? ` · ${Math.round(item.durationSeconds / 60)} min` : ""}</option>)}</select></label><label>Episode title<input value={episodeForm.title} onChange={(event) => setEpisodeForm({ ...episodeForm, title: event.target.value })} required /></label><label>Summary<textarea value={episodeForm.summary} onChange={(event) => setEpisodeForm({ ...episodeForm, summary: event.target.value })} /></label><div className={styles.columns}><label>Season <small>optional</small><input type="number" min="1" value={episodeForm.seasonNumber} onChange={(event) => setEpisodeForm({ ...episodeForm, seasonNumber: event.target.value })} /></label><label>Episode no. <small>optional</small><input type="number" min="1" value={episodeForm.episodeNumber} onChange={(event) => setEpisodeForm({ ...episodeForm, episodeNumber: event.target.value })} /></label></div><label className={styles.check}><input type="checkbox" checked={episodeForm.explicit} onChange={(event) => setEpisodeForm({ ...episodeForm, explicit: event.target.checked })} /> Contains explicit material</label><button disabled={working || !data.series.length || !data.approvedAudio.length}>Create episode draft</button><p className={styles.hint}>{!data.approvedAudio.length ? <>No approved station audio is available. <Link href="/dashboard/media">Upload and submit audio first.</Link></> : "Only audio with current Ruvanas approval can be selected."}</p></form>
    </section>
    <section className={styles.library}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>3 · EDIT & PUBLISH</p><h2>Episodes</h2></div><button className={styles.refresh} onClick={load}>Refresh</button></div>
      {!allEpisodes.length ? <div className={styles.empty}>Create a series and episode to open the editor.</div> : allEpisodes.map((episode) => { const draft = draftFor(episode); const publicUrl = `/podcasts/${data.organisation.slug}/${episode.series.feedSlug}`; const rssUrl = `/api/public/podcasts/${data.organisation.slug}/${episode.series.feedSlug}/rss`; return <article className={styles.episode} key={episode.id}><div className={styles.episodeHead}><div><span>{episode.series.title}</span><h3>{episode.title}</h3><p>{episode.mediaAsset?.name} · {episode.series.station.name}</p></div><div className={styles.badges}><b>{episode.transcript?.status || "NO TRANSCRIPT"}</b><b>{episode.status}</b></div></div><div className={styles.columns}><label>Title<input value={draft.title} onChange={(event) => setDrafts({ ...drafts, [episode.id]: { ...draft, title: event.target.value } })} /></label><label>Summary<textarea value={draft.summary} onChange={(event) => setDrafts({ ...drafts, [episode.id]: { ...draft, summary: event.target.value } })} /></label></div><div className={styles.columns}><label>Transcript <small>time-time | speaker | words</small><textarea className={styles.editor} value={draft.transcript} onChange={(event) => setDrafts({ ...drafts, [episode.id]: { ...draft, transcript: event.target.value } })} placeholder="0:00-0:08 | Host | Welcome to the show." /></label><label>Chapters <small>time | title</small><textarea className={styles.editor} value={draft.chapters} onChange={(event) => setDrafts({ ...drafts, [episode.id]: { ...draft, chapters: event.target.value } })} placeholder="0:00 | Introduction" /></label></div><label>Accessible description<textarea value={draft.accessibleDescription} onChange={(event) => setDrafts({ ...drafts, [episode.id]: { ...draft, accessibleDescription: event.target.value } })} /></label><div className={styles.actions}><button className={styles.secondary} disabled={working} onClick={() => saveEpisode(episode, false)}>Save draft</button><button className={styles.secondary} disabled={working} onClick={() => saveEpisode(episode, true)}>Submit transcript</button>{data.permissions.canPublish && episode.transcript?.status === "NEEDS_REVIEW" ? <button className={styles.secondary} disabled={working} onClick={() => act({ action: "APPROVE_TRANSCRIPT", podcastEpisodeId: episode.id }, "Transcript approved.")}>Approve transcript</button> : null}{data.permissions.canPublish && episode.status !== "PUBLISHED" ? <button disabled={working} onClick={() => act({ action: "PUBLISH", podcastEpisodeId: episode.id }, "Podcast episode is now public and included in RSS.")}>Publish</button> : null}{data.permissions.canPublish && episode.status === "PUBLISHED" ? <button className={styles.danger} disabled={working} onClick={() => act({ action: "UNPUBLISH", podcastEpisodeId: episode.id, reason: "Withdrawn by an organisation manager for editorial review." }, "Episode withdrawn from public delivery.")}>Unpublish</button> : null}{episode.status === "PUBLISHED" ? <><a href={publicUrl} target="_blank" rel="noreferrer">Public page</a><a href={rssUrl} target="_blank" rel="noreferrer">RSS</a></> : null}</div></article>; })}
    </section>
  </main>;
}
