"use client";

import { useEffect, useState } from "react";
import { channelMatchesPillar } from "@/lib/pillar-audio.mjs";
import styles from "./pillar-autodj.module.css";

function formForChannel(channel, product) {
  return {
    enabled: channel?.nonStop.enabled === true,
    genreCodes: channel?.nonStop.genreCodes || [],
    playbackPolicy: product === "ONLINE" ? "RUN_24_7" : channel?.nonStop.playbackPolicy || "RUN_24_7"
  };
}

export default function PillarAutoDjWorkspace({ product, rightsUse }) {
  const [data, setData] = useState(null);
  const [channelId, setChannelId] = useState("");
  const [form, setForm] = useState(formForChannel(null, product));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(preferredId = "") {
    const response = await fetch("/api/programming/simple", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load AutoDJ.");
    const channels = result.channels.filter((channel) => channelMatchesPillar(channel, product) && channel.rightsUse === rightsUse);
    const selected = channels.find((channel) => channel.id === preferredId) || channels[0] || null;
    setData({ ...result, channels });
    setChannelId(selected?.id || "");
    setForm(formForChannel(selected, product));
  }

  useEffect(() => { load().catch((issue) => setError(issue.message)); }, [product, rightsUse]);

  function chooseChannel(id) {
    setChannelId(id);
    setForm(formForChannel(data.channels.find((channel) => channel.id === id), product));
    setNotice(""); setError("");
  }

  function toggleGenre(code) {
    setForm((current) => ({ ...current, genreCodes: current.genreCodes.includes(code) ? current.genreCodes.filter((value) => value !== code) : [...current.genreCodes, code] }));
  }

  async function save() {
    if (!channelId || !data?.canManage || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/simple/nonstop", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, enabled: form.enabled, genreCodes: form.genreCodes, playbackPolicy: form.playbackPolicy })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save AutoDJ.");
      await load(channelId);
      setNotice(result.enabled ? `AutoDJ is on. ${result.playableTrackCount} approved tracks are ready for this channel.` : "AutoDJ is off for this channel. Existing schedules were not changed.");
    } catch (issue) { setError(issue.message); }
    finally { setBusy(false); }
  }

  if (!data && !error) return <section className={styles.card} role="status">Loading your channels…</section>;
  if (!data) return <section className={styles.card} role="alert">{error}</section>;
  const channel = data.channels.find((item) => item.id === channelId);

  return <section className={styles.card} aria-label={`${product} AutoDJ settings`}>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {notice ? <p className={styles.success} role="status">{notice}</p> : null}
    {!data.channels.length ? <div className={styles.empty}><h2>Channel setup is needed</h2><p>No {product.toLowerCase()} channel is ready to configure. Create or ask Ruvanas to prepare one first; you do not need to enter streaming credentials here.</p></div> : <>
      <div className={styles.heading}><div><p className={styles.eyebrow}>1 · CHOOSE CHANNEL</p><h2>Which channel?</h2></div><span className={form.enabled ? styles.on : styles.off}>{form.enabled ? "AutoDJ on" : "AutoDJ off"}</span></div>
      <label className={styles.field}>Channel<select value={channelId} onChange={(event) => chooseChannel(event.target.value)}>{data.channels.map((item) => <option key={item.id} value={item.id}>{item.stationName ? `${item.stationName} / ` : ""}{item.name}</option>)}</select></label>
      <p className={styles.hint}>{channel?.status === "DRAFT" ? "This channel is still a draft. You can prepare AutoDJ now; it will not make the output live." : "AutoDJ fills gaps after scheduled or live programmes."}</p>

      <div className={styles.heading}><div><p className={styles.eyebrow}>2 · AUTOMATIC MUSIC</p><h2>When should it play?</h2></div></div>
      <label className={styles.switch}><input type="checkbox" checked={form.enabled} disabled={!data.canManage || busy} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /><span>{form.enabled ? "On — fill the gaps with approved music" : "Off — leave AutoDJ paused"}</span></label>
      {product !== "ONLINE" ? <div className={styles.choices} role="group" aria-label="AutoDJ playback hours">
        <label className={form.playbackPolicy === "RUN_24_7" ? styles.selectedChoice : styles.choice}><input type="radio" name="playbackPolicy" value="RUN_24_7" checked={form.playbackPolicy === "RUN_24_7"} disabled={!data.canManage || busy} onChange={() => setForm((current) => ({ ...current, playbackPolicy: "RUN_24_7" }))} /><strong>All day, every day</strong><small>Use for a continuously running channel.</small></label>
        <label className={form.playbackPolicy === "FOLLOW_LOCATION_HOURS" ? styles.selectedChoice : styles.choice}><input type="radio" name="playbackPolicy" value="FOLLOW_LOCATION_HOURS" checked={form.playbackPolicy === "FOLLOW_LOCATION_HOURS"} disabled={!data.canManage || busy} onChange={() => setForm((current) => ({ ...current, playbackPolicy: "FOLLOW_LOCATION_HOURS" }))} /><strong>Follow location hours</strong><small>Play during the hours set for its listening area.</small></label>
      </div> : <p className={styles.hint}>Online Radio runs continuously, 24/7.</p>}

      <details className={styles.genres}><summary>Choose genres (optional)</summary><p>Leave all unchecked to use every eligible genre. Rights and territory rules still apply.</p><div className={styles.genreGrid}>{data.genres.map((genre) => <label key={genre.id}><input type="checkbox" checked={form.genreCodes.includes(genre.code)} disabled={!data.canManage || busy} onChange={() => toggleGenre(genre.code)} />{genre.name}</label>)}</div></details>
      <div className={styles.actions}><button type="button" disabled={!data.canManage || busy} onClick={save}>{busy ? "Saving…" : "Save AutoDJ"}</button><p>{data.canManage ? "Saving changes this channel’s automatic playback; it does not alter the schedule or connect a stream." : "Only an authorised owner, manager or content editor can change AutoDJ."}</p></div>
    </>}
  </section>;
}
