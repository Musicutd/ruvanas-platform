"use client";

import { useEffect, useMemo, useState } from "react";
import { nonStopSettingsChanged, summariseChannelPlaylistPlan } from "@/lib/subscriber-autodj-workspace.mjs";
import { filterSavedPlaylists, onlineRadioPlanningData, playlistFormIssues, playlistFormSnapshot } from "@/lib/online-radio-workspace.mjs";
import styles from "./simple-playlists.module.css";

const emptyPlaylist = { name: "", durationValue: 1, durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: [] };
const zonedInput = (value, timezone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export default function SimplePlaylistWorkspace({ availableProducts = [], onlineOnly = false, planningOnly = false }) {
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
  const [catalogue, setCatalogue] = useState(null);
  const [catalogueError, setCatalogueError] = useState("");
  const [browseProduct, setBrowseProduct] = useState(availableProducts[0]?.key || "");
  const [snapshotAt, setSnapshotAt] = useState(null);
  const [clock, setClock] = useState(null);
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [playlistBaseline, setPlaylistBaseline] = useState(() => playlistFormSnapshot(emptyPlaylist));
  const [attemptedSave, setAttemptedSave] = useState(false);

  async function load({ refreshNonStop = false } = {}) {
    const response = await fetch("/api/programming/simple", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load playlists.");
    const result = onlineOnly ? onlineRadioPlanningData(payload) : payload;
    setData(result);
    const loadedAt = new Date();
    setSnapshotAt(loadedAt); setClock(loadedAt);
    const chosen = result.channels.find((item) => item.id === channelId) || result.channels[0];
    if (chosen) {
      setChannelId(chosen.id);
      setPlaylistChannelId((current) => current || chosen.id);
      if (refreshNonStop || chosen.id !== channelId) {
        setNonStopEnabled(chosen.nonStop.enabled);
        setNonStopGenres(chosen.nonStop.genreCodes);
      }
      setSchedule((current) => ({ ...current, channelId: current.channelId || chosen.id, timezone: current.channelId ? current.timezone : chosen.timezone }));
    }
  }
  useEffect(() => { load().catch((issue) => setError(issue.message)); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    // The draft sandbox has genre choices from its configuration API only.
    // It must not fetch or imply licensed catalogue/audio access.
    if (!data || data.sandboxDraftOnly === true || planningOnly) return;
    if (!channelId && !browseProduct) return;
    const controller = new AbortController();
    setCatalogue(null); setCatalogueError("");
    const catalogueQuery = channelId ? `channelId=${encodeURIComponent(channelId)}` : `product=${encodeURIComponent(browseProduct)}`;
    fetch(`/api/catalogue/music?${catalogueQuery}&limit=6`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to load approved music."); return payload; })
      .then(setCatalogue)
      .catch((issue) => { if (issue.name !== "AbortError") setCatalogueError(issue.message); });
    return () => controller.abort();
  }, [channelId, browseProduct, data, planningOnly]);

  const channel = data?.channels.find((item) => item.id === channelId);
  const playlistChannel = data?.channels.find((item) => item.id === playlistChannelId);
  const scheduleChannel = data?.channels.find((item) => item.id === schedule.channelId);
  const sandboxDraftOnly = data?.sandboxDraftOnly === true;
  const canSchedule = !planningOnly && !sandboxDraftOnly && data?.canSchedule !== false && data?.canManage === true;
  const unsavedPlaylist = playlistFormSnapshot(playlist) !== playlistBaseline;
  const playlistIssues = playlistFormIssues(playlist, playlistChannel, onlineOnly ? "ONLINE_RADIO" : null);
  const visiblePlaylists = useMemo(() => filterSavedPlaylists(data?.playlists, playlistSearch), [data, playlistSearch]);
  const unsavedNonStop = nonStopSettingsChanged(channel?.nonStop, nonStopEnabled, nonStopGenres);
  const channelPlan = useMemo(() => summariseChannelPlaylistPlan(data?.events, channelId, clock), [data, channelId, clock]);
  const compatible = useMemo(() => data?.playlists.filter((item) => item.rightsUse === scheduleChannel?.rightsUse) || [], [data, scheduleChannel]);
  const genreName = (code) => data?.genres.find((item) => item.code === code)?.name || code.replaceAll("_", " ");
  const planTime = (value) => new Date(value).toLocaleString("en-GB", { timeZone: channel?.timezone || "Europe/Malta", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    if (!unsavedNonStop && !unsavedPlaylist) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsavedNonStop, unsavedPlaylist]);

  async function send(url, options, reloadOptions) {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
      const result = await response.json();
      if (!response.ok) { const issue = new Error(result.error || "The change could not be saved."); issue.affectedEvents = result.affectedEvents; throw issue; }
      await load(reloadOptions);
      return result;
    } finally { setBusy(false); }
  }

  function chooseChannel(id) {
    if (unsavedNonStop && !window.confirm("Discard your unsaved AutoDJ changes and switch channel?")) return;
    if ((unsavedPlaylist || editingId) && !window.confirm("Discard your unsaved playlist edits and switch channel? Saved playlists will stay unchanged.")) return;
    const selected = data.channels.find((item) => item.id === id);
    setChannelId(id);
    setPlaylistChannelId(id);
    setPlaylist(emptyPlaylist); setPlaylistBaseline(playlistFormSnapshot(emptyPlaylist)); setEditingId(null); setAttemptedSave(false);
    setNonStopEnabled(selected?.nonStop.enabled || false);
    setNonStopGenres(selected?.nonStop.genreCodes || []);
    setMessage(""); setError("");
    setSchedule((current) => ({ ...current, channelId: id, playlistId: "", timezone: selected?.timezone || "Europe/Malta" }));
  }

  async function saveNonStop() {
    if (planningOnly || sandboxDraftOnly || !data?.canManage) return;
    try {
      const result = await send("/api/programming/simple/nonstop", { method: "PUT", body: JSON.stringify({ channelId, enabled: nonStopEnabled, genreCodes: nonStopGenres }) }, { refreshNonStop: true });
      setMessage(result.enabled ? `AutoDJ Non-Stop is on. ${result.playableTrackCount} rights-approved songs are ready.` : "AutoDJ Non-Stop is off.");
    } catch (issue) { setError(`${issue.message} Refresh the saved status before retrying if the connection was interrupted.`); }
  }

  function discardNonStop() {
    setNonStopEnabled(channel?.nonStop.enabled === true);
    setNonStopGenres(channel?.nonStop.genreCodes || []);
    setError("");
  }

  async function refreshSnapshot() {
    if (unsavedNonStop && !window.confirm("Discard your unsaved AutoDJ changes and refresh the saved status?")) return;
    setBusy(true); setError(""); setMessage("");
    try { await load({ refreshNonStop: true }); } catch (issue) { setError(issue.message); } finally { setBusy(false); }
  }

  function toggleGenre(code) {
    setPlaylist((current) => ({ ...current, genreCodes: current.genreCodes.includes(code) ? current.genreCodes.filter((item) => item !== code) : [...current.genreCodes, code] }));
  }
  function revealSection(id) {
    const section = document.getElementById(id);
    const disclosure = section?.closest("details");
    if (disclosure) disclosure.open = true;
    section?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function moveSlot(from, to) {
    if (!data?.canManage || busy || to < 0 || to >= playlist.genreCodes.length || from === to) return;
    setPlaylist((current) => { const genreCodes = [...current.genreCodes]; genreCodes.splice(to, 0, genreCodes.splice(from, 1)[0]); return { ...current, genreCodes }; });
  }

  async function savePlaylist() {
    setAttemptedSave(true);
    if (!data?.canManage || playlistIssues.length) return;
    if (editingId && !sandboxDraftOnly && !window.confirm("Save changes to this existing playlist? Programmes or active time slots that use it may select different music. Saving does not switch broadcasting on.")) return;
    try {
      const result = await send(editingId ? `/api/programming/simple/${editingId}` : "/api/programming/simple", { method: editingId ? "PATCH" : "POST", body: JSON.stringify({ ...playlist, channelId: playlistChannelId }) });
      setMessage(`Saved “${result.playlist.name}”. ${sandboxDraftOnly ? "Private draft only; no audio is started." : "No new time slot or weekly plan was published."}`);
      setPlaylist(emptyPlaylist); setPlaylistBaseline(playlistFormSnapshot(emptyPlaylist)); setEditingId(null); setAttemptedSave(false);
      window.dispatchEvent(new Event("ruvanas:playlists-changed"));
    } catch (issue) { setError(issue.message); }
  }
  function editPlaylist(item) {
    if (unsavedPlaylist && !window.confirm("Discard your unsaved playlist edits and open this saved playlist?")) return;
    setEditingId(item.id);
    setPlaylistChannelId(data.channels.find((channel) => channel.id === channelId && channel.rightsUse === item.rightsUse)?.id || data.channels.find((channel) => channel.rightsUse === item.rightsUse)?.id || playlistChannelId);
    const next = { name: item.name, durationValue: item.durationMinutes % 1440 === 0 ? item.durationMinutes / 1440 : item.durationMinutes / 60, durationUnit: item.durationMinutes % 1440 === 0 ? "DAYS" : "HOURS", buildMode: item.buildMode, genreCodes: item.genreCodes };
    setPlaylist(next); setPlaylistBaseline(playlistFormSnapshot(next)); setAttemptedSave(false);
    revealSection("simple-playlist-builder");
  }
  function newPlaylist() {
    if (unsavedPlaylist && !window.confirm("Discard your unsaved playlist edits and start a new playlist?")) return;
    setEditingId(null); setPlaylist(emptyPlaylist); setPlaylistBaseline(playlistFormSnapshot(emptyPlaylist)); setAttemptedSave(false);
    revealSection("simple-playlist-builder");
  }
  async function duplicatePlaylist(item) {
    try { await send(`/api/programming/simple/${item.id}`, { method: "POST", body: JSON.stringify({ action: "duplicate" }) }); setMessage(`Copied “${item.name}”.`); window.dispatchEvent(new Event("ruvanas:playlists-changed")); } catch (issue) { setError(issue.message); }
  }
  async function archivePlaylist(item) {
    if (sandboxDraftOnly || !data?.canManage) return;
    try {
      await send(`/api/programming/simple/${item.id}`, { method: "DELETE" });
      setMessage(`Archived “${item.name}”.`);
      window.dispatchEvent(new Event("ruvanas:playlists-changed"));
    } catch (issue) {
      if (issue.affectedEvents && window.confirm(`${issue.message} Archive it and cancel those schedule items?`)) {
        try { await send(`/api/programming/simple/${item.id}?confirm=true`, { method: "DELETE" }); setMessage(`Archived “${item.name}” and cancelled its schedule items.`); window.dispatchEvent(new Event("ruvanas:playlists-changed")); } catch (retry) { setError(retry.message); }
      } else setError(issue.message);
    }
  }

  async function addSchedule() {
    if (!canSchedule) return;
    try {
      const result = await send(editingEventId ? `/api/programming/simple/events/${editingEventId}` : "/api/programming/simple/events", { method: editingEventId ? "PATCH" : "POST", body: JSON.stringify(schedule) });
      setMessage(`${editingEventId ? "Updated" : "Scheduled"} the playlist for ${new Date(result.event.startsAt).toLocaleString("en-GB", { timeZone: result.event.timezone })}.`);
      setEditingEventId(null);
      setSchedule((current) => ({ ...current, playlistId: "", startsAt: "", endsAt: "" }));
    } catch (issue) { setError(issue.message); }
  }
  function editSchedule(item) {
    if (!canSchedule) return;
    setEditingEventId(item.id);
    setSchedule({ channelId: item.channelId, playlistId: item.playlistId, startsAt: zonedInput(item.startsAt, item.timezone), endsAt: zonedInput(item.endsAt, item.timezone), timezone: item.timezone });
    revealSection("simple-playlist-schedule");
  }
  async function cancelSchedule(item) {
    if (!canSchedule) return;
    if (!window.confirm(`Cancel “${item.playlistName}” on ${item.channelName}?`)) return;
    try { await send(`/api/programming/simple/events/${item.id}`, { method: "DELETE" }); setMessage("Schedule item cancelled."); } catch (issue) { setError(issue.message); }
  }

  if (!data && !error) return <section className={styles.panel}>Loading playlists…</section>;
  if (!data) return <section className={styles.panel} role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); load().catch((issue) => setError(issue.message)); }}>Try again</button></section>;
  return <div className={styles.layout}>
    {sandboxDraftOnly && <aside className={styles.summary} role="note"><strong>Private Online Radio drafts only.</strong> Save, edit or duplicate playlists and prepare a weekly planner draft. Live AutoDJ, active time slots, broadcasting, uploads, downloads and paid actions are blocked. Saving here cannot start audio.</aside>}
    {message && <p className={styles.success} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {data.channels.length > 0 && <section className={styles.panel} aria-labelledby="channel-plan-title">
      <p className={styles.kicker}>YOUR CHANNEL · SAVED SETTINGS</p>
      <h2 id="channel-plan-title">{sandboxDraftOnly ? "Your private test channel" : planningOnly ? "Choose your station channel" : "AutoDJ at a glance"}</h2>
      <div className={styles.row}>
        <label>Station / channel<select value={channelId} disabled={busy} onChange={(event) => chooseChannel(event.target.value)}>{data.channels.map((item) => <option key={item.id} value={item.id}>{item.stationName ? `${item.stationName} / ` : ""}{item.name} · {item.productFamily}</option>)}</select></label>
        <div className={styles.channelMeta}><strong>Time zone: {channel?.timezone}</strong><span>Status times use this time zone.</span><button type="button" className={styles.secondary} disabled={busy} onClick={refreshSnapshot}>{busy ? "Working…" : "Refresh saved status"}</button></div>
      </div>
      {!sandboxDraftOnly && !planningOnly && <div className={styles.statusGrid}>
        <article className={styles.statusCard}><h3>Automatic music</h3><strong>{channel?.nonStop.enabled ? "Saved: ON" : "Saved: OFF"}</strong><span>{channel?.nonStop.genreCodes.length ? channel.nonStop.genreCodes.map(genreName).join(" · ") : "All eligible genres"}</span><small>{channel?.nonStop.playbackPolicy === "FOLLOW_LOCATION_HOURS" ? "Follows location opening hours" : "24-hour policy"} · scheduled programmes take priority.</small></article>
        <article className={styles.statusCard}><h3>Playlist slot now</h3><strong>{channelPlan.current.length > 1 ? "Overlapping playlist slots — review required" : channelPlan.current[0]?.playlistName || "No playlist slot at this time"}</strong>{channelPlan.current.map((item) => <span key={item.id}>{planTime(item.startsAt)} – {planTime(item.endsAt)}</span>)}<small>This is the saved playlist plan, not confirmation of what is audible.</small></article>
        <article className={styles.statusCard}><h3>Next playlist slot</h3><strong>{channelPlan.next?.playlistName || "No next playlist slot in this snapshot"}</strong>{channelPlan.next && <span>{planTime(channelPlan.next.startsAt)} – {planTime(channelPlan.next.endsAt)}</span>}<small>Recurring programmes are reviewed separately in Weekly planner.</small></article>
      </div>}
      {!sandboxDraftOnly && !planningOnly && <p className={styles.hint}>Snapshot checked {snapshotAt ? planTime(snapshotAt) : "just now"}. Live presenters, emergency overrides, rights checks and other published programmes may change the output. Refresh to check for changes made elsewhere.</p>}
      {!data.canManage && <p className={styles.summary}>View only. An owner, manager or content editor can change automatic music and playlist slots. Only an owner or manager can publish a weekly programme.</p>}
    </section>}
    {!sandboxDraftOnly && !planningOnly && <section className={styles.panel} aria-label="Approved music catalogue">
      <p className={styles.kicker}>APPROVED MUSIC · AVAILABLE AUTOMATICALLY</p>
      <h2>Music for your service</h2>
      {!data.channels.length && availableProducts.length > 1 ? <label>Service<select value={browseProduct} onChange={(event) => setBrowseProduct(event.target.value)}>{availableProducts.map((product) => <option key={product.key} value={product.key}>{product.label}</option>)}</select></label> : null}
      {data.channels.length ? <p className={styles.hint}>Showing music cleared for {channel?.name || "your selected channel"}. Use the selector above to check another service. This is a catalogue count, not the number of songs matching your AutoDJ settings.</p> : <p className={styles.hint}>You can browse approved songs now. A channel is needed only when you are ready to start playback.</p>}
      <div className={styles.cataloguePreview} aria-live="polite">
        <strong>{catalogue ? `${catalogue.total} approved catalogue track${catalogue.total === 1 ? "" : "s"} available` : "Checking the approved catalogue…"}</strong>
        {catalogueError ? <span>{catalogueError}</span> : catalogue?.tracks?.length ? <span>{catalogue.tracks.slice(0, 5).map((track) => `${track.artist} — ${track.title}`).join(" · ")}</span> : catalogue ? <span>No catalogue tracks are cleared for this service, territory and plan yet. Your own approved uploads may still be available.</span> : null}
        <small>This list updates automatically when Ruvanas approves music. Track files cannot be downloaded here. Turning on AutoDJ is a separate step.</small>
        {!catalogue?.territoryKnown ? <small>Music restricted to a country appears once a listening area or channel territory is confirmed.</small> : null}
        {channel?.productFamily === "ONLINE" || !channelId && browseProduct === "ONLINE" ? <small>Licensed catalogue tracks are browseable only for Online Radio until their live-output rights and encoder path are verified.</small> : null}
      </div>
    </section>}
    {!data.channels.length && <section className={styles.panel}><h2>A channel is needed before creating playlists</h2><p>{sandboxDraftOnly ? "Ask your administrator to prepare your private draft channel. No streaming connection is needed for draft planning." : "Ask Ruvanas to prepare your station channel and music-rights profile. You can still browse your music library while setup is completed."}</p><a href={onlineOnly ? "/dashboard/radio" : "/dashboard"}>See your next setup step</a></section>}
    {data.channels.length > 0 && <>
      {!sandboxDraftOnly && !planningOnly && <section className={styles.panel} aria-labelledby="nonstop-title">
        <p className={styles.kicker}>1 · SIMPLE CONTINUOUS MUSIC</p><h2 id="nonstop-title">AutoDJ Non-Stop</h2>
        <p>Keep approved music playing when no scheduled programme is active. Streaming connection details remain with Ruvanas.</p>
        <p className={styles.hint}>If you want music playing all day, start here. Playlists and timed slots below are optional.</p>
        <p className={styles.hint}>{channel?.streamingStatus === "RIGHTS_PROFILE_REQUIRED" ? "Ask Ruvanas to classify this channel's music-rights pillar before using playlists." : channel?.streamingStatus === "CONFIGURED" ? "Streaming details saved" : channel?.streamingStatus === "RUVANAS_PLAYBACK" ? "Ruvanas playback channel ready for music setup" : "Pending manual streaming configuration · you can prepare music now"}</p>
        <label className={styles.toggle}><input type="checkbox" checked={nonStopEnabled} disabled={!data.canManage || busy || !channel?.rightsUse} onChange={(event) => setNonStopEnabled(event.target.checked)} /> Use automatic music between programmes</label>
        <details><summary>Limit music to selected genres (optional)</summary><p>Leave all unchecked to use every eligible genre.</p><div className={styles.genreGrid}>{data.genres.map((genre) => <label key={genre.id}><input type="checkbox" checked={nonStopGenres.includes(genre.code)} disabled={!data.canManage || busy} onChange={() => setNonStopGenres((current) => current.includes(genre.code) ? current.filter((code) => code !== genre.code) : [...current, genre.code])} />{genre.name}</label>)}</div></details>
        <p className={styles.summary} role="status">{unsavedNonStop ? "Unsaved changes — nothing has changed on the channel yet." : "Showing saved AutoDJ settings."} Saving applies your automatic music settings to this channel and may affect live playback. It does not publish a weekly programme.</p>
        <div className={styles.actions}><button type="button" disabled={!data.canManage || busy || !channel?.rightsUse || !unsavedNonStop} onClick={saveNonStop}>{busy ? "Working…" : "Save AutoDJ changes"}</button><button type="button" className={styles.secondary} disabled={busy || !unsavedNonStop} onClick={discardNonStop}>Discard changes</button></div>
      </section>}
      <details className={styles.taskDetails} open={planningOnly || undefined}>
        <summary><span>2 · PLAYLISTS</span><strong>Create or manage playlists{data.playlists.length ? ` · ${data.playlists.length} saved` : ""}</strong><small>Save a reusable music rule for your weekly programmes.</small></summary>
      <section className={styles.panel} id="simple-playlist-builder" aria-labelledby="builder-title">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>YOUR SAVED MUSIC MIXES</p><h2>Saved playlists</h2></div><button type="button" disabled={!data.canManage || busy} onClick={newPlaylist}>New playlist</button></div>
        {data.playlists.length ? <label>Find a saved playlist<input type="search" placeholder="Playlist name or genre" value={playlistSearch} onChange={(event) => setPlaylistSearch(event.target.value)} /></label> : null}
        <div className={styles.cards}>{visiblePlaylists.map((item) => <article key={item.id} className={styles.card}><h3>{item.name}</h3><p>{item.durationMinutes % 1440 === 0 ? `${item.durationMinutes / 1440} day(s)` : `${item.durationMinutes / 60} hour(s)`} · {item.buildMode === "GENRE_SEQUENCE" ? "Genre order" : "Varied music mix"}</p><small>{item.genreCodes.map(genreName).join(" · ")}</small><div className={styles.actions}>{planningOnly ? <a className={styles.nextLink} href="#workspace-planner">Use in weekly planner →</a> : canSchedule ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setSchedule((current) => ({ ...current, playlistId: item.id })); revealSection("simple-playlist-schedule"); }}>Schedule</button> : null}<button type="button" className={styles.secondary} disabled={!data.canManage || busy} onClick={() => editPlaylist(item)}>Edit</button><button type="button" className={styles.secondary} disabled={!data.canManage || busy} onClick={() => duplicatePlaylist(item)}>Duplicate</button>{!sandboxDraftOnly && !planningOnly ? <button type="button" className={styles.danger} disabled={!data.canManage || busy} onClick={() => archivePlaylist(item)}>Archive</button> : null}</div></article>)}</div>
        {!visiblePlaylists.length ? <div className={styles.emptyState}><strong>{data.playlists.length ? "No playlists match your search" : "Create your first playlist below"}</strong><p>{data.playlists.length ? "Try another name or clear the search." : "Choose a name, length and genres. Then use the saved mix in your weekly planner."}</p></div> : null}
        <hr className={styles.divider} />
        <h2 id="builder-title">{editingId ? "Edit playlist" : "Create a playlist"}</h2>
        <p>{sandboxDraftOnly ? "Choose a duration and genre pattern for a private draft. This saves the playlist configuration only; it does not copy audio or start playback." : "Choose a duration and genre pattern. Ruvanas chooses rights-approved songs when playback runs."}</p>
        {!data.genres.length && <p className={styles.hint}>{sandboxDraftOnly ? "No configured genre choices are available yet. Ask the owner to configure a genre before testing playlist drafts." : <>No music genres are available yet. Add genre tags to approved songs in the <a href="/dashboard/media">Media Library</a> before building a playlist.</>}</p>}
        {editingId && !sandboxDraftOnly ? <p className={styles.summary}>This is an existing playlist, not a new draft version. Saving changes may affect programmes or active time slots that already use it. You will be asked to confirm.</p> : null}
        {planningOnly ? <p className={styles.hint}>Playlist music for <strong>{playlistChannel?.name || "your selected channel"}</strong>. Use the station / channel selector above to switch.</p> : <label>Music for<select value={playlistChannelId} disabled={!data.canManage || busy || Boolean(editingId)} onChange={(event) => setPlaylistChannelId(event.target.value)}>{data.channels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.productFamily}{item.rightsUse ? "" : " · rights setup needed"}</option>)}</select></label>}
        <div className={styles.row}><label>Playlist name<input value={playlist.name} maxLength={120} disabled={!data.canManage || busy} placeholder="Morning" onChange={(event) => setPlaylist((current) => ({ ...current, name: event.target.value }))} /></label><label>Length<input type="number" min="1" max="30" value={playlist.durationValue} disabled={!data.canManage || busy} onChange={(event) => setPlaylist((current) => ({ ...current, durationValue: event.target.value }))} /></label><label>Unit<select value={playlist.durationUnit} disabled={!data.canManage || busy} onChange={(event) => setPlaylist((current) => ({ ...current, durationUnit: event.target.value }))}><option value="HOURS">Hours</option><option value="DAYS">Days</option></select></label></div>
        <div className={styles.methods}><label className={playlist.buildMode === "RANDOM_GENRE_POOL" ? styles.selectedMethod : styles.method}><input type="radio" name="playlist-method" checked={playlist.buildMode === "RANDOM_GENRE_POOL"} disabled={!data.canManage || busy} onChange={() => setPlaylist((current) => ({ ...current, buildMode: "RANDOM_GENRE_POOL", genreCodes: [...new Set(current.genreCodes)] }))} /><strong>Random Genre Mix</strong><span>Choose genres; songs play in a varied order.</span></label><label className={playlist.buildMode === "GENRE_SEQUENCE" ? styles.selectedMethod : styles.method}><input type="radio" name="playlist-method" checked={playlist.buildMode === "GENRE_SEQUENCE"} disabled={!data.canManage || busy} onChange={() => setPlaylist((current) => ({ ...current, buildMode: "GENRE_SEQUENCE" }))} /><strong>Genre Sequence</strong><span>Choose an order; it repeats for the playlist duration.</span></label></div>
        {playlist.buildMode === "RANDOM_GENRE_POOL" ? <fieldset className={styles.genreChoices}><legend>Choose music genres</legend><div className={styles.genreGrid}>{data.genres.map((genre) => <label key={genre.id}><input type="checkbox" checked={playlist.genreCodes.includes(genre.code)} disabled={!data.canManage || busy} onChange={() => toggleGenre(genre.code)} />{genre.name}</label>)}</div></fieldset> : <div>
          <div className={styles.row}><label>Add a genre slot<select value="" disabled={!data.canManage || busy} onChange={(event) => setPlaylist((current) => ({ ...current, genreCodes: [...current.genreCodes, event.target.value] }))}><option value="">Choose genre…</option>{data.genres.map((genre) => <option key={genre.id} value={genre.code}>{genre.name}</option>)}</select></label></div>
          <ol className={styles.sequence}>{playlist.genreCodes.map((code, index) => <li key={`${index}-${code}`} draggable={data.canManage && !busy} onDragStart={() => setDragged(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { moveSlot(dragged, index); setDragged(null); }}><span>{genreName(code)}</span><div>
            <button type="button" aria-label={`Move ${genreName(code)} up`} disabled={!data.canManage || index === 0 || busy} onClick={() => moveSlot(index, index - 1)}>↑</button>
            <button type="button" aria-label={`Move ${genreName(code)} down`} disabled={!data.canManage || index === playlist.genreCodes.length - 1 || busy} onClick={() => moveSlot(index, index + 1)}>↓</button>
            <button type="button" aria-label={`Duplicate ${genreName(code)}`} disabled={!data.canManage || busy} onClick={() => setPlaylist((current) => ({ ...current, genreCodes: current.genreCodes.flatMap((item, position) => position === index ? [item, item] : [item]) }))}>Duplicate</button>
            <button type="button" aria-label={`Remove ${genreName(code)}`} disabled={!data.canManage || busy} onClick={() => setPlaylist((current) => ({ ...current, genreCodes: current.genreCodes.filter((_, position) => position !== index) }))}>Remove</button>
          </div></li>)}</ol>
        </div>}
        <p className={styles.summary}><strong>Preview:</strong> {playlist.name || "Untitled"} · {playlist.durationValue} {playlist.durationUnit.toLowerCase()} · {playlist.buildMode === "GENRE_SEQUENCE" ? "Genre Sequence" : "Random Genre Mix"} · {playlist.genreCodes.length ? playlist.genreCodes.map(genreName).join(" → ") : "Choose genres"}</p>
        <p className={styles.hint} role="status">{unsavedPlaylist ? "Unsaved playlist changes" : editingId ? "Showing saved playlist settings" : "New playlist · not saved yet"}</p>
        {attemptedSave && playlistIssues.length ? <ul className={styles.error} role="alert">{playlistIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        <div className={styles.actions}><button type="button" disabled={!data.canManage || busy} onClick={savePlaylist}>{busy ? "Saving…" : editingId ? "Save playlist changes" : "Save playlist"}</button>{editingId || unsavedPlaylist ? <button type="button" className={styles.secondary} disabled={busy} onClick={newPlaylist}>{editingId ? "Cancel edit" : "Clear form"}</button> : null}{planningOnly ? <a href="#workspace-planner" className={styles.nextLink}>Next: plan your week →</a> : null}</div>
      </section>
      </details>
      {!sandboxDraftOnly && !planningOnly && data.canSchedule !== false && <details className={styles.taskDetails}>
        <summary><span>3 · OPTIONAL</span><strong>Choose when a playlist plays{data.events.length ? ` · ${data.events.length} upcoming` : ""}</strong><small>Schedule a saved playlist for a specific date and time.</small></summary>
      <section className={styles.panel} id="simple-playlist-schedule" aria-labelledby="schedule-title">
        <p className={styles.kicker}>3 · PLAN A TIME SLOT</p>
        <h2 id="schedule-title">Plan a playlist time</h2>
        <p>Place a saved playlist on one of your channels. At the end, Non-Stop resumes if it is on.</p>
        <p className={styles.summary}>Scheduling a playlist creates an active time slot immediately. For recurring programmes with draft → preview → publish, use Weekly planner instead.</p>
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
      </details>}
    </>}
  </div>;
}
