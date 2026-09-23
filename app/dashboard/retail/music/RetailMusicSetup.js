"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildRetailMusicAreas, retailMusicSelection, RETAIL_CATALOGUE_MODE } from "@/lib/retail-music-setup.mjs";
import styles from "./retail-music.module.css";

export default function RetailMusicSetup() {
  const [programming, setProgramming] = useState(null);
  const [areaId, setAreaId] = useState("");
  const [modeId, setModeId] = useState("");
  const [playbackPolicy, setPlaybackPolicy] = useState("FOLLOW_LOCATION_HOURS");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [catalogue, setCatalogue] = useState(null);
  const [catalogueError, setCatalogueError] = useState("");

  async function load(preferredAreaId = "") {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/programming", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load music settings.");
      const areas = buildRetailMusicAreas(payload);
      const area = areas.find((item) => item.id === preferredAreaId) || areas.find((item) => !item.blocker) || areas[0] || null;
      const selection = retailMusicSelection(area, payload.musicModes);
      setProgramming(payload);
      setAreaId(area?.id || "");
      setModeId(selection.modeId);
      setPlaybackPolicy(selection.playbackPolicy);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!areaId) return;
    const controller = new AbortController();
    setCatalogue(null);
    setCatalogueError("");
    fetch(`/api/catalogue/music?product=RETAIL&zoneId=${encodeURIComponent(areaId)}&limit=8`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to load the catalogue."); return payload; })
      .then((payload) => {
        setCatalogue(payload);
        if (payload.total > 0) setModeId((current) => current || RETAIL_CATALOGUE_MODE);
      })
      .catch((issue) => { if (issue.name !== "AbortError") setCatalogueError(issue.message); });
    return () => controller.abort();
  }, [areaId]);

  const areas = useMemo(() => buildRetailMusicAreas(programming), [programming]);
  const area = areas.find((item) => item.id === areaId) || null;
  const playableModes = programming?.musicModes?.filter((mode) => mode.playableTrackCount > 0 && !(area?.channel?.autoDjPolicy?.catalogueRotation && mode.id === area.channel.autoDjPolicy.defaultMusicModeId)) || [];
  const selectedMode = modeId === RETAIL_CATALOGUE_MODE && catalogue?.total > 0
    ? { id: RETAIL_CATALOGUE_MODE, name: "Approved Ruvanas catalogue", playableTrackCount: catalogue.total }
    : playableModes.find((mode) => mode.id === modeId) || null;
  const currentPolicy = area?.channel?.autoDjPolicy || null;
  const changed = currentPolicy?.enabled !== true || (modeId === RETAIL_CATALOGUE_MODE ? !currentPolicy?.catalogueRotation : currentPolicy.defaultMusicModeId !== modeId) || currentPolicy.playbackPolicy !== playbackPolicy;
  const setupNeeds = [
    !area ? "a shop area" : area.blocker && !area.canPrepareChannel ? "a ready channel for this area" : null,
    !playableModes.length && !catalogue?.total ? "approved playable music" : null
  ].filter(Boolean);

  function chooseArea(id) {
    const nextArea = areas.find((item) => item.id === id) || null;
    const selection = retailMusicSelection(nextArea, programming?.musicModes);
    setAreaId(id);
    setModeId(selection.modeId);
    setPlaybackPolicy(selection.playbackPolicy);
    setNotice("");
    setError("");
  }

  async function save() {
    if (!area || (area.blocker && !area.canPrepareChannel) || !selectedMode || !programming?.canManage || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    let channelPrepared = false;
    try {
      let channelId = area.channel?.id;
      if (!channelId && area.canPrepareChannel) {
        const prepareResponse = await fetch("/api/programming/retail/prepare-channel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: area.id })
        });
        const prepared = await prepareResponse.json();
        if (!prepareResponse.ok) throw new Error(prepared.error || "Unable to prepare this shop area.");
        channelId = prepared.channelId;
        channelPrepared = true;
      }
      const catalogueChoice = modeId === RETAIL_CATALOGUE_MODE;
      const response = await fetch(catalogueChoice ? "/api/programming/simple/nonstop" : "/api/programming/autodj", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(catalogueChoice ? {
          channelId,
          enabled: true,
          genreCodes: [],
          sourceScopes: catalogue.sources,
          playbackPolicy,
          targetType: "ZONE",
          targetId: area.id
        } : {
          channelId,
          enabled: true,
          defaultMusicModeId: modeId,
          backupMusicModeId: currentPolicy?.backupMusicModeId === modeId ? null : currentPolicy?.backupMusicModeId || null,
          playbackPolicy,
          targetType: "ZONE",
          targetId: area.id,
          rightsUse: "RETAIL_RADIO"
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save music for this area.");
      await load(area.id);
      setNotice(`Automatic music was saved for ${area.label}. Check the player to confirm what customers hear.`);
    } catch (saveError) {
      if (channelPrepared) await load(area.id);
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.message} role="status">Loading your shops and approved music…</div>;
  if (!programming) return <div className={styles.error} role="alert">{error || "Music settings are unavailable."}</div>;

  return <>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.success} role="status">{notice}</div> : null}

    <section className={styles.card} aria-labelledby="area-heading">
      <div className={styles.cardHeading}><span className={styles.number}>1</span><div><h2 id="area-heading">Which shop?</h2><p>Choose the shop area you want to update.</p></div></div>
      {!areas.length ? <div className={styles.empty}>No listening areas are set up yet. <Link href="/dashboard/locations">Review locations and zones →</Link></div> : areas.length === 1 ? <div className={styles.field}>Shop / listening area<strong className={styles.onlyArea}>{areas[0].label}</strong></div> : <label className={styles.field}>Shop / listening area<select value={areaId} onChange={(event) => chooseArea(event.target.value)}>{areas.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {area?.canPrepareChannel ? <div className={styles.warning}>This area has no channel yet. Save will prepare and assign one automatically; streaming-provider details are not needed here.</div> : area?.blocker ? <div className={styles.warning}>{area.blocker} <Link href="/dashboard/support">Ask for setup help →</Link></div> : null}
      {area && !area.blocker ? <div className={styles.current}><strong>Current status</strong><span>{area.current?.musicModeName ? `${area.current.musicModeName} · ${area.current.sourceLabel}` : area.programmingState === "LOCATION_CLOSED" ? "Outside your configured opening hours" : "No music is scheduled right now"}</span></div> : null}
    </section>

    <section className={styles.card} aria-labelledby="music-heading">
      <div className={styles.cardHeading}><span className={styles.number}>2</span><div><h2 id="music-heading">Choose the music</h2><p>These choices are ready for your organisation.</p></div></div>
      {catalogueError ? <div className={styles.warning} role="status">{catalogueError} Please refresh to try again.</div> : null}
      {catalogue === null && !catalogueError ? <p className={styles.message} role="status">Checking approved catalogue music…</p> : null}
      {catalogue && !catalogue.territoryKnown ? <div className={styles.warning}>This shop needs a confirmed country before music licensed only for Europe, the US or Canada can appear. <Link href="/dashboard/locations">Check your location →</Link></div> : null}
      {!playableModes.length && !catalogue?.total && catalogue !== null ? <div className={styles.empty}>No music is cleared for this shop and your current plan yet. Ruvanas can review the catalogue rights or help prepare a music choice. <Link href="/dashboard/support">Ask for help →</Link></div> : null}
      {playableModes.length || catalogue?.total ? <div className={styles.modeGrid}>{catalogue?.total ? <label className={modeId === RETAIL_CATALOGUE_MODE ? styles.selectedMode : styles.mode}>
        <input type="radio" name="retail-music-mode" value={RETAIL_CATALOGUE_MODE} checked={modeId === RETAIL_CATALOGUE_MODE} onChange={() => setModeId(RETAIL_CATALOGUE_MODE)} disabled={!programming.canManage || Boolean(area?.blocker && !area?.canPrepareChannel)} />
        <span><strong>Approved Ruvanas catalogue</strong><small>Ready for this shop. New approved songs become available without another upload.</small><em>{catalogue.total} available track{catalogue.total === 1 ? "" : "s"}</em></span>
      </label> : null}{playableModes.map((mode) => <label key={mode.id} className={modeId === mode.id ? styles.selectedMode : styles.mode}>
        <input type="radio" name="retail-music-mode" value={mode.id} checked={modeId === mode.id} onChange={() => setModeId(mode.id)} disabled={!programming.canManage || Boolean(area?.blocker && !area?.canPrepareChannel)} />
        <span><strong>{mode.name}</strong><small>{mode.description || "Approved music selection"}</small><em>{mode.playableTrackCount} available track{mode.playableTrackCount === 1 ? "" : "s"}</em></span>
      </label>)}</div> : null}
      {catalogue?.tracks?.length ? <div className={styles.cataloguePreview}><strong>From the catalogue</strong><p>{catalogue.tracks.slice(0, 5).map((track) => `${track.artist} — ${track.title}`).join(" · ")}</p><small>Track details only; downloads are not available here. Playback remains subject to licensing and your connected channel.</small></div> : null}
    </section>

    <section className={styles.card} aria-labelledby="hours-heading">
      <div className={styles.cardHeading}><span className={styles.number}>3</span><div><h2 id="hours-heading">When should it play?</h2><p>Choose shop hours for a normal retail location.</p></div></div>
      <div className={styles.hourGrid}>
        <label className={playbackPolicy === "FOLLOW_LOCATION_HOURS" ? styles.selectedMode : styles.mode}><input type="radio" name="retail-hours" value="FOLLOW_LOCATION_HOURS" checked={playbackPolicy === "FOLLOW_LOCATION_HOURS"} onChange={() => setPlaybackPolicy("FOLLOW_LOCATION_HOURS")} disabled={!programming.canManage} /><span><strong>During shop hours</strong><small>Follow the opening hours configured for this location.</small></span></label>
        <label className={playbackPolicy === "RUN_24_7" ? styles.selectedMode : styles.mode}><input type="radio" name="retail-hours" value="RUN_24_7" checked={playbackPolicy === "RUN_24_7"} onChange={() => setPlaybackPolicy("RUN_24_7")} disabled={!programming.canManage} /><span><strong>All day, every day</strong><small>Use for locations that need continuous 24/7 music.</small></span></label>
      </div>
      {programming.canManage && setupNeeds.length ? <p className={styles.setupHint} role="status">You can choose a time now. To save automatic music, this setup still needs {setupNeeds.join(" and ")}.</p> : null}
      {programming.canManage && area?.canPrepareChannel && !setupNeeds.length ? <p className={styles.setupHint} role="status">Save will set up this shop's missing channel and enable its approved automatic music. A connected player is needed before customers hear it.</p> : null}
    </section>

    <section className={styles.review} aria-labelledby="review-heading">
      <div><p className={styles.eyebrow}>REVIEW</p><h2 id="review-heading">{area?.label || "Choose an area"}</h2><p>{selectedMode?.name || "No music selected"} · {playbackPolicy === "RUN_24_7" ? "24/7" : "During shop hours"}</p><small>Published schedules take priority. Saving can change live playback on a connected player; it does not connect a player or override music rights.</small></div>
      <button type="button" onClick={save} disabled={saving || !changed || !area || Boolean(area.blocker && !area.canPrepareChannel) || !selectedMode || !programming.canManage}>{saving ? "Saving…" : currentPolicy?.enabled ? "Update automatic music" : "Save automatic music"}</button>
    </section>
    {!programming.canManage ? <p className={styles.readOnly}>This account can view the music setup. An organisation owner or manager can change it.</p> : null}
    <div className={styles.nextLinks}><Link href="/dashboard/players">Check the shop player →</Link><Link href="/dashboard/programming">Need a detailed schedule? Open advanced programming →</Link></div>
  </>;
}
