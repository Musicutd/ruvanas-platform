"use client";

import { useEffect, useMemo, useState } from "react";
import { buildProgrammingWeek, PROGRAMMING_WEEKDAYS } from "@/lib/subscriber-programming.mjs";
import styles from "./programming.module.css";

const EMPTY_SLOT = { weekday: 1, startsAt: "09:00", endsAt: "17:00", musicModeId: "" };

function targetLabel(target) {
  return target.type === "ZONE" ? `${target.locationName} / ${target.name}` : `${target.name} (whole location)`;
}

function SchedulePreview({ slots, modes }) {
  const modeById = new Map(modes.map((mode) => [mode.id, mode]));
  const week = buildProgrammingWeek(slots.map((slot, index) => ({
    ...slot,
    id: `preview-${index}`,
    musicModeName: modeById.get(slot.musicModeId)?.name || "Choose a music mode",
    startMinute: Number(slot.startsAt?.slice(0, 2)) * 60 + Number(slot.startsAt?.slice(3, 5)),
    endMinute: Number(slot.endsAt?.slice(0, 2)) * 60 + Number(slot.endsAt?.slice(3, 5))
  })));
  return (
    <div className={styles.weekGrid}>
      {week.map((day) => (
        <section className={styles.dayCard} key={day.weekday}>
          <h4>{day.name.slice(0, 3)}</h4>
          {day.slots.length ? day.slots.map((slot) => (
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
              {target.current ? <div className={styles.liveMode}><span className={styles.liveDot} />{target.current.musicModeName}</div> : <div className={styles.noLive}>No matching programme now</div>}
              <small>{target.timezone}</small>
            </article>
          ))}
          {!data.targets.length ? <div className={styles.emptyState}>No active listening areas are ready yet. Ask Ruvanas to prepare your first location.</div> : null}
        </div>
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
                <SchedulePreview slots={form.slots} modes={data.musicModes} />
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
