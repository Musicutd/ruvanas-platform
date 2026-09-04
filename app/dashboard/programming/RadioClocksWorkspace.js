"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./programming.module.css";

const TYPE_OPTIONS = [["MUSIC_MODE", "Music mode"], ["MUSIC_TRACK", "Specific music track"], ["PROMO", "Jingle or promo"], ["SHOW_RUNDOWN", "Approved show rundown"], ["MARKER", "Timing marker"]];
const TRANSITIONS = [["CLEAN", "Clean"], ["CROSSFADE", "Crossfade"], ["DUCK_VOICE", "Duck voice"], ["HARD_START", "Hard start"]];
const DEFAULT_DURATION = { MUSIC_MODE: 3600, MUSIC_TRACK: 180, PROMO: 30, SHOW_RUNDOWN: 1800, MARKER: 0 };
const EMPTY_ITEM = { type: "MUSIC_MODE", label: "Music sweep", durationSeconds: 3600, transition: "CLEAN", transitionSeconds: 0, sourceId: "" };
const EMPTY_FORM = { name: "", description: "", items: [{ ...EMPTY_ITEM }] };

function sourceCollection(sources, type) {
  return { MUSIC_MODE: sources?.musicModes, MUSIC_TRACK: sources?.tracks, PROMO: sources?.promos, SHOW_RUNDOWN: sources?.rundowns }[type] || [];
}

function plannedSeconds(items) {
  let cursor = 0;
  for (const item of items) {
    if (item.type === "MARKER") continue;
    const overlap = ["CROSSFADE", "DUCK_VOICE"].includes(item.transition) ? Number(item.transitionSeconds || 0) : 0;
    cursor = Math.max(0, cursor - overlap) + Number(item.durationSeconds || 0);
  }
  return cursor;
}

function time(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export default function RadioClocksWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/radio-clocks", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load Radio Clocks.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const total = useMemo(() => plannedSeconds(form.items), [form.items]);
  const remaining = 3600 - total;
  const clocks = data?.clocks || [];

  function resetForm() {
    setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_ITEM }] });
    setEditingId(null); setPreview(null); setError(""); setNotice("");
  }

  function edit(clock) {
    setEditingId(clock.id);
    setForm({ name: clock.name, description: clock.description || "", items: clock.items.map((item) => ({ type: item.type, label: item.label, durationSeconds: item.durationSeconds, transition: item.transition, transitionSeconds: item.transitionSeconds, sourceId: item.sourceId || "" })) });
    setPreview(null); setError(""); setNotice("");
  }

  function updateItem(index, field, value) {
    setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (field === "type") return { ...item, type: value, durationSeconds: DEFAULT_DURATION[value], sourceId: "", transition: "CLEAN", transitionSeconds: 0 };
      if (field === "transition") return { ...item, transition: value, transitionSeconds: ["CROSSFADE", "DUCK_VOICE"].includes(value) ? 2 : 0 };
      return { ...item, [field]: value };
    }) }));
  }

  function moveUp(index) {
    if (index < 1) return;
    setForm((current) => {
      const items = [...current.items];
      [items[index - 1], items[index]] = [items[index], items[index - 1]];
      return { ...current, items };
    });
  }

  function fitLastItem() {
    const actualIndex = [...form.items].map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => item.type !== "MARKER").at(-1)?.itemIndex;
    if (actualIndex === undefined) return;
    const nextDuration = Number(form.items[actualIndex].durationSeconds || 0) + remaining;
    if (nextDuration < 1 || nextDuration > 3600) return setError("The final playable item cannot absorb the remaining time. Adjust an earlier item first.");
    updateItem(actualIndex, "durationSeconds", nextDuration); setError("");
  }

  async function save(event) {
    event.preventDefault(); setBusy("save"); setError(""); setNotice(""); setPreview(null);
    try {
      const response = await fetch(editingId ? `/api/programming/radio-clocks/${editingId}` : "/api/programming/radio-clocks", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the Radio Clock.");
      setEditingId(payload.clock.id);
      setNotice(editingId ? "Clock structure saved as a new version. Publish it when the hour is ready." : "Clock draft created. Preview the complete hour before publishing.");
      await load();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function previewClock(id) {
    setBusy(`preview:${id}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/programming/radio-clocks/${id}/preview`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to preview the Radio Clock.");
      setPreview(payload.clock); setEditingId(id);
    } catch (previewError) { setError(previewError.message); } finally { setBusy(""); }
  }

  async function action(id, actionName) {
    setBusy(`${actionName}:${id}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/programming/radio-clocks/${id}/${actionName}`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Unable to ${actionName} this Radio Clock.`);
      setNotice(actionName === "publish" ? `Version ${payload.clock.publishedVersion} is now the approved reusable hour template.` : "Radio Clock archived.");
      if (actionName === "archive") resetForm();
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setBusy(""); }
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading Radio Clocks…</div></section>;

  return <section className={styles.panel} aria-labelledby="radio-clocks-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>RADIO CLOCKS</p><h2 id="radio-clocks-title">Shape every broadcast hour</h2></div><span className={styles.count}>{clocks.length} saved</span></div>
    <p className={styles.panelIntro}>Create a reusable 60-minute structure from music modes, individual tracks, approved promos and Show Builder rundowns. Crossfades and voice ducking use the same transition language as the studio.</p>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}

    {clocks.length ? <div className={styles.clockGrid}>{clocks.map((clock) => <article className={`${styles.clockCard} ${editingId === clock.id ? styles.selectedCard : ""}`} key={clock.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{clock.name}</strong><span>Version {clock.version}{clock.needsPublish ? " · unpublished changes" : ""}</span></div><span className={clock.status === "PUBLISHED" && !clock.needsPublish ? styles.publishedBadge : styles.draftBadge}>{clock.status === "PUBLISHED" && !clock.needsPublish ? "PUBLISHED" : "DRAFT"}</span></div>
      <div className={styles.clockMeter}><span style={{ width: `${Math.min(100, clock.plannedSeconds / 36)}%` }} /></div><p>{clock.items.length} items · {time(clock.plannedSeconds)} of 60:00 · {clock.readyToPublish ? "exact hour" : `${Math.abs(clock.remainingSeconds)} seconds ${clock.remainingSeconds > 0 ? "short" : "over"}`}</p>
      <div className={styles.cardActions}>{data.canAuthor ? <button type="button" className={styles.secondaryButton} onClick={() => edit(clock)}>Edit clock</button> : null}<button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => previewClock(clock.id)}>Preview hour</button>{data.canPublish && clock.readyToPublish && (clock.status === "DRAFT" || clock.needsPublish) ? <button type="button" className={styles.primaryButton} disabled={busy !== ""} onClick={() => action(clock.id, "publish")}>Publish clock</button> : null}{data.canPublish ? <button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => action(clock.id, "archive")}>Archive</button> : null}</div>
    </article>)}</div> : <div className={styles.emptyState}>No Radio Clocks yet. Start with a music sweep, then add the fixed points that give the hour its sound.</div>}

    {data?.canAuthor ? <form className={styles.smartPlaylistForm} onSubmit={save}><div className={styles.smartFormHeader}><div><h3>{editingId ? "Edit Radio Clock" : "Create a Radio Clock"}</h3><p>The timing meter must finish at exactly 60:00 before an owner or manager can publish.</p></div>{editingId ? <button type="button" className={styles.secondaryButton} onClick={resetForm}>Create another</button> : null}</div>
      <div className={styles.formGrid}><label><span>Clock name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Contemporary daytime hour" /></label><label><span>Purpose</span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe where this clock will be used" /></label></div>
      <div className={styles.clockSummary}><div><strong>{time(total)} / 60:00</strong><span>{remaining === 0 ? "Ready for publication" : `${Math.abs(remaining)} seconds ${remaining > 0 ? "remaining" : "over"}`}</span></div><div className={styles.clockMeter}><span style={{ width: `${Math.min(100, total / 36)}%` }} /></div><button type="button" className={styles.secondaryButton} disabled={remaining === 0} onClick={fitLastItem}>Fit final item to hour</button></div>
      <div className={styles.slotHeader}><h3>Clock items</h3><button type="button" className={styles.secondaryButton} disabled={form.items.length >= 100} onClick={() => setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM, durationSeconds: 180 }] })}>Add item</button></div>
      <div className={styles.clockItemList}>{form.items.map((item, index) => { const options = sourceCollection(data.sources, item.type); return <div className={styles.clockItem} key={index}><span className={styles.clockPosition}>{index + 1}</span><label><span>Type</span><select value={item.type} onChange={(event) => updateItem(index, "type", event.target.value)}>{TYPE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Label</span><input required value={item.label} onChange={(event) => updateItem(index, "label", event.target.value)} /></label>{item.type !== "MARKER" ? <label className={styles.clockSource}><span>Approved source</span><select required value={item.sourceId} onChange={(event) => updateItem(index, "sourceId", event.target.value)}><option value="">Choose source</option>{options.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}</select></label> : <div className={styles.clockSource}><span>Marker only</span><small>No audio source is played.</small></div>}<label><span>Seconds</span><input type="number" min={item.type === "MARKER" ? 0 : 1} max="3600" value={item.durationSeconds} onChange={(event) => updateItem(index, "durationSeconds", event.target.value)} /></label><label><span>Transition</span><select value={item.transition} onChange={(event) => updateItem(index, "transition", event.target.value)}>{TRANSITIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Mix seconds</span><input type="number" min="0" max="30" disabled={!['CROSSFADE', 'DUCK_VOICE'].includes(item.transition)} value={item.transitionSeconds} onChange={(event) => updateItem(index, "transitionSeconds", event.target.value)} /></label><div className={styles.clockItemActions}><button type="button" className={styles.copyButton} disabled={index === 0} onClick={() => moveUp(index)}>↑</button><button type="button" className={styles.removeButton} disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button></div></div>; })}</div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>Draft → exact-hour preview → owner/manager publish</span><button className={styles.primaryButton} disabled={busy !== ""}>{busy === "save" ? "Saving…" : editingId ? "Save new version" : "Create clock draft"}</button></div></form> : <div className={styles.readOnlyMessage}>You can view and preview Radio Clocks. An owner, manager or content editor can change them.</div>}

    {preview ? <div className={styles.clockPreview}><div className={styles.sectionHeading}><div><p className={styles.kicker}>ONE-HOUR PREVIEW</p><h3>{preview.name}</h3></div><span className={preview.readyToPublish ? styles.publishedBadge : styles.draftBadge}>{preview.readyToPublish ? "EXACT 60:00" : "TIMING CHECK"}</span></div><div className={styles.timeline}>{preview.items.map((item) => <div className={styles.timelineItem} key={item.id}><time>{time(item.offsetSeconds)}</time><div><strong>{item.label}</strong><span>{item.type.replaceAll("_", " ")} · {item.source?.name || "Timing marker"}</span><small>{item.durationSeconds}s · {item.transition.replaceAll("_", " ").toLowerCase()}{item.transitionSeconds ? ` ${item.transitionSeconds}s` : ""}</small></div></div>)}</div></div> : null}
  </section>;
}
