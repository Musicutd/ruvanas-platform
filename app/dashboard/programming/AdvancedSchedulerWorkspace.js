"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./programming.module.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SOURCES = [["RADIO_CLOCK", "Radio Clock"], ["MUSIC_MODE", "Music Mode"], ["SHOW_RUNDOWN", "Show Rundown"]];
const EMPTY_ITEM = { label: "Scheduled programme", recurrence: "WEEKLY", sourceType: "RADIO_CLOCK", weekday: 1, startTime: "09:00", startsAt: "", durationMinutes: 60, priority: 50, sourceId: "" };
const EMPTY_FORM = { channelId: "", name: "", timezone: "Europe/Malta", items: [{ ...EMPTY_ITEM }] };

function sourceOptions(sources, type) {
  return { RADIO_CLOCK: sources?.radioClocks, MUSIC_MODE: sources?.musicModes, SHOW_RUNDOWN: sources?.rundowns }[type] || [];
}

function localInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}

function payloadItem(item) {
  return { ...item, startsAt: item.recurrence === "ONE_OFF" && item.startsAt ? new Date(item.startsAt).toISOString() : null };
}

export default function AdvancedSchedulerWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/advanced-scheduler", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load the Advanced Scheduler.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const schedules = data?.schedules || [];
  const configuredChannelIds = useMemo(() => new Set(schedules.map((schedule) => schedule.channel.id)), [schedules]);

  function resetForm() {
    setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_ITEM }] });
    setEditingId(null); setPreview(null); setAcknowledged(false); setError(""); setNotice("");
  }

  function edit(schedule) {
    const version = schedule.versions[0];
    setEditingId(schedule.id);
    setForm({
      channelId: schedule.channel.id,
      name: schedule.name,
      timezone: schedule.timezone,
      items: version.items.map((item) => ({ label: item.label, recurrence: item.recurrence, sourceType: item.sourceType, weekday: item.weekday ?? 1, startTime: item.startTime || "09:00", startsAt: localInput(item.startsAt), durationMinutes: item.durationMinutes, priority: item.priority, sourceId: item.sourceId }))
    });
    setPreview(null); setAcknowledged(false); setError(""); setNotice(`Preparing version ${schedule.latestVersion + 1}. The active version stays live until you publish.`);
  }

  function updateItem(index, field, value) {
    setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (field === "sourceType") return { ...item, sourceType: value, sourceId: "", durationMinutes: value === "RADIO_CLOCK" ? 60 : item.durationMinutes };
      if (field === "recurrence") return { ...item, recurrence: value, weekday: value === "WEEKLY" ? 1 : null, startTime: value === "WEEKLY" ? "09:00" : null, startsAt: value === "ONE_OFF" ? item.startsAt : "" };
      return { ...item, [field]: value };
    }) }));
  }

  async function save(event) {
    event.preventDefault(); setBusy("save"); setError(""); setNotice(""); setPreview(null); setAcknowledged(false);
    try {
      const body = { ...form, items: form.items.map(payloadItem) };
      const response = await fetch(editingId ? `/api/programming/advanced-scheduler/${editingId}` : "/api/programming/advanced-scheduler", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the schedule draft.");
      setEditingId(payload.schedule.id);
      setNotice(editingId ? `Version ${payload.schedule.latestVersion} saved as a draft. Preview it before publishing.` : "Channel schedule created as a draft. Preview the compiled week before publishing.");
      await load();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function previewVersion(scheduleId, versionId) {
    setBusy(`preview:${versionId}`); setError(""); setNotice(""); setAcknowledged(false);
    try {
      const response = await fetch(`/api/programming/advanced-scheduler/${scheduleId}/preview?versionId=${encodeURIComponent(versionId)}&days=7`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to compile this schedule.");
      setPreview(payload.preview); setEditingId(scheduleId);
    } catch (previewError) { setError(previewError.message); } finally { setBusy(""); }
  }

  async function publish(scheduleId, versionId) {
    setBusy(`publish:${versionId}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/programming/advanced-scheduler/${scheduleId}/versions/${versionId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conflictsAcknowledged: acknowledged }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to publish the schedule.");
      setNotice(`Version ${payload.version.version} is now the active channel schedule.`); setPreview(null); setAcknowledged(false); await load();
    } catch (publishError) { setError(publishError.message); } finally { setBusy(""); }
  }

  async function archive(scheduleId) {
    setBusy(`archive:${scheduleId}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/programming/advanced-scheduler/${scheduleId}/archive`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to take this schedule off air.");
      setNotice("The active version has been archived. Existing retail and school schedules remain unchanged."); setPreview(null); await load();
    } catch (archiveError) { setError(archiveError.message); } finally { setBusy(""); }
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading Advanced Scheduler…</div></section>;

  return <section className={styles.panel} aria-labelledby="advanced-scheduler-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>ADVANCED SCHEDULER</p><h2 id="advanced-scheduler-title">Build the channel day</h2></div><span className={styles.count}>{schedules.length} channel{schedules.length === 1 ? "" : "s"}</span></div>
    <p className={styles.panelIntro}>Assign published Radio Clocks, playable Music Modes and approved Show Rundowns directly to a channel. Weekly and one-off programmes are compiled in the channel timezone before publication.</p>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}

    {schedules.length ? <div className={styles.schedulerGrid}>{schedules.map((schedule) => { const latest = schedule.versions[0]; return <article className={`${styles.schedulerCard} ${editingId === schedule.id ? styles.selectedCard : ""}`} key={schedule.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{schedule.name}</strong><span>{schedule.channel.name} · {schedule.timezone}</span></div><span className={schedule.activeVersion ? styles.publishedBadge : styles.draftBadge}>{schedule.activeVersion ? `LIVE v${schedule.activeVersion.version}` : "DRAFT"}</span></div>
      <p>{latest.items.length} programme{latest.items.length === 1 ? "" : "s"} · latest version {latest.version} {latest.status.toLowerCase()}</p>
      <div className={styles.versionStrip}>{schedule.versions.slice(0, 5).map((version) => <button type="button" key={version.id} className={version.isActive ? styles.activeVersion : styles.versionButton} onClick={() => previewVersion(schedule.id, version.id)}>v{version.version} · {version.isActive ? "live" : version.status.toLowerCase()}</button>)}</div>
      <div className={styles.cardActions}>{data.canAuthor ? <button type="button" className={styles.secondaryButton} onClick={() => edit(schedule)}>Prepare next version</button> : null}<button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => previewVersion(schedule.id, latest.id)}>Preview latest</button>{data.canPublish && schedule.activeVersion ? <button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => archive(schedule.id)}>Take off air</button> : null}</div>
    </article>; })}</div> : <div className={styles.emptyState}>No channel schedules yet. Choose an active Online Radio channel and build its first governed week.</div>}

    {data?.canAuthor ? <form className={styles.schedulerForm} onSubmit={save}><div className={styles.smartFormHeader}><div><h3>{editingId ? "Prepare the next schedule version" : "Create a channel schedule"}</h3><p>Saving never changes live playback. Publication is a separate owner or manager action.</p></div>{editingId ? <button type="button" className={styles.secondaryButton} onClick={resetForm}>Create another</button> : null}</div>
      <div className={styles.formGrid}><label><span>Channel</span><select required disabled={Boolean(editingId)} value={form.channelId} onChange={(event) => setForm({ ...form, channelId: event.target.value })}><option value="">Choose channel</option>{(data.sources?.channels || []).map((channel) => <option key={channel.id} value={channel.id} disabled={!editingId && configuredChannelIds.has(channel.id)}>{channel.name}{channel.configured ? " · configured" : ""}</option>)}</select></label><label><span>Schedule name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Ruvanas Radio weekly grid" /></label><label><span>Channel timezone</span><input required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} placeholder="Europe/Malta" /></label></div>
      <div className={styles.slotHeader}><h3>Programmes</h3><button type="button" className={styles.secondaryButton} disabled={form.items.length >= 200} onClick={() => setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM, label: `Programme ${form.items.length + 1}` }] })}>Add programme</button></div>
      <div className={styles.schedulerItems}>{form.items.map((item, index) => <div className={styles.schedulerItem} key={index}><span className={styles.clockPosition}>{index + 1}</span><label><span>Programme label</span><input required value={item.label} onChange={(event) => updateItem(index, "label", event.target.value)} /></label><label><span>Source type</span><select value={item.sourceType} onChange={(event) => updateItem(index, "sourceType", event.target.value)}>{SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={styles.schedulerSource}><span>Approved source</span><select required value={item.sourceId} onChange={(event) => updateItem(index, "sourceId", event.target.value)}><option value="">Choose source</option>{sourceOptions(data.sources, item.sourceType).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label><label><span>Recurrence</span><select value={item.recurrence} onChange={(event) => updateItem(index, "recurrence", event.target.value)}><option value="WEEKLY">Every week</option><option value="ONE_OFF">One-off</option></select></label>{item.recurrence === "WEEKLY" ? <><label><span>Day</span><select value={item.weekday} onChange={(event) => updateItem(index, "weekday", Number(event.target.value))}>{DAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label><label><span>Local start</span><input required type="time" value={item.startTime} onChange={(event) => updateItem(index, "startTime", event.target.value)} /></label></> : <label className={styles.oneOffTime}><span>One-off start</span><input required type="datetime-local" value={item.startsAt} onChange={(event) => updateItem(index, "startsAt", event.target.value)} /></label>}<label><span>Minutes</span><input type="number" min="1" max="1440" disabled={item.sourceType === "RADIO_CLOCK"} value={item.durationMinutes} onChange={(event) => updateItem(index, "durationMinutes", event.target.value)} /></label><label><span>Priority</span><input type="number" min="0" max="100" value={item.priority} onChange={(event) => updateItem(index, "priority", event.target.value)} /></label><button type="button" className={styles.removeButton} disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button></div>)}</div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>Draft → timezone preview → controlled publication</span><button className={styles.primaryButton} disabled={busy !== ""}>{busy === "save" ? "Saving…" : editingId ? "Save next version" : "Create schedule draft"}</button></div>
    </form> : <div className={styles.readOnlyMessage}>You can inspect channel schedules. An owner, manager or content editor can prepare changes.</div>}

    {preview ? <div className={styles.schedulerPreview}><div className={styles.sectionHeading}><div><p className={styles.kicker}>SEVEN-DAY COMPILED PREVIEW</p><h3>{preview.schedule.name} · version {preview.version.version}</h3></div><span className={preview.readyToPublish ? styles.publishedBadge : styles.draftBadge}>{preview.readyToPublish ? "READY" : "CONFLICTS"}</span></div>
      {preview.compatibilityWarnings.map((warning) => <div className={styles.compatibilityWarning} key={warning}>{warning}</div>)}
      {preview.conflicts.map((conflict, index) => <div className={conflict.severity === "BLOCKING" ? styles.blockingConflict : styles.overrideConflict} key={`${conflict.leftPosition}-${conflict.rightPosition}-${index}`}>{conflict.severity === "BLOCKING" ? "Blocking overlap" : `Priority override: programme ${conflict.winnerPosition + 1} wins`} · programmes {conflict.leftPosition + 1} and {conflict.rightPosition + 1}</div>)}
      <div className={styles.compiledList}>{preview.occurrences.slice(0, 100).map((occurrence, index) => <div className={styles.compiledItem} key={`${occurrence.position}-${occurrence.startsAt}-${index}`}><time>{new Date(occurrence.startsAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><div><strong>{occurrence.label}</strong><span>{occurrence.sourceType.replaceAll("_", " ")} · {occurrence.source.name}</span></div><small>{occurrence.durationMinutes || Math.round((new Date(occurrence.endsAt) - new Date(occurrence.startsAt)) / 60000)} min · priority {occurrence.priority}</small></div>)}</div>
      {preview.conflicts.some((conflict) => conflict.severity === "CONTROLLED_OVERRIDE") ? <label className={styles.reviewCheck}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I reviewed the priority overrides and confirm that the higher-priority programmes should win.</span></label> : null}
      {data.canPublish && preview.version.status === "DRAFT" ? <div className={styles.actionBar}><button type="button" className={styles.primaryButton} disabled={!preview.readyToPublish || busy !== "" || (preview.conflicts.some((conflict) => conflict.severity === "CONTROLLED_OVERRIDE") && !acknowledged)} onClick={() => publish(preview.schedule.id, preview.version.id)}>Publish version {preview.version.version}</button></div> : null}
    </div> : null}
  </section>;
}
