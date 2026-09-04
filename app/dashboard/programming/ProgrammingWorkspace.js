"use client";

import { useEffect, useMemo, useState } from "react";
import { buildProgrammingWeek, formatProgrammingTime, PROGRAMMING_WEEKDAYS } from "@/lib/subscriber-programming.mjs";
import { buildContinuousProgrammingWeek } from "@/lib/autodj-policy.mjs";
import styles from "./programming.module.css";

const EMPTY_SLOT = { weekday: 1, startsAt: "09:00", endsAt: "17:00", musicModeId: "" };

function targetLabel(target) {
  return target.type === "ZONE" ? `${target.locationName} / ${target.name}` : `${target.name} (whole location)`;
}

function SchedulePreview({ slots, modes, autoDjPolicy = null }) {
  const modeById = new Map(modes.map((mode) => [mode.id, mode]));
  const normalizedSlots = slots.map((slot, index) => ({
    ...slot,
    id: `preview-${index}`,
    musicModeName: modeById.get(slot.musicModeId)?.name || "Choose a music mode",
    startMinute: Number(slot.startsAt?.slice(0, 2)) * 60 + Number(slot.startsAt?.slice(3, 5)),
    endMinute: Number(slot.endsAt?.slice(0, 2)) * 60 + Number(slot.endsAt?.slice(3, 5))
  }));
  const week = buildProgrammingWeek(normalizedSlots);
  const continuousWeek = buildContinuousProgrammingWeek(normalizedSlots, autoDjPolicy);
  const minuteLabel = (minute) => minute === 1440 ? "24:00" : formatProgrammingTime(minute);
  return (
    <div className={styles.weekGrid}>
      {week.map((day) => (
        <section className={styles.dayCard} key={day.weekday}>
          <h4>{day.name.slice(0, 3)}</h4>
          {autoDjPolicy?.enabled ? continuousWeek[day.weekday].segments.map((segment, index) => segment.source === "DEFAULT_AUTODJ" ? (
            <div className={styles.fallbackSlot} key={`fallback-${day.weekday}-${index}`}>
              <strong>{minuteLabel(segment.startMinute)}–{minuteLabel(segment.endMinute)}</strong>
              <span>{autoDjPolicy.defaultMusicMode?.name || "Continuous AutoDJ"}</span>
              <small>{autoDjPolicy.playbackPolicy === "RUN_24_7" ? "automatic 24/7 gap cover" : "gap cover during open hours"}</small>
            </div>
          ) : (
            <div className={styles.previewSlot} key={segment.slot.id || `scheduled-${day.weekday}-${index}`}>
              <strong>{minuteLabel(segment.startMinute)}–{minuteLabel(segment.endMinute)}</strong>
              <span>{segment.slot.musicModeName}</span>
              <small>scheduled priority</small>
            </div>
          )) : day.slots.length ? day.slots.map((slot) => (
            <div className={styles.previewSlot} key={slot.id}>
              <strong>{slot.startsAt}–{slot.endsAt}</strong>
              <span>{slot.musicModeName}</span>
              {slot.overnight ? <small>continues overnight</small> : null}
            </div>
          )) : <span className={styles.emptyDay}>No programme</span>}
        </section>
      ))}
    </div>
  );
}

export default function ProgrammingWorkspace({ organisationName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [autoDjSaving, setAutoDjSaving] = useState(false);
  const [autoDjForm, setAutoDjForm] = useState({
    channelId: "",
    enabled: false,
    defaultMusicModeId: "",
    backupMusicModeId: "",
    playbackPolicy: "FOLLOW_LOCATION_HOURS"
  });
  const [form, setForm] = useState({
    name: "Weekly radio plan",
    targetKey: "",
    effectiveFrom: "",
    effectiveTo: "",
    slots: [{ ...EMPTY_SLOT }]
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/programming", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load radio programming.");
      setData(payload);
      setAutoDjForm((current) => {
        const channel = payload.channels.find((entry) => entry.id === current.channelId) || payload.channels[0];
        const policy = channel?.autoDjPolicy;
        return {
          channelId: channel?.id || "",
          enabled: policy?.enabled === true,
          defaultMusicModeId: policy?.defaultMusicModeId || payload.musicModes.find((mode) => mode.playableTrackCount > 0)?.id || "",
          backupMusicModeId: policy?.backupMusicModeId || "",
          playbackPolicy: policy?.playbackPolicy || "FOLLOW_LOCATION_HOURS"
        };
      });
      setForm((current) => ({
        ...current,
        targetKey: current.targetKey || (payload.targets[0] ? `${payload.targets[0].type}:${payload.targets[0].id}` : ""),
        slots: current.slots.map((slot) => ({ ...slot, musicModeId: slot.musicModeId || payload.musicModes[0]?.id || "" }))
      }));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const published = useMemo(() => data?.schedules.filter((schedule) => schedule.status === "PUBLISHED") || [], [data]);
  const drafts = useMemo(() => data?.schedules.filter((schedule) => schedule.status === "DRAFT") || [], [data]);
  const selectedTarget = useMemo(() => {
    if (!data || !form.targetKey) return null;
    const [type, id] = form.targetKey.split(":");
    return data.targets.find((target) => target.type === type && target.id === id) || null;
  }, [data, form.targetKey]);
  const playableModes = useMemo(() => data?.musicModes.filter((mode) => mode.playableTrackCount > 0) || [], [data]);
  const selectedChannel = useMemo(() => data?.channels.find((channel) => channel.id === autoDjForm.channelId) || null, [data, autoDjForm.channelId]);
  const previewAutoDjPolicy = useMemo(() => {
    if (!selectedTarget?.channelId) return null;
    if (selectedTarget.channelId === autoDjForm.channelId) {
      return {
        enabled: autoDjForm.enabled,
        playbackPolicy: autoDjForm.playbackPolicy,
        defaultMusicMode: data?.musicModes.find((mode) => mode.id === autoDjForm.defaultMusicModeId) || null
      };
    }
    return data?.channels.find((channel) => channel.id === selectedTarget.channelId)?.autoDjPolicy || null;
  }, [selectedTarget, autoDjForm, data]);

  function chooseAutoDjChannel(channelId) {
    const channel = data.channels.find((entry) => entry.id === channelId);
    const policy = channel?.autoDjPolicy;
    setAutoDjForm({
      channelId,
      enabled: policy?.enabled === true,
      defaultMusicModeId: policy?.defaultMusicModeId || playableModes[0]?.id || "",
      backupMusicModeId: policy?.backupMusicModeId || "",
      playbackPolicy: policy?.playbackPolicy || "FOLLOW_LOCATION_HOURS"
    });
  }

  async function saveAutoDj() {
    setError("");
    setNotice("");
    if (!autoDjForm.channelId) return setError("Choose a radio channel.");
    if (autoDjForm.enabled && !autoDjForm.defaultMusicModeId) return setError("Choose a playable default music mode.");
    setAutoDjSaving(true);
    try {
      const response = await fetch("/api/programming/autodj", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...autoDjForm,
          defaultMusicModeId: autoDjForm.defaultMusicModeId || null,
          backupMusicModeId: autoDjForm.backupMusicModeId || null
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save Continuous AutoDJ settings.");
      setNotice(autoDjForm.enabled
        ? "Continuous AutoDJ is ready. Scheduled programmes keep priority and uncovered time uses your fallback music."
        : "Continuous AutoDJ is off for this channel. Published schedules remain unchanged.");
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setAutoDjSaving(false);
    }
  }

  function updateSlot(index, field, value) {
    setForm((current) => ({
      ...current,
      slots: current.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, [field]: value } : slot)
    }));
    setPreviewOpen(false);
    setReviewed(false);
  }

  function addSlot() {
    setForm((current) => ({
      ...current,
      slots: [...current.slots, { ...EMPTY_SLOT, musicModeId: data?.musicModes[0]?.id || "" }]
    }));
    setPreviewOpen(false);
    setReviewed(false);
  }

  function removeSlot(index) {
    setForm((current) => ({ ...current, slots: current.slots.filter((_, slotIndex) => slotIndex !== index) }));
    setPreviewOpen(false);
    setReviewed(false);
  }

  function useAsStartingPoint(schedule) {
    setForm({
      name: `${schedule.name} update`,
      targetKey: `${schedule.targetType}:${schedule.targetId}`,
      effectiveFrom: schedule.effectiveFrom || "",
      effectiveTo: schedule.effectiveTo || "",
      slots: schedule.slots.map((slot) => ({
        weekday: slot.weekday,
        startsAt: `${String(Math.floor(slot.startMinute / 60)).padStart(2, "0")}:${String(slot.startMinute % 60).padStart(2, "0")}`,
        endsAt: `${String(Math.floor(slot.endMinute / 60)).padStart(2, "0")}:${String(slot.endMinute % 60).padStart(2, "0")}`,
        musicModeId: slot.musicModeId
      }))
    });
    setPreviewOpen(false);
    setReviewed(false);
    setNotice("Plan copied into the weekly planner. Review your changes before publishing a new version.");
    window.scrollTo({ top: 620, behavior: "smooth" });
  }

  async function save(publish) {
    setError("");
    setNotice("");
    if (!selectedTarget) return setError("Choose a shop or listening area.");
    if (publish && (!previewOpen || !reviewed)) return setError("Open the weekly preview and confirm that you reviewed it before publishing.");
    setSaving(true);
    try {
      const response = await fetch("/api/programming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          targetType: selectedTarget.type,
          targetId: selectedTarget.id,
          effectiveFrom: form.effectiveFrom || null,
          effectiveTo: form.effectiveTo || null,
          publish,
          previewAcknowledged: publish && reviewed,
          slots: form.slots.map((slot) => ({ ...slot, weekday: Number(slot.weekday) }))
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save this radio plan.");
      setNotice(publish ? "Radio plan published. The new version is now active for this listening area." : "Draft saved. Nothing live was changed.");
      setPreviewOpen(false);
      setReviewed(false);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.loading}>Loading {organisationName}&apos;s radio programming…</div>;
  if (!data) return <div className={styles.error}>{error || "Radio programming is unavailable."}</div>;

  return (
    <div className={styles.workspace}>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <section className={styles.liveSection} aria-labelledby="live-heading">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>LIVE OVERVIEW</p><h2 id="live-heading">What is scheduled now</h2></div>
          <span className={styles.updated}>Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div className={styles.liveGrid}>
          {data.targets.map((target) => (
            <article className={styles.liveCard} key={`${target.type}:${target.id}`}>
              <div><span className={styles.targetType}>{target.type === "ZONE" ? "ZONE" : "LOCATION"}</span><h3>{targetLabel(target)}</h3></div>
              {target.current ? <div><div className={styles.liveMode}><span className={styles.liveDot} />{target.current.musicModeName}</div><span className={styles.sourcePill}>{target.current.sourceLabel}</span></div> : <div className={styles.noLive}>{target.programmingState === "LOCATION_CLOSED" ? "Outside configured hours" : "No playable programming"}</div>}
              <small>{target.timezone}</small>
            </article>
          ))}
          {!data.targets.length ? <div className={styles.emptyState}>No active listening areas are ready yet. Ask Ruvanas to prepare your first location.</div> : null}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="autodj-heading">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>CONTINUOUS SCHEDULING FALLBACK</p><h2 id="autodj-heading">Keep the channel playing automatically</h2></div>
          <span className={autoDjForm.enabled ? styles.permission : styles.readOnly}>{autoDjForm.enabled ? "AutoDJ on" : "AutoDJ off"}</span>
        </div>
        <p className={styles.panelIntro}>Scheduled programmes, approved school audio and campaign insertions keep their existing priority. AutoDJ covers only the remaining gaps, using a backup mode if the default becomes unavailable.</p>
        {!data.channels.length ? <div className={styles.emptyState}>No active channel is assigned yet. Prepare a channel before enabling Continuous AutoDJ.</div> : (
          <>
            <div className={styles.formGrid}>
              <label><span>Radio channel</span><select value={autoDjForm.channelId} onChange={(event) => chooseAutoDjChannel(event.target.value)}>{data.channels.map((channel) => <option value={channel.id} key={channel.id}>{channel.name}{channel.stationName ? ` · ${channel.stationName}` : ""}</option>)}</select></label>
              <label className={styles.switchField}><span>Continuous AutoDJ</span><span className={styles.switchRow}><input type="checkbox" checked={autoDjForm.enabled} disabled={!data.canManage} onChange={(event) => setAutoDjForm({ ...autoDjForm, enabled: event.target.checked })} /><strong>{autoDjForm.enabled ? "Enabled" : "Disabled"}</strong></span></label>
              <label><span>Default music mode</span><select value={autoDjForm.defaultMusicModeId} disabled={!data.canManage} onChange={(event) => setAutoDjForm({ ...autoDjForm, defaultMusicModeId: event.target.value, backupMusicModeId: event.target.value === autoDjForm.backupMusicModeId ? "" : autoDjForm.backupMusicModeId })}><option value="">Choose a playable mode</option>{playableModes.map((mode) => <option value={mode.id} key={mode.id}>{mode.name} · {mode.playableTrackCount} playable</option>)}</select></label>
              <label><span>Backup music mode <small>(optional)</small></span><select value={autoDjForm.backupMusicModeId} disabled={!data.canManage} onChange={(event) => setAutoDjForm({ ...autoDjForm, backupMusicModeId: event.target.value })}><option value="">No backup mode</option>{playableModes.filter((mode) => mode.id !== autoDjForm.defaultMusicModeId).map((mode) => <option value={mode.id} key={mode.id}>{mode.name} · {mode.playableTrackCount} playable</option>)}</select></label>
              <label><span>Playback hours</span><select value={autoDjForm.playbackPolicy} disabled={!data.canManage} onChange={(event) => setAutoDjForm({ ...autoDjForm, playbackPolicy: event.target.value })}><option value="FOLLOW_LOCATION_HOURS">Follow location / school hours</option><option value="RUN_24_7">Run continuously, 24/7</option></select></label>
              <div className={styles.policySummary}><strong>{selectedChannel?.name || "Channel"}</strong><span>{selectedChannel?.assignments.length ? selectedChannel.assignments.join(" · ") : "Online or unassigned channel"}</span><small>{autoDjForm.playbackPolicy === "RUN_24_7" ? "Designed for always-on and online radio channels." : "Silence outside configured opening or school hours is intentional."}</small></div>
            </div>
            {!playableModes.length ? <div className={styles.error}>AutoDJ needs at least one active music mode with a playable, licensed catalogue track.</div> : null}
            <div className={styles.actionBar}><span className={styles.safeClaim}>No scheduling-induced dead air while a valid fallback is available.</span>{data.canManage ? <button type="button" className={styles.primaryButton} disabled={autoDjSaving || (autoDjForm.enabled && !autoDjForm.defaultMusicModeId)} onClick={saveAutoDj}>{autoDjSaving ? "Saving…" : "Save AutoDJ settings"}</button> : null}</div>
          </>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="planner-heading">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>WEEKLY PLANNER</p><h2 id="planner-heading">Create a radio plan</h2></div>
          <span className={data.canManage ? styles.permission : styles.readOnly}>{data.canManage ? "Owner / manager editing" : "View only"}</span>
        </div>

        {!data.canManage ? (
          <div className={styles.readOnlyMessage}>Your organisation role has read-only access. An owner or manager can publish programming changes.</div>
        ) : data.musicModes.length === 0 ? (
          <div className={styles.emptyState}>No approved music modes are available yet. Ruvanas will prepare and approve the music choices for your organisation.</div>
        ) : (
          <>
            <div className={styles.formGrid}>
              <label><span>Plan name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label><span>Shop or listening area</span><select value={form.targetKey} onChange={(event) => { setForm({ ...form, targetKey: event.target.value }); setPreviewOpen(false); setReviewed(false); }}><option value="">Choose an area</option>{data.targets.map((target) => <option value={`${target.type}:${target.id}`} key={`${target.type}:${target.id}`}>{targetLabel(target)}</option>)}</select></label>
              <label><span>Starts on <small>(optional)</small></span><input type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} /></label>
              <label><span>Ends on <small>(optional)</small></span><input type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })} /></label>
            </div>

            <div className={styles.slotHeader}><h3>Programmes</h3><button type="button" className={styles.secondaryButton} onClick={addSlot}>+ Add programme</button></div>
            <div className={styles.slotList}>
              {form.slots.map((slot, index) => (
                <div className={styles.slotRow} key={`slot-${index}`}>
                  <label><span>Day</span><select value={slot.weekday} onChange={(event) => updateSlot(index, "weekday", Number(event.target.value))}>{PROGRAMMING_WEEKDAYS.map((day, weekday) => <option value={weekday} key={day}>{day}</option>)}</select></label>
                  <label><span>From</span><input type="time" value={slot.startsAt} onChange={(event) => updateSlot(index, "startsAt", event.target.value)} /></label>
                  <label><span>To</span><input type="time" value={slot.endsAt} onChange={(event) => updateSlot(index, "endsAt", event.target.value)} /></label>
                  <label className={styles.modeField}><span>Approved music mode</span><select value={slot.musicModeId} onChange={(event) => updateSlot(index, "musicModeId", event.target.value)}>{data.musicModes.map((mode) => <option value={mode.id} key={mode.id}>{mode.name} · {mode.trackCount} tracks</option>)}</select></label>
                  <button type="button" className={styles.removeButton} onClick={() => removeSlot(index)} disabled={form.slots.length === 1} aria-label={`Remove programme ${index + 1}`}>Remove</button>
                </div>
              ))}
            </div>

            <div className={styles.actionBar}>
              <button type="button" className={styles.secondaryButton} onClick={() => { setPreviewOpen(true); setReviewed(false); }}>Preview week</button>
              <button type="button" className={styles.secondaryButton} onClick={() => save(false)} disabled={saving}>Save draft</button>
              <button type="button" className={styles.primaryButton} onClick={() => save(true)} disabled={saving || !reviewed}>{saving ? "Saving…" : "Publish plan"}</button>
            </div>

            {previewOpen ? (
              <div className={styles.previewPanel}>
                <div className={styles.previewTitle}><div><p className={styles.kicker}>PREVIEW BEFORE ACTIVATION</p><h3>{form.name || "Weekly radio plan"}</h3><span>{selectedTarget ? targetLabel(selectedTarget) : "Choose a listening area"}</span></div><span className={styles.timezone}>{selectedTarget?.timezone}</span></div>
                <SchedulePreview slots={form.slots} modes={data.musicModes} autoDjPolicy={previewAutoDjPolicy} />
                <label className={styles.reviewCheck}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the days, times, music modes and listening area. This plan is ready to go live.</span></label>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="plans-heading">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>SAVED PLANS</p><h2 id="plans-heading">Live and upcoming programming</h2></div><span className={styles.count}>{published.length} live · {drafts.length} draft</span></div>
        <div className={styles.scheduleList}>
          {[...published, ...drafts].slice(0, 12).map((schedule) => (
            <article className={styles.scheduleCard} key={schedule.id}>
              <div><span className={schedule.status === "PUBLISHED" ? styles.publishedBadge : styles.draftBadge}>{schedule.status === "PUBLISHED" ? (schedule.effectiveFrom && schedule.effectiveFrom > new Date().toISOString().slice(0, 10) ? "UPCOMING" : "LIVE") : "DRAFT"}</span><h3>{schedule.name}</h3><p>{schedule.targetName}</p></div>
              <div className={styles.scheduleMeta}><strong>Version {schedule.version}</strong><span>{schedule.slots.length} programme{schedule.slots.length === 1 ? "" : "s"}</span><span>{schedule.effectiveFrom ? `From ${schedule.effectiveFrom}` : "Starts immediately"}{schedule.effectiveTo ? ` · Until ${schedule.effectiveTo}` : ""}</span>{data.canManage ? <button type="button" className={styles.copyButton} onClick={() => useAsStartingPoint(schedule)}>Use as starting point</button> : null}</div>
            </article>
          ))}
          {!published.length && !drafts.length ? <div className={styles.emptyState}>No radio plans have been saved yet. Your first published plan will appear here.</div> : null}
        </div>
      </section>
    </div>
  );
}

