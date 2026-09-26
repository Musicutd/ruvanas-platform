"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./corrections.module.css";

const emptyPolicy = { allowedGenres: "", restrictedGenres: "", blockedArtists: "", blockedTrackIds: "" };
const toForm = (policy = {}) => Object.fromEntries(Object.keys(emptyPolicy).map((key) => [key, (policy?.[key] || []).join(", ")]));
const toPayload = (form) => Object.fromEntries(Object.keys(emptyPolicy).map((key) => [key, form[key].split(",").map((value) => value.trim()).filter(Boolean)]));

function PolicyFields({ form, onChange }) {
  return <div className={styles.fields}>
    <label>Allowed genres <small>Optional; blank means no extra genre limit.</small><input value={form.allowedGenres} onChange={(event) => onChange({ ...form, allowedGenres: event.target.value })} placeholder="e.g. Pop, Classical" /></label>
    <label>Restricted genres<input value={form.restrictedGenres} onChange={(event) => onChange({ ...form, restrictedGenres: event.target.value })} placeholder="Separate with commas" /></label>
    <label>Blocked artists<input value={form.blockedArtists} onChange={(event) => onChange({ ...form, blockedArtists: event.target.value })} placeholder="Exact artist names, comma-separated" /></label>
    <label>Blocked track IDs<input value={form.blockedTrackIds} onChange={(event) => onChange({ ...form, blockedTrackIds: event.target.value })} placeholder="Track IDs, comma-separated" /></label>
  </div>;
}

function StaffGrants({ facilityId, setNotice }) {
  const [staff, setStaff] = useState(null);
  const [memberId, setMemberId] = useState("");
  const [permission, setPermission] = useState("VIEWER");
  const [capabilities, setCapabilities] = useState({ canPriorityActivate: false, canPriorityStop: false, canEmergencyActivate: false, canEmergencyClear: false });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/corrections/facilities/${facilityId}/staff`, { cache: "no-store" });
    const result = await response.json();
    if (result.ok) setStaff(result);
    else setNotice(result.error || "Unable to load facility staff.");
  }, [facilityId, setNotice]);
  useEffect(() => { load(); }, [load]);
  const change = async (method, selectedId) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/corrections/facilities/${facilityId}/staff`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: selectedId, permission, ...capabilities }) });
      const result = await response.json();
      setNotice(result.error || (result.ok ? method === "DELETE" ? "Facility access removed." : "Facility access saved." : "Staff access could not be changed."));
      if (result.ok) await load();
    } catch { setNotice("The connection failed. Please try again."); }
    finally { setBusy(false); }
  };
  return <details className={styles.details}><summary>Facility staff access</summary><div className={styles.inner}>
    <p className={styles.muted}>Grant only the access each team member needs. Managers can review; editors can draft and submit; viewers can only read.</p>
    {!staff ? <p>Loading team…</p> : <>
      <div className={styles.inlineForm}><label>Team member<select value={memberId} onChange={(event) => { const id = event.target.value; setMemberId(id); const role = staff.members.find((item) => item.id === id)?.role; const grant = staff.grants.find((item) => item.organisationMemberId === id); setPermission(grant?.permission || (["OWNER", "MANAGER"].includes(role) ? "MANAGER" : role === "CONTENT_EDITOR" ? "EDITOR" : "VIEWER")); setCapabilities({ canPriorityActivate: grant?.canPriorityActivate || false, canPriorityStop: grant?.canPriorityStop || false, canEmergencyActivate: grant?.canEmergencyActivate || false, canEmergencyClear: grant?.canEmergencyClear || false }); }}><option value="">Choose a team member</option>{staff.members.map((item) => <option key={item.id} value={item.id}>{item.user.name || item.user.email} · {item.role}</option>)}</select></label><label>Inside role<select value={permission} onChange={(event) => setPermission(event.target.value)}><option value="MANAGER">Manager · review</option><option value="EDITOR">Editor · submit</option><option value="VIEWER">Viewer · read</option></select></label><button type="button" disabled={busy || !memberId} onClick={() => change("POST", memberId)}>Save access</button></div>
      {permission === "MANAGER" && <div className={styles.fields}>{Object.entries({ canPriorityActivate: "Start Priority", canPriorityStop: "Stop Priority", canEmergencyActivate: "Start Emergency", canEmergencyClear: "Clear Emergency" }).map(([key, label]) => <label key={key} className={styles.check}><input type="checkbox" checked={capabilities[key]} onChange={(event) => setCapabilities((current) => ({ ...current, [key]: event.target.checked }))} /> {label}</label>)}</div>}
      {staff.grants.map((grant) => { const member = staff.members.find((item) => item.id === grant.organisationMemberId); return <div className={styles.staffRow} key={grant.id}><span>{member?.user.name || member?.user.email || "Team member"} · {grant.permission}</span><button type="button" disabled={busy} onClick={() => change("DELETE", grant.organisationMemberId)}>Remove</button></div>; })}
    </>}
  </div></details>;
}

function FacilityCard({ facility, refresh, setNotice, canEdit, canAddZone, canSetDual }) {
  const [policy, setPolicy] = useState(toForm(facility));
  const [youth, setYouth] = useState(facility.youthFacility);
  const [dualApproval, setDualApproval] = useState(facility.dualApprovalRequired);
  const [broadcastPolicy, setBroadcastPolicy] = useState({ announcementApprovalMode: facility.announcementApprovalMode, priorityEnabled: facility.priorityEnabled, emergencyEnabled: facility.emergencyEnabled, emergencyDrillsEnabled: facility.emergencyDrillsEnabled });
  const [zoneName, setZoneName] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (action, body) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/corrections/facilities/${facility.locationId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
      const result = await response.json();
      setNotice(result.error || (result.ok ? action === "ADD_ZONE" ? "Secure area added. It remains offline." : "Facility restrictions saved." : "This change could not be saved."));
      if (result.ok) { setZoneName(""); refresh(); }
    } catch { setNotice("The connection failed. Please try again."); }
    finally { setBusy(false); }
  };
  return <article className={styles.card}>
    <div className={styles.cardHead}><div><span className={styles.eyebrow}>Facility · draft</span><h3>{facility.location.name}</h3><p>{facility.location.countryCode} · {facility.location.timezone}</p></div><span className={styles.badge}>{facility.location.zones.length} secure area{facility.location.zones.length === 1 ? "" : "s"}</span></div>
    <div className={styles.zoneList}>{facility.location.zones.map((zone) => <span key={zone.id} className={styles.zone}>⌁ {zone.name} <small>Offline</small></span>)}</div>
    <p className={styles.muted}>Local policy: {facility.policyConfiguredAt ? "saved" : "needs review"}. Corrections playback remains off.</p>
    {canEdit && <details className={styles.details}><summary>Manage secure areas and local policy</summary><div className={styles.inner}>
      {canAddZone ? <form onSubmit={(event) => { event.preventDefault(); save("ADD_ZONE", { name: zoneName }); }} className={styles.inlineForm}><label>New secure area<input value={zoneName} onChange={(event) => setZoneName(event.target.value)} placeholder="e.g. East Wing" minLength={2} maxLength={160} required /></label><button disabled={busy}>Add area</button></form> : <p className={styles.muted}>The secure-area allowance is full. Contact Ruvanas before adding more.</p>}
      <h4>Facility music restrictions</h4><p className={styles.muted}>These add to the organisation policy. They can never override music rights or permit explicit tracks.</p>
      <PolicyFields form={policy} onChange={setPolicy} />
      <label className={styles.check}><input type="checkbox" checked={youth} onChange={(event) => setYouth(event.target.checked)} /> Youth facility — also exclude tracks with content warnings</label>
      {canSetDual && <label className={styles.check}><input type="checkbox" checked={dualApproval} onChange={(event) => setDualApproval(event.target.checked)} /> Require a second, different facility reviewer</label>}
      <button type="button" disabled={busy} onClick={() => save("SAVE_POLICY", { ...toPayload(policy), youthFacility: youth, dualApprovalRequired: dualApproval, cleanOnly: true })}>Save facility policy</button>
    </div></details>}
    {canSetDual && <StaffGrants facilityId={facility.locationId} setNotice={setNotice} />}
    {canSetDual && <details className={styles.details}><summary>Announcement and override policy</summary><div className={styles.inner}><p className={styles.muted}>Priority and Emergency are off until the owner enables them. Emergency also requires a separate explicit staff grant. This is not a certified life-safety system.</p><label>Standard announcement approval<select value={broadcastPolicy.announcementApprovalMode} onChange={(event) => setBroadcastPolicy({ ...broadcastPolicy, announcementApprovalMode: event.target.value })}><option value="CREATOR_PUBLISH">Creator with publish authority</option><option value="EXPLICIT">Independent approval</option><option value="DUAL">Two independent approvals</option></select></label>{Object.entries({ priorityEnabled: "Permit Priority overrides", emergencyEnabled: "Permit Emergency overrides", emergencyDrillsEnabled: "Permit labelled Emergency drills" }).map(([key, label]) => <label key={key} className={styles.check}><input type="checkbox" checked={broadcastPolicy[key]} onChange={(event) => setBroadcastPolicy({ ...broadcastPolicy, [key]: event.target.checked })} /> {label}</label>)}<button disabled={busy} onClick={() => save("SAVE_ANNOUNCEMENT_POLICY", broadcastPolicy)}>Save announcement policy</button></div></details>}
  </article>;
}

export default function CorrectionsSetup() {
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState("");
  const [policy, setPolicy] = useState(emptyPolicy);
  const [newFacility, setNewFacility] = useState({ name: "", firstZoneName: "", timezone: "Europe/Malta", countryCode: "MT", youthFacility: false });
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/corrections/facilities", { cache: "no-store" });
      const result = await response.json();
      if (!result.ok) { setNotice(result.error || "Unable to load Inside setup."); return; }
      setData(result);
      setPolicy(toForm(result.profile));
    } catch { setNotice("Unable to load Inside setup."); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const submit = async (url, method, body, success) => {
    setBusy(true);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      setNotice(result.error || (result.ok ? success : "This change could not be saved."));
      if (result.ok) await refresh();
    } catch { setNotice("The connection failed. Please try again."); }
    finally { setBusy(false); }
  };
  return <main className={styles.page}>
    <div className={styles.hero}><span className={styles.eyebrow}>Ruvanas Inside · Corrections</span><h1>Prepare your secure radio spaces</h1><p>Set up facilities and music rules first. Listening, scheduling and secure players will be added in later stages.</p><strong className={styles.locked}>● Playback is off · No public listener page</strong></div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!data ? <p>Loading your organisation’s Inside setup…</p> : <>
      <div className={styles.steps}><span>1 · Add facility <b>{data.facilities.length ? "✓" : "—"}</b></span><span>2 · Set organisation policy <b>{data.profile?.policyConfiguredAt ? "✓" : "—"}</b></span><span>3 · Check each facility policy <b>{data.facilities.length && data.facilities.every((item) => item.policyConfiguredAt) ? "✓" : "—"}</b></span><span>4 · Private playback <b>Later</b></span></div>
      <section className={styles.card}><div className={styles.cardHead}><div><span className={styles.eyebrow}>Organisation-wide</span><h2>Music safety policy</h2><p>Clean versions only. Explicit tracks are always prohibited.</p></div><span className={styles.badge}>{data.profile?.policyConfiguredAt ? "Saved" : "Not reviewed"}</span></div>
        {data.canCreate ? <><PolicyFields form={policy} onChange={setPolicy} /><button disabled={busy} onClick={() => submit("/api/corrections/policy", "PATCH", { ...toPayload(policy), cleanOnly: true }, "Organisation policy saved. Playback remains off.")}>Save organisation policy</button></> : <p className={styles.muted}>Only the organisation owner can change the central policy.</p>}
      </section>
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Your secure spaces</span><h2>Facilities and areas</h2><p>{data.facilities.length} of {data.caps.facilities} facilities shown · {data.zoneCount} of {data.caps.zones} secure areas used. Areas remain offline until later setup.</p></div></div>
      {data.facilities.map((facility) => <FacilityCard key={facility.locationId} facility={facility} refresh={refresh} setNotice={setNotice} canEdit={facility.canEdit} canAddZone={data.zoneCount < data.caps.zones} canSetDual={data.canCreate} />)}
      {data.canCreate && data.facilities.length < data.caps.facilities && data.zoneCount < data.caps.zones && <section className={styles.card}><h3>Add a facility</h3><p className={styles.muted}>This creates a draft facility and its first offline secure area. It does not start broadcasting.</p><form onSubmit={(event) => { event.preventDefault(); submit("/api/corrections/facilities", "POST", newFacility, "Facility created as draft. Set its local policy next."); }}><div className={styles.fields}><label>Facility name<input value={newFacility.name} onChange={(event) => setNewFacility({ ...newFacility, name: event.target.value })} minLength={2} maxLength={160} required /></label><label>First secure area<input value={newFacility.firstZoneName} onChange={(event) => setNewFacility({ ...newFacility, firstZoneName: event.target.value })} minLength={2} maxLength={160} required /></label><label>Timezone<input value={newFacility.timezone} onChange={(event) => setNewFacility({ ...newFacility, timezone: event.target.value })} required /></label><label>Country code<input value={newFacility.countryCode} onChange={(event) => setNewFacility({ ...newFacility, countryCode: event.target.value.toUpperCase() })} maxLength={2} required /></label></div><label className={styles.check}><input type="checkbox" checked={newFacility.youthFacility} onChange={(event) => setNewFacility({ ...newFacility, youthFacility: event.target.checked })} /> Youth facility</label><button disabled={busy}>Create draft facility</button></form></section>}
      <section className={styles.card}><span className={styles.eyebrow}>Next · Corrections Guard</span><h2>Programmes and staff review</h2><p>Create drafts, submit verified audio and record separated staff approvals. This does not publish or schedule audio.</p><a href="/dashboard/corrections/programmes">Open programmes and review →</a><p><a href="/dashboard/corrections/studio">Prepare supervised Studio sessions →</a></p></section>
      <section className={styles.card}><span className={styles.eyebrow}>Facility communication</span><h2>Announcements and controlled overrides</h2><p>Approved audio can be scheduled to private areas. Priority and Emergency require separate facility controls.</p><a href="/dashboard/corrections/announcements">Open announcements →</a></section>
      <section className={styles.card}><span className={styles.eyebrow}>Inside workspaces</span><h2>Requests, rehabilitation and contributors</h2><p>Keep request moderation, approved media and supervised development separate from live playout.</p><p><a href="/dashboard/corrections/requests">Review radio requests →</a></p><p><a href="/dashboard/corrections/rehabilitation">Manage rehabilitation audio →</a></p><p><a href="/dashboard/corrections/contributors">View contributor development →</a></p></section>
      <p className={styles.footer}>Facility and review setup only. No Corrections channel, AutoDJ, secure player or public listener is enabled by these settings.</p>
    </>}
  </main>;
}
