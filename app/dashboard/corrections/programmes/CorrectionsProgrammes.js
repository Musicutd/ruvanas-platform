"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../corrections.module.css";

async function send(url, method, body) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

function ProgrammeCard({ programme, facility, renders, refresh, setNotice }) {
  const [title, setTitle] = useState(programme.title);
  const [description, setDescription] = useState(programme.description || "");
  const [renderId, setRenderId] = useState("");
  const [decision, setDecision] = useState("APPROVE");
  const [note, setNote] = useState("");
  const [readiness, setReadiness] = useState(null);
  const [busy, setBusy] = useState(false);
  const canWrite = ["OWNER", "MANAGER", "EDITOR"].includes(facility?.programmeRole);
  const canReview = ["OWNER", "MANAGER"].includes(facility?.programmeRole);
  const canEdit = canWrite && ["DRAFT", "CHANGES_REQUESTED", "REJECTED", "APPROVED"].includes(programme.status);
  const canSubmit = canWrite && ["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(programme.status);
  const reviewStage = programme.status === "SUBMITTED" ? "STAFF" : programme.status === "STAFF_APPROVED" ? "FACILITY" : null;
  const act = async (suffix, method, body, success) => {
    setBusy(true);
    try {
      const result = await send(`/api/corrections/programmes/${programme.id}${suffix}`, method, body);
      setNotice(result.error || (result.ok ? success : "The programme could not be updated."));
      if (result.ok) await refresh();
    } catch { setNotice("The connection failed. Please try again."); }
    finally { setBusy(false); }
  };
  const check = async () => {
    const response = await fetch(`/api/corrections/programmes/${programme.id}/readiness`, { cache: "no-store" });
    const result = await response.json();
    setReadiness(result.readiness || null);
  };
  return <article className={styles.card}>
    <div className={styles.cardHead}><div><span className={styles.eyebrow}>{programme.facilityName} · revision {programme.latestRevision}</span><h3>{programme.title}</h3><p>{programme.description || "No description yet."}</p></div><span className={styles.badge}>{programme.status.replaceAll("_", " ")}</span></div>
    {programme.submission && <p className={styles.muted}>Submitted version {programme.submission.revision} · {programme.submission.dualApprovalRequired ? "Two reviews required" : "One staff review required"} · {programme.submission.reviews.length} decision{programme.submission.reviews.length === 1 ? "" : "s"} recorded</p>}
    {programme.submission?.reviewAudioUrl && <div><label className={styles.muted}>Listen to the submitted version</label><audio controls controlsList="nodownload noplaybackrate" preload="none" src={programme.submission.reviewAudioUrl} style={{ width: "100%", marginTop: 8 }} /></div>}
    {programme.submission?.reviews?.length > 0 && <div className={styles.zoneList}>{programme.submission.reviews.map((review, index) => <span className={styles.zone} key={`${review.stage}-${index}`}>{review.stage} · {review.decision.replaceAll("_", " ")}{review.note ? ` — ${review.note}` : ""}</span>)}</div>}
    {canEdit && <details className={styles.details}><summary>Edit programme details</summary><div className={styles.inner}><p className={styles.muted}>Changing an approved programme immediately removes its current approval. Submit a new audio version for review.</p><div className={styles.fields}><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={160} /></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></label></div><button type="button" disabled={busy} onClick={() => act("", "PATCH", { title, description }, "Draft saved. Prior approval is no longer current.")}>Save draft</button></div></details>}
    {canSubmit && <details className={styles.details}><summary>Submit audio for staff review</summary><div className={styles.inner}><p className={styles.muted}>Select a verified, approved Studio render. The exact audio checksum and policy versions are recorded; submission does not publish or schedule it.</p>{renders.length ? <div className={styles.inlineForm}><label>Approved render<select value={renderId} onChange={(event) => setRenderId(event.target.value)}><option value="">Choose approved audio</option>{renders.map((render) => <option key={render.id} value={render.id}>{render.projectTitle} · {new Date(render.completedAt).toLocaleDateString()}</option>)}</select></label><button type="button" disabled={busy || !renderId} onClick={() => act("/submit", "POST", { renderId }, "Submitted for staff review. Nothing is on air.")}>Submit for review</button></div> : <p>No verified Studio render is ready for this account yet. Audio preparation and contributor handoff are part of the next Studio stage.</p>}</div></details>}
    {canReview && reviewStage && <details className={styles.details}><summary>{reviewStage === "STAFF" ? "Staff review" : "Second facility review"}</summary><div className={styles.inner}><p className={styles.muted}>Listen to the submitted audio above before deciding. You cannot approve your own submission; a second review must be by another person.</p><div className={styles.fields}><label>Decision<select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="APPROVE">Approve</option><option value="CHANGES_REQUESTED">Request changes</option><option value="REJECT">Reject</option></select></label><label>Reason or note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder={decision === "APPROVE" ? "Optional" : "Required for changes or rejection"} /></label></div><button type="button" disabled={busy} onClick={() => act("/review", "POST", { stage: reviewStage, decision, note }, "Review recorded. Scheduling and playback remain disabled.")}>Record review</button></div></details>}
    <button type="button" className={styles.secondaryButton} onClick={check}>Check approval evidence</button>
    {readiness && <p role="status" className={styles.muted}>{readiness.allowed ? "Approval evidence is current. Private delivery is still not enabled." : `Not ready: ${readiness.reason.replaceAll("_", " ").toLowerCase()}.`}</p>}
  </article>;
}

export default function CorrectionsProgrammes() {
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [facilitiesResponse, programmesResponse] = await Promise.all([fetch("/api/corrections/facilities", { cache: "no-store" }), fetch("/api/corrections/programmes", { cache: "no-store" })]);
      const [facilities, programmes] = await Promise.all([facilitiesResponse.json(), programmesResponse.json()]);
      if (!facilities.ok || !programmes.ok) { setNotice(facilities.error || programmes.error || "Unable to load programmes."); return; }
      setData({ facilities: facilities.facilities, programmes: programmes.programmes, renders: programmes.renders });
    } catch { setNotice("Unable to load programmes."); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const create = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await send("/api/corrections/programmes", "POST", { facilityId, title, description });
      setNotice(result.error || (result.ok ? "Programme draft created. It is not on air." : "Could not create the programme."));
      if (result.ok) { setTitle(""); setDescription(""); await refresh(); }
    } catch { setNotice("The connection failed. Please try again."); }
    finally { setBusy(false); }
  };
  const editableFacilities = data?.facilities.filter((facility) => ["OWNER", "MANAGER", "EDITOR"].includes(facility.programmeRole)) || [];
  return <main className={styles.page}>
    <div className={styles.hero}><span className={styles.eyebrow}>Ruvanas Inside · Corrections Guard</span><h1>Programmes and staff review</h1><p>Prepare a programme, submit a fixed audio version, and record staff decisions. No approval here starts broadcasting.</p><strong className={styles.locked}>● Scheduling and playback remain off</strong><p><a href="/dashboard/corrections">← Facility setup</a></p></div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!data ? <p>Loading programme workspace…</p> : <>
      {editableFacilities.length > 0 && <section className={styles.card}><span className={styles.eyebrow}>1 · Draft</span><h2>Create a programme</h2><form onSubmit={create}><div className={styles.fields}><label>Facility<select value={facilityId} onChange={(event) => setFacilityId(event.target.value)} required><option value="">Choose a facility</option>{editableFacilities.map((facility) => <option key={facility.locationId} value={facility.locationId}>{facility.location.name}</option>)}</select></label><label>Programme title<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={160} required /></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></label></div><button disabled={busy}>Create draft</button></form></section>}
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>2 · Review queue</span><h2>Facility programmes</h2><p>{data.programmes.length ? "Only assigned facilities are shown." : "No programmes are visible for your assigned facilities yet."}</p></div></div>
      {data.programmes.map((programme) => <ProgrammeCard key={programme.id} programme={programme} facility={data.facilities.find((item) => item.locationId === programme.facilityId)} renders={data.renders} refresh={refresh} setNotice={setNotice} />)}
      <p className={styles.footer}>C3 governance only. Contributor Studio, scheduling, secure player delivery and live radio remain later stages.</p>
    </>}
  </main>;
}
