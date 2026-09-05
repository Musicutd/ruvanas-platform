"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./programming.module.css";

const EMPTY = { channelId: "", primarySourceId: "", backupSourceId: "", enabled: true, failureThreshold: 2, recoveryThreshold: 3, recoveryHoldSeconds: 60 };
const labelForState = (state) => ({ PRIMARY: "Primary on air", BACKUP: "Backup on air", SCHEDULED_FALLBACK: "Schedule / AutoDJ", RECOVERY_PENDING: "Recovery check", MANUAL_OVERRIDE: "Manual override" }[state] || state);

export default function LiveFailoverWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/live-failover", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load live failover.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const channels = useMemo(() => {
    const unique = new Map();
    for (const source of data?.sources || []) if (source.channel?.id) unique.set(source.channel.id, source.channel.name);
    return [...unique.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);
  const channelSources = (data?.sources || []).filter((source) => source.channel?.id === form.channelId && ["READY", "ACTIVE"].includes(source.status));

  async function submit(body, success) {
    setBusy("save"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/live-failover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to change live failover.");
      setNotice(success); await load();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function save(event) {
    event.preventDefault();
    await submit(form, "Live failover is configured. Ruvanas will retain transition evidence and recover the primary only after it is stable.");
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading live failover…</div></section>;
  const policies = data?.policies || [];
  return <section className={styles.panel} aria-labelledby="live-failover-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>LIVE FAILOVER</p><h2 id="live-failover-title">Keep the channel on air</h2></div><span className={styles.count}>{policies.filter((policy) => policy.enabled).length} protected</span></div>
    <p className={styles.panelIntro}>Choose a primary and backup live source. Health checks switch safely to the backup—or to scheduled programming and AutoDJ—and wait for stable recovery before returning.</p>
    <div className={styles.safetyBanner}><strong>No rapid source switching</strong><span>Failure confirmation, recovery probes and a recovery hold prevent unstable sources from repeatedly moving listeners. Every meaningful transition is retained as operational evidence.</span></div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {policies.length ? <div className={styles.failoverGrid}>{policies.map((policy) => <article className={styles.failoverCard} key={policy.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{policy.channel.station?.name ? `${policy.channel.station.name} / ` : ""}{policy.channel.name}</strong><span>{policy.primarySource?.name || "No primary"} → {policy.backupSource?.name || "schedule / AutoDJ"}</span></div><span className={policy.state === "PRIMARY" ? styles.publishedBadge : styles.healthWarning}>{labelForState(policy.state)}</span></div>
      <div className={styles.liveSourceMeta}><span>Now: {policy.effectiveSource?.name || "shared programming"}</span><span>{policy.failureThreshold} failed checks to switch</span><span>{policy.recoveryThreshold} healthy checks to recover</span><span>{policy.recoveryHoldSeconds}s hold</span></div>
      <p>{policy.lastTransitionAt ? `Last decision ${new Date(policy.lastTransitionAt).toLocaleString()} · ${String(policy.lastTransitionReason || "").replaceAll("_", " ").toLowerCase()}` : "No transition recorded yet."}</p>
      {policy.manualOverrideUntil ? <small>Manual override ends {new Date(policy.manualOverrideUntil).toLocaleString()}</small> : null}
      {data.canManage ? <div className={styles.cardActions}>
        {policy.enabled ? <button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => submit({ action: "DISABLE", policyId: policy.id }, "Automatic failover disabled; the normal External Live source remains available.")}>Disable</button> : null}
        {policy.enabled && policy.backupSource ? <button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => submit({ action: "OVERRIDE", policyId: policy.id, sourceId: policy.backupSource.id, durationMinutes: 30 }, "Backup selected manually for 30 minutes.")}>Use backup for 30 min</button> : null}
        {policy.manualOverrideUntil ? <button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => submit({ action: "CLEAR_OVERRIDE", policyId: policy.id }, "Manual override cleared; automatic health decisions resumed.")}>Resume automatic</button> : null}
      </div> : null}
      {policy.events?.length ? <details className={styles.failoverEvidence}><summary>Recent transition evidence</summary>{policy.events.slice(0, 6).map((event) => <div key={event.id}><strong>{String(event.kind).replaceAll("_", " ")}</strong><span>{new Date(event.observedAt).toLocaleString()} · {String(event.reason).replaceAll("_", " ").toLowerCase()}</span></div>)}</details> : null}
    </article>)}</div> : <div className={styles.emptyState}>No live failover policy yet. Prepare and test at least one External Live source, then protect its channel below.</div>}
    {data?.canManage ? <form className={styles.schedulerForm} onSubmit={save}>
      <div className={styles.smartFormHeader}><div><h3>Configure channel protection</h3><p>Only ready, recently healthy sources can be enabled. Saving never exposes source credentials.</p></div></div>
      <div className={styles.formGrid}>
        <label><span>Channel</span><select required value={form.channelId} onChange={(event) => setForm({ ...form, channelId: event.target.value, primarySourceId: "", backupSourceId: "" })}><option value="">Choose channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        <label><span>Primary live source</span><select required value={form.primarySourceId} onChange={(event) => setForm({ ...form, primarySourceId: event.target.value })}><option value="">Choose tested source</option>{channelSources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.healthStatus}</option>)}</select></label>
        <label><span>Backup live source <small>(optional)</small></span><select value={form.backupSourceId} onChange={(event) => setForm({ ...form, backupSourceId: event.target.value })}><option value="">Use schedule / AutoDJ</option>{channelSources.filter((source) => source.id !== form.primarySourceId).map((source) => <option key={source.id} value={source.id}>{source.name} · {source.healthStatus}</option>)}</select></label>
        <label><span>Failed checks before backup</span><select value={form.failureThreshold} onChange={(event) => setForm({ ...form, failureThreshold: Number(event.target.value) })}><option value="1">1 check</option><option value="2">2 checks</option><option value="3">3 checks</option></select></label>
        <label><span>Healthy checks before recovery</span><select value={form.recoveryThreshold} onChange={(event) => setForm({ ...form, recoveryThreshold: Number(event.target.value) })}><option value="2">2 checks</option><option value="3">3 checks</option><option value="4">4 checks</option></select></label>
        <label><span>Recovery hold</span><select value={form.recoveryHoldSeconds} onChange={(event) => setForm({ ...form, recoveryHoldSeconds: Number(event.target.value) })}><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option></select></label>
      </div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>Health-gated · evidence retained · unified fallback</span><button className={styles.primaryButton} disabled={busy !== ""}>{busy ? "Saving…" : "Enable live failover"}</button></div>
    </form> : <div className={styles.readOnlyMessage}>You can review failover health and evidence. An organisation owner or manager controls the policy.</div>}
  </section>;
}
