"use client";

import { Children, cloneElement, useCallback, useEffect, useMemo, useState } from "react";
import { formatStudioLogTime, moveStudioConsolePanel, reorderStudioConsolePanel, STUDIO_CONSOLE_PANEL_GROUPS, studioClockBoundaryConflicts, studioTimingToNextHardEvent } from "@/lib/studio-console.mjs";
import { studioVoiceTrackingUrl } from "@/lib/studio-voice-handoff.mjs";
import styles from "./studio-pro.module.css";

const presets = ["PRESENTER", "PRODUCER", "AUTOMATION", "COMPACT", "DUAL_SCREEN"];
const panelOptions = [
  ["ON_AIR", "On air and next"], ["DAILY_LOG", "Daily Log"], ["OUTPUT_HEALTH", "Output health"],
  ["PREPARE", "Prepare area"], ["CARTS", "Hot carts"], ["RADIO_CLOCKS", "Radio clocks and voice tracks"],
  ["NOTES", "Presenter notes"], ["MIX_POINTS", "Mix points"]
];
const pretty = (value) => String(value || "").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
const widthChoices = [240, 320, 480, 640, 800, 1200];

function ConsolePanelGrid({ layoutPanels, panelSizes, children, ...props }) {
  const panels = Children.toArray(children).filter((panel) => !layoutPanels || layoutPanels.includes(panel.props["data-panel-id"]));
  if (layoutPanels) panels.sort((left, right) => layoutPanels.indexOf(left.props["data-panel-id"]) - layoutPanels.indexOf(right.props["data-panel-id"]));
  return <div {...props}>{panels.map((panel) => cloneElement(panel, {
    style: { ...panel.props.style, "--panel-width": `${panelSizes?.[panel.props["data-panel-id"]] || 320}px` }
  }))}</div>;
}

function ConsoleLayoutControls({ layout, busy, onSave }) {
  const [draggedPanelId, setDraggedPanelId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const visible = new Set(layout.panels);
  const labelFor = (id) => panelOptions.find(([key]) => key === id)?.[1] || pretty(id);
  const savePanels = (panels, sizes = layout.sizes) => onSave({ preset: layout.preset, panels, sizes });
  const clearDrag = () => { setDraggedPanelId(""); setDropTargetId(""); };
  return <details className={styles.layoutControls}>
    <summary>Choose visible panels, order and widths</summary>
    <p className={styles.muted}>Drag a visible panel handle onto another panel in the same section to reorder it. The arrow buttons also work with a keyboard. On-air status and output health always stay visible. These settings change only your Console view, not audio.</p>
    {Object.entries(STUDIO_CONSOLE_PANEL_GROUPS).map(([groupName, group]) => {
      const ordered = [...group].sort((left, right) => {
        const leftIndex = layout.panels.indexOf(left);
        const rightIndex = layout.panels.indexOf(right);
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
      });
      const active = layout.panels.filter((id) => group.includes(id));
      return <section key={groupName} aria-label={`${pretty(groupName)} panels`}>
        <h3>{pretty(groupName)} panels</h3>
        <div className={styles.panelSettings}>{ordered.map((id) => {
          const label = labelFor(id);
          const width = layout.sizes?.[id] || 320;
          const position = active.indexOf(id);
          return <div className={`${styles.panelSetting} ${dropTargetId === id ? styles.panelDropTarget : ""}`} key={id}
            onDragOver={(event) => { if (busy || !draggedPanelId || !visible.has(id) || !group.includes(draggedPanelId) || draggedPanelId === id) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTargetId((current) => current === id ? current : id); }}
            onDrop={(event) => { event.preventDefault(); if (!busy && draggedPanelId && draggedPanelId !== id && group.includes(draggedPanelId) && visible.has(id)) savePanels(reorderStudioConsolePanel(layout, draggedPanelId, id).panels); clearDrag(); }}>
            <span className={styles.dragHandle} draggable={!busy && visible.has(id)} title={visible.has(id) ? `Drag ${label} to reorder` : "Show this panel before reordering"} aria-hidden="true"
              onDragStart={(event) => { if (busy || !visible.has(id)) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); setDraggedPanelId(id); }} onDragEnd={clearDrag}>⋮⋮</span>
            <label><input type="checkbox" checked={visible.has(id)} disabled={busy || id === "ON_AIR" || id === "OUTPUT_HEALTH"} onChange={(event) => savePanels(event.target.checked ? [...layout.panels, id] : layout.panels.filter((panelId) => panelId !== id))} />{label}</label>
            <div className={styles.panelSettingActions}>
              <button type="button" className={styles.secondary} aria-label={`Move ${label} earlier`} disabled={busy || position <= 0} onClick={() => savePanels(moveStudioConsolePanel(layout, id, -1).panels)}>↑</button>
              <button type="button" className={styles.secondary} aria-label={`Move ${label} later`} disabled={busy || position < 0 || position === active.length - 1} onClick={() => savePanels(moveStudioConsolePanel(layout, id, 1).panels)}>↓</button>
              <label>Width <select aria-label={`${label} width`} value={width} disabled={busy || !visible.has(id)} onChange={(event) => savePanels(layout.panels, { ...layout.sizes, [id]: Number(event.target.value) })}>{!widthChoices.includes(width) ? <option value={width}>{width}px</option> : null}{widthChoices.map((choice) => <option key={choice} value={choice}>{choice}px</option>)}</select></label>
            </div>
          </div>;
        })}</div>
      </section>;
    })}
  </details>;
}

function FutureQueueInLog({ upcoming, prepared, monitor, busy, prepareQueue }) {
  return <section aria-label="Untimed future Manual queue">
    <h4>Untimed future Manual queue</h4>
    <p className={styles.muted}>These are prepared Manual queue positions, not timed broadcasts or listener-play proof. Fixed programmes and campaigns above cannot be edited here. Replacement is limited to unlocked, organisation-owned music; the server rechecks the incoming item's rights.</p>
    <div className={styles.list}>{upcoming.map((item, index) => <div className={styles.item} key={item.id}>
      <header><strong>#{index + 1} · {item.title}</strong><span className={styles.status}>{item.locked ? "LOCKED" : "FUTURE"}</span></header>
      {!monitor && !item.locked ? <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={busy || index === 0 || upcoming[index - 1]?.locked} onClick={() => prepareQueue("REORDER", { itemId: item.id, position: index - 1 })}>Move earlier</button>
        <button type="button" className={styles.secondary} disabled={busy || index === upcoming.length - 1 || upcoming[index + 1]?.locked} onClick={() => prepareQueue("REORDER", { itemId: item.id, position: index + 1 })}>Move later</button>
        {item.itemType === "MUSIC" && prepared.length ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); const replacementItemId = new FormData(event.currentTarget).get("replacementItemId"); if (replacementItemId) prepareQueue("REPLACE_FUTURE", { itemId: item.id, replacementItemId }); }}>
          <label>Replace with prepared item<select name="replacementItemId" aria-label={`Replace ${item.title} with prepared item`} required disabled={busy}><option value="">Choose an item</option>{prepared.filter((candidate) => candidate.rightsReady).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label>
          <button type="submit" className={styles.secondary} disabled={busy || !prepared.some((candidate) => candidate.rightsReady)}>Replace future item</button>
        </form> : null}
      </div> : null}
    </div>)}{!upcoming.length ? <p className={styles.muted}>No future Manual items. Scheduled programmes remain in the timed log above.</p> : null}</div>
  </section>;
}

function TimedPlaylistHandoff({ playlists = [] }) {
  if (!playlists.length) return null;
  return <section aria-label="Published timed playlists in this Daily Log">
    <h4>Timed playlists on this date</h4>
    <p className={styles.muted}>Open the existing generator to review its saved plan and any draft. Replacement remains unavailable here until database and listener-output checks pass; this link does not change what listeners hear.</p>
    <div className={styles.actions}>{playlists.map((playlist) => <a className={styles.secondary} key={playlist.id} href={`/dashboard/programming?timedPlaylistId=${encodeURIComponent(playlist.id)}#workspace-automation`}>Review {playlist.name} · published v{playlist.publishedVersion}{playlist.currentVersion > playlist.publishedVersion ? ` · draft v${playlist.currentVersion}` : ""}</a>)}</div>
  </section>;
}

export default function BroadcastConsoleClient({ enabled, monitor = false }) {
  const [data, setData] = useState(null);
  const clock = (value) => formatStudioLogTime(value, data?.dailyLog?.timezone);
  const [channelId, setChannelId] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draggedCard, setDraggedCard] = useState(null);
  const [dropCard, setDropCard] = useState(null);
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
  async function prepareQueue(action, extra = {}) {
    const session = data?.session;
    if (monitor || !session || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/studio/playout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `studio-console:${action}:${crypto.randomUUID()}` },
        body: JSON.stringify({ action, sessionId: session.id, expectedRevision: session.revision, ...extra })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The future queue could not be changed.");
      await load();
      setNotice("Future queue updated. This does not change listener output.");
    } catch (cause) {
      await load().catch(() => undefined);
      setError(cause.message);
    } finally { setBusy(false); }
  }
  const clearCardDrag = () => { setDraggedCard(null); setDropCard(null); };
  function startCardDrag(event, section) {
    const handle = event.target.closest?.("[data-card-drag]");
    if (!handle) return;
    const id = handle?.dataset.cardDrag;
    if (monitor || busy || !id || !data?.layout?.panels?.includes(id) || !STUDIO_CONSOLE_PANEL_GROUPS[section]?.includes(id)) {
      event.preventDefault(); return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDraggedCard({ section, id });
  }
  function overCard(event, section) {
    const id = event.target.closest?.("[data-panel-id]")?.dataset.panelId;
    if (monitor || busy || draggedCard?.section !== section || !id || id === draggedCard.id ||
        !data?.layout?.panels?.includes(id) || !STUDIO_CONSOLE_PANEL_GROUPS[section]?.includes(id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropCard((current) => current?.section === section && current?.id === id ? current : { section, id });
  }
  function finishCardDrag(event, section) {
    if (!draggedCard) return;
    event.preventDefault();
    const id = event.target.closest?.("[data-panel-id]")?.dataset.panelId;
    if (!monitor && !busy && draggedCard?.section === section && id && id !== draggedCard.id &&
        data?.layout?.panels?.includes(id) && STUDIO_CONSOLE_PANEL_GROUPS[section]?.includes(id)) {
      const layout = reorderStudioConsolePanel(data.layout, draggedCard.id, id);
      save("SAVE_LAYOUT", { preset: layout.preset, panels: layout.panels, sizes: layout.sizes });
    }
    clearCardDrag();
  }
  const items = data?.session?.items || [];
  const onAir = items.find((item) => item.status === "ON_AIR");
  const upcoming = useMemo(() => items.filter((item) => item.area === "LIVE" && item.status === "READY").sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id))), [items]);
  const prepared = useMemo(() => items.filter((item) => item.area === "PREPARE" && item.status === "READY"), [items]);
  const nextHard = useMemo(() => (data?.dailyLog?.planned || []).find((entry) => entry.hardEvent && new Date(entry.plannedStartAt).getTime() > now), [data, now]);
  const hardEventTiming = useMemo(() => now ? studioTimingToNextHardEvent(data?.dailyLog, new Date(now)) : null, [data, now]);
  const clockConflicts = useMemo(() => studioClockBoundaryConflicts(data?.dailyLog), [data?.dailyLog]);
  const health = data?.broadcast?.flatMap((session) => session.destinations) || [];
  const connected = data?.manualOutput?.connected ? health.filter((item) => item.state === "CONNECTED").length : 0;
  if (!enabled) return <section className={`${styles.panel} ${styles.locked}`}><div><p className={styles.eyebrow}>STUDIO PRO</p><h2>Broadcast Console is available on Tiers 3–5</h2><p className={styles.muted}>Studio Basic projects remain available. Console access does not grant catalogue or broadcast rights.</p></div></section>;
  if (!data) return <section className={styles.panel}><p role="status">{error || "Loading Broadcast Console…"}</p></section>;
  if (!data.channel) return <section className={styles.panel}><h2>Set up a channel first</h2><p>{data.notice}</p><a href="/dashboard/programming" className={styles.secondary}>Open programming</a></section>;
  return <section className={styles.panel}>
    <div className={styles.topbar}><div><p className={styles.eyebrow}>RUVANAS BROADCAST CONSOLE · {monitor ? "READ-ONLY MONITOR" : "PRESENTER WORKSPACE"}</p><h2>{data.channel.name}</h2><p className={styles.muted}>Shared view of the existing programme, queue, schedule and destination state. Queue state is not proof of listener playback.</p></div><label>Channel<select aria-label="Console channel" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{data.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>{!monitor ? <a href={`/dashboard/studio/monitor?channelId=${encodeURIComponent(channelId)}`} target="_blank" rel="noopener noreferrer" className={styles.secondary}>Open second-screen monitor</a> : null}</div>
    {error ? <div role="alert" className={styles.error}>{error}</div> : null}{notice ? <div role="status" className={styles.notice}>{notice}</div> : null}
    {!monitor ? <><div className={styles.actions}><label>Layout <select aria-label="Console layout" value={data.layout.preset} disabled={busy} onChange={(event) => save("SAVE_LAYOUT", { preset: event.target.value })}>{presets.map((preset) => <option key={preset} value={preset}>{pretty(preset)}</option>)}</select></label><a href="/dashboard/studio?workspace=playout" className={styles.secondary}>Open Manual Playout controls</a><a href="/dashboard/studio?workspace=broadcast" className={styles.secondary}>Open distribution controls</a></div><p className={styles.muted}>Drag a card by its handle to rearrange this view, or use the keyboard-friendly arrows in layout settings. Audio and programme order do not change.</p><ConsoleLayoutControls layout={data.layout} busy={busy} onSave={(next) => save("SAVE_LAYOUT", next)} /></> : null}
    {!data.manualOutput?.connected ? <p className={styles.warning} role="status">{data.manualOutput?.reason} The Daily Log and Manual queue below are preparation and planning views, not verified listener output.</p> : null}
    <div className={styles.consoleStatus}><strong>{onAir ? "QUEUE ITEM MARKED ON AIR — UNVERIFIED" : "NO MANUAL ITEM CUED"}</strong><span>Mode: {data.session?.mode || "AutoDJ / schedule"}</span><span>Fallback: {data.session?.fallbackAutoDjId ? "configured" : "not confirmed"}</span><span>Studio destinations: {connected}/{health.length} verified connected</span><span>Channel clock: {now ? clock(now) : "—"}</span></div>
    <ConsolePanelGrid layoutPanels={monitor ? null : data.layout.panels} panelSizes={data.layout.sizes} className={styles.consoleGrid} data-section="primary" data-drop-panel={dropCard?.section === "PRIMARY" ? dropCard.id : ""} onDragStart={(event) => startCardDrag(event, "PRIMARY")} onDragOver={(event) => overCard(event, "PRIMARY")} onDrop={(event) => finishCardDrag(event, "PRIMARY")} onDragEnd={clearCardDrag}>
      <article className={styles.card} data-panel-id="ON_AIR">{!monitor ? <span className={styles.cardDragHandle} data-card-drag="ON_AIR" draggable={!busy} title="Drag output status · next · after next card to reorder" aria-hidden="true">⋮⋮</span> : null}<p className={styles.eyebrow}>OUTPUT STATUS · NEXT · AFTER NEXT</p><h3>{data.manualOutput?.connected && onAir?.title || "Schedule or AutoDJ controls output"}</h3><p className={styles.muted}>{data.manualOutput?.connected ? onAir?.artistOrProgramme || data.session?.outputHealth : "Manual output not verified"}</p><div className={styles.list}>{upcoming.slice(0, 8).map((item, index) => <div className={styles.item} key={item.id}><header><strong>{index === 0 ? "NEXT" : index === 1 ? "AFTER NEXT" : `#${index + 1}`} · {item.title}</strong><span className={styles.status}>{item.locked ? "LOCKED" : item.rightsReady ? "READY" : "BLOCKED"}</span></header><small>{item.artistOrProgramme || item.itemType} · {Math.round((item.durationMs || 0) / 1000)} sec</small>{!monitor ? <div className={styles.actions}><button className={styles.secondary} disabled={busy || index === 0 || item.locked || upcoming[index - 1]?.locked} onClick={() => prepareQueue("REORDER", { itemId: item.id, position: index - 1 })}>Move up</button><button className={styles.secondary} disabled={busy || index === upcoming.length - 1 || item.locked || upcoming[index + 1]?.locked} onClick={() => prepareQueue("REORDER", { itemId: item.id, position: index + 1 })}>Move down</button><button className={styles.secondary} disabled={busy} onClick={() => prepareQueue("LOCK", { itemId: item.id, locked: !item.locked })}>{item.locked ? "Unlock" : "Lock"}</button></div> : null}</div>)}{!upcoming.length ? <p className={styles.warning}>Manual queue empty. Check AutoDJ and destination state before a live show.</p> : null}</div></article>
<article className={styles.card} data-panel-id="DAILY_LOG">{!monitor ? <span className={styles.cardDragHandle} data-card-drag="DAILY_LOG" draggable={!busy} title="Drag daily log card to reorder" aria-hidden="true">⋮⋮</span> : null}<p className={styles.eyebrow}>DAILY LOG</p><h3>Planned and verified events</h3><label>Date <input type="date" value={date || data.dailyLog?.date || ""} onChange={(event) => setDate(event.target.value)} /></label><p className={styles.muted}>Timezone: {data.dailyLog?.timezone}. Planned entries and verified plays are separate; an entry here does not prove output.</p>{nextHard ? <p className={styles.warning}>Next fixed event: {clock(nextHard.plannedStartAt)} · {nextHard.label}</p> : null}{hardEventTiming?.deltaMs < 0 ? <p className={styles.warning} role="status">Timing warning: the preceding planned item may overlap this fixed event by {Math.ceil(-hardEventTiming.deltaMs / 60000)} min. Review the rundown.</p> : null}{clockConflicts.length ? <div className={styles.warning} role="status"><strong>Radio Clock timing conflicts to review ({clockConflicts.length})</strong><ul>{clockConflicts.slice(0, 3).map((conflict) => <li key={`${conflict.clockItemId}:${conflict.boundaryId}`}>{conflict.clockLabel} extends {Math.ceil(conflict.overlapMs / 1000)} sec past {clock(conflict.boundaryAt)} · {conflict.boundaryLabel}.</li>)}</ul>{clockConflicts.length > 3 ? <small>Showing the first 3 conflicts.</small> : null}<small>Planning warning only; this does not change the published schedule or listener output.</small></div> : null}<div className={styles.list}>{(data.dailyLog?.planned || []).slice(0, 40).map((entry) => <div className={styles.item} key={`${entry.sourceType}:${entry.id}`}><header><strong>{clock(entry.plannedStartAt)} · {entry.label}</strong><span className={styles.status}>{entry.hardEvent ? "FIXED" : "PLANNED"}</span></header><small>{pretty(entry.sourceType)} · estimated {clock(entry.estimatedStartAt)}</small></div>)}{!data.dailyLog?.planned?.length ? <p className={styles.muted}>Nothing scheduled for this day.</p> : null}</div><TimedPlaylistHandoff playlists={data.dailyLog?.timedPlaylists} /><FutureQueueInLog upcoming={upcoming} prepared={prepared} monitor={monitor} busy={busy} prepareQueue={prepareQueue} /><p className={styles.muted}>Verified playback events: {data.dailyLog?.actual?.length || 0}</p></article>
      <article className={styles.card} data-panel-id="OUTPUT_HEALTH">{!monitor ? <span className={styles.cardDragHandle} data-card-drag="OUTPUT_HEALTH" draggable={!busy} title="Drag output health card to reorder" aria-hidden="true">⋮⋮</span> : null}<p className={styles.eyebrow}>OUTPUT HEALTH</p><h3>Destinations and live sources</h3><div className={styles.list}>{health.map((item) => <div className={styles.item} key={item.destination.id}><header><strong>{item.destination.name}</strong><span className={styles.status}>{item.state}</span></header><small>Listeners: {item.destination.listenerCount ?? "unavailable"}{item.lastSafeError ? ` · ${item.lastSafeError}` : ""}</small></div>)}{!health.length ? <p className={styles.muted}>No active broadcast destination. This Console cannot confirm public output.</p> : null}{data.sources.map((source) => <div className={styles.item} key={source.id}><strong>{source.name}</strong><p>External source: {source.status} · {source.healthStatus || "not checked"}</p></div>)}{data.browserLive.map((live) => <div className={styles.item} key={live.id}><strong>{live.title}</strong><p>Browser microphone session: {live.status}</p></div>)}</div></article>
    </ConsolePanelGrid>
    {!monitor ? <ConsolePanelGrid layoutPanels={data.layout.panels} panelSizes={data.layout.sizes} className={styles.consoleGrid} data-section="tools" data-drop-panel={dropCard?.section === "TOOLS" ? dropCard.id : ""} onDragStart={(event) => startCardDrag(event, "TOOLS")} onDragOver={(event) => overCard(event, "TOOLS")} onDrop={(event) => finishCardDrag(event, "TOOLS")} onDragEnd={clearCardDrag}>
      <article className={styles.card} data-panel-id="PREPARE"><span className={styles.cardDragHandle} data-card-drag="PREPARE" draggable={!busy} title="Drag private prepare area card to reorder" aria-hidden="true">⋮⋮</span><p className={styles.eyebrow}>PRIVATE PREPARE AREA</p><h3>Send an approved item to the future queue</h3><p className={styles.muted}>These commands use Manual Playout's existing rights and revision checks. They do not start audio.</p><div className={styles.list}>{prepared.map((item) => <div className={styles.item} key={item.id}><header><strong>{item.title}</strong><span className={styles.status}>{item.rightsReady ? "READY" : "BLOCKED"}</span></header><small>{item.readinessReason || "Refresh rights before queueing."}</small><div className={styles.actions}><button className={styles.secondary} disabled={busy || !item.rightsReady} onClick={() => prepareQueue("SEND_NEXT", { itemId: item.id })}>Send to Next</button><button className={styles.secondary} disabled={busy || !item.rightsReady} onClick={() => prepareQueue("INSERT_QUEUE", { itemId: item.id })}>Add to end</button></div></div>)}{!prepared.length ? <p className={styles.muted}>Nothing prepared yet. Open Manual Playout to select protected media.</p> : null}</div></article>
      <article className={styles.card} data-panel-id="CARTS"><span className={styles.cardDragHandle} data-card-drag="CARTS" draggable={!busy} title="Drag hot carts card to reorder" aria-hidden="true">⋮⋮</span><p className={styles.eyebrow}>HOT CARTS</p><h3>Reusable protected media references</h3><p className={styles.muted}>Carts are configured here. Live firing stays unavailable until a verified output bridge is connected.</p><form className={styles.form} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; if (await save("CREATE_BANK", { name: new FormData(form).get("name") })) form.reset(); }}><label>New cart bank<input name="name" minLength="2" required /></label><button className={styles.secondary} disabled={busy}>Create bank</button></form>{data.banks.length ? <form className={styles.form} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries()); if (await save("ADD_CART", values)) form.reset(); }}><label>Bank<select name="bankId" required><option value="">Choose bank</option>{data.banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label><label>Protected media<select name="mediaAssetId" required><option value="">Choose file</option>{(data.cartChoices || []).map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {pretty(asset.mediaType)}</option>)}</select></label><label>Cart label<input name="label" maxLength="80" /></label><button className={styles.secondary} disabled={busy}>Add reference</button></form> : null}<div className={styles.list}>{data.banks.map((bank) => <div className={styles.item} key={bank.id}><strong>{bank.name}</strong><p>{bank.carts.length} carts</p>{bank.carts.map((cart) => <div key={cart.id} className={styles.item}><strong>{cart.label}</strong><small>{cart.ready ? "Media ready" : "Media unavailable"} · {pretty(cart.behaviour)}</small><button className={styles.danger} disabled={busy} onClick={() => save("REMOVE_CART", { cartId: cart.id })}>Remove</button></div>)}</div>)}</div></article>
      <article className={styles.card} data-panel-id="RADIO_CLOCKS"><span className={styles.cardDragHandle} data-card-drag="RADIO_CLOCKS" draggable={!busy} title="Drag radio clocks & voice tracks card to reorder" aria-hidden="true">⋮⋮</span><p className={styles.eyebrow}>RADIO CLOCKS & VOICE TRACKS</p><h3>Prepare the next programme</h3><p className={styles.muted}>Use the existing Radio Clock editor and Voice Tracking workflow. Changes remain subject to their own publication and approval controls.</p><div className={styles.list}>{data.clocks.map((item) => <div className={styles.item} key={item.id}><strong>{item.name}</strong><p>{Math.round(item.durationSeconds / 60)} min · published v{item.publishedVersion}</p></div>)}</div><div className={styles.actions}><a className={styles.secondary} href="/dashboard/programming#workspace-automation">Edit Radio Clocks</a><a className={styles.secondary} href={studioVoiceTrackingUrl(channelId)}>Prepare voice track for this channel</a><a className={styles.secondary} href="/dashboard/programming#workspace-live">Microphone studio</a></div></article>
      <article className={styles.card} data-panel-id="NOTES"><span className={styles.cardDragHandle} data-card-drag="NOTES" draggable={!busy} title="Drag presenter notes card to reorder" aria-hidden="true">⋮⋮</span><p className={styles.eyebrow}>PRESENTER NOTES</p><h3>Show cues</h3><p className={styles.warning}>Do not enter patient, student, pastoral or other sensitive personal records.</p><form className={styles.form} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries()); if (await save("CREATE_NOTE", values)) form.reset(); }}><label>Title<input name="title" required minLength="2" /></label><label>Note<textarea name="body" required minLength="2" maxLength="800" /></label><button className={styles.secondary} disabled={busy}>Add cue</button></form><div className={styles.list}>{data.notes.map((note) => <div className={styles.item} key={note.id}><header><strong>{note.title}</strong><span className={styles.status}>{note.acknowledgedAt ? "SEEN" : "NEW"}</span></header><p>{note.body}</p>{!note.acknowledgedAt ? <button className={styles.secondary} disabled={busy} onClick={() => save("ACK_NOTE", { noteId: note.id })}>Acknowledge</button> : null}</div>)}</div></article>
      <article className={styles.card} data-panel-id="MIX_POINTS"><span className={styles.cardDragHandle} data-card-drag="MIX_POINTS" draggable={!busy} title="Drag mix points card to reorder" aria-hidden="true">⋮⋮</span><p className={styles.eyebrow}>MIX POINTS</p><h3>Prepare a clean transition</h3><p className={styles.muted}>Set a cue, intro, mix, fade or end marker on an organisation-owned file already in this Console. These non-destructive defaults are used when preparing a new Manual Playout item.</p><form className={styles.form} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries()); await save("SAVE_MIX_POINT", { ...values, positionMs: Number(values.positionMs) }); }}><label>Media<select name="mediaAssetId" required><option value="">Choose a queued or cart file</option>{(data.markerChoices || []).map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.durationSeconds || "?"} sec</option>)}</select></label><label>Marker<select name="pointType"><option value="CUE_IN">Cue in</option><option value="INTRO_END">Intro end</option><option value="MIX_START">Mix start</option><option value="FADE_START">Fade start</option><option value="END">End</option></select></label><label>Position in milliseconds<input name="positionMs" type="number" min="0" step="1" required /></label><button className={styles.secondary} disabled={busy}>Save marker</button></form><div className={styles.list}>{(data.mixPoints || []).map((point) => <p key={point.id}>{pretty(point.type)} · {(point.positionMs / 1000).toFixed(2)} sec</p>)}</div></article>
    </ConsolePanelGrid> : null}
    {!monitor && data.spotBoard ? <div className={styles.consoleGrid} aria-label="Commercial spot board">
      <article className={styles.card}>
        <p className={styles.eyebrow}>COMMERCIAL SPOT BOARD · READ ONLY</p>
        <h3>Bookings for {data.channel.name}</h3>
        <p className={styles.muted}>Channel policy: {pretty(data.spotBoard.policyStatus)}. These are booking and approval records, not a timed playout list or proof that an advert reached listeners.</p>
        <div className={styles.list}>{data.spotBoard.bookings.map((booking) => <div className={styles.item} key={booking.id}>
          <header><strong>{booking.advertiser} · {booking.name}</strong><span className={styles.status}>{pretty(booking.bookingStatus)}</span></header>
          <p>{booking.campaignName} · campaign {pretty(booking.campaignStatus)}</p>
          <small>Inventory {pretty(booking.inventoryStatus)} · creative {pretty(booking.creativeStatus)} · {booking.effectiveFrom?.slice(0, 10) || "—"} to {booking.effectiveTo?.slice(0, 10) || "—"}</small>
        </div>)}{!data.spotBoard.bookings.length ? <p className={styles.muted}>No commercial bookings target this station or channel.</p> : null}</div>
        <div className={styles.actions}><a className={styles.secondary} href="/dashboard/radio/advertising">Review advertising approvals and placements</a></div>
      </article>
    </div> : null}
    <p className={styles.muted}>{data.rightsNotice}</p>
  </section>;
}
