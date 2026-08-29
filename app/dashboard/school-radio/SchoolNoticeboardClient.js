"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function displayStatus(post) {
  if (post.status === "CANCELLED") return "CANCELLED";
  const now = new Date();
  if (new Date(post.endsAt) <= now) return "ENDED";
  if (new Date(post.startsAt) > now) return "SCHEDULED";
  return "LIVE";
}

export default function SchoolNoticeboardClient({ announcements = [], locations = [], canManage = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState({ announcementId: "", target: "", startsAt: "", endsAt: "", theme: "INFORMATION", priority: 50, displaySeconds: 15 });

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/noticeboard", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "School noticeboards could not be loaded.");
    setData(payload);
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);
  const approved = useMemo(() => announcements.filter((item) => item.status === "APPROVED"), [announcements]);
  const targets = useMemo(() => locations.flatMap((location) => [
    { value: `location:${location.id}`, label: `${location.name} — all display zones` },
    ...location.zones.map((zone) => ({ value: `zone:${zone.id}`, label: `${location.name} — ${zone.name}` }))
  ]), [locations]);

  async function schedule(event) {
    event.preventDefault();
    const [targetType, targetId] = form.target.split(":");
    const startsAt = new Date(form.startsAt);
    const endsAt = new Date(form.endsAt);
    if (!targetId || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setError("Choose an announcement, display target, start, and end time."); return;
    }
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/noticeboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          announcementId: form.announcementId,
          locationId: targetType === "location" ? targetId : null,
          zoneId: targetType === "zone" ? targetId : null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          theme: form.theme,
          priority: Number(form.priority),
          displaySeconds: Number(form.displaySeconds)
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The notice could not be scheduled.");
      setForm({ announcementId: "", target: "", startsAt: "", endsAt: "", theme: "INFORMATION", priority: 50, displaySeconds: 15 });
      setNotice("Approved announcement scheduled for the school noticeboard.");
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function cancel(post) {
    const reason = window.prompt("Why should this notice be removed from the display?", "");
    if (!reason?.trim()) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/school-radio/noticeboard/${post.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The notice could not be removed.");
      setNotice("Notice removed from the display schedule."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  return <section style={s.section}>
    <div style={s.heading}><div><p style={s.eyebrow}>STAGE 8A · SCHOOL DIGITAL NOTICEBOARDS</p><h2 style={s.title}>Approved school notices on enrolled displays</h2><p style={s.hint}>Reuse staff-reviewed School Radio announcements on the correct school screens. There is no public student feed and no unreviewed text entry.</p></div><span style={s.safety}>STAFF CONTROLLED</span></div>
    {error ? <div style={s.error}>{error}</div> : null}{notice ? <div style={s.notice}>{notice}</div> : null}
    {canManage ? <form onSubmit={schedule} style={s.form}>
      <label style={s.label}>Approved announcement<select style={s.input} value={form.announcementId} onChange={(event) => setForm((current) => ({ ...current, announcementId: event.target.value }))} required><option value="">Choose approved announcement…</option>{approved.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label style={s.label}>Display target<select style={s.input} value={form.target} onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))} required><option value="">Choose location or zone…</option>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
      <div style={s.columns}><label style={s.label}>Starts<input style={s.input} type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} required /></label><label style={s.label}>Ends<input style={s.input} type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} required /></label></div>
      <div style={s.columns}><label style={s.label}>Presentation<select style={s.input} value={form.theme} onChange={(event) => setForm((current) => ({ ...current, theme: event.target.value }))}><option value="INFORMATION">Information</option><option value="CELEBRATION">Celebration</option><option value="IMPORTANT">Important</option></select></label><label style={s.label}>Seconds per notice<input style={s.input} type="number" min="8" max="120" value={form.displaySeconds} onChange={(event) => setForm((current) => ({ ...current, displaySeconds: event.target.value }))} /></label></div>
      <label style={s.label}>Priority (0–100)<input style={s.input} type="number" min="0" max="100" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} /></label>
      <button style={s.primary} disabled={working || !approved.length || !targets.length}>Schedule approved notice</button>
      {!approved.length ? <p style={s.hint}>Approve a School Radio announcement first.</p> : null}
    </form> : <p style={s.hint}>Owners and managers schedule notices. Staff can view the noticeboard history below.</p>}
    <div style={s.list}>{!data ? <p style={s.hint}>Loading noticeboards…</p> : !data.posts.length ? <p style={s.hint}>No school notices have been scheduled yet.</p> : data.posts.map((post) => {
      const status = displayStatus(post);
      const target = post.zone ? `${post.zone.location.name} — ${post.zone.name}` : `${post.location?.name} — all zones`;
      return <article key={post.id} style={s.item}><div style={s.itemHeading}><div><h3 style={s.itemTitle}>{post.announcement.title}</h3><p style={s.hint}>{target} · {formatDate(post.startsAt)} → {formatDate(post.endsAt)}</p></div><span style={{ ...s.badge, ...(status === "LIVE" ? s.live : status === "CANCELLED" ? s.cancelled : {}) }}>{status}</span></div>{post.announcement.summary ? <p style={s.body}>{post.announcement.summary}</p> : null}<p style={s.meta}>{String(post.theme).replaceAll("_", " ")} · priority {post.priority} · {post.displaySeconds}s</p>{post.cancellationReason ? <p style={s.cancelReason}>Removed: {post.cancellationReason}</p> : null}{canManage && post.status === "SCHEDULED" && new Date(post.endsAt) > new Date() ? <button style={s.remove} disabled={working} onClick={() => cancel(post)}>Remove from schedule</button> : null}</article>;
    })}</div>
  </section>;
}

const s = {
  section: { border: "1px solid #7c3aed", borderRadius: 14, background: "#17172f", padding: 22, marginBottom: 20 },
  heading: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 18 },
  eyebrow: { color: "#c4b5fd", fontSize: 12, fontWeight: 900, letterSpacing: 1.2, margin: "0 0 8px" },
  title: { margin: 0, fontSize: 26 }, hint: { color: "#aab5ca", lineHeight: 1.5, fontSize: 13 },
  safety: { border: "1px solid #8b5cf6", borderRadius: 6, padding: "5px 8px", color: "#ddd6fe", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" },
  form: { display: "grid", gap: 12, border: "1px solid #3d3d67", borderRadius: 10, padding: 16, marginBottom: 18 },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 },
  label: { display: "grid", gap: 7, color: "#e2e8f0", fontWeight: 800, fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #64748b", borderRadius: 8, padding: "10px 11px", background: "#fff", color: "#111827", font: "inherit" },
  primary: { border: 0, borderRadius: 8, padding: "12px 16px", background: "#8b5cf6", color: "#fff", fontWeight: 900, cursor: "pointer" },
  list: { display: "grid", gap: 10 }, item: { border: "1px solid #343f59", borderRadius: 10, padding: 15, background: "#111a2c" },
  itemHeading: { display: "flex", justifyContent: "space-between", gap: 12 }, itemTitle: { margin: "0 0 4px" }, body: { color: "#e2e8f0", lineHeight: 1.5 }, meta: { color: "#c4b5fd", fontSize: 12, fontWeight: 800 },
  badge: { borderRadius: 5, padding: "4px 8px", background: "#dbeafe", color: "#1e40af", height: "fit-content", fontSize: 11, fontWeight: 900 }, live: { background: "#dcfce7", color: "#166534" }, cancelled: { background: "#e2e8f0", color: "#475569" },
  remove: { border: "1px solid #f87171", borderRadius: 7, background: "transparent", color: "#fecaca", padding: "8px 10px", fontWeight: 800, cursor: "pointer" }, cancelReason: { color: "#fca5a5", fontSize: 13 },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 12 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 12 }
};
