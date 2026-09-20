"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./simple-playlists.module.css";

const emptyPlaylist = { name: "", durationValue: 1, durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: [] };
const zonedInput = (value, timezone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export default function SimplePlaylistWorkspace() {
  const [data, setData] = useState(null);
  const [channelId, setChannelId] = useState("");
  const [playlistChannelId, setPlaylistChannelId] = useState("");
  const [nonStopGenres, setNonStopGenres] = useState([]);
  const [nonStopEnabled, setNonStopEnabled] = useState(false);
  const [playlist, setPlaylist] = useState(emptyPlaylist);
  const [editingId, setEditingId] = useState(null);
  const [schedule, setSchedule] = useState({ channelId: "", playlistId: "", startsAt: "", endsAt: "", timezone: "Europe/Malta" });
  const [editingEventId, setEditingEventId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragged, setDragged] = useState(null);

  async function load() {
    const response = await fetch("/api/programming/simple", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load playlists.");
    setData(result);
    const chosen = result.channels.find((item) => item.id === channelId) || result.channels[0];
    if (chosen) {
      setChannelId(chosen.id);
      setPlaylistChannelId((current) => current || chosen.id);
      setNonStopEnabled(chosen.nonStop.enabled);
      setNonStopGenres(chosen.nonStop.genreCodes);
      setSchedule((current) => ({ ...current, channelId: current.channelId || chosen.id, timezone: current.channelId ? current.timezone : chosen.timezone }));
    }
  }
  useEffect(() => { load().catch((issue) => setError(issue.message)); }, []);

  const channel = data?.channels.find((item) => item.id === channelId);
  const playlistChannel = data?.channels.find((item) => item.id === playlistChannelId);
  const scheduleChannel = data?.channels.find((item) => item.id === schedule.channelId);
  const compatible = useMemo(() => data?.playlists.filter((item) => item.rightsUse === scheduleChannel?.rightsUse) || [], [data, scheduleChannel]);
  const genreName = (code) => data?.genres.find((item) => item.code === code)?.name || code.replaceAll("_", " ");

  async function send(url, options) {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
      const result = await response.json();
      if (!response.ok) { const issue = new Error(result.error || "The change could not be saved."); issue.affectedEvents = result.affectedEvents; throw issue; }
      await load();
      return result;
    } finally { setBusy(false); }
  }

  function chooseChannel(id) {
    const selected = data.channels.find((item) => item.id === id);
    setChannelId(id);
    setNonStopEnabled(selected?.nonStop.enabled || false);
    setNonStopGenres(selected?.nonStop.genreCodes || []);
    setSchedule((current) => ({ ...current, channelId: id, playlistId: "", timezone: selected?.timezone || "Europe/Malta" }));
  }

  async function saveNonStop(enabled = nonStopEnabled) {
    try {
      const result = await send("/api/programming/simple/nonstop", { method: "PUT", body: JSON.stringify({ channelId, enabled, genreCodes: nonStopGenres }) });
      setMessage(result.enabled ? `AutoDJ Non-Stop is on. ${result.playableTrackCount} rights-approved songs are ready.` : "AutoDJ Non-Stop is off.");
    } catch (issue) { setNonStopEnabled(channel?.nonStop.enabled === true); setError(issue.message); }
  }

  function toggleGenre(code) {
    setPlaylist((current) => ({ ...current, genreCodes: current.genreCodes.includes(code) ? current.genreCodes.filter((item) => item !== code) : [...current.genreCodes, code] }));
  }
  function moveSlot(from, to) {
    if (to < 0 || to >= playlist.genreCodes.length || from === to) return;
    setPlaylist((current) => { const genreCodes = [...current.genreCodes]; genreCodes.splice(to, 0, genreCodes.splice(from, 1)[0]); return { ...current, genreCodes }; });
  }

  async function savePlaylist() {
    try {
      const result = await send(editingId ? `/api/programming/simple/${editingId}` : "/api/programming/simple", { method: editingId ? "PATCH" : "POST", body: JSON.stringify({ ...playlist, channelId: playlistChannelId }) });
      setMessage(`Saved “${result.playlist.name}”.`); setPlaylist(emptyPlaylist); setEditingId(null);
    } catch (issue) { setError(issue.message); }
  }
  function editPlaylist(item) {
    setEditingId(item.id);
    setPlaylistChannelId(data.channels.find((channel) => channel.rightsUse === item.rightsUse)?.id || playlistChannelId);
    setPlaylist({ name: item.name, durationValue: item.durationMinutes % 1440 === 0 ? item.durationMinutes / 1440 : item.durationMinutes / 60, durationUnit: item.durationMinutes % 1440 === 0 ? "DAYS" : "HOURS", buildMode: item.buildMode, genreCodes: item.genreCodes });
    document.getElementById("simple-playlist-builder")?.scrollIntoView({ behavior: "smooth" });
  }
  async function duplicatePlaylist(item) {
    try { await send(`/api/programming/simple/${item.id}`, { method: "POST", body: JSON.stringify({ action: "duplicate" }) }); setMessage(`Copied “${item.name}”.`); } catch (issue) { setError(issue.message); }
  }
  async function archivePlaylist(item) {
    try {
      await send(`/api/programming/simple/${item.id}`, { method: "DELETE" });
      setMessage(`Archived “${item.name}”.`);
    } catch (issue) {
      if (issue.affectedEvents && window.confirm(`${issue.message} Archive it and cancel those schedule items?`)) {
        try { await send(`/api/programming/simple/${item.id}?confirm=true`, { method: "DELETE" }); setMessage(`Archived “${item.name}” and cancelled its schedule items.`); } catch (retry) { setError(retry.message); }
      } else setError(issue.message);
    }
  }

  async function addSchedule() {
    try {
      const result = await send(editingEventId ? `/api/programming/simple/events/${editingEventId}` : "/api/programming/simple/events", { method: editingEventId ? "PATCH" : "POST", body: JSON.stringify(schedule) });
      setMessage(`${editingEventId ? "Updated" : "Scheduled"} the playlist for ${new Date(result.event.startsAt).toLocaleString("en-GB", { timeZone: result.event.timezone })}.`);
      setEditingEventId(null);
      setSchedule((current) => ({ ...current, playlistId: "", startsAt: "", endsAt: "" }));
    } catch (issue) { setError(issue.message); }
  }
  function editSchedule(item) {
    setEditingEventId(item.id);
    setSchedule({ channelId: item.channelId, playlistId: item.playlistId, startsAt: zonedInput(item.startsAt, item.timezone), endsAt: zonedInput(item.endsAt, item.timezone), timezone: item.timezone });
    document.getElementById("simple-playlist-schedule")?.scrollIntoView({ behavior: "smooth" });
  }
  async function cancelSchedule(item) {
    if (!window.confirm(`Cancel “${item.playlistName}” on ${item.channelName}?`)) return;
    try { await send(`/api/programming/simple/events/${item.id}`, { method: "DELETE" }); setMessage("Schedule item cancelled."); } catch (issue) { setError(issue.message); }
  }

  if (!data && !error) return <section className={styles.panel}>Loading playlists…</section>;
  if (!data) return <section className={styles.panel} role="alert">{error}</section>;
  return <div className={styles.layout}>
    {message && <p className={styles.success} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!data.channels.length && <section className={styles.panel}><h2>Create a channel first</h2><p>Your playlists will belong to your organisation and can be scheduled on its channels. You can prepare them before streaming details are entered.</p><a href="/dashboard">Open your product dashboard</a></section>}
    {data.channels.length > 0 && <>
      <section className={styles.panel} aria-labelledby="nonstop-title">
        <p className={styles.kicker}>1 · SIMPLE CONTINUOUS MUSIC</p><h2 id="nonstop-title">AutoDJ Non-Stop</h2>
        <p>Keep approved music playing when no scheduled programme is active. Streaming connection details remain with Ruvanas.</p>
        <label>Channel<select value={channelId} onChange={(event) => chooseChannel(event.target.value)}>{data.channels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.productFamily}</option>)}</select></label>
        <p className={styles.hint}>{channel?.streamingStatus === "RIGHTS_PROFILE_REQUIRED" ? "Ask Ruvanas to classify this channel's music-rights pillar before using playlists." : channel?.streamingStatus === "CONFIGURED" ? "Streaming details saved" : channel?.streamingStatus === "RUVANAS_PLAYBACK" ? "Ruvanas playback channel ready for music setup" : "Pending manual streaming configuration · you can prepare music now"}</p>
        <label className={styles.toggle}><input type="checkbox" checked={nonStopEnabled} disabled={!data.canManage || busy || !channel?.rightsUse} onChange={(event) => { setNonStopEnabled(event.target.checked); saveNonStop(event.target.checked); }} /> AutoDJ Non-Stop {nonStopEnabled ? "ON" : "OFF"}</label>
        <details><summary>Limit music to selected genres (optional)</summary><p>Leave all unchecked to use every eligible genre.</p><div className={styles.genreGrid}>{data.genres.map((genre) => <label key={genre.id}><input type="checkbox" checked={nonStopGenres.includes(genre.code)} disabled={!data.canManage || busy} onChange={() => setNonStopGenres((current) => current.includes(genre.code) ? current.filter((code) => code !== genre.code) : [...current, genre.code])} />{genre.name}</label>)}</div></details>
        <button type="button" disabled={!data.canManage || busy || !channel?.rightsUse} onClick={() => saveNonStop()}>Save genre choices</button>
      </section>
      <section className={styles.panel} id="simple-playlist-builder" aria-labelledby="builder-title">
        <p className={styles.kicker}>2 · REUSABLE MUSIC</p><h2 id="builder-title">Saved Playlists</h2>
        <p>Choose a duration and genre pattern. Ruvanas chooses rights-approved songs when playback runs.</p>
        {!data.genres.length && <p className={styles.hint}>No music genres are available yet. Add genre tags to approved songs in the <a href="/dashboard/media">Media Library</a> before building a playlist.</p>}
        <label>Music for<select value={playlistChannelId} disabled={!data.canManage || busy || Boolean(editingId)} onChange={(event) => setPlaylistChannelId(event.target.value)}>{data.channels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.productFamily}{item.rightsUse ? "" : " · rights setup needed"}</option>)}</select></label>
        <div className={styles.row}><label>Playlist name<input value={playlist.name} maxLength={120} disabled={!data.canManage || busy} placeholder="Morning" onChange={(event) => setPlaylist((current) => ({ ...current, name: event.target.value }))} /></label><label>Length<input type="number" min="1" max="30" value={playlist.durationValue} disabled={!data.canManage || busy} onChange={(event) => setPlaylist((current) => ({ ...current, durationValue: event.target.value }))} /></label><label>Unit<select value={playlist.durationUnit} disabled={!data.canManage || busy} onChange={(event) => setPlaylist((current) => ({ ...current, durationUnit: event.target.value }))}><option value="HOURS">Hours</option><option value="DAYS">Days</option></select></label></div>
        <div className={styles.methods}><label className={playlist.buildMode === "RANDOM_GENRE_POOL" ? styles.selectedMethod : styles.method}><input type="radio" name="playlist-method" checked={playlist.buildMode === "RANDOM_GENRE_POOL"} disabled={!data.canManage || busy} onChange={() => setPlaylist((current) => ({ ...current, buildMode: "RANDOM_GENRE_POOL", genreCodes: [...new Set(current.genreCodes)] }))} /><strong>Random Genre Mix</strong><span>Choose genres; songs play in a varied order.</span></label><label className={playlist.buildMode === "GENRE_SEQUENCE" ? styles.selectedMethod : styles.method}><input type="radio" name="playlist-method" checked={playlist.buildMode === "GENRE_SEQUENCE"} disabled={!data.canManage || busy} onChange={() => setPlaylist((current) => ({ ...current, buildMode: "GENRE_SEQUENCE" }))} /><strong>Genre Sequence</strong><span>Choose an order; it repeats for the playlist duration.</span></label></div>
        {playlist.buildMode === "RANDOM_GENRE_POOL" ? <div className={styles.genreGrid}>{data.genres.map((genre) => <label key={genre.id}><input type="checkbox" checked={playlist.genreCodes.includes(genre.code)} disabled={!data.canManage || busy} onChange={() => toggleGenre(genre.code)} />{genre.name}</label>)}</div> : <div><div className={styles.row}><label>Add a genre slot<select value="" disabled={!data.canManage || busy} onChange={(event) => setPlaylist((current) => ({ ...current, genreCodes: [...current.genreCodes, event.target.value] }))}><option value="">Choose genre…</option>{data.genres.map((genre) => <option key={genre.id} value={genre.code}>{genre.name}</option>)}</select></label></div><ol className={styles.sequence}>{playlist.genreCodes.map((code, index) => <li key={`${index}-${code}`} draggable={data.canManage && !busy} onDragStart={() => setDragged(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { moveSlot(dragged, index); setDragged(null); }}><span>{genreName(code)}</span><div><button type="button" aria-label={`Move ${genreName(code)} up`} disabled={index === 0 || busy} onClick={() => moveSlot(index, index - 1)}>↑</button><button type="button" aria-label={`Move ${genreName(code)} down`} disabled={index === playlist.genreCodes.length - 1 || busy} onClick={() => moveSlot(index, index + 1)}>↓</button><button type="button" aria-label={`Duplicate ${genreName(code)}`} disabled={busy} onClick={() => setPlaylist((current) => ({ ...current, genreCodes: current.genreCodes.flatMap((item, position) => position === index ? [item, item] : [item]) }))}>Duplicate</button><button type="button" aria-label={`Remove ${genreName(code)}`} disabled={busy} onClick={() => setPlaylist((current) => ({ ...current, genreCodes: current.genreCodes.filter((_, position) => position !== index) }))}>Remove</button></div></li>)}</ol></div>}
        <p className={styles.summary}><strong>Preview:</strong> {playlist.name || "Untitled"} · {playlist.durationValue} {playlist.durationUnit.toLowerCase()} · {playlist.buildMode === "GENRE_SEQUENCE" ? "Genre Sequence" : "Random Genre Mix"} · {playlist.genreCodes.length ? playlist.genreCodes.map(genreName).join(" → ") : "Choose genres"}</p>
        <div className={styles.actions}><button type="button" disabled={!data.canManage || busy || !playlistChannel?.rightsUse || !playlist.name.trim() || !playlist.genreCodes.length} onClick={savePlaylist}>{editingId ? "Save changes" : "Save playlist"}</button>{editingId && <button type="button" className={styles.secondary} onClick={() => { setEditingId(null); setPlaylist(emptyPlaylist); }}>Cancel edit</button>}</div>
        <div className={styles.cards}>{data.playlists.map((item) => <article key={item.id} className={styles.card}><h3>{item.name}</h3><p>{item.durationMinutes % 1440 === 0 ? `${item.durationMinutes / 1440} day(s)` : `${item.durationMinutes / 60} hour(s)`} · {item.buildMode === "GENRE_SEQUENCE" ? "Genre Sequence" : "Random Genre Mix"}</p><small>{item.genreCodes.map(genreName).join(" · ")}</small><div className={styles.actions}><button type="button" className={styles.secondary} disabled={!data.canManage || busy} onClick={() => { setSchedule((current) => ({ ...current, playlistId: item.id })); document.getElementById("simple-playlist-schedule")?.scrollIntoView({ behavior: "smooth" }); }}>Schedule</button><button type="button" className={styles.secondary} disabled={!data.canManage || busy} onClick={() => editPlaylist(item)}>Edit</button><button type="button" className={styles.secondary} disabled={!data.canManage || busy} onClick={() => duplicatePlaylist(item)}>Duplicate</button><button type="button" className={styles.danger} disabled={!data.canManage || busy} onClick={() => archivePlaylist(item)}>Archive</button></div></article>)}</div>
      </section>
      <section className={styles.panel} id="simple-playlist-schedule" aria-labelledby="schedule-title">
        <p className={styles.kicker}>3 · PLAN A TIME SLOT</p>
        <h2 id="schedule-title">Advanced AutoDJ Schedule</h2>
        <p>Place a saved playlist on one of your channels. At the end, Non-Stop resumes if it is on.</p>
        <div className={styles.row}>
          <label>Channel<select value={schedule.channelId} disabled={!data.canManage || busy} onChange={(event) => { const selected = data.channels.find((item) => item.id === event.target.value); setSchedule((current) => ({ ...current, channelId: event.target.value, playlistId: "", timezone: selected?.timezone || "Europe/Malta" })); }}>{data.channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Saved Playlist<select value={schedule.playlistId} disabled={!data.canManage || busy} onChange={(event) => setSchedule((current) => ({ ...current, playlistId: event.target.value }))}><option value="">Choose playlist…</option>{compatible.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Time zone<input value={schedule.timezone} disabled={!data.canManage || busy} onChange={(event) => setSchedule((current) => ({ ...current, timezone: event.target.value }))} aria-describedby="playlist-timezone-help" /></label>
        </div>
        <p id="playlist-timezone-help" className={styles.hint}>Times below use this channel&apos;s time zone. For a physical location, use its saved location time zone.</p>
        <div className={styles.row}>
          <label>Starts<input type="datetime-local" value={schedule.startsAt} disabled={!data.canManage || busy} min={zonedInput(new Date(), scheduleChannel?.timezone || "Europe/Malta")} onChange={(event) => setSchedule((current) => ({ ...current, startsAt: event.target.value }))} /></label>
          <label>Ends<input type="datetime-local" value={schedule.endsAt} disabled={!data.canManage || busy} onChange={(event) => setSchedule((current) => ({ ...current, endsAt: event.target.value }))} /></label>
        </div>
        <div className={styles.actions}><button type="button" disabled={!data.canManage || busy || !scheduleChannel?.rightsUse || !schedule.playlistId || !schedule.startsAt || !schedule.endsAt} onClick={addSchedule}>{editingEventId ? "Save schedule changes" : "Schedule playlist"}</button>{editingEventId && <button type="button" className={styles.secondary} onClick={() => { setEditingEventId(null); setSchedule((current) => ({ ...current, playlistId: "", startsAt: "", endsAt: "" })); }}>Cancel edit</button>}</div>
        <h3>Upcoming schedule</h3>
        {data.events.length ? <ul className={styles.events}>{data.events.map((item) => <li key={item.id}><div><strong>{item.playlistName}</strong> · {item.channelName}<br /><small>{new Date(item.startsAt).toLocaleString("en-GB", { timeZone: item.timezone })} – {new Date(item.endsAt).toLocaleString("en-GB", { timeZone: item.timezone })} ({item.timezone})</small></div><div className={styles.actions}><button type="button" className={styles.secondary} disabled={!data.canManage || busy} onClick={() => editSchedule(item)}>Edit</button><button type="button" className={styles.danger} disabled={!data.canManage || busy} onClick={() => cancelSchedule(item)}>Cancel</button></div></li>)}</ul> : <p>No upcoming playlist times yet.</p>}
      </section>
    </>}
  </div>;
}
