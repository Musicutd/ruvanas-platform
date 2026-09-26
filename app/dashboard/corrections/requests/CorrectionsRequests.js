"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../c5.module.css";

async function call(url, method = "GET", body) {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "This action could not be completed.");
  return data;
}

export default function CorrectionsRequests() {
  const [facilities, setFacilities] = useState([]);
  const [facilityId, setFacilityId] = useState("");
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [status, setStatus] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState({ availability: "DISABLED", songRequestsEnabled: false, messageRequestsEnabled: false, dedicationsEnabled: false });
  const [newRequest, setNewRequest] = useState({ type: "SONG", songTitle: "", songArtist: "", recipientDisplayName: "", wingOrUnit: "", message: "" });
  const [review, setReview] = useState({ onAirRecipient: "", onAirMessage: "", trackId: "", programmeId: "", note: "" });
  const facility = facilities.find((item) => item.locationId === facilityId);
  const load = useCallback(async (id = facilityId, filter = status) => {
    try { const result = await call(`/api/corrections/requests?${new URLSearchParams({ ...(id ? { facilityId: id } : {}), ...(filter ? { status: filter } : {}), ...(typeFilter ? { type: typeFilter } : {}), ...(dateFilter ? { date: dateFilter } : {}) })}`); setRequests(result.requests); }
    catch (error) { setNotice(error.message); }
  }, [facilityId, status, typeFilter, dateFilter]);
  useEffect(() => {
    Promise.all([call("/api/corrections/facilities"), call("/api/corrections/programmes")]).then(([f, p]) => {
      setFacilities(f.facilities); setProgrammes(p.programmes || []); if (f.facilities[0]) setFacilityId(f.facilities[0].locationId);
    }).catch((error) => setNotice(error.message));
  }, []);
  useEffect(() => { if (facilityId) { load(facilityId, status); const f = facilities.find((item) => item.locationId === facilityId); if (f) setPolicy({ availability: f.requestAvailability, songRequestsEnabled: f.songRequestsEnabled, messageRequestsEnabled: f.messageRequestsEnabled, dedicationsEnabled: f.dedicationsEnabled });
    call(`/api/corrections/requests/music?facilityId=${encodeURIComponent(facilityId)}`).then((data) => setTracks(data.tracks)).catch(() => setTracks([])); }
  }, [facilityId, status, facilities, load]);
  const act = async (url, method, body, success) => { setBusy(true); setNotice(""); try { await call(url, method, body); setNotice(success); await load(); }
    catch (error) { setNotice(error.message); } finally { setBusy(false); } };
  const open = async (id) => { setSelected(null); setReview({ onAirRecipient: "", onAirMessage: "", trackId: "", programmeId: "", note: "" });
    try { setSelected((await call(`/api/corrections/requests/${id}`)).request); } catch (error) { setNotice(error.message); } };
  const decide = async (action) => { if (!selected) return; setBusy(true); try {
    await call(`/api/corrections/requests/${selected.id}`, "POST", { ...review, action });
    setNotice(`Request ${action.toLowerCase()} recorded.`); setSelected((await call(`/api/corrections/requests/${selected.id}`)).request); await load();
  } catch (error) { setNotice(error.message); } finally { setBusy(false); } };
  return <main className={styles.page}><header className={styles.hero}><span>RUVANAS INSIDE · REQUESTS</span><h1>Review radio requests</h1><p>Internal and Family & Friends requests wait for facility staff. Nothing here sends a private message or changes playout.</p></header>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <nav className={styles.links}><a href="/dashboard/corrections">Facilities</a><a href="/dashboard/corrections/programmes">Programmes</a><a href="/dashboard/corrections/rehabilitation">Rehabilitation</a><a href="/dashboard/corrections/contributors">Contributors</a></nav>
    <section className={styles.card}><h2>Facility and availability</h2><div className={styles.fields}><label>Facility<select value={facilityId} onChange={(event) => { setFacilityId(event.target.value); setSelected(null); }}>{facilities.map((item) => <option key={item.locationId} value={item.locationId}>{item.location.name}</option>)}</select></label>
      <label>Accept requests<select value={policy.availability} disabled={!facility?.canEdit} onChange={(event) => setPolicy({ ...policy, availability: event.target.value })}><option value="DISABLED">Off</option><option value="INTERNAL_ONLY">Internal only</option><option value="FAMILY_AND_INTERNAL">Family and internal</option></select></label></div>
      <div className={styles.checks}>{[["songRequestsEnabled", "Songs"], ["messageRequestsEnabled", "Messages"], ["dedicationsEnabled", "Dedications"]].map(([key, label]) => <label key={key}><input type="checkbox" checked={!!policy[key]} disabled={!facility?.canEdit} onChange={(event) => setPolicy({ ...policy, [key]: event.target.checked })} /> {label}</label>)}</div>
      {facility?.canEdit && <button disabled={busy} onClick={async () => { await act(`/api/corrections/facilities/${facilityId}/requests-policy`, "PATCH", policy, "Facility request policy saved."); const f = await call("/api/corrections/facilities"); setFacilities(f.facilities); }}>Save request settings</button>}
      {facility?.requestAvailability === "FAMILY_AND_INTERNAL" && facility.publicRequestCode && <p>Family request link: <a href={`/inside/request/${facility.publicRequestCode}`} target="_blank" rel="noreferrer">Open the moderated request form</a>. Share only through approved facility channels.</p>}
    </section>
    <section className={styles.card}><h2>Add an internal request</h2><p>Use a local reference only if needed. It will never be copied into on-air wording automatically.</p><div className={styles.fields}>
      <label>Type<select value={newRequest.type} onChange={(event) => setNewRequest({ ...newRequest, type: event.target.value })}><option value="SONG">Song</option><option value="PROGRAMME">Programme</option><option value="DEDICATION">Dedication</option><option value="MESSAGE">Message</option><option value="REHABILITATION_SUGGESTION">Rehabilitation suggestion</option></select></label>
      <label>Recipient display name<input value={newRequest.recipientDisplayName} onChange={(event) => setNewRequest({ ...newRequest, recipientDisplayName: event.target.value })} maxLength={80} /></label>
      <label>Wing / unit<input value={newRequest.wingOrUnit} onChange={(event) => setNewRequest({ ...newRequest, wingOrUnit: event.target.value })} maxLength={80} /></label>
      {newRequest.type === "SONG" && <><label>Song title<input value={newRequest.songTitle} onChange={(event) => setNewRequest({ ...newRequest, songTitle: event.target.value })} maxLength={160} /></label><label>Artist<input value={newRequest.songArtist} onChange={(event) => setNewRequest({ ...newRequest, songArtist: event.target.value })} maxLength={160} /></label></>}
      <label>Message<input value={newRequest.message} onChange={(event) => setNewRequest({ ...newRequest, message: event.target.value })} maxLength={500} /></label></div>
      <button disabled={busy || !facilityId || !facility?.canEdit || policy.availability === "DISABLED"} onClick={() => act("/api/corrections/requests", "POST", { ...newRequest, facilityId }, "Internal request received for review.")}>Send to review</button>
    </section>
    <section className={styles.card}><h2>Review queue</h2><div className={styles.fields}><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{["RECEIVED", "SCREENING", "APPROVED", "REJECTED", "SCHEDULED", "PLAYED", "ARCHIVED"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option>{["SONG", "PROGRAMME", "DEDICATION", "MESSAGE", "REHABILITATION_SUGGESTION"].map((item) => <option key={item}>{item.replaceAll("_", " ")}</option>)}</select></label><label>Received on (UTC)<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label></div>
      <div className={styles.list}>{requests.map((item) => <button key={item.id} className={styles.row} disabled={!facility?.canEdit} onClick={() => open(item.id)}><strong>{item.type === "SONG" ? `${item.songArtist || "Artist not given"} — ${item.songTitle}` : item.type.replaceAll("_", " ")}</strong><span>{item.source} · {item.status} · {new Date(item.createdAt).toLocaleDateString()}</span></button>)}</div>
      {!requests.length && <p>No requests in this view.</p>}
    </section>
    {selected && <section className={styles.card}><h2>Staff review</h2><p>Original submission — restricted to authorised facility staff</p><div className={styles.evidence}><p>Recipient reference: {selected.recipientReference || "Not given"}</p><p>Original message: {selected.originalMessage || "None"}</p><p>Sender: {selected.senderDisplayName || "Not given"}</p><p>Song: {selected.songArtist || ""} {selected.songTitle || ""}</p></div>
      <p>On-air wording is separate. Do not copy private references.</p><div className={styles.fields}><label>On-air recipient<input value={review.onAirRecipient} onChange={(event) => setReview({ ...review, onAirRecipient: event.target.value })} maxLength={80} /></label><label>On-air message<textarea value={review.onAirMessage} onChange={(event) => setReview({ ...review, onAirMessage: event.target.value })} maxLength={500} /></label>
      {selected.type === "SONG" && <label>Eligible approved recording<select value={review.trackId} onChange={(event) => setReview({ ...review, trackId: event.target.value })}><option value="">Choose a policy-cleared track</option>{tracks.map((track) => <option key={track.id} value={track.id}>{track.artist} — {track.title}</option>)}</select></label>}
      <label>Approved programme (optional)<select value={review.programmeId} onChange={(event) => setReview({ ...review, programmeId: event.target.value })}><option value="">No programme link</option>{programmes.filter((item) => item.facilityId === facilityId && item.status === "APPROVED").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Staff note<input value={review.note} onChange={(event) => setReview({ ...review, note: event.target.value })} maxLength={500} /></label></div>
      <div className={styles.actions}>{selected.status === "RECEIVED" && <><button disabled={busy} onClick={() => decide("SCREEN")}>Start screening</button><button disabled={busy} onClick={() => decide("REJECT")}>Reject</button></>}{selected.status === "SCREENING" && <><button disabled={busy} onClick={() => decide("APPROVE")}>Approve wording</button><button disabled={busy} onClick={() => decide("REJECT")}>Reject</button></>}{["APPROVED", "REJECTED"].includes(selected.status) && <button disabled={busy} onClick={() => decide("ARCHIVE")}>Archive</button>}</div>
      {!!selected.decisions?.length && <div className={styles.evidence}><h3>Review history</h3>{selected.decisions.map((decision) => <p key={decision.id}>{new Date(decision.decidedAt).toLocaleString()} · {decision.action} · {decision.fromStatus} → {decision.toStatus}{decision.note ? ` · ${decision.note}` : ""}</p>)}</div>}
      <p className={styles.caution}>Approval is not scheduling. Private Corrections playback remains locked; do not report this as played.</p></section>}
  </main>;
}
