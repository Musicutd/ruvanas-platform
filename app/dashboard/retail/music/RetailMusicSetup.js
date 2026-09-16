"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildRetailMusicAreas, retailMusicSelection } from "@/lib/retail-music-setup.mjs";
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

  const areas = useMemo(() => buildRetailMusicAreas(programming), [programming]);
  const area = areas.find((item) => item.id === areaId) || null;
  const playableModes = programming?.musicModes?.filter((mode) => mode.playableTrackCount > 0) || [];
  const selectedMode = playableModes.find((mode) => mode.id === modeId) || null;
  const currentPolicy = area?.channel?.autoDjPolicy || null;
  const changed = currentPolicy?.enabled !== true || currentPolicy.defaultMusicModeId !== modeId || currentPolicy.playbackPolicy !== playbackPolicy;

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
    if (!area || area.blocker || !selectedMode || !programming?.canManage || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/programming/autodj", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: area.channel.id,
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

    <div className={styles.steps} aria-label="Music setup steps">
      <span>1 · Choose a shop area</span><span>2 · Choose music</span><span>3 · Set hours</span>
    </div>

    <section className={styles.card} aria-labelledby="area-heading">
      <div className={styles.cardHeading}><span className={styles.number}>1</span><div><h2 id="area-heading">Where should music play?</h2><p>Select the listening area connected to your shop player.</p></div></div>
      {!areas.length ? <div className={styles.empty}>No listening areas are set up yet. <Link href="/dashboard/locations">Review locations and zones →</Link></div> : <label className={styles.field}>Shop / listening area
        <select value={areaId} onChange={(event) => chooseArea(event.target.value)}>{areas.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      </label>}
      {area?.blocker ? <div className={styles.warning}>{area.blocker} <Link href="/dashboard/support">Ask for setup help →</Link></div> : null}
      {area && !area.blocker ? <div className={styles.current}><strong>Current status</strong><span>{area.current?.musicModeName ? `${area.current.musicModeName} · ${area.current.sourceLabel}` : area.programmingState === "LOCATION_CLOSED" ? "Outside your configured opening hours" : "No music is scheduled right now"}</span></div> : null}
    </section>

    <section className={styles.card} aria-labelledby="music-heading">
      <div className={styles.cardHeading}><span className={styles.number}>2</span><div><h2 id="music-heading">What should play automatically?</h2><p>Choose from music prepared for your organisation. Rights and availability are checked before saving.</p></div></div>
      {!playableModes.length ? <div className={styles.empty}>No playable music choices are ready yet. A catalogue alone does not create a shop playlist; an approved music mode must be prepared for your organisation. <Link href="/dashboard/programming">Open advanced programming →</Link> or <Link href="/dashboard/support">ask for help →</Link></div> : <div className={styles.modeGrid}>{playableModes.map((mode) => <label key={mode.id} className={modeId === mode.id ? styles.selectedMode : styles.mode}>
        <input type="radio" name="retail-music-mode" value={mode.id} checked={modeId === mode.id} onChange={() => setModeId(mode.id)} disabled={!programming.canManage || Boolean(area?.blocker)} />
        <span><strong>{mode.name}</strong><small>{mode.description || "Approved music selection"}</small><em>{mode.playableTrackCount} available track{mode.playableTrackCount === 1 ? "" : "s"}</em></span>
      </label>)}</div>}
    </section>

    <section className={styles.card} aria-labelledby="hours-heading">
      <div className={styles.cardHeading}><span className={styles.number}>3</span><div><h2 id="hours-heading">When should it play?</h2><p>Automatic music fills gaps around any published programmes.</p></div></div>
      <div className={styles.hourGrid}>
        <label className={playbackPolicy === "FOLLOW_LOCATION_HOURS" ? styles.selectedMode : styles.mode}><input type="radio" name="retail-hours" value="FOLLOW_LOCATION_HOURS" checked={playbackPolicy === "FOLLOW_LOCATION_HOURS"} onChange={() => setPlaybackPolicy("FOLLOW_LOCATION_HOURS")} disabled={!programming.canManage || Boolean(area?.blocker)} /><span><strong>During shop hours</strong><small>Follow the opening hours configured for this location.</small></span></label>
        <label className={playbackPolicy === "RUN_24_7" ? styles.selectedMode : styles.mode}><input type="radio" name="retail-hours" value="RUN_24_7" checked={playbackPolicy === "RUN_24_7"} onChange={() => setPlaybackPolicy("RUN_24_7")} disabled={!programming.canManage || Boolean(area?.blocker)} /><span><strong>All day, every day</strong><small>Use for locations that need continuous 24/7 music.</small></span></label>
      </div>
    </section>

    <section className={styles.review} aria-labelledby="review-heading">
      <div><p className={styles.eyebrow}>REVIEW</p><h2 id="review-heading">{area?.label || "Choose an area"}</h2><p>{selectedMode?.name || "No music selected"} · {playbackPolicy === "RUN_24_7" ? "24/7" : "During shop hours"}</p><small>Published schedules take priority. Saving can change live playback on a connected player; it does not connect a player or override music rights.</small></div>
      <button type="button" onClick={save} disabled={saving || !changed || !area || Boolean(area.blocker) || !selectedMode || !programming.canManage}>{saving ? "Saving…" : currentPolicy?.enabled ? "Update automatic music" : "Save automatic music"}</button>
    </section>
    {!programming.canManage ? <p className={styles.readOnly}>This account can view the music setup. An organisation owner or manager can change it.</p> : null}
    <div className={styles.nextLinks}><Link href="/dashboard/players">Check the shop player →</Link><Link href="/dashboard/programming">Need a detailed schedule? Open advanced programming →</Link></div>
  </>;
}
