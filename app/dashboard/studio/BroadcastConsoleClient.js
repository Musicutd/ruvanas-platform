"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./studio-pro.module.css";

const presets = ["PRESENTER", "PRODUCER", "AUTOMATION", "COMPACT", "DUAL_SCREEN"];
const pretty = (value) => String(value || "").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
const clock = (value) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export default function BroadcastConsoleClient({ enabled, monitor = false }) {
  const [data, setData] = useState(null);
  const [channelId, setChannelId] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(null);
  useEffect(() => { const requested = new URLSearchParams(window.location.search).get("channelId"); if (requested) setChannelId(requested); }, []);
  const load = useCallback(async () => {
    if (!enabled) return;
    const params = new URLSearchParams();
    if (channelId) params.set("channelId", channelId);
    if (date) params.set("date", date);
    const response = await fetch(`/api/studio/console?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "The Broadcast Console could not be loaded.");
    setData(body);
    setChannelId(body.channel?.id || "");
    setError("");
  }, [enabled, channelId, date]);
  useEffect(() => { load().catch((cause) => setError(cause.message)); }, [load]);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => { setNow(Date.now()); load().catch((cause) => setError(cause.message)); }, 10000); return () => window.clearInterval(timer); }, [load]);
  async function save(action, extra = {}) {
    if (monitor || !channelId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/studio/console", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, channelId, ...extra }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The Console change could not be saved.");
      await load();
      setNotice(`${pretty(action)} saved.`);
      return true;
    } catch (cause) { setError(cause.message); return false; }
    finally { setBusy(false); }
  }
  const items = data?.session?.items || [];
  const onAir = items.find((item) => item.status === "ON_AIR");
  const upcoming = useMemo(() => items.filter((item) => item.area === "LIVE" && item.status === "READY").sort((a, b) => a.position - b.position), [items]);
  const nextHard = useMemo(() => (data?.dailyLog?.planned || []).find((entry) => entry.hardEvent && new Date(entry.plannedStartAt).getTime() > now), [data, now]);
  const health = data?.broadcast?.flatMap((session) => session.destinations) || [];
  const connected = health.filter((item) => item.state === "CONNECTED").length;
  if (!enabled) return <section className={`${styles.panel} ${styles.locked}`}><div><p className={styles.eyebrow}>STUDIO PRO</p><h2>Broadcast Console is available on Tiers 3–5</h2><p className={styles.muted}>Studio Basic projects remain available. Console access does not grant catalogue or broadcast rights.</p></div></section>;
  if (!data) return <section className={styles.panel}><p role="status">{error || "Loading Broadcast Console…"}</p></section>;
  if (!data.channel) return <section className={styles.panel}><h2>Set up a channel first</h2><p>{data.notice}</p><a href="/dashboard/programming" className={styles.secondary}>Open programming</a></section>;
  return <section className={styles.panel}>
    <div className={styles.topbar}><div><p className={styles.eyebrow}>RUVANAS BROADCAST CONSOLE · {monitor ? "READ-ONLY MONITOR" : "PRESENTER WORKSPACE"}</p><h2>{data.channel.name}</h2><p className={styles.muted}>Shared view of the existing programme, queue, schedule and destination state. Queue state is not proof of listener playback.</p></div><label>Channel<select aria-label="Console channel" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{data.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>{!monitor ? <a href={`/dashboard/studio/monitor?channelId=${encodeURIComponent(channelId)}`} target="_blank" rel="noopener noreferrer" className={styles.secondary}>Open second-screen monitor</a> : null}</div>
    {error ? <div role="alert" className={styles.error}>{error}</div> : null}{notice ? <div role="status" className={styles.notice}>{notice}</div> : null}
    {!monitor ? <div className={styles.actions}><label>Layout <select aria-label="Console layout" value={data.layout.preset} disabled={busy} onChange={(event) => save("SAVE_LAYOUT", { preset: event.target.value })}>{presets.map((preset) => <option key={preset} value={preset}>{pretty(preset)}</option>)}</select></label><a href="/dashboard/studio?workspace=playout" className={styles.secondary}>Open Manual Playout controls</a><a href="/dashboard/studio?workspace=broadcast" className={styles.secondary}>Open distribution controls</a></div> : null}
    <div className={styles.consoleStatus}><strong>{onAir ? "CUE STATE: ON AIR" : "NO MANUAL ITEM CUED"}</strong><span>Mode: {data.session?.mode || "AutoDJ / schedule"}</span><span>Fallback: {data.session?.fallbackAutoDjId ? "armed" : "not confirmed"}</span><span>Destinations: {connected}/{health.length} connected</span><span>Clock: {now ? new Date(now).toLocaleTimeString() : "—"}</span></div>
    <div className={styles.consoleGrid} data-preset={monitor ? "MONITOR" : data.layout.preset} data-section="primary">
      <article className={styles.card}><p className={styles.eyebrow}>ON AIR · NEXT · AFTER NEXT</p><h3>{onAir?.title || "Schedule or AutoDJ controls output"}</h3><p className={styles.muted}>{onAir?.artistOrProgramme || data.session?.outputHealth || "No manual session"}</p><div className={styles.list}>{upcoming.slice(0, 8).map((item, index) => <div className={styles.item} key={item.id}><header><strong>{index === 0 ? "NEXT" : index === 1 ? "AFTER NEXT" : `#${index + 1}`} · {item.title}</strong><span className={styles.status}>{item.locked ? "LOCKED" : item.rightsReady ? "READY" : "BLOCKED"}</span></header><small>{item.artistOrProgramme || item.itemType} · {Math.round((item.durationMs || 0) / 1000)} sec</small></div>)}{!upcoming.length ? <p className={styles.warning}>Manual queue empty. Check AutoDJ and destination state before a live show.</p> : null}</div></article>
      <article className={styles.card}><p className={styles.eyebrow}>DAILY LOG</p><h3>Planned and verified events</h3><label>Date <input type="date" value={date || data.dailyLog?.date || ""} onChange={(event) => setDate(event.target.value)} /></label><p className={styles.muted}>Timezone: {data.dailyLog?.timezone}. Planned entries and verified plays are separate; an entry here does not prove output.</p>{nextHard ? <p className={styles.warning}>Next fixed event: {clock(nextHard.plannedStartAt)} · {nextHard.label}</p> : null}<div className={styles.list}>{(data.dailyLog?.planned || []).slice(0, 40).map((entry) => <div className={styles.item} key={`${entry.sourceType}:${entry.id}`}><header><strong>{clock(entry.plannedStartAt)} · {entry.label}</strong><span className={styles.status}>{entry.hardEvent ? "FIXED" : "PLANNED"}</span></header><small>{pretty(entry.sourceType)} · estimated {clock(entry.estimatedStartAt)}</small></div>)}{!data.dailyLog?.planned?.length ? <p className={styles.muted}>Nothing scheduled for this day.</p> : null}</div><p className={styles.muted}>Verified playback events: {data.dailyLog?.actual?.length || 0}</p></article>
      <article className={styles.card}><p className={styles.eyebrow}>OUTPUT HEALTH</p><h3>Destinations and live sources</h3><div className={styles.list}>{health.map((item) => <div className={styles.item} key={item.destination.id}><header><strong>{item.destination.name}</strong><span className={styles.status}>{item.state}</span></header><small>Listeners: {item.destination.listenerCount ?? "unavailable"}{item.lastSafeError ? ` · ${item.lastSafeError}` : ""}</small></div>)}{!health.length ? <p className={styles.muted}>No active broadcast destination. This Console cannot confirm public output.</p> : null}{data.sources.map((source) => <div className={styles.item} key={source.id}><strong>{source.name}</strong><p>External source: {source.status} · {source.healthStatus || "not checked"}</p></div>)}{data.browserLive.map((live) => <div className={styles.item} key={live.id}><strong>{live.title}</strong><p>Browser microphone session: {live.status}</p></div>)}</div></article>
    </div>
    {!monitor ? <div className={styles.consoleGrid} data-preset={data.layout.preset} data-section="tools">
      <article className={styles.card}><p className={styles.eyebrow}>HOT CARTS</p><h3>Reusable protected media references</h3><p className={styles.muted}>Carts are configured here. Live firing stays unavailable until a verified output bridge is connected.</p><form className={styles.form} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; if (await save("CREATE_BANK", { name: new FormData(form).get("name") })) form.reset(); }}><label>New cart bank<input name="name" minLength="2" required /></label><button className={styles.secondary} disabled={busy}>Create bank</button></form>{data.banks.length ? <form className={styles.form} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries()); if (await save("ADD_CART", values)) form.reset(); }}><label>Bank<select name="bankId" required><option value="">Choose bank</option>{data.banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label><label>Protected media<select name="mediaAssetId" required><option value="">Choose file</option>{(data.cartChoices || []).map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {pretty(asset.mediaType)}</option>)}</select></label><label>Cart label<input name="label" maxLength="80" /></label><button className={styles.secondary} disabled={busy}>Add reference</button></form> : null}<div className={styles.list}>{data.banks.map((bank) => <div className={styles.item} key={bank.id}><strong>{bank.name}</strong><p>{bank.carts.length} carts</p>{bank.carts.map((cart) => <div key={cart.id} className={styles.item}><strong>{cart.label}</strong><small>{cart.ready ? "Media ready" : "Media unavailable"} · {pretty(cart.behaviour)}</small><button className={styles.danger} disabled={busy} onClick={() => save("REMOVE_CART", { cartId: cart.id })}>Remove</button></div>)}</div>)}</div></article>
      <article className={styles.card}><p className={styles.eyebrow}>RADIO CLOCKS & VOICE TRACKS</p><h3>Prepare the next programme</h3><p className={styles.muted}>Use the existing Radio Clock editor and Voice Tracking workflow. Changes remain subject to their own publication and approval controls.</p><div className={styles.list}>{data.clocks.map((item) => <div className={styles.item} key={item.id}><strong>{item.name}</strong><p>{Math.round(item.durationSeconds / 60)} min · published v{item.publishedVersion}</p></div>)}</div><div className={styles.actions}><a className={styles.secondary} href="/dashboard/programming#workspace-automation">Edit Radio Clocks</a><a className={styles.secondary} href="/dashboard/programming#workspace-production">Open Voice Tracking</a><a className={styles.secondary} href="/dashboard/programming#workspace-live">Microphone studio</a></div></article>
      <article className={styles.card}><p className={styles.eyebrow}>PRESENTER NOTES</p><h3>Show cues</h3><p className={styles.warning}>Do not enter patient, student, pastoral or other sensitive personal records.</p><form className={styles.form} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries()); if (await save("CREATE_NOTE", values)) form.reset(); }}><label>Title<input name="title" required minLength="2" /></label><label>Note<textarea name="body" required minLength="2" maxLength="800" /></label><button className={styles.secondary} disabled={busy}>Add cue</button></form><div className={styles.list}>{data.notes.map((note) => <div className={styles.item} key={note.id}><header><strong>{note.title}</strong><span className={styles.status}>{note.acknowledgedAt ? "SEEN" : "NEW"}</span></header><p>{note.body}</p>{!note.acknowledgedAt ? <button className={styles.secondary} disabled={busy} onClick={() => save("ACK_NOTE", { noteId: note.id })}>Acknowledge</button> : null}</div>)}</div></article>
      <article className={styles.card}><p className={styles.eyebrow}>MIX POINTS</p><h3>Prepare a clean transition</h3><p className={styles.muted}>Set a cue, intro, mix, fade or end marker on an organisation-owned file already in this Console. These non-destructive defaults are used when preparing a new Manual Playout item.</p><form className={styles.form} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries()); await save("SAVE_MIX_POINT", { ...values, positionMs: Number(values.positionMs) }); }}><label>Media<select name="mediaAssetId" required><option value="">Choose a queued or cart file</option>{(data.markerChoices || []).map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.durationSeconds || "?"} sec</option>)}</select></label><label>Marker<select name="pointType"><option value="CUE_IN">Cue in</option><option value="INTRO_END">Intro end</option><option value="MIX_START">Mix start</option><option value="FADE_START">Fade start</option><option value="END">End</option></select></label><label>Position in milliseconds<input name="positionMs" type="number" min="0" step="1" required /></label><button className={styles.secondary} disabled={busy}>Save marker</button></form><div className={styles.list}>{(data.mixPoints || []).map((point) => <p key={point.id}>{pretty(point.type)} · {(point.positionMs / 1000).toFixed(2)} sec</p>)}</div></article>
    </div> : null}
    <p className={styles.muted}>{data.rightsNotice}</p>
  </section>;
}
