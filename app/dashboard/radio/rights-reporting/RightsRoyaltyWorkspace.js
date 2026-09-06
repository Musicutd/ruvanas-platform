"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./rights-reporting.module.css";

const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

export default function RightsRoyaltyWorkspace() {
  const [data, setData] = useState(null);
  const [authority, setAuthority] = useState({ code: "", name: "", territoryCode: "MT", reportFormat: "STANDARD_USAGE_V1" });
  const [mapping, setMapping] = useState({ authorityId: "", trackId: "", recordingCode: "", workCode: "", composers: "", publishers: "", authorityReference: "", verified: false });
  const [report, setReport] = useState({ authorityId: "", from: monthAgo, to: today, attestationAccepted: false });
  const [working, setWorking] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/rights-royalty", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load rights reporting.");
      setData(payload);
      const first = payload.authorities.find((item) => item.active)?.id || "";
      setMapping((current) => ({ ...current, authorityId: current.authorityId || first, trackId: current.trackId || payload.tracks[0]?.id || "" }));
      setReport((current) => ({ ...current, authorityId: current.authorityId || first }));
    } catch (cause) { setError(cause.message); } finally { setWorking(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectedTrack = useMemo(() => data?.tracks.find((track) => track.id === mapping.trackId), [data, mapping.trackId]);
  useEffect(() => {
    const saved = selectedTrack?.rightsWorkMappings.find((item) => item.authorityId === mapping.authorityId);
    setMapping((current) => ({ ...current, recordingCode: saved?.recordingCode || "", workCode: saved?.workCode || "", composers: (saved?.composers || []).join(", "), publishers: (saved?.publishers || []).join(", "), authorityReference: saved?.authorityReference || "", verified: Boolean(saved?.verifiedAt) }));
  }, [selectedTrack, mapping.authorityId]);

  async function save(body, success) {
    setWorking(body.action); setError(""); setNotice("");
    try {
      const response = await fetch("/api/rights-royalty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The change could not be saved.");
      setNotice(success); await load();
    } catch (cause) { setError(cause.message); } finally { setWorking(""); }
  }

  async function createReport(event) {
    event.preventDefault(); setWorking("report"); setError(""); setNotice(""); setJob(null);
    try {
      const response = await fetch("/api/reports/rights-royalty/exports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to start the report.");
      setJob(payload.job); poll(payload.job.statusUrl);
    } catch (cause) { setError(cause.message); setWorking(""); }
  }

  async function poll(url) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error || "Unable to check the report."); break; }
      setJob(payload.job);
      if (payload.job.status === "READY") { setNotice("The attested rights-usage export is ready."); break; }
      if (payload.job.status === "FAILED") { setError(payload.job.error || "The report failed."); break; }
    }
    setWorking(""); await load();
  }

  const summary = data?.summary || {};
  return <div className={styles.workspace}>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    <section className={styles.metrics} aria-label="Rights reporting summary"><div><strong>{summary.ledgerEvents || 0}</strong><span>immutable usage events</span></div><div><strong>{Math.round((summary.playedSeconds || 0) / 60)}</strong><span>confirmed music minutes</span></div><div><strong>{summary.mappedTracks || 0}</strong><span>mapped catalogue tracks</span></div><div><strong>{data?.authorities.filter((item) => item.active).length || 0}</strong><span>active authorities</span></div></section>

    <section className={styles.panel}><div className={styles.heading}><div><p className={styles.kicker}>AUTHORITY PROFILE</p><h2>Add a reporting destination</h2></div><span>Provider-neutral</span></div><form onSubmit={(event) => { event.preventDefault(); save({ action: "SAVE_AUTHORITY", ...authority }, "Reporting authority saved."); }}><div className={styles.formGrid}><label><span>Authority code</span><input value={authority.code} maxLength="24" placeholder="LOCAL-AUTH" onChange={(event) => setAuthority({ ...authority, code: event.target.value })} /></label><label><span>Authority name</span><input value={authority.name} placeholder="Reporting authority" onChange={(event) => setAuthority({ ...authority, name: event.target.value })} /></label><label><span>Territory</span><input value={authority.territoryCode} maxLength="2" onChange={(event) => setAuthority({ ...authority, territoryCode: event.target.value.toUpperCase() })} /></label><label><span>Export format</span><select value={authority.reportFormat} onChange={(event) => setAuthority({ ...authority, reportFormat: event.target.value })}><option value="STANDARD_USAGE_V1">Detailed usage CSV</option><option value="SUMMARY_USAGE_V1">Summary usage CSV</option></select></label></div>{data?.permissions.canManage ? <div className={styles.actions}><button disabled={Boolean(working)}>Save authority</button></div> : <p className={styles.muted}>An owner or manager controls authority profiles.</p>}</form></section>

    <section className={styles.panel}><div className={styles.heading}><div><p className={styles.kicker}>WORK MAPPING</p><h2>Connect recordings to recognised identifiers</h2></div><span>{summary.mappedTracks || 0}/{summary.catalogueTracks || 0} mapped</span></div>{data?.authorities.length && data?.tracks.length ? <form onSubmit={(event) => { event.preventDefault(); save({ action: "SAVE_MAPPING", ...mapping }, "Track mapping saved with a new audited revision."); }}><div className={styles.formGrid}><label><span>Reporting authority</span><select value={mapping.authorityId} onChange={(event) => setMapping({ ...mapping, authorityId: event.target.value })}>{data.authorities.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.territoryCode}</option>)}</select></label><label><span>Track</span><select value={mapping.trackId} onChange={(event) => setMapping({ ...mapping, trackId: event.target.value, recordingCode: "", workCode: "", composers: "", publishers: "", authorityReference: "", verified: false })}>{data.tracks.map((item) => <option key={item.id} value={item.id}>{item.artist} — {item.title}</option>)}</select></label><label><span>ISRC</span><input value={mapping.recordingCode} placeholder="MTABC2600001" onChange={(event) => setMapping({ ...mapping, recordingCode: event.target.value })} /></label><label><span>ISWC</span><input value={mapping.workCode} placeholder="T1234567890" onChange={(event) => setMapping({ ...mapping, workCode: event.target.value })} /></label><label><span>Composers</span><input value={mapping.composers} placeholder="Names separated by commas" onChange={(event) => setMapping({ ...mapping, composers: event.target.value })} /></label><label><span>Publishers</span><input value={mapping.publishers} placeholder="Names separated by commas" onChange={(event) => setMapping({ ...mapping, publishers: event.target.value })} /></label><label><span>Authority reference</span><input value={mapping.authorityReference} onChange={(event) => setMapping({ ...mapping, authorityReference: event.target.value })} /></label><label className={styles.check}><input type="checkbox" checked={mapping.verified} onChange={(event) => setMapping({ ...mapping, verified: event.target.checked })} /><span>I verified these identifiers against our records.</span></label></div>{data.permissions.canManage ? <div className={styles.actions}><button disabled={Boolean(working)}>Save mapping</button></div> : null}</form> : <p className={styles.muted}>Add an authority and make sure your organisation has approved music tracks before mapping works.</p>}</section>

    <section className={styles.panel}><div className={styles.heading}><div><p className={styles.kicker}>ATTESTED EXPORT</p><h2>Create an authority-specific usage report</h2></div><span>Up to 366 days</span></div>{data?.permissions.canManage ? <form onSubmit={createReport}><div className={styles.formGrid}><label><span>Reporting authority</span><select value={report.authorityId} onChange={(event) => setReport({ ...report, authorityId: event.target.value })}><option value="">Choose authority</option>{data?.authorities.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.territoryCode}</option>)}</select></label><label><span>From</span><input type="date" value={report.from} onChange={(event) => setReport({ ...report, from: event.target.value })} /></label><label><span>To</span><input type="date" value={report.to} onChange={(event) => setReport({ ...report, to: event.target.value })} /></label><label className={styles.check}><input type="checkbox" checked={report.attestationAccepted} onChange={(event) => setReport({ ...report, attestationAccepted: event.target.checked })} /><span>I attest this selection represents our device-confirmed usage evidence.</span></label></div><div className={styles.actions}><button disabled={Boolean(working) || !report.authorityId || !report.attestationAccepted}>Generate sealed CSV</button>{job?.downloadUrl ? <a className={styles.primaryLink} href={job.downloadUrl}>Download {job.rowCount} rows</a> : null}</div>{job && !job.downloadUrl ? <p className={styles.muted}>Report status: {job.status}</p> : null}</form> : <p className={styles.muted}>An organisation owner or manager must attest and generate rights reports.</p>}<div className={styles.evidence}><strong>Evidence boundary</strong><span>{data?.evidenceNotice}</span></div></section>
  </div>;
}
