"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./advertising.module.css";

const defaults = {
  stationId: "", channelId: "", pacingMode: "EVEN", maxSpotsPerBreak: 4,
  maxBreakSeconds: 180, minBreakGapMinutes: 10, maxAdvertisingSecondsPerHour: 720
};

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default function RadioAdvertisingWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(defaults);
  const [working, setWorking] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/radio-advertising", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load radio advertising.");
      setData(payload);
      setForm((current) => current.stationId ? current : { ...current, stationId: payload.stations[0]?.id || "", channelId: payload.stations[0]?.channels[0]?.id || "" });
    } catch (loadError) { setError(loadError.message); } finally { setWorking(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const station = useMemo(() => data?.stations.find((item) => item.id === form.stationId), [data, form.stationId]);
  const selectedPolicy = useMemo(() => data?.policies.find((item) => item.channelId === form.channelId), [data, form.channelId]);

  useEffect(() => {
    if (!selectedPolicy) return;
    setForm((current) => ({
      ...current,
      stationId: selectedPolicy.stationId,
      channelId: selectedPolicy.channelId,
      pacingMode: selectedPolicy.pacingMode,
      maxSpotsPerBreak: selectedPolicy.maxSpotsPerBreak,
      maxBreakSeconds: selectedPolicy.maxBreakSeconds,
      minBreakGapMinutes: selectedPolicy.minBreakGapMinutes,
      maxAdvertisingSecondsPerHour: selectedPolicy.maxAdvertisingSecondsPerHour
    }));
  }, [selectedPolicy]);

  async function act(body, success) {
    setWorking(body.action); setError(""); setNotice("");
    try {
      const response = await fetch("/api/radio-advertising", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The advertising action could not be completed.");
      setNotice(success); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(""); }
  }

  function changeStation(stationId) {
    const nextStation = data.stations.find((item) => item.id === stationId);
    setForm({ ...defaults, stationId, channelId: nextStation?.channels[0]?.id || "" });
  }

  function changeChannel(channelId) {
    const policy = data.policies.find((item) => item.channelId === channelId);
    setForm(policy ? {
      stationId: policy.stationId,
      channelId: policy.channelId,
      pacingMode: policy.pacingMode,
      maxSpotsPerBreak: policy.maxSpotsPerBreak,
      maxBreakSeconds: policy.maxBreakSeconds,
      minBreakGapMinutes: policy.minBreakGapMinutes,
      maxAdvertisingSecondsPerHour: policy.maxAdvertisingSecondsPerHour
    } : { ...defaults, stationId: form.stationId, channelId });
  }

  const summary = data?.summary || {};
  return <div className={styles.workspace}>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    <section className={styles.metrics} aria-label="Radio advertising summary">
      <div><strong>{summary.activePolicies || 0}</strong><span>active channel policies</span></div>
      <div><strong>{summary.publishedCampaigns || 0}</strong><span>published radio campaigns</span></div>
      <div><strong>{summary.readyPlacements || 0}</strong><span>placements ready</span></div>
      <div><strong>{summary.completedPlays || 0}</strong><span>completed plays recorded</span></div>
    </section>

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>CHANNEL POLICY</p><h2>Control advertising breaks</h2></div><span>{selectedPolicy?.status || "NOT SET"}</span></div>
      {!data?.stations.length ? <div className={styles.empty}><p>Create and activate an Online Radio station and channel before configuring advertising.</p><a className={styles.primaryLink} href="/stations/new">Create station</a></div> : <form onSubmit={(event) => { event.preventDefault(); act({ action: "SAVE_POLICY", ...form }, "Advertising limits saved as a draft. Activate the policy when you are ready for delivery."); }}>
        <div className={styles.formGrid}>
          <label><span>Station</span><select value={form.stationId} onChange={(event) => changeStation(event.target.value)}>{data.stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Channel</span><select value={form.channelId} onChange={(event) => changeChannel(event.target.value)}>{(station?.channels || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Pacing</span><select value={form.pacingMode} onChange={(event) => setForm({ ...form, pacingMode: event.target.value })}><option value="EVEN">Evenly paced</option><option value="PRIORITY">Priority first</option></select></label>
          <label><span>Maximum spots per break</span><input type="number" min="1" max="12" value={form.maxSpotsPerBreak} onChange={(event) => setForm({ ...form, maxSpotsPerBreak: event.target.value })} /></label>
          <label><span>Maximum break length (seconds)</span><input type="number" min="15" max="600" value={form.maxBreakSeconds} onChange={(event) => setForm({ ...form, maxBreakSeconds: event.target.value })} /></label>
          <label><span>Minimum gap between breaks (minutes)</span><input type="number" min="1" max="180" value={form.minBreakGapMinutes} onChange={(event) => setForm({ ...form, minBreakGapMinutes: event.target.value })} /></label>
          <label><span>Maximum advertising per hour (seconds)</span><input type="number" min="30" max="1800" value={form.maxAdvertisingSecondsPerHour} onChange={(event) => setForm({ ...form, maxAdvertisingSecondsPerHour: event.target.value })} /></label>
        </div>
        {data.permissions.canManage ? <div className={styles.actions}><button disabled={Boolean(working) || !form.channelId}>Save draft</button>{selectedPolicy?.status === "DRAFT" || selectedPolicy?.status === "PAUSED" ? <button type="button" className={styles.primary} disabled={Boolean(working)} onClick={() => act({ action: "ACTIVATE_POLICY", policyId: selectedPolicy.id }, "Advertising policy activated for this channel.")}>Activate</button> : null}{selectedPolicy?.status === "ACTIVE" ? <button type="button" className={styles.danger} disabled={Boolean(working)} onClick={() => act({ action: "PAUSE_POLICY", policyId: selectedPolicy.id }, "Advertising paused. Commercial spots are now blocked on this channel.")}>Pause delivery</button> : null}</div> : <p className={styles.muted}>An organisation owner or manager controls these limits.</p>}
      </form>}
      {selectedPolicy ? <p className={styles.policyMeta}>Revision {selectedPolicy.revision} · {selectedPolicy.approvedAt ? `approved ${formatDate(selectedPolicy.approvedAt)}` : "waiting for approval"}</p> : null}
    </section>

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>BOOKINGS</p><h2>Commercial placement readiness</h2></div><span>{data?.placements.length || 0} linked orders</span></div>
      <div className={styles.cards}>{data?.placements.length ? data.placements.map((placement) => <article className={styles.card} key={placement.id}>
        <div className={styles.cardHead}><div><b>{placement.advertiser.name}</b><h3>{placement.name}</h3><p>{placement.inventoryPackage.name}{placement.campaign ? ` · ${placement.campaign.name}` : " · no campaign linked"} · {placement.channelCount} channel{placement.channelCount === 1 ? "" : "s"}</p></div><span className={placement.readiness.ready ? styles.ready : styles.blocked}>{placement.readiness.ready ? "READY" : "CHECK"}</span></div>
        <div className={styles.volume}><span><strong>{placement.readiness.estimatedPlays}</strong> scheduled</span><span><strong>{placement.deliveredPlays}</strong> completed</span><span><strong>{placement.readiness.availablePlays}</strong> inventory available</span></div>
        {placement.readiness.blockers.length ? <ul>{placement.readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className={styles.good}>Approvals, targeting, dates and available volume are ready.</p>}
      </article>) : <div className={styles.empty}><p>No station or channel advertising orders are linked yet.</p><a className={styles.primaryLink} href="/dashboard/retail-media">Open Retail Media</a></div>}</div>
    </section>

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>INVENTORY & CAMPAIGNS</p><h2>Radio commercial catalogue</h2></div></div>
      <div className={styles.split}><div><h3>Inventory</h3>{data?.inventory.length ? data.inventory.map((item) => <p key={item.id}><strong>{item.name}</strong><span>{item.status} · {item.maxPlays} plays · {item.orderCount} orders</span></p>) : <p className={styles.muted}>No radio inventory packages.</p>}</div><div><h3>Campaigns</h3>{data?.campaigns.length ? data.campaigns.map((item) => <p key={item.id}><strong>{item.name}</strong><span>{item.status} · about {item.estimatedPlays} plays</span></p>) : <p className={styles.muted}>No radio-targeted campaigns.</p>}</div></div>
      <div className={styles.evidence}><strong>Evidence boundary</strong><span>{data?.evidenceNotice}</span></div>
    </section>
  </div>;
}
