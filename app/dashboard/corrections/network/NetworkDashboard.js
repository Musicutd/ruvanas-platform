"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./network.module.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export default function NetworkDashboard() {
  const [data, setData] = useState(null);
  const [facilityId, setFacilityId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [distribution, setDistribution] = useState({ programmeId: "", facilityIds: [], groupId: "" });
  const [windowInput, setWindowInput] = useState({ facilityId: "", kind: "CENTRAL", weekday: 1, startMinute: 420, endMinute: 600,
    distributionId: "", mandatory: false, allowedContentTypes: ["PROGRAMME"] });
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
        {[["Facilities", `${data.totals.activeFacilities} / ${data.totals.facilities}`], ["Secure areas", data.totals.zones],
          ["Players online", data.totals.onlinePlayers], ["Players offline", data.totals.offlinePlayers],
          ["Pending review", data.totals.pendingReviews], ["Completed player deliveries · 7d", data.totals.completedDeliveriesLast7Days],
          ["Failed player deliveries · 7d", data.totals.failedDeliveriesLast7Days],
          ["Rehabilitation delivered · 7d", `${(data.rehabilitationDeliveredSecondsLast7Days / 3600).toFixed(1)} h`]]
          .map(([label, value]) => <article className={styles.metric} key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </section>
      <section className={styles.card}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Operational health</span><h2>Facility comparison</h2></div><span>Proof, not listener tracking</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Facility</th><th>Areas</th><th>Online</th><th>Offline</th><th>Approved programmes</th><th>Delivered · 7d</th><th>Failed · 7d</th></tr></thead><tbody>
          {data.facilities.map((item) => <tr key={item.id}><th scope="row">{item.name}<small>{item.status}</small></th><td>{item.zones}</td><td>{item.onlinePlayers}</td><td>{item.offlinePlayers}</td><td>{item.approvedProgrammes}</td><td>{item.completedDeliveries}</td><td>{item.failedDeliveries}</td></tr>)}
        </tbody></table></div><p className={styles.note}>{data.note}</p></section>
      <section className={styles.grid}>
        <article className={styles.card}><span className={styles.eyebrow}>Shared, version-pinned audio</span><h2>Programme distribution</h2>
          <p>A central distribution records the exact reviewed submission. It does not itself start playback or bypass facility policy.</p>
          <div className={styles.list}>{data.distributions.length ? data.distributions.map((item) => <div key={item.id} className={styles.row}><span>{item.programme.title} · revision {item.submission.revision}<small>{data.facilities.find((facility) => facility.id === item.targetFacilityId)?.name || "Other facility"} · {item.status}</small></span>
            {item.status === "ACTIVE" && data.permissions.distribute && <button type="button" disabled={busy} onClick={() => submit(`/api/corrections/network/distribution/${item.id}`, "DELETE", null, "Distribution withdrawn. Historical proof remains intact.")}>Withdraw</button>}</div>) : <p>No central distributions for this view.</p>}</div>
          {data.permissions.distribute && <form onSubmit={(event) => { event.preventDefault(); submit("/api/corrections/network/distribution", "POST", distribution, "Exact approved version distributed for planning."); }}>
            <label>Approved source programme<select required value={distribution.programmeId} onChange={(event) => setDistribution({ ...distribution, programmeId: event.target.value })}><option value="">Choose programme</option>{data.programmes.map((item) => <option key={item.id} value={item.id}>{item.title} · revision {item.latestRevision}</option>)}</select></label>
            <label>Facility group (optional)<select value={distribution.groupId} onChange={(event) => setDistribution({ ...distribution, groupId: event.target.value })}><option value="">No group</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
            <fieldset><legend>Target facilities</legend><div className={styles.checks}>{data.facilities.map((item) => <label key={item.id}><input type="checkbox" checked={distribution.facilityIds.includes(item.id)} onChange={(event) => setDistribution({ ...distribution, facilityIds: event.target.checked ? [...distribution.facilityIds, item.id] : distribution.facilityIds.filter((id) => id !== item.id) })} /> {item.name}</label>)}</div></fieldset>
            <button disabled={busy || !distribution.programmeId || (!distribution.facilityIds.length && !distribution.groupId)}>Distribute approved version</button>
          </form>}</article>
        <article className={styles.card}><span className={styles.eyebrow}>Central · local</span><h2>Weekly windows</h2><p>Mandatory central blocks cannot be replaced locally. A local block requires an approved central default covering its full time.</p>
          <div className={styles.list}>{data.windows.length ? data.windows.map((item) => <div key={item.id} className={styles.row}><span>{DAYS[item.weekday]} {clock(item.startMinute)}–{clock(item.endMinute)} · {item.kind}{item.mandatory ? " · mandatory" : ""}<small>{data.facilities.find((facility) => facility.id === item.facilityId)?.name || "Other facility"} · {item.active ? "planned" : "inactive"}</small></span>{item.active && data.permissions.programme && <button type="button" disabled={busy} onClick={() => submit(`/api/corrections/network/windows/${item.id}`, "DELETE", null, "Window deactivated. The audit record is retained.")}>Deactivate</button>}</div>) : <p>No windows for this view.</p>}</div>
          {data.permissions.programme && <form onSubmit={(event) => { event.preventDefault(); submit("/api/corrections/network/windows", "POST", windowInput, "Window saved as a governed network plan."); }}>
            <div className={styles.fields}><label>Facility<select required value={windowInput.facilityId} onChange={(event) => setWindowInput({ ...windowInput, facilityId: event.target.value })}><option value="">Choose facility</option>{data.facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Window<select value={windowInput.kind} onChange={(event) => setWindowInput({ ...windowInput, kind: event.target.value, distributionId: "", mandatory: false })}><option value="CENTRAL">Central</option><option value="LOCAL">Local</option></select></label>
              <label>Day<select value={windowInput.weekday} onChange={(event) => setWindowInput({ ...windowInput, weekday: Number(event.target.value) })}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
              <label>Start minute<input type="number" min="0" max="1439" value={windowInput.startMinute} onChange={(event) => setWindowInput({ ...windowInput, startMinute: Number(event.target.value) })} /></label>
              <label>End minute<input type="number" min="1" max="1440" value={windowInput.endMinute} onChange={(event) => setWindowInput({ ...windowInput, endMinute: Number(event.target.value) })} /></label>
              {windowInput.kind === "CENTRAL" && <label>Approved distribution<select required value={windowInput.distributionId} onChange={(event) => setWindowInput({ ...windowInput, distributionId: event.target.value })}><option value="">Choose version</option>{data.distributions.filter((item) => item.status === "ACTIVE" && item.targetFacilityId === windowInput.facilityId).map((item) => <option key={item.id} value={item.id}>{item.programme.title} · revision {item.submission.revision}</option>)}</select></label>}
            </div>{windowInput.kind === "CENTRAL" && <label className={styles.check}><input type="checkbox" checked={windowInput.mandatory} onChange={(event) => setWindowInput({ ...windowInput, mandatory: event.target.checked })} /> Mandatory central block</label>}
            <button disabled={busy || !windowInput.facilityId}>Save planned window</button>
          </form>}</article>
      </section>
      <section className={styles.card}><span className={styles.eyebrow}>Last seven days</span><h2>Network activity</h2><div className={styles.activity}><span>{data.totals.requestsLast7Days} moderated requests received</span><span>{data.totals.announcementsLast7Days} announcements prepared</span><span>{data.totals.approvedRehabilitationItems} approved rehabilitation items</span><span>{data.overrideHistory.length} recent facility overrides</span></div><p className={styles.note}>Facility Emergency and Priority controls remain in their own guarded workspace. There is no network-wide Emergency action here.</p></section>
    </>}
  </main>;
}
