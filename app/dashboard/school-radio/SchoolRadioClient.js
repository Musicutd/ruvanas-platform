"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SchoolEditorialClient from "./SchoolEditorialClient";

const managerRoles = new Set(["OWNER", "MANAGER"]);

function Badge({ value }) {
  const colours = {
    APPROVED: ["#dcfce7", "#166534"],
    IN_REVIEW: ["#fef3c7", "#92400e"],
    CHANGES_REQUESTED: ["#ffedd5", "#9a3412"],
    REJECTED: ["#fee2e2", "#991b1b"],
    CANCELLED: ["#e2e8f0", "#475569"],
    DRAFT: ["#dbeafe", "#1e40af"]
  };
  const [background, color] = colours[value] || ["#e2e8f0", "#334155"];
  return <span style={{ ...styles.badge, background, color }}>{String(value).replaceAll("_", " ")}</span>;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function SchoolRadioClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [announcement, setAnnouncement] = useState({ title: "", summary: "", promoVersionId: "" });
  const [slot, setSlot] = useState({ announcementId: "", target: "", startsAt: "", endsAt: "" });

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/school-radio/announcements", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "School Radio could not be loaded.");
    setData(payload);
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);
  const canManage = managerRoles.has(data?.role);
  const approvedAnnouncements = useMemo(() => (data?.announcements || []).filter((item) => item.status === "APPROVED"), [data]);
  const targets = useMemo(() => (data?.locations || []).flatMap((location) => [
    { value: `location:${location.id}`, label: `${location.name} — all zones` },
    ...location.zones.map((zone) => ({ value: `zone:${zone.id}`, label: `${location.name} — ${zone.name}` }))
  ]), [data]);

  async function createAnnouncement(event) {
    event.preventDefault();
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...announcement, submitForReview: true })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The announcement could not be created.");
      setAnnouncement({ title: "", summary: "", promoVersionId: "" });
      setNotice("Announcement submitted for review.");
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function review(item, action) {
    let notes = null;
    if (new Set(["REQUEST_CHANGES", "REJECT"]).has(action)) {
      notes = window.prompt(action === "REJECT" ? "Reason for rejection:" : "Changes required:", "");
      if (!notes?.trim()) return;
    }
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/school-radio/announcements/${item.id}/review`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, notes })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The review action could not be completed.");
      setNotice("Announcement status updated."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function createSlot(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const announcementId = String(formData.get("announcementId") || "");
    const target = String(formData.get("target") || "");
    const startsAt = new Date(String(formData.get("startsAt") || ""));
    const endsAt = new Date(String(formData.get("endsAt") || ""));
    const [targetType, targetId] = target.split(":");
    if (!announcementId || !targetId || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setError("Choose an approved announcement, target, and valid start and end times.");
      return;
    }
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/broadcast-slots", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          announcementId,
          locationId: targetType === "location" ? targetId : null,
          zoneId: targetType === "zone" ? targetId : null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The broadcast slot could not be scheduled.");
      setSlot({ announcementId: "", target: "", startsAt: "", endsAt: "" });
      setNotice("Broadcast slot approved and added to the player schedule."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function cancelSlot(item) {
    const reason = window.prompt("Why is this slot being cancelled?", "");
    if (!reason?.trim()) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/school-radio/broadcast-slots/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The slot could not be cancelled.");
      setNotice("Broadcast slot cancelled."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  if (!data) return <main style={styles.page}><a href="/dashboard" style={styles.back}>← Dashboard</a><p>{error || "Loading School Radio…"}</p></main>;

  return <main style={styles.page}>
    <a href="/dashboard" style={styles.back}>← Dashboard</a>
    <header style={styles.header}>
      <div><p style={styles.eyebrow}>SCHOOL RADIO · STAFF WORKSPACE</p><h1 style={styles.title}>{data.profile.displayName || data.organisation.name}</h1><p style={styles.subtitle}>Create supervised announcements and schedule approved audio for your school locations. This workspace is private by default.</p></div>
      <Badge value={data.profile.publishingPolicy} />
    </header>
    {error ? <div style={styles.error}>{error}</div> : null}
    {notice ? <div style={styles.notice}>{notice}</div> : null}

    <SchoolEditorialClient />

    <section style={styles.grid}>
      <form onSubmit={createAnnouncement} style={styles.card}>
        <p style={styles.eyebrow}>1 · PREPARE</p><h2 style={styles.cardTitle}>New staff announcement</h2>
        <label style={styles.label}>Title<input style={styles.input} value={announcement.title} onChange={(event) => setAnnouncement((current) => ({ ...current, title: event.target.value }))} maxLength={160} required /></label>
        <label style={styles.label}>Approved audio<select style={styles.input} value={announcement.promoVersionId} onChange={(event) => setAnnouncement((current) => ({ ...current, promoVersionId: event.target.value }))} required><option value="">Choose audio…</option>{data.audioVersions.map((version) => <option key={version.id} value={version.id}>{version.promoAsset.name} · v{version.version}</option>)}</select></label>
        <label style={styles.label}>Staff note (optional)<textarea style={{ ...styles.input, minHeight: 84 }} value={announcement.summary} onChange={(event) => setAnnouncement((current) => ({ ...current, summary: event.target.value }))} maxLength={1000} /></label>
        <button style={styles.primary} disabled={working || !data.audioVersions.length}>Submit for review</button>
        {!data.audioVersions.length ? <p style={styles.hint}>No approved organisation audio is available yet. Ruvanas operations must upload and approve the audio first.</p> : null}
      </form>

      {canManage ? <form onSubmit={createSlot} style={styles.card}>
        <p style={styles.eyebrow}>3 · SCHEDULE</p><h2 style={styles.cardTitle}>Approved broadcast slot</h2>
        <label style={styles.label}>Announcement<select name="announcementId" style={styles.input} value={slot.announcementId} onChange={(event) => setSlot((current) => ({ ...current, announcementId: event.target.value }))} required><option value="">Choose approved announcement…</option>{approvedAnnouncements.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label style={styles.label}>Location or zone<select name="target" style={styles.input} value={slot.target} onChange={(event) => setSlot((current) => ({ ...current, target: event.target.value }))} required><option value="">Choose target…</option>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
        <div style={styles.twoColumns}><label style={styles.label}>Starts<input name="startsAt" style={styles.input} type="datetime-local" value={slot.startsAt} onChange={(event) => setSlot((current) => ({ ...current, startsAt: event.target.value }))} required /></label><label style={styles.label}>Ends<input name="endsAt" style={styles.input} type="datetime-local" value={slot.endsAt} onChange={(event) => setSlot((current) => ({ ...current, endsAt: event.target.value }))} required /></label></div>
        <button style={styles.primary} disabled={working || !approvedAnnouncements.length}>Approve and schedule</button>
      </form> : <section style={styles.card}><p style={styles.eyebrow}>3 · SCHEDULE</p><h2 style={styles.cardTitle}>Manager approval required</h2><p style={styles.hint}>An owner or manager reviews announcements and creates broadcast slots.</p></section>}
    </section>

    <section style={{ ...styles.card, marginTop: 20 }}><p style={styles.eyebrow}>2 · REVIEW & HISTORY</p><h2 style={styles.cardTitle}>Announcements</h2>
      {!data.announcements.length ? <p style={styles.hint}>No announcements have been created.</p> : <div style={styles.list}>{data.announcements.map((item) => <article key={item.id} style={styles.item}>
        <div style={styles.itemHeader}><div><h3 style={styles.itemTitle}>{item.title}</h3><p style={styles.hint}>{item.promoVersion.promoAsset.name} · created by {item.createdBy.name || item.createdBy.email}</p></div><Badge value={item.status} /></div>
        {item.summary ? <p style={styles.body}>{item.summary}</p> : null}{item.reviewNotes ? <p style={styles.reviewNote}>Review note: {item.reviewNotes}</p> : null}
        {canManage && item.status === "IN_REVIEW" ? <div style={styles.actions}><button style={styles.approve} disabled={working} onClick={() => review(item, "APPROVE")}>Approve</button><button style={styles.secondary} disabled={working} onClick={() => review(item, "REQUEST_CHANGES")}>Request changes</button><button style={styles.danger} disabled={working} onClick={() => review(item, "REJECT")}>Reject</button></div> : null}
        {!canManage && new Set(["DRAFT", "CHANGES_REQUESTED"]).has(item.status) ? <button style={styles.secondary} disabled={working} onClick={() => review(item, "SUBMIT")}>Submit for review</button> : null}
        {item.broadcastSlots.length ? <div style={styles.slots}>{item.broadcastSlots.map((broadcast) => <div key={broadcast.id} style={styles.slot}><span><strong>{broadcast.zone ? `${broadcast.zone.location.name} — ${broadcast.zone.name}` : broadcast.location?.name}</strong><br />{formatDate(broadcast.startsAt)} → {formatDate(broadcast.endsAt)}</span><span><Badge value={broadcast.status} />{canManage && broadcast.status === "APPROVED" ? <button style={styles.cancelLink} disabled={working} onClick={() => cancelSlot(broadcast)}>Cancel</button> : null}</span></div>)}</div> : null}
      </article>)}</div>}
    </section>
    <p style={styles.privacy}>Safety boundary: staff-managed only · no student accounts · no student personal details · private publishing policy.</p>
  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#fff", padding: "36px max(20px, calc((100vw - 1160px)/2)) 72px", fontFamily: "Arial, sans-serif" },
  back: { color: "#f4b942", textDecoration: "none", fontWeight: 800 },
  header: { display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", margin: "34px 0 24px" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.2, margin: "0 0 8px" },
  title: { fontSize: "clamp(34px,5vw,52px)", margin: 0 }, subtitle: { color: "#b8c3d6", lineHeight: 1.6, maxWidth: 760 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20 },
  card: { border: "1px solid #2b3a54", borderRadius: 14, background: "#182235", padding: 22 }, cardTitle: { margin: "0 0 18px" },
  label: { display: "grid", gap: 7, marginBottom: 14, color: "#dce5f3", fontWeight: 800, fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "11px 12px", font: "inherit" },
  twoColumns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 },
  primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "12px 16px", fontWeight: 900, cursor: "pointer" },
  list: { display: "grid", gap: 14 }, item: { border: "1px solid #34445f", borderRadius: 10, padding: 16, background: "#131e30" },
  itemHeader: { display: "flex", justifyContent: "space-between", gap: 14 }, itemTitle: { margin: "0 0 5px" },
  hint: { color: "#9facbf", lineHeight: 1.5, fontSize: 13 }, body: { color: "#d4dceb", lineHeight: 1.5 }, reviewNote: { color: "#fed7aa", borderLeft: "3px solid #fb923c", paddingLeft: 10 },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }, approve: { border: 0, borderRadius: 7, background: "#22c55e", color: "#052e16", padding: "8px 11px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, background: "transparent", color: "#e2e8f0", padding: "8px 11px", fontWeight: 800, cursor: "pointer" }, danger: { border: "1px solid #f87171", borderRadius: 7, background: "transparent", color: "#fecaca", padding: "8px 11px", fontWeight: 800, cursor: "pointer" },
  slots: { display: "grid", gap: 8, marginTop: 14 }, slot: { display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #34445f", paddingTop: 10, color: "#cbd5e1", fontSize: 13 }, cancelLink: { display: "block", marginTop: 7, border: 0, background: "none", color: "#fca5a5", cursor: "pointer", fontWeight: 800 },
  badge: { display: "inline-block", borderRadius: 5, padding: "4px 8px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 16 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 16 }, privacy: { color: "#8ea0b8", fontSize: 12, marginTop: 20 }
};
