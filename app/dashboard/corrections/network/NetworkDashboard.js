"use client";

import { useCallback, useEffect, useState } from "react";
import { CORRECTIONS_NETWORK_REPORT_SOURCES, CORRECTIONS_NETWORK_REPORT_KINDS, correctionsNetworkReportClassification } from "@/lib/corrections-network-report.mjs";
import styles from "./network.module.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export default function NetworkDashboard() {
  const [data, setData] = useState(null);
  const [facilityId, setFacilityId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [distribution, setDistribution] = useState({ programmeId: "", facilityIds: [], groupId: "", allFacilities: false });
  const [audioDistribution, setAudioDistribution] = useState({ kind: "REHABILITATION", contentId: "",
    facilityIds: [], groupId: "", allFacilities: false, territoryCode: "", rightsConfirmed: false });
  const [windowInput, setWindowInput] = useState({ facilityId: "", kind: "CENTRAL", weekday: 1, startMinute: 420, endMinute: 600,
    distributionId: "", audioDistributionId: "", mandatory: false, allowedContentTypes: ["PROGRAMME"] });
  const [reportInput, setReportInput] = useState({ from: "", to: "", facilityId: "", groupId: "", classification: "", kind: "", programmeId: "", rehabilitationId: "", announcementId: "", source: "", status: "" });
  const refresh = useCallback(async () => {
    const url = facilityId ? `/api/corrections/network?facilityId=${encodeURIComponent(facilityId)}` : "/api/corrections/network";
    try {
      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error || "Network view is unavailable."); return; }
      setData(result);
    } catch { setNotice("Could not load the network view. Please retry."); }
  }, [facilityId]);
  useEffect(() => { refresh(); }, [refresh]);
  const submit = async (url, method, body, success) => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      setNotice(result.error || (response.ok ? success : "The change could not be saved."));
      if (response.ok) await refresh();
    } catch { setNotice("The connection failed. Please retry."); }
    finally { setBusy(false); }
  };
  return <main className={styles.page}>
    <header className={styles.hero}><span className={styles.eyebrow}>Ruvanas Inside · Tier 4/5</span><h1>One authority, clear control at each facility</h1>
      <p>See private delivery evidence and prepare centrally approved programmes without widening a facility’s local access.</p>
      <a href="/dashboard/corrections">← Facility controls</a></header>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!data ? <p>Loading network operations…</p> : <>
      <label className={styles.switcher}>View facilities <select value={facilityId} onChange={(event) => setFacilityId(event.target.value)}>
        <option value="">All facilities</option>{data.facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <section className={styles.metrics} aria-label="Network operations summary">
        {[["Facilities", `${data.totals.activeFacilities} / ${data.totals.facilities}`], ["Degraded facilities", data.totals.degradedFacilities], ["Secure areas", data.totals.zones],
          ["Players online", data.totals.onlinePlayers], ["Players offline", data.totals.offlinePlayers],
          ["Pending review", data.totals.pendingReviews], ["Completed player deliveries · 7d", data.totals.completedDeliveriesLast7Days],
          ["Failed player deliveries · 7d", data.totals.failedDeliveriesLast7Days],
          ["Supervised Studio sessions · 7d", data.facilities.reduce((sum, item) => sum + (item.studioProductions || 0), 0)],
          ["Rehabilitation delivered · 7d", `${(data.rehabilitationDeliveredSecondsLast7Days / 3600).toFixed(1)} h`],
          ["Central programme plays · 7d", data.deliveryMetricsLast7Days.centralProgramme],
          ["Local programme plays · 7d", data.deliveryMetricsLast7Days.localProgramme],
          ["Central audio delivered · 7d", `${(data.deliveryMetricsLast7Days.centralDeliveredSeconds / 3600).toFixed(1)} h`],
          ["Local audio delivered · 7d", `${(data.deliveryMetricsLast7Days.localDeliveredSeconds / 3600).toFixed(1)} h`],
          ["Central rehabilitation plays · 7d", data.deliveryMetricsLast7Days.centralRehabilitation],
          ["Local rehabilitation plays · 7d", data.deliveryMetricsLast7Days.localRehabilitation],
          ["Central announcement plays · 7d", data.deliveryMetricsLast7Days.centralAnnouncement],
          ["Request deliveries · 7d", data.deliveryMetricsLast7Days.request]]
          .map(([label, value]) => <article className={styles.metric} key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </section>
      <section className={styles.card}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Operational health</span><h2>Facility comparison</h2></div><span>Proof, not listener tracking</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Facility</th><th>Areas</th><th>Online</th><th>Offline</th><th>Approved programmes</th><th>Studio · 7d</th><th>Delivered · 7d</th><th>Failed · 7d</th></tr></thead><tbody>
          {data.facilities.map((item) => <tr key={item.id}><th scope="row">{item.name}<small>{item.status}</small></th><td>{item.zones}</td><td>{item.onlinePlayers}</td><td>{item.offlinePlayers}</td><td>{item.approvedProgrammes}</td><td>{item.studioProductions || 0}</td><td>{item.completedDeliveries}</td><td>{item.failedDeliveries}</td></tr>)}
        </tbody></table></div><p className={styles.note}>{data.note}</p></section>
      <section className={styles.grid}>
        <article className={styles.card}><span className={styles.eyebrow}>Shared, version-pinned audio</span><h2>Programme distribution</h2>
          <p>Each distribution records the exact reviewed submission. A facility-origin programme can be selected for that facility’s local window after central approval.</p>
          <div className={styles.list}>{data.distributions.length ? data.distributions.map((item) => <div key={item.id} className={styles.row}><span>{item.programme.title} · revision {item.submission.revision}<small>{data.facilities.find((facility) => facility.id === item.targetFacilityId)?.name || "Other facility"} · {item.versionState === "NEW_VERSION_AVAILABLE" ? "New revision available; pinned revision remains active" : item.versionState === "WITHDRAWN" ? "Withdrawn" : "Current"}</small></span>
            {item.status === "ACTIVE" && data.permissions.distribute && <button type="button" disabled={busy} onClick={() => submit(`/api/corrections/network/distribution/${item.id}`, "DELETE", null, "Distribution withdrawn. Historical proof remains intact.")}>Withdraw</button>}</div>) : <p>No central distributions for this view.</p>}</div>
          {data.permissions.distribute && <form onSubmit={(event) => { event.preventDefault(); submit("/api/corrections/network/distribution", "POST", distribution, "Exact approved version distributed for planning."); }}>
            <label>Approved source programme<select required value={distribution.programmeId} onChange={(event) => setDistribution({ ...distribution, programmeId: event.target.value })}><option value="">Choose programme</option>{data.programmes.map((item) => <option key={item.id} value={item.id}>{item.title} · revision {item.latestRevision}</option>)}</select></label>
            <label className={styles.check}><input type="checkbox" checked={distribution.allFacilities} onChange={(event) => setDistribution({ ...distribution, allFacilities: event.target.checked, facilityIds: [], groupId: "" })} /> All active policy-ready facilities</label>
            {!distribution.allFacilities && <><label>Facility group (optional)<select value={distribution.groupId} onChange={(event) => setDistribution({ ...distribution, groupId: event.target.value })}><option value="">No group</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <fieldset><legend>Target facilities</legend><div className={styles.checks}>{data.facilities.map((item) => <label key={item.id}><input type="checkbox" checked={distribution.facilityIds.includes(item.id)} onChange={(event) => setDistribution({ ...distribution, facilityIds: event.target.checked ? [...distribution.facilityIds, item.id] : distribution.facilityIds.filter((id) => id !== item.id) })} /> {item.name}</label>)}</div></fieldset></>}
            <button disabled={busy || !distribution.programmeId || (!distribution.allFacilities && !distribution.facilityIds.length && !distribution.groupId)}>Distribute approved version</button>
          </form>}</article>
        <article className={styles.card}><span className={styles.eyebrow}>Staff-approved private audio</span><h2>Rehabilitation & standard announcements</h2>
          <p>Distribute one exact approved version. This schedules ordinary information, never a Priority or Emergency override.</p>
          <div className={styles.list}>{data.audioDistributions?.length ? data.audioDistributions.map((item) => <div key={item.id} className={styles.row}>
            <span>{item.title} · {item.kind.toLowerCase()}<small>{data.facilities.find((facility) => facility.id === item.targetFacilityId)?.name || "Other facility"} · {item.versionState.replaceAll("_", " ").toLowerCase()}</small></span>
            {item.status === "ACTIVE" && data.permissions.distribute && <button type="button" disabled={busy} onClick={() => submit(`/api/corrections/network/audio-distribution/${item.id}`, "DELETE", null, "Audio distribution withdrawn. Historical proof remains intact.")}>Withdraw</button>}
          </div>) : <p>No rehabilitation or standard announcement distributions yet.</p>}</div>
          {data.permissions.distribute && <form onSubmit={(event) => { event.preventDefault(); submit("/api/corrections/network/audio-distribution", "POST", audioDistribution, "Exact approved audio distributed for planning."); }}>
            <label>Content type<select value={audioDistribution.kind} onChange={(event) => setAudioDistribution({ ...audioDistribution, kind: event.target.value, contentId: "" })}><option value="REHABILITATION">Rehabilitation</option><option value="ANNOUNCEMENT">Standard announcement</option></select></label>
            <label>Approved audio<select required value={audioDistribution.contentId} onChange={(event) => setAudioDistribution({ ...audioDistribution, contentId: event.target.value })}><option value="">Choose approved audio</option>{(audioDistribution.kind === "REHABILITATION" ? data.reportOptions.rehabilitation : data.reportOptions.announcements).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label>Rights territory for authority-wide rehabilitation (two-letter country code)<input maxLength={2} value={audioDistribution.territoryCode} onChange={(event) => setAudioDistribution({ ...audioDistribution, territoryCode: event.target.value.toUpperCase() })} placeholder="MT" /></label>
            <label className={styles.check}><input type="checkbox" checked={audioDistribution.rightsConfirmed} onChange={(event) => setAudioDistribution({ ...audioDistribution, rightsConfirmed: event.target.checked })} /> I confirm Ruvanas may privately deliver this audio in the selected territory.</label>
            <label className={styles.check}><input type="checkbox" checked={audioDistribution.allFacilities} onChange={(event) => setAudioDistribution({ ...audioDistribution, allFacilities: event.target.checked, facilityIds: [], groupId: "" })} /> All active policy-ready facilities in that territory</label>
            {!audioDistribution.allFacilities && <><label>Facility group (optional)<select value={audioDistribution.groupId} onChange={(event) => setAudioDistribution({ ...audioDistribution, groupId: event.target.value })}><option value="">No group</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <fieldset><legend>Target facilities</legend><div className={styles.checks}>{data.facilities.map((item) => <label key={item.id}><input type="checkbox" checked={audioDistribution.facilityIds.includes(item.id)} onChange={(event) => setAudioDistribution({ ...audioDistribution, facilityIds: event.target.checked ? [...audioDistribution.facilityIds, item.id] : audioDistribution.facilityIds.filter((id) => id !== item.id) })} /> {item.name}</label>)}</div></fieldset></>}
            <button disabled={busy || !audioDistribution.contentId || !audioDistribution.rightsConfirmed || (!audioDistribution.allFacilities && !audioDistribution.facilityIds.length && !audioDistribution.groupId)}>Distribute approved audio</button>
          </form>}</article>
        <article className={styles.card}><span className={styles.eyebrow}>Central · local</span><h2>Weekly windows</h2><p>Mandatory central blocks cannot be replaced locally. Every window needs an exact approved audio version; a local block also needs a central default covering its full time.</p>
          <div className={styles.list}>{data.windows.length ? data.windows.map((item) => <div key={item.id} className={styles.row}><span>{DAYS[item.weekday]} {clock(item.startMinute)}–{clock(item.endMinute)} · {item.kind}{item.mandatory ? " · mandatory" : ""}<small>{data.facilities.find((facility) => facility.id === item.facilityId)?.name || "Other facility"} · {item.active ? "planned" : "inactive"}</small></span>{item.active && data.permissions.programme && <button type="button" disabled={busy} onClick={() => submit(`/api/corrections/network/windows/${item.id}`, "DELETE", null, "Window deactivated. The audit record is retained.")}>Deactivate</button>}</div>) : <p>No windows for this view.</p>}</div>
          {data.permissions.programme && <form onSubmit={(event) => { event.preventDefault(); submit("/api/corrections/network/windows", "POST", windowInput, "Window saved as a governed network plan."); }}>
            <div className={styles.fields}><label>Facility<select required value={windowInput.facilityId} onChange={(event) => setWindowInput({ ...windowInput, facilityId: event.target.value })}><option value="">Choose facility</option>{data.facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Window<select value={windowInput.kind} onChange={(event) => setWindowInput({ ...windowInput, kind: event.target.value, distributionId: "", audioDistributionId: "", mandatory: false })}><option value="CENTRAL">Central</option><option value="LOCAL">Local</option></select></label>
              <label>Day<select value={windowInput.weekday} onChange={(event) => setWindowInput({ ...windowInput, weekday: Number(event.target.value) })}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
              <label>Start minute<input type="number" min="0" max="1439" value={windowInput.startMinute} onChange={(event) => setWindowInput({ ...windowInput, startMinute: Number(event.target.value) })} /></label>
              <label>End minute<input type="number" min="1" max="1440" value={windowInput.endMinute} onChange={(event) => setWindowInput({ ...windowInput, endMinute: Number(event.target.value) })} /></label>
              <label>Approved audio version<select required value={windowInput.distributionId ? `programme:${windowInput.distributionId}` : windowInput.audioDistributionId ? `audio:${windowInput.audioDistributionId}` : ""} onChange={(event) => {
                const [type, id] = event.target.value.split(":");
                const selected = data.audioDistributions?.find((item) => item.id === id);
                setWindowInput({ ...windowInput, distributionId: type === "programme" ? id : "",
                  audioDistributionId: type === "audio" ? id : "",
                  allowedContentTypes: [type === "audio" ? selected.kind : "PROGRAMME"] });
              }}><option value="">Choose version</option>
                <optgroup label="Programmes">{data.distributions.filter((item) => item.status === "ACTIVE" && item.targetFacilityId === windowInput.facilityId && (windowInput.kind === "CENTRAL" || item.sourceFacilityId === windowInput.facilityId)).map((item) => <option key={item.id} value={`programme:${item.id}`}>{item.programme.title} · revision {item.submission.revision}</option>)}</optgroup>
                {windowInput.kind === "CENTRAL" && <optgroup label="Rehabilitation & standard announcements">{data.audioDistributions?.filter((item) => item.status === "ACTIVE" && item.versionState !== "SUPERSEDED" && item.targetFacilityId === windowInput.facilityId).map((item) => <option key={item.id} value={`audio:${item.id}`}>{item.title} · {item.kind.toLowerCase()}</option>)}</optgroup>}
              </select></label>
            </div>{windowInput.kind === "CENTRAL" && <label className={styles.check}><input type="checkbox" checked={windowInput.mandatory} onChange={(event) => setWindowInput({ ...windowInput, mandatory: event.target.checked })} /> Mandatory central block</label>}
            <button disabled={busy || !windowInput.facilityId || (!windowInput.distributionId && !windowInput.audioDistributionId)}>Save planned window</button>
          </form>}</article>
      </section>
      {data.permissions.report && <section className={styles.card}><span className={styles.eyebrow}>Verified network evidence</span><h2>Download delivery proof</h2>
        <p>Each row links to an actual private player proof and exact playout intent. No contributor or family-request text is exported.</p>
        <div className={styles.fields}>
          <label>From (optional)<input type="date" value={reportInput.from} onChange={(event) => setReportInput({ ...reportInput, from: event.target.value })} /></label>
          <label>To (optional)<input type="date" value={reportInput.to} onChange={(event) => setReportInput({ ...reportInput, to: event.target.value })} /></label>
          <label>Facility<select value={reportInput.facilityId} onChange={(event) => setReportInput({ ...reportInput, facilityId: event.target.value, groupId: "" })}><option value="">All facilities</option>{data.facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Group<select value={reportInput.groupId} onChange={(event) => setReportInput({ ...reportInput, groupId: event.target.value, facilityId: "" })}><option value="">No group filter</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label>Central or local<select value={reportInput.classification} onChange={(event) => setReportInput({ ...reportInput, classification: event.target.value, source: "" })}><option value="">All</option><option value="CENTRAL">Central</option><option value="LOCAL">Local</option><option value="FACILITY">Other facility delivery</option></select></label>
          <label>Content type<select value={reportInput.kind} onChange={(event) => setReportInput({ ...reportInput, kind: event.target.value, source: "", programmeId: "", rehabilitationId: "", announcementId: "" })}><option value="">All</option><option value="PROGRAMME">Programme</option><option value="REHABILITATION">Rehabilitation</option><option value="ANNOUNCEMENT">Announcement</option><option value="REQUEST">Request delivery</option></select></label>
          <label>Source<select value={reportInput.source} onChange={(event) => setReportInput({ ...reportInput, source: event.target.value })}><option value="">All matching sources</option>{CORRECTIONS_NETWORK_REPORT_SOURCES.filter((source) => (!reportInput.kind || CORRECTIONS_NETWORK_REPORT_KINDS[reportInput.kind].includes(source)) && (!reportInput.classification || correctionsNetworkReportClassification(source) === reportInput.classification)).map((source) => <option key={source} value={source}>{source.replaceAll("_", " ")}</option>)}</select></label>
          {reportInput.kind === "PROGRAMME" && <label>Programme<select value={reportInput.programmeId} onChange={(event) => setReportInput({ ...reportInput, programmeId: event.target.value })}><option value="">All programmes</option>{data.reportOptions.programmes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          {reportInput.kind === "REHABILITATION" && <label>Rehabilitation audio<select value={reportInput.rehabilitationId} onChange={(event) => setReportInput({ ...reportInput, rehabilitationId: event.target.value })}><option value="">All rehabilitation</option>{data.reportOptions.rehabilitation.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          {reportInput.kind === "ANNOUNCEMENT" && <label>Announcement<select value={reportInput.announcementId} onChange={(event) => setReportInput({ ...reportInput, announcementId: event.target.value })}><option value="">All announcements</option>{data.reportOptions.announcements.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          <label>Delivery status<select value={reportInput.status} onChange={(event) => setReportInput({ ...reportInput, status: event.target.value })}><option value="">All statuses</option>{["STARTED", "COMPLETED", "FAILED", "INTERRUPTED"].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
        </div>
        <a href={`/api/corrections/network/report/export?${new URLSearchParams(Object.entries(reportInput).filter(([, value]) => value)).toString()}`}>Download CSV →</a>
      </section>}
      <section className={styles.card}><span className={styles.eyebrow}>Player proof · 7 days</span><h2>Delivery by source</h2>
        <div className={styles.activity}>{data.deliveryBySource?.length ? data.deliveryBySource.map((item) => <span key={`${item.source}:${item.status}`}>{item.source.replaceAll("_", " ")} · {item.status.toLowerCase()} · {item.playerEvents} player events</span>) : <span>No verified private player events yet.</span>}</div>
        <p className={styles.note}>A completed player event confirms device delivery, not individual listening or a rehabilitation outcome.</p>
      </section>
      <section className={styles.card}><span className={styles.eyebrow}>Last seven days</span><h2>Network activity</h2><div className={styles.activity}><span>{data.totals.requestsLast7Days} moderated requests received</span><span>{data.totals.announcementsLast7Days} announcements prepared</span><span>{data.totals.approvedRehabilitationItems} approved rehabilitation items</span><span>{data.overrideHistory.length} recent facility overrides</span></div><p className={styles.note}>Facility Emergency and Priority controls remain in their own guarded workspace. There is no network-wide Emergency action here.</p></section>
    </>}
  </main>;
}
