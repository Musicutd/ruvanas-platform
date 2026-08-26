"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WEEKDAYS } from "@/lib/opening-hours.mjs";

const defaultHours = WEEKDAYS.map((_, weekday) => ({
  weekday,
  isClosed: weekday === 0,
  opensAt: "09:00",
  closesAt: "18:00"
}));

export default function OpeningHoursForm({ locationId, timezone, initialHours, initialExceptions }) {
  const router = useRouter();
  const [weeklyHours, setWeeklyHours] = useState(initialHours.length ? initialHours : defaultHours);
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  function updateDay(index, changes) {
    setWeeklyHours((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...changes } : entry));
  }

  function updateException(index, changes) {
    setExceptions((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...changes } : entry));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage({ type: "", text: "" });
    try {
      const response = await fetch(`/api/admin/locations/${locationId}/opening-hours`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyHours, exceptions })
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: "error", text: data.error || "Unable to save opening hours." });
        return;
      }
      setMessage({ type: "success", text: "Opening hours saved." });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "A connection error occurred. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} style={styles.form}>
      <p style={styles.help}>Times use <strong>{timezone}</strong>. They remain local when clocks change for daylight saving time.</p>
      <div style={styles.dayList}>
        {weeklyHours.map((entry, index) => (
          <div key={entry.weekday} style={styles.dayRow}>
            <strong style={styles.dayName}>{WEEKDAYS[entry.weekday]}</strong>
            <label style={styles.closedLabel}>
              <input type="checkbox" checked={entry.isClosed} onChange={(event) => updateDay(index, { isClosed: event.target.checked })} /> Closed
            </label>
            <input aria-label={`${WEEKDAYS[entry.weekday]} opening time`} type="time" value={entry.opensAt} disabled={entry.isClosed} onChange={(event) => updateDay(index, { opensAt: event.target.value })} style={styles.timeInput} required={!entry.isClosed} />
            <span style={styles.to}>to</span>
            <input aria-label={`${WEEKDAYS[entry.weekday]} closing time`} type="time" value={entry.closesAt} disabled={entry.isClosed} onChange={(event) => updateDay(index, { closesAt: event.target.value })} style={styles.timeInput} required={!entry.isClosed} />
          </div>
        ))}
      </div>

      <div style={styles.exceptionHeader}>
        <div>
          <h3 style={styles.heading}>Special dates</h3>
          <p style={styles.help}>Holidays and one-off hours override the weekly timetable.</p>
        </div>
        <button type="button" style={styles.secondaryButton} onClick={() => setExceptions((current) => [...current, { date: "", label: "", isClosed: true, opensAt: "09:00", closesAt: "18:00" }])}>Add special date</button>
      </div>

      {exceptions.length === 0 ? <p style={styles.empty}>No special dates added.</p> : null}
      {exceptions.map((entry, index) => (
        <div key={`${entry.date}-${index}`} style={styles.exceptionRow}>
          <input aria-label="Special date" type="date" value={entry.date} onChange={(event) => updateException(index, { date: event.target.value })} style={styles.input} required />
          <input aria-label="Special date label" type="text" value={entry.label || ""} placeholder="Holiday or event" maxLength={120} onChange={(event) => updateException(index, { label: event.target.value })} style={styles.input} />
          <label style={styles.closedLabel}><input type="checkbox" checked={entry.isClosed} onChange={(event) => updateException(index, { isClosed: event.target.checked })} /> Closed</label>
          <input aria-label="Special opening time" type="time" value={entry.opensAt} disabled={entry.isClosed} onChange={(event) => updateException(index, { opensAt: event.target.value })} style={styles.timeInput} required={!entry.isClosed} />
          <span style={styles.to}>to</span>
          <input aria-label="Special closing time" type="time" value={entry.closesAt} disabled={entry.isClosed} onChange={(event) => updateException(index, { closesAt: event.target.value })} style={styles.timeInput} required={!entry.isClosed} />
          <button type="button" style={styles.removeButton} onClick={() => setExceptions((current) => current.filter((_, entryIndex) => entryIndex !== index))}>Remove</button>
        </div>
      ))}

      {message.text ? <p style={{ ...styles.message, ...(message.type === "error" ? styles.error : styles.success) }}>{message.text}</p> : null}
      <button type="submit" disabled={saving} style={styles.saveButton}>{saving ? "Saving…" : "Save opening hours"}</button>
    </form>
  );
}

const styles = {
  form: { display: "grid", gap: 16 },
  help: { margin: 0, color: "#475569", fontSize: 14, lineHeight: 1.5 },
  dayList: { display: "grid", gap: 8 },
  dayRow: { display: "grid", gridTemplateColumns: "120px 90px minmax(105px, 1fr) 24px minmax(105px, 1fr)", gap: 10, alignItems: "center", padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff" },
  dayName: { color: "#172033", fontSize: 14 },
  closedLabel: { display: "flex", alignItems: "center", gap: 6, color: "#334155", fontSize: 13, fontWeight: 700 },
  timeInput: { minWidth: 0, padding: 8, border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", color: "#111827" },
  to: { color: "#64748b", textAlign: "center", fontSize: 13 },
  exceptionHeader: { display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 8 },
  heading: { margin: "0 0 4px", color: "#172033", fontSize: 16 },
  exceptionRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff" },
  input: { minWidth: 150, flex: "1 1 160px", padding: 8, border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", color: "#111827" },
  secondaryButton: { border: "1px solid #9a6400", borderRadius: 7, background: "#fff", color: "#7c5100", padding: "9px 12px", fontWeight: 800, cursor: "pointer" },
  removeButton: { border: "1px solid #b91c1c", borderRadius: 6, background: "#fff", color: "#991b1b", padding: 8, fontWeight: 700, cursor: "pointer" },
  empty: { margin: 0, color: "#64748b", fontSize: 14 },
  saveButton: { justifySelf: "start", border: 0, borderRadius: 8, background: "#f4b942", color: "#172033", padding: "11px 16px", fontWeight: 900, cursor: "pointer" },
  message: { margin: 0, padding: 10, borderRadius: 7, fontSize: 13, fontWeight: 700 },
  error: { background: "#fee2e2", color: "#991b1b" },
  success: { background: "#dcfce7", color: "#166534" }
};
