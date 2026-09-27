"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../c5.module.css";

const categories = [
  ["OPERATIONAL_INFORMATION", "Operational information"], ["URGENT_FACILITY_NOTICE", "Urgent facility notice"],
  ["SAFETY_INSTRUCTION", "Safety instruction"], ["EMERGENCY_INSTRUCTION", "Emergency instruction"], ["TEST_DRILL", "Test / drill"]
];

export default function CorrectionsAnnouncements() {
  const [facilities, setFacilities] = useState([]);
  const [facilityId, setFacilityId] = useState("");
  const [workspace, setWorkspace] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [zoneIds, setZoneIds] = useState([]);
  const [startsAt, setStartsAt] = useState("");
  const [category, setCategory] = useState("OPERATIONAL_INFORMATION");
  const [drill, setDrill] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const facility = facilities.find((item) => item.locationId === facilityId);
  const approved = workspace?.announcements?.filter((item) => item.status === "APPROVED") || [];
  const selected = approved.find((item) => item.id === selectedId);
  const permissions = workspace?.permissions || {};
  const active = workspace?.overrides?.filter((item) => item.status === "ACTIVE" && new Date(item.expiresAt) > new Date(workspace.now || 0)) || [];

  const refresh = useCallback(async () => {
    if (!facilityId) return;
    const response = await fetch(`/api/corrections/announcements?facilityId=${encodeURIComponent(facilityId)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load announcements.");
    setWorkspace(result);
  }, [facilityId]);

  useEffect(() => { fetch("/api/corrections/facilities", { cache: "no-store" }).then((response) => response.json()).then((data) => { if (data.ok) { setFacilities(data.facilities); setFacilityId((value) => value || data.facilities[0]?.locationId || ""); } else setNotice(data.error || "Unable to load facilities."); }).catch(() => setNotice("Unable to load facilities.")); }, []);
  useEffect(() => { refresh().catch((error) => setNotice(error.message)); }, [refresh]);
  useEffect(() => { if (!facilityId) return undefined; const timer = setInterval(() => refresh().catch(() => {}), 5000); return () => clearInterval(timer); }, [facilityId, refresh]);
  useEffect(() => { setZoneIds([]); setSelectedId(""); setEmergencyOpen(false); }, [facilityId]);

  async function send(url, body = {}) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The action could not be completed.");
      setNotice(data.offlinePlayers?.length ? `Request accepted, but ${data.offlinePlayers.length} player(s) are unavailable. Delivery is not confirmed.` : data.alreadyStarted ? "This broadcast was already started. No duplicate was created." : "Saved. Check player delivery evidence below.");
      await refresh();
      return data;
    } catch (error) { setNotice(error.message); return null; }
    finally { setBusy(false); }
  }

  function targetToggle(id) { setZoneIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function start(type) {
    if (!selected || !zoneIds.length) { setNotice("Choose an approved announcement and at least one active area."); return; }
    if (type === "EMERGENCY") { setEmergencyOpen(true); return; }
    send("/api/corrections/overrides", { facilityId, zoneIds, announcementId: selected.id, type, category, drill: false, idempotencyKey: crypto.randomUUID() });
  }

  return <main className={styles.page}>
    <header className={styles.hero}><span>RUVANAS INSIDE · CONTROLLED COMMUNICATION</span><h1>Facility announcements</h1><p>Prepare and approve audio, schedule ordinary messages, or use separately authorised Priority and Emergency controls. This is not a certified life-safety alert system.</p></header>
    <nav className={styles.links}><a href="/dashboard/corrections">Facility setup</a><a href="/dashboard/corrections/programmes">Programmes</a><a href="/dashboard/corrections/requests">Requests</a></nav>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <section className={styles.card}><h2>Choose facility</h2><div className={styles.fields}><label>Facility<select value={facilityId} onChange={(event) => setFacilityId(event.target.value)}><option value="">Choose facility</option>{facilities.map((item) => <option key={item.locationId} value={item.locationId}>{item.location.name}</option>)}</select></label></div><p>Only active, policy-configured facilities and private enrolled players can receive broadcasts.</p></section>
    {!facility || !workspace ? null : <>
      <section className={styles.card} aria-live="polite"><h2>Current override state</h2>{active.length ? active.map((item) => {
        const completed = item.playoutIntents.filter((intent) => intent.playbackEvents.some((event) => event.eventType === "COMPLETED")).length;
        const failed = item.playoutIntents.filter((intent) => intent.playbackEvents.some((event) => event.eventType === "FAILED")).length;
        const unavailable = item.playoutIntents.filter((intent) => intent.player.status !== "ONLINE" || !intent.player.lastHeartbeatAt || Date.now() - new Date(intent.player.lastHeartbeatAt).getTime() > 90000).length;
        return <div key={item.id} className={styles.evidence}><h3>{item.type}{item.drill ? " · DRILL" : ""} active</h3><p>{facility.location.name} · {item.targetZoneIds.map((id) => facility.location.zones.find((zone) => zone.id === id)?.name || id).join(", ")}</p><p>Started {new Date(item.startedAt).toLocaleString()} · initiating user {item.initiatedByUserId}</p><p>Player evidence: {completed}/{item.targetPlayerIds.length} completed · {failed} failed · {unavailable} unavailable. This does not prove a person heard the message.</p>{(item.type === "EMERGENCY" ? permissions.EMERGENCY_CLEAR : permissions.PRIORITY_STOP) && <button disabled={busy} onClick={() => send(`/api/corrections/overrides/${item.id}/clear`)}>Authorised clear / stop</button>}</div>;
      }) : <p>No Priority or Emergency override is currently active.</p>}</section>
      {permissions.CREATE && <section className={styles.card}><h2>1 · Create a draft</h2><p>Choose an approved, QC-passed announcement or voice recording already in this organisation’s protected media library. New media must pass the existing media review first.</p><div className={styles.fields}><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label><label>Approved audio<select value={mediaId} onChange={(event) => setMediaId(event.target.value)}><option value="">Choose audio</option>{workspace.media.map((item) => <option key={item.id} value={item.id}>{item.promoAsset.name} · {item.mediaAsset.durationSeconds}s</option>)}</select></label></div><button disabled={busy || !title || !mediaId} onClick={async () => { const result = await send("/api/corrections/announcements", { facilityId, title, promoVersionId: mediaId }); if (result) { setTitle(""); setMediaId(""); } }}>Create draft</button></section>}
      <section className={styles.card}><h2>2 · Review approved content</h2><div className={styles.list}>{workspace.announcements.length ? workspace.announcements.map((item) => <div className={styles.evidence} key={item.id}><strong>{item.title}</strong> · {item.status}{item.approvedByUserId && item.status === "DRAFT" ? " · first approval recorded" : ""}<p>{item.playoutIntents.length} planned player deliveries · {item.playoutIntents.filter((intent) => intent.playbackEvents.some((event) => event.eventType === "COMPLETED")).length} confirmed complete</p>{permissions.APPROVE && item.status === "DRAFT" && <button disabled={busy} onClick={() => send(`/api/corrections/announcements/${item.id}/approve`)}>Record authorised approval</button>}</div>) : <p>No announcement drafts yet.</p>}</div></section>
      {(permissions.SCHEDULE || permissions.PRIORITY_ACTIVATE || permissions.EMERGENCY_ACTIVATE) && <section className={styles.card}><h2>3 · Target approved audio</h2><div className={styles.fields}><label>Announcement<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose approved audio</option>{approved.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div><fieldset><legend>Active private areas</legend>{facility.location.zones.filter((zone) => zone.status === "ACTIVE").map((zone) => <label key={zone.id} style={{ display: "block", margin: ".5rem 0" }}><input type="checkbox" checked={zoneIds.includes(zone.id)} onChange={() => targetToggle(zone.id)} /> {zone.name}</label>)}</fieldset>
        {permissions.SCHEDULE && <div className={styles.evidence}><h3>Standard scheduled announcement</h3><div className={styles.fields}><label>Broadcast date and time<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label></div><button disabled={busy || !selected || !zoneIds.length || !startsAt} onClick={() => send(`/api/corrections/announcements/${selectedId}/schedule`, { zoneIds, startsAt: new Date(startsAt).toISOString() })}>Schedule standard announcement</button></div>}
        {permissions.PRIORITY_ACTIVATE && <div className={styles.evidence}><h3>Priority broadcast</h3><p>Interrupts current approved private programming in selected areas. Players return to the current schedule when it ends. Offline delivery is not claimed.</p><div className={styles.fields}><label>Reason category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.filter(([id]) => id !== "TEST_DRILL").map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div><button disabled={busy || !selected || !zoneIds.length || !!active.find((item) => item.type === "EMERGENCY")} onClick={() => start("PRIORITY")}>Start Priority Broadcast</button></div>}
        {permissions.EMERGENCY_ACTIVATE && <div className={styles.evidence}><h3>Restricted Emergency Override</h3><p>This control is separate from ordinary announcements. It requires explicit facility permission and confirmation.</p><button disabled={busy || !selected || !zoneIds.length} onClick={() => start("EMERGENCY")}>Review Emergency target and confirmation →</button></div>}
      </section>}
      {emergencyOpen && permissions.EMERGENCY_ACTIVATE && <section className={styles.card} style={{ borderColor: "#ef9a78" }}><h2>Emergency confirmation</h2><p>Facility: <strong>{facility.location.name}</strong></p><p>Target areas ({zoneIds.length}): <strong>{zoneIds.map((id) => facility.location.zones.find((zone) => zone.id === id)?.name || id).join(", ")}</strong></p><p>Audio: <strong>{selected?.title || "None selected"}</strong></p><p>Behaviour: interrupts current approved private programming in these areas. The player re-resolves the current schedule after the message ends or is cleared. This is not a certified emergency system.</p><div className={styles.fields}><label>Reason category<select value={category} onChange={(event) => { setCategory(event.target.value); setDrill(event.target.value === "TEST_DRILL"); }}><option value="">Choose reason</option>{categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Type START EMERGENCY to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label></div>{facility.emergencyDrillsEnabled && <label><input type="checkbox" checked={drill} onChange={(event) => { setDrill(event.target.checked); setCategory(event.target.checked ? "TEST_DRILL" : "EMERGENCY_INSTRUCTION"); }} /> This is a labelled test/drill</label>}<div className={styles.actions}><button disabled={busy || confirmation !== "START EMERGENCY" || !selected || !zoneIds.length} onClick={async () => { const result = await send("/api/corrections/overrides", { facilityId, zoneIds, announcementId: selectedId, type: "EMERGENCY", category, drill, confirmation, idempotencyKey: crypto.randomUUID() }); if (result) { setEmergencyOpen(false); setConfirmation(""); } }}>Confirm and start Emergency</button><button type="button" onClick={() => { setEmergencyOpen(false); setConfirmation(""); }}>Cancel</button></div></section>}
      <section className={styles.card}><h2>Recent override history</h2>{workspace.overrides.filter((item) => !active.some((current) => current.id === item.id)).map((item) => <p key={item.id}>{item.type}{item.drill ? " · drill" : ""} · {item.status === "ACTIVE" ? "Expired window" : item.status} · {new Date(item.startedAt).toLocaleString()} · {item.playoutIntents.filter((intent) => intent.playbackEvents.some((event) => event.eventType === "COMPLETED")).length}/{item.targetPlayerIds.length} player completions</p>)}</section>
    </>}
  </main>;
}
