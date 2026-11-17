"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scopeStationScheduleData } from "@/lib/station-schedule-scope.mjs";
import { schedulerFormTimezone, schedulerLocalInput, schedulerPayloadItem, schedulerPreviewDays } from "@/lib/scheduler-form-time.mjs";
import styles from "./programming.module.css";
import previewStyles from "./advanced-scheduler-preview.module.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SOURCES = [["MUSIC_MODE", "Music mix"], ["RADIO_CLOCK", "Radio clock"], ["SHOW_RUNDOWN", "Approved show"]];
const EMPTY_ITEM = { label: "Music programme", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", weekday: 1, startTime: "09:00", startsAt: "", durationMinutes: 60, priority: 50, sourceId: "" };
const EMPTY_FORM = { channelId: "", name: "", timezone: "Europe/Malta", items: [{ ...EMPTY_ITEM }] };

function sourceOptions(sources, type) {
  return { RADIO_CLOCK: sources?.radioClocks, MUSIC_MODE: sources?.musicModes, SHOW_RUNDOWN: sources?.rundowns }[type] || [];
}

export function plannerFormSnapshot(form) {
  return JSON.stringify({
    channelId: form.channelId, name: form.name, timezone: form.timezone,
    items: form.items.map((item) => ({
      label: item.label, sourceType: item.sourceType, sourceId: item.sourceId,
      recurrence: item.recurrence, weekday: String(item.weekday ?? ""),
      startTime: item.startTime || "", startsAt: item.startsAt || "",
      durationMinutes: String(item.durationMinutes), priority: String(item.priority)
    }))
  });
}

export function plannerFormIssues(form) {
  const issues = [];
  if (!form.channelId) issues.push("Choose the channel for this plan.");
  if (form.name.trim().length < 2 || form.name.trim().length > 120) issues.push("Give your plan a name of 2–120 characters.");
  try { new Intl.DateTimeFormat("en-GB", { timeZone: form.timezone }).format(); }
  catch { issues.push("Enter a valid planner time zone, such as Europe/Malta."); }
  for (const [index, item] of form.items.entries()) {
    const prefix = `Programme ${index + 1}: `;
    if (item.label.trim().length < 2 || item.label.trim().length > 160) issues.push(`${prefix}enter a name of 2–160 characters.`);
    if (!item.sourceId) issues.push(`${prefix}choose a saved music mix, radio clock or approved show.`);
    if (!Number.isInteger(Number(item.durationMinutes)) || Number(item.durationMinutes) < 1 || Number(item.durationMinutes) > 1440) issues.push(`${prefix}choose a length from 1 to 1,440 minutes.`);
    if (!Number.isInteger(Number(item.priority)) || Number(item.priority) < 0 || Number(item.priority) > 100) issues.push(`${prefix}choose an overlap priority from 0 to 100.`);
    if (item.recurrence === "WEEKLY" && (!Number.isInteger(Number(item.weekday)) || Number(item.weekday) < 0 || Number(item.weekday) > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime || ""))) issues.push(`${prefix}choose a weekday and valid start time.`);
    try { schedulerPayloadItem(item, form.timezone); }
    catch (error) { issues.push(`${prefix}${error.message}`); }
  }
  return issues;
}

// Presentation only. Server handlers still own all tenant, rights and write gates.
export function scopePlannerChannels(payload, onlineChannelIds = null) {
  let scoped = payload;
  if (onlineChannelIds !== null) {
    const allowed = new Set(Array.isArray(onlineChannelIds) ? onlineChannelIds : []);
    scoped = {
      ...payload,
      sources: { ...payload.sources, channels: (payload.sources?.channels || []).filter((channel) => allowed.has(channel.id)) },
      schedules: (payload.schedules || []).filter((schedule) => allowed.has(schedule.channel?.id))
    };
  }
  if (scoped.sandboxDraftOnly === true) return {
    ...scoped,
    schedules: (scoped.schedules || []).filter((schedule) => !schedule.activeVersion && schedule.versions?.length > 0 && schedule.versions.every((version) => version.status === "DRAFT" && version.isActive !== true))
  };
  return scoped;
}

export default function AdvancedSchedulerWorkspace({ stationId = null, onlineChannelIds = null }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formBaseline, setFormBaseline] = useState(() => plannerFormSnapshot(EMPTY_FORM));
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [loadedFormVersion, setLoadedFormVersion] = useState(null);
  const loadedScope = useRef(undefined);
  const choicesRefreshPending = useRef(false);
  const channelScopeKey = JSON.stringify(onlineChannelIds === null ? null : Array.isArray(onlineChannelIds) ? [...new Set(onlineChannelIds)].sort() : []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/advanced-scheduler", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load the weekly planner.");
      const allowedChannelIds = JSON.parse(channelScopeKey);
      const scoped = scopePlannerChannels(scopeStationScheduleData(payload, stationId), allowedChannelIds);
      const scopedChannels = scoped.sources.channels;
      setData(scoped);
      const editorScope = JSON.stringify([stationId, channelScopeKey]);
      if (loadedScope.current !== editorScope) {
        const channel = stationId || allowedChannelIds !== null ? scopedChannels.find((item) => !item.configured) || scopedChannels[0] : null;
        const initialForm = { ...EMPTY_FORM, channelId: channel?.id || "", timezone: schedulerFormTimezone(channel, EMPTY_FORM.timezone), items: [{ ...EMPTY_ITEM }] };
        setForm(initialForm); setFormBaseline(plannerFormSnapshot(initialForm));
        loadedScope.current = editorScope;
      }
      return true;
    } catch (loadError) { setError(loadError.message); return false; } finally { setBusy(""); }
  }, [stationId, channelScopeKey]);

  const refreshChoices = useCallback(async () => {
    setBusy("refresh"); setError(""); setNotice("");
    if (await load()) setNotice("Playlist choices and saved plans refreshed. Your form changes have been kept.");
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!busy && choicesRefreshPending.current) {
      choicesRefreshPending.current = false;
      void refreshChoices();
    }
    const refresh = () => {
      if (busy) { choicesRefreshPending.current = true; return; }
      void refreshChoices();
    };
    window.addEventListener("ruvanas:playlists-changed", refresh);
    return () => window.removeEventListener("ruvanas:playlists-changed", refresh);
  }, [busy, refreshChoices]);
  const schedules = data?.schedules || [];
  const configuredChannelIds = useMemo(() => new Set(schedules.map((schedule) => schedule.channel.id)), [schedules]);
  const previewDays = useMemo(() => preview ? schedulerPreviewDays(preview) : [], [preview]);
  const selectedChannel = data?.sources?.channels?.find((channel) => channel.id === form.channelId);
  const sandboxDraftOnly = data?.sandboxDraftOnly === true;
  const canPublish = data?.canPublish === true && !sandboxDraftOnly;
  const hasUnsavedChanges = plannerFormSnapshot(form) !== formBaseline;
  const formIssues = useMemo(() => plannerFormIssues(form), [form]);
  const savedSchedule = schedules.find((schedule) => schedule.id === editingId);
  const savedVersion = savedSchedule?.versions?.[0];
  const previewIsCurrent = preview?.schedule?.id === editingId;
  const currentStep = !editingId || hasUnsavedChanges ? 1 : !previewIsCurrent ? 2 : 3;
  const availableSourceTypes = sandboxDraftOnly ? SOURCES.filter(([type]) => type === "MUSIC_MODE") : SOURCES;
  const previewLabel = sandboxDraftOnly
    ? preview?.conflicts?.some((conflict) => conflict.severity === "BLOCKING") ? "CONFLICTS" : "VALID DRAFT"
    : preview?.readyToPublish ? "READY" : "CONFLICTS";

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

  function mayDiscardChanges() {
    return !hasUnsavedChanges || window.confirm("Discard your unsaved weekly planner changes? Your saved versions will stay unchanged.");
  }

  function resetForm() {
    if (!mayDiscardChanges()) return;
    const channel = stationId || onlineChannelIds !== null ? data?.sources?.channels?.find((item) => !item.configured) || data?.sources?.channels?.[0] : null;
    const nextForm = { ...EMPTY_FORM, channelId: channel?.id || "", timezone: schedulerFormTimezone(channel, EMPTY_FORM.timezone), items: [{ ...EMPTY_ITEM, sourceType: stationId ? "MUSIC_MODE" : EMPTY_ITEM.sourceType, label: stationId ? "Music rotation" : EMPTY_ITEM.label }] };
    setForm(nextForm); setFormBaseline(plannerFormSnapshot(nextForm));
    setEditingId(null); setLoadedFormVersion(null); setPreview(null); setAcknowledged(false); setError(""); setNotice(""); setAttemptedSave(false);
  }

  function edit(schedule) {
    if (!mayDiscardChanges()) return;
    const version = schedule.versions[0];
    setEditingId(schedule.id);
    setLoadedFormVersion(version.version);
    const nextForm = {
      channelId: schedule.channel.id,
      name: schedule.name,
      timezone: schedule.timezone,
      items: version.items.map((item) => ({ label: item.label, recurrence: item.recurrence, sourceType: item.sourceType, weekday: item.weekday ?? 1, startTime: item.startTime || "09:00", startsAt: schedulerLocalInput(item.startsAt, schedule.timezone), originalStartsAt: item.startsAt, originalTimezone: schedule.timezone, durationMinutes: item.durationMinutes, priority: item.priority, sourceId: item.sourceId }))
    };
    setForm(nextForm); setFormBaseline(plannerFormSnapshot(nextForm)); setAttemptedSave(false);
    setPreview(null); setAcknowledged(false); setError(""); setNotice(sandboxDraftOnly ? `Preparing private draft version ${schedule.latestVersion + 1}. Broadcasting remains off.` : `Preparing version ${schedule.latestVersion + 1}. The active version stays live until you publish.`);
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
    event.preventDefault(); setAttemptedSave(true); setError(""); setNotice("");
    if (formIssues.length) { setError("Complete the highlighted planner details before saving."); return; }
    setBusy("save"); setPreview(null); setAcknowledged(false);
    try {
      const body = { ...form, items: form.items.map((item) => schedulerPayloadItem(item, form.timezone)) };
      const response = await fetch(editingId ? `/api/programming/advanced-scheduler/${editingId}` : "/api/programming/advanced-scheduler", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the schedule draft.");
      setEditingId(payload.schedule.id);
      setLoadedFormVersion(payload.schedule.latestVersion);
      setFormBaseline(plannerFormSnapshot(form)); setAttemptedSave(false);
      setNotice(sandboxDraftOnly ? `Private draft version ${payload.schedule.latestVersion} saved. Preview the compiled week; publication and live broadcasting are blocked.` : editingId ? `Version ${payload.schedule.latestVersion} saved as a draft. Preview it before publishing.` : "Channel schedule created as a draft. Preview the compiled week before publishing.");
      await load();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function previewVersion(scheduleId, versionId) {
    setBusy(`preview:${versionId}`); setError(""); setNotice(""); setAcknowledged(false);
    try {
      const response = await fetch(`/api/programming/advanced-scheduler/${scheduleId}/preview?versionId=${encodeURIComponent(versionId)}&days=7`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to compile this schedule.");
      setPreview(payload.preview);
    } catch (previewError) { setError(previewError.message); } finally { setBusy(""); }
  }

  async function publish(scheduleId, versionId) {
    if (!canPublish) return;
    if (hasUnsavedChanges) { setError("Save or discard your form changes, then preview the saved version before publishing."); return; }
    setBusy(`publish:${versionId}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/programming/advanced-scheduler/${scheduleId}/versions/${versionId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conflictsAcknowledged: acknowledged }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to publish the schedule.");
      setNotice(`Version ${payload.version.version} is now the active channel schedule.`); setPreview(null); setAcknowledged(false); await load();
    } catch (publishError) { setError(publishError.message); } finally { setBusy(""); }
  }

  async function archive(scheduleId) {
    if (!canPublish) return;
    setBusy(`archive:${scheduleId}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/programming/advanced-scheduler/${scheduleId}/archive`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to take this schedule off air.");
      setNotice("The active version has been archived. Existing retail and school schedules remain unchanged."); setPreview(null); await load();
    } catch (archiveError) { setError(archiveError.message); } finally { setBusy(""); }
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading weekly planner…</div></section>;
  if (!data) return <section className={styles.panel}><h2>Weekly planner unavailable</h2><p role="alert">{error || "Your saved plans could not be loaded."}</p><button type="button" className={styles.secondaryButton} onClick={() => { setBusy("load"); setError(""); load(); }}>Try loading again</button></section>;

  return <section className={styles.panel} aria-labelledby="advanced-scheduler-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>WEEKLY PLANNER</p><h2 id="advanced-scheduler-title">{stationId ? "Plan your station week" : "Weekly programme planner"}</h2></div><div className={previewStyles.headingTools}><span className={styles.count}>{schedules.length} channel{schedules.length === 1 ? "" : "s"}</span><button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={refreshChoices}>{busy === "refresh" ? "Refreshing…" : "Refresh playlist choices"}</button></div></div>
    <p className={styles.panelIntro}>{sandboxDraftOnly ? "Choose a saved private playlist for your test channel. Set its day, start time and length, then save and preview the week in the planner time zone. This is a plan only; publishing and live broadcasting remain blocked." : <>Choose an approved music mix, a published radio clock or an approved show for {stationId ? "this station's channel" : "a channel"}. Set its day, start time and length, then review the saved week in the planner time zone. Save a draft first; publishing is a separate action.</>}</p>
    <ol className={previewStyles.steps} aria-label="Weekly planner steps">
      <li aria-current={currentStep === 1 ? "step" : undefined}><span>1</span><div><strong>Prepare a draft</strong><small>Name your plan and add programmes. Saving does not start audio.</small></div></li>
      <li aria-current={currentStep === 2 ? "step" : undefined}><span>2</span><div><strong>Review the saved week</strong><small>Preview the dates, time zone and any overlaps before continuing.</small></div></li>
      <li aria-current={currentStep === 3 ? "step" : undefined}><span>3</span><div><strong>{sandboxDraftOnly ? "Keep your test private" : "Publish when ready"}</strong><small>{sandboxDraftOnly ? "Your drafts stay private. Publishing and broadcasting are blocked." : "Only an owner or manager can activate a saved schedule. This is a separate action."}</small></div></li>
    </ol>
    {sandboxDraftOnly ? <aside className={styles.readOnlyMessage} role="note"><strong>Private Online Radio drafts only.</strong> You can save and preview your weekly plan. Publishing, taking a schedule off air, live broadcasting, uploads, downloads and paid actions are blocked. Saving never starts audio.</aside> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}

    {!data?.sources?.channels?.length && (stationId || onlineChannelIds !== null) ? <div className={styles.emptyState}>{stationId ? "No active channel is prepared for this station. Ask Ruvanas Super Admin to prepare the Online Radio channel in station setup first." : "No Online Radio channels are available in this planner. Ask Ruvanas Super Admin to prepare your station channel first."}</div> : null}
    {schedules.length ? <div className={styles.schedulerGrid}>{schedules.map((schedule) => { const latest = schedule.versions[0]; return <article className={`${styles.schedulerCard} ${editingId === schedule.id ? styles.selectedCard : ""}`} key={schedule.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{schedule.name}</strong><span>{schedule.channel.name} · {schedule.timezone}</span></div><span className={schedule.activeVersion ? styles.publishedBadge : styles.draftBadge}>{schedule.activeVersion ? `Published v${schedule.activeVersion.version}` : "DRAFT"}</span></div>
      <p>{latest.items.length} programme{latest.items.length === 1 ? "" : "s"} · latest version {latest.version} {latest.status.toLowerCase()}</p>
      <div className={styles.versionStrip}>{schedule.versions.slice(0, 5).map((version) => <button type="button" key={version.id} disabled={busy !== ""} className={version.isActive ? styles.activeVersion : styles.versionButton} onClick={() => previewVersion(schedule.id, version.id)}>v{version.version} · {version.isActive ? "published" : version.status.toLowerCase()}</button>)}</div>
      <div className={styles.cardActions}>{data.canAuthor ? <button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => edit(schedule)}>Edit next draft</button> : null}<button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => previewVersion(schedule.id, latest.id)}>Preview latest</button>{canPublish && schedule.activeVersion ? <button type="button" className={styles.removeButton} disabled={busy !== "" || hasUnsavedChanges} onClick={() => archive(schedule.id)}>Take off air</button> : null}</div>
    </article>; })}</div> : <div className={styles.emptyState}>{sandboxDraftOnly ? "No private weekly drafts yet. Choose your test channel and build its first week." : "No channel schedules yet. Choose an active Online Radio channel and build its first governed week."}</div>}

    {data?.canAuthor && ((!stationId && onlineChannelIds === null) || data.sources?.channels?.length) ? <form className={styles.schedulerForm} onSubmit={save} id="weekly-planner-form"><fieldset className={previewStyles.formFields} disabled={busy !== ""}><legend className={previewStyles.srOnly}>Prepare your weekly plan</legend><div className={styles.smartFormHeader}><div><h3>{editingId ? "Prepare the next schedule version" : "Create a channel schedule"}</h3><p>{sandboxDraftOnly ? "Saving keeps this a private draft. No publication or live playback is available in this workspace." : "Saving never changes live playback. Publication is a separate owner or manager action."}</p></div>{editingId ? <button type="button" className={styles.secondaryButton} onClick={resetForm}>Create another</button> : null}</div>
      <div className={`${previewStyles.saveState} ${hasUnsavedChanges ? previewStyles.unsaved : ""}`} role="status"><strong>{hasUnsavedChanges ? "Unsaved form changes" : editingId ? `Saved version ${loadedFormVersion || ""} loaded` : "New draft · not saved yet"}</strong><span>{hasUnsavedChanges ? "Save the draft to include these changes in a preview. Your published schedule is unchanged." : editingId ? "You can preview these saved details below. Editing prepares a separate next version." : "Complete the details below, then save your first private draft."}</span>{hasUnsavedChanges ? <button type="button" className={styles.secondaryButton} onClick={() => savedSchedule ? edit(savedSchedule) : resetForm()}>Discard form changes</button> : null}</div>
      {attemptedSave && formIssues.length ? <div className={previewStyles.validation} role="alert"><strong>Before saving, please check:</strong><ul>{formIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></div> : null}
      <div className={styles.formGrid}><label><span>{stationId ? "Station channel" : "Channel"}</span><select required disabled={Boolean(editingId)} value={form.channelId} onChange={(event) => { const channel = data.sources.channels.find((channel) => channel.id === event.target.value); setForm({ ...form, channelId: event.target.value, timezone: schedulerFormTimezone(channel, EMPTY_FORM.timezone) }); }}><option value="">Choose channel</option>{(data.sources?.channels || []).map((channel) => <option key={channel.id} value={channel.id} disabled={!editingId && configuredChannelIds.has(channel.id)}>{channel.name}{channel.configured ? " · configured" : ""}</option>)}</select></label><label><span>Schedule name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Ruvanas Radio weekly grid" /></label><label><span>Planner time zone</span><input required readOnly={Boolean(editingId)} value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} placeholder="Europe/Malta" aria-describedby="scheduler-timezone-help" /></label></div>
      <p className={previewStyles.timeHelp} id="scheduler-timezone-help">{selectedChannel ? `${selectedChannel.name} · ` : ""}All programme times below use the planner time zone above, not your computer&apos;s clock. Check it before saving. One-off times that are missing or repeated when clocks change must use a different time; an unchanged saved instant is preserved.</p>
      {editingId ? <p className={previewStyles.timeHelp}>Time zone is fixed for an existing schedule so a draft cannot retime the active programme.</p> : null}
      <div className={styles.slotHeader}><h3>Programmes</h3><button type="button" className={styles.secondaryButton} disabled={form.items.length >= 200} onClick={() => setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM, label: `Programme ${form.items.length + 1}` }] })}>Add programme</button></div>
      <div className={styles.schedulerItems}>{form.items.map((item, index) => <div className={`${styles.schedulerItem} ${previewStyles.editorItem}`} key={index}>
        <div className={previewStyles.programmeHeading}><span>{index + 1}</span><strong>{item.label || `Programme ${index + 1}`}</strong><small>{item.recurrence === "WEEKLY" ? `${DAYS[Number(item.weekday)] || "Choose a day"} · ${item.startTime || "Choose a time"}` : "One-time programme"} · {item.durationMinutes || "—"} min</small></div>
        <label><span>Programme name</span><input required value={item.label} onChange={(event) => updateItem(index, "label", event.target.value)} /></label>
        <label><span>Play from</span><select value={item.sourceType} onChange={(event) => updateItem(index, "sourceType", event.target.value)}>{availableSourceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className={styles.schedulerSource}><span>Approved music or show</span><select required value={item.sourceId} onChange={(event) => updateItem(index, "sourceId", event.target.value)}><option value="">Choose music or show</option>{sourceOptions(data.sources, item.sourceType).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>{!sourceOptions(data.sources, item.sourceType).length ? <small className={previewStyles.sourceHelp}>{sandboxDraftOnly ? "Save a private test playlist first, then reload this planner. No audio or publication is needed." : "No approved source of this type is available. Choose another type or prepare its music or show first."}</small> : null}</label>
        <label><span>Repeat</span><select value={item.recurrence} onChange={(event) => updateItem(index, "recurrence", event.target.value)}><option value="WEEKLY">Every week</option><option value="ONE_OFF">One time only</option></select></label>
        {item.recurrence === "WEEKLY" ? <><label><span>Day</span><select value={item.weekday} onChange={(event) => updateItem(index, "weekday", Number(event.target.value))}>{DAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label><label><span>Start time</span><input required type="time" value={item.startTime} onChange={(event) => updateItem(index, "startTime", event.target.value)} /></label></> : <label className={styles.oneOffTime}><span>Start date &amp; time</span><input required type="datetime-local" value={item.startsAt} onChange={(event) => updateItem(index, "startsAt", event.target.value)} /></label>}
        <label><span>Length (minutes)</span><input type="number" min="1" max="1440" disabled={item.sourceType === "RADIO_CLOCK"} value={item.durationMinutes} onChange={(event) => updateItem(index, "durationMinutes", event.target.value)} /></label>
        <button type="button" className={styles.removeButton} disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
        <details className={previewStyles.priority}><summary>Advanced: overlap priority</summary><p>A higher number wins when programmes overlap. Equal priorities block publishing; different-priority overrides require review before publishing.</p><label><span>Overlap priority</span><input type="number" min="0" max="100" value={item.priority} onChange={(event) => updateItem(index, "priority", event.target.value)} /></label></details>
      </div>)}</div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>{sandboxDraftOnly ? "Private draft → timezone preview · no publication" : "Draft → timezone preview → controlled publication"}</span><button className={styles.primaryButton} disabled={busy !== ""}>{busy === "save" ? "Saving…" : editingId ? "Save next version" : "Create schedule draft"}</button>{savedVersion ? <button type="button" className={styles.secondaryButton} disabled={hasUnsavedChanges || busy !== ""} onClick={() => previewVersion(savedSchedule.id, savedVersion.id)}>Preview saved version {savedVersion.version}</button> : null}</div>
    </fieldset></form> : !data?.canAuthor ? <div className={styles.readOnlyMessage}>You can inspect channel schedules. An owner, manager or content editor can prepare changes.</div> : null}

    {preview ? <div className={styles.schedulerPreview} id="weekly-planner-preview"><div className={styles.sectionHeading}><div><p className={styles.kicker}>SEVEN-DAY COMPILED PREVIEW</p><h3>{preview.schedule.name} · version {preview.version.version}</h3><p className={previewStyles.weekRange}>{previewDays[0]?.label} – {previewDays.at(-1)?.label} · {preview.schedule.timezone}</p></div><span className={previewLabel === "CONFLICTS" ? styles.draftBadge : styles.publishedBadge}>{previewLabel}</span></div>
      <div className={previewStyles.context}><strong>{preview.schedule.channel?.name || "Selected channel"} · {preview.schedule.timezone}</strong><span>This is a preview of the saved plan, not a live audio or on-air status monitor. Unsaved form changes are not included. {sandboxDraftOnly ? "Publication and live broadcasting are blocked." : "Publishing is a separate action."}</span><small>{sandboxDraftOnly ? "Empty periods have no saved programme. This test workspace never supplies live audio, including AutoDJ gap coverage." : "Empty periods show no saved programme. AutoDJ may cover those gaps when it is enabled and approved music is available."}</small></div>
      {hasUnsavedChanges ? <div className={previewStyles.validation} role="status"><strong>This preview does not include your unsaved form changes.</strong><p>Save the draft, then preview its new version. Publishing is unavailable until your form changes are saved or discarded.</p></div> : null}
      <div className={previewStyles.reviewSummary} role="status"><strong>{preview.conflicts.some((conflict) => conflict.severity === "BLOCKING") ? "Overlaps need attention" : preview.conflicts.length ? "Review the priority overrides" : "No programme overlaps in this preview"}</strong><span>{preview.conflicts.some((conflict) => conflict.severity === "BLOCKING") ? "Edit the affected programmes, save a new draft and preview again. Equal-priority overlaps block publication." : sandboxDraftOnly ? "Check the days and times below. This remains a private test plan with no live audio." : "Check the days, times and music sources below. A preview is not publication or proof of on-air audio."}</span></div>
      <nav className={previewStyles.weekOverview} aria-label="Jump to a day in the saved week">{previewDays.map((day) => <a key={day.date} href={`#planner-day-${day.date}`}><strong>{day.label}</strong><span>{day.items.length ? `${day.items.length} programme${day.items.length === 1 ? "" : "s"}` : "Nothing planned"}</span></a>)}</nav>
      {preview.compatibilityWarnings.map((warning) => <div className={styles.compatibilityWarning} key={warning}>{warning}</div>)}
      {preview.conflicts.map((conflict, index) => <div className={conflict.severity === "BLOCKING" ? styles.blockingConflict : styles.overrideConflict} key={`${conflict.leftPosition}-${conflict.rightPosition}-${index}`}><strong>{conflict.severity === "BLOCKING" ? "Blocking overlap" : `Priority override: programme ${conflict.winnerPosition + 1} wins`}</strong> · {preview.version.items.find((item) => item.position === conflict.leftPosition)?.label || `Programme ${conflict.leftPosition + 1}`} and {preview.version.items.find((item) => item.position === conflict.rightPosition)?.label || `Programme ${conflict.rightPosition + 1}`}<br /><small>{new Date(conflict.startsAt).toLocaleString("en-GB", { timeZone: preview.schedule.timezone })} – {new Date(conflict.endsAt).toLocaleString("en-GB", { timeZone: preview.schedule.timezone })} · {preview.schedule.timezone}</small></div>)}
      <div className={previewStyles.days} aria-label={`Saved seven-day plan in ${preview.schedule.timezone}`}>{previewDays.map((day) => <section className={previewStyles.day} id={`planner-day-${day.date}`} key={day.date}><div className={previewStyles.dayHeader}><h4>{day.label}</h4><span>{day.items.length ? `${day.items.length} programme${day.items.length === 1 ? "" : "s"}` : "No saved programmes"}</span></div>{day.items.length ? <ol className={previewStyles.programmes}>{day.items.map((occurrence, index) => <li className={previewStyles.programme} key={`${occurrence.position}-${occurrence.startsAt}-${index}`}><time>{occurrence.startLabel} – {occurrence.endLabel}{occurrence.continuesAfterDay ? " · continues" : ""}</time><div><strong>{occurrence.label}</strong><p>{occurrence.source.name}</p><details><summary>Source &amp; priority</summary><span>{SOURCES.find(([value]) => value === occurrence.sourceType)?.[1] || occurrence.sourceType.replaceAll("_", " ")} · {Math.round((new Date(occurrence.endsAt) - new Date(occurrence.startsAt)) / 60000)} min · priority {occurrence.priority}</span></details></div></li>)}</ol> : <p className={previewStyles.empty}>{sandboxDraftOnly ? "No programme is saved for this day. Live audio and automatic gap coverage remain off." : "No programme is saved for this day. Check automatic music if you want gap coverage."}</p>}</section>)}</div>
      {canPublish && preview.conflicts.some((conflict) => conflict.severity === "CONTROLLED_OVERRIDE") ? <label className={styles.reviewCheck}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I reviewed the priority overrides and confirm that the higher-priority programmes should win.</span></label> : null}
      {canPublish && preview.version.status === "DRAFT" ? <div className={styles.actionBar}><span className={previewStyles.publicationHelp}>Publication activates this saved schedule. Review this version before continuing.</span><button type="button" className={styles.primaryButton} disabled={!preview.readyToPublish || busy !== "" || hasUnsavedChanges || (preview.conflicts.some((conflict) => conflict.severity === "CONTROLLED_OVERRIDE") && !acknowledged)} onClick={() => publish(preview.schedule.id, preview.version.id)}>Publish version {preview.version.version}</button></div> : null}
    </div> : null}
  </section>;
}
