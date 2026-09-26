"use client";

import { useEffect, useState } from "react";
import styles from "../c5.module.css";

async function call(url, method = "GET", body) {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "This action could not be completed."); return data;
}

export default function CorrectionsRehabilitation() {
  const [facilities, setFacilities] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ facilityId: "", categoryCode: "EDUCATION", mediaAssetId: "", title: "", providerName: "", description: "", languageCode: "en" });
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const refresh = async () => { const result = await call("/api/corrections/rehabilitation"); setData(result); };
  useEffect(() => { Promise.all([call("/api/corrections/facilities"), call("/api/corrections/programmes"), call("/api/corrections/rehabilitation")]).then(([f, p, r]) => { setFacilities(f.facilities); setProgrammes(p.programmes || []); setData(r); if (f.facilities[0]) setForm((current) => ({ ...current, facilityId: f.facilities[0].locationId })); }).catch((error) => setNotice(error.message)); }, []);
  const act = async (url, body, success) => { setBusy(true); setNotice(""); try { await call(url, "POST", body); setNotice(success); await refresh(); }
    catch (error) { setNotice(error.message); } finally { setBusy(false); } };
  return <main className={styles.page}><header className={styles.hero}><span>RUVANAS INSIDE · REHABILITATION</span><h1>Build approved audio programmes</h1><p>Reuse protected Ruvanas media and Corrections programmes. These records document content and delivery plans, not education or therapeutic outcomes.</p></header>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <nav className={styles.links}><a href="/dashboard/corrections">Facilities</a><a href="/dashboard/corrections/requests">Requests</a><a href="/dashboard/corrections/programmes">Programmes</a><a href="/dashboard/corrections/contributors">Contributors</a></nav>
    {data && <div className={styles.stats}><span>{data.metrics.approved} approved items</span><span>{data.metrics.awaitingReview} awaiting review</span><span>{data.metrics.expiringSoon} expiring within 30 days</span></div>}
    <section className={styles.card}><h2>Add content for staff review</h2><p>Choose an approved audio file already held by your organisation. Licensed music masters are not copied into this library.</p>
      <div className={styles.fields}><label>Facility<select value={form.facilityId} onChange={(event) => setForm({ ...form, facilityId: event.target.value })}>{facilities.map((item) => <option key={item.locationId} value={item.locationId}>{item.location.name}</option>)}</select></label>
      <label>Category<select value={form.categoryCode} onChange={(event) => setForm({ ...form, categoryCode: event.target.value })}>{(data?.categories || []).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <label>Approved audio<select value={form.mediaAssetId} onChange={(event) => setForm({ ...form, mediaAssetId: event.target.value })}><option value="">Choose audio</option>{(data?.media || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={160} /></label>
      <label>Provider / source<input value={form.providerName} onChange={(event) => setForm({ ...form, providerName: event.target.value })} maxLength={160} /></label>
      <label>Language<input value={form.languageCode} onChange={(event) => setForm({ ...form, languageCode: event.target.value })} maxLength={12} /></label>
      <label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={1500} /></label></div>
      <button disabled={busy || !data?.canManage || !facilities.find((item) => item.locationId === form.facilityId)?.canEdit || !form.mediaAssetId || !form.title || !form.providerName} onClick={() => act("/api/corrections/rehabilitation", form, "Content draft saved. Submit it for a different staff member to approve.")}>Save content draft</button>
    </section>
    <section className={styles.card}><h2>Library and review</h2><div className={styles.list}>{(data?.content || []).map((item) => <article className={styles.evidence} key={item.id}><strong>{item.title}</strong><p>{item.category.name} · {item.providerName} · {item.status}</p>
      <div className={styles.actions}>{item.status === "DRAFT" && item.canReview && <button disabled={busy} onClick={() => act(`/api/corrections/rehabilitation/${item.id}`, { action: "SUBMIT" }, "Sent for review.")}>Submit for review</button>}{item.status === "IN_REVIEW" && item.canReview && <>{item.canApprove && <button disabled={busy} onClick={() => act(`/api/corrections/rehabilitation/${item.id}`, { action: "APPROVE" }, "Content approved.")}>Approve</button>}<button disabled={busy} onClick={() => act(`/api/corrections/rehabilitation/${item.id}`, { action: "REJECT" }, "Content rejected.")}>Reject</button></>}{["APPROVED", "REJECTED"].includes(item.status) && item.canReview && <button disabled={busy} onClick={() => act(`/api/corrections/rehabilitation/${item.id}`, { action: "ARCHIVE" }, "Content archived.")}>Archive</button>}</div>
      {item.status === "APPROVED" && <label>Prepare in a draft programme <select defaultValue="" onChange={(event) => { if (event.target.value) act(`/api/corrections/programmes/${event.target.value}/rehabilitation`, { contentId: item.id }, "Added to draft programme. Scheduling remains locked."); event.target.value = ""; }}><option value="">Choose draft programme</option>{programmes.filter((programme) => programme.status === "DRAFT" && programme.facilityId === item.facilityId).map((programme) => <option key={programme.id} value={programme.id}>{programme.title}</option>)}</select></label>}
    </article>)}</div>{!data?.content?.length && <p>No rehabilitation content yet.</p>}<p className={styles.caution}>Preparing a programme is not publishing or delivery. Corrections scheduling stays locked until private playout and approval integration are verified.</p></section>
  </main>;
}
