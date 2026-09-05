"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./programming.module.css";

const EMPTY = { name: "", channelId: "", providerKey: "GENERIC_HTTP", streamUrl: "", credentialType: "NONE", credentialUsername: "", credentialSecret: "", startsAt: "", endsAt: "" };
const iso = (value) => value ? new Date(value).toISOString() : null;
const healthClass = (status) => status === "HEALTHY" ? styles.publishedBadge : status === "UNKNOWN" ? styles.draftBadge : styles.healthWarning;

export default function ExternalLiveWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/external-live", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load External Live.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(event) {
    event.preventDefault(); setBusy("create"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/programming/external-live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, startsAt: iso(form.startsAt), endsAt: iso(form.endsAt) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save this source.");
      setForm(EMPTY); setNotice("Source saved securely. Test the connection before taking it live."); await load();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function act(source, action) {
    setBusy(`${action}:${source.id}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/programming/external-live/${source.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Unable to ${action.toLowerCase()} this source.`);
      setNotice(action === "PROBE" ? `Connection test ${payload.probe.status.toLowerCase()}.` : action === "ACTIVATE" ? `${source.name} is now the authoritative live source for ${source.channel.name}.` : `${source.name} has been ${action === "ARCHIVE" ? "archived" : "taken off air"}.`);
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setBusy(""); }
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading External Live…</div></section>;
  const sources = data?.sources || [];
  return <section className={styles.panel} aria-labelledby="external-live-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>EXTERNAL LIVE</p><h2 id="external-live-title">Bring a live source on air safely</h2></div><span className={styles.count}>{sources.filter((source) => source.status === "ACTIVE").length} live</span></div>
    <p className={styles.panelIntro}>Connect an Icecast, SHOUTcast or standards-based HTTP audio source to a channel. Ruvanas tests it, protects its credentials and sends it through the same playout priority and listener controls as scheduled radio.</p>
    <div className={styles.safetyBanner}><strong>Protected by design</strong><span>Credentials are encrypted and are never shown in the player manifest. An unhealthy or expired source fails safely to the next approved programming source.</span></div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {sources.length ? <div className={styles.externalLiveGrid}>{sources.map((source) => <article className={source.status === "ACTIVE" ? styles.externalLiveActive : styles.externalLiveCard} key={source.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{source.name}</strong><span>{source.channel.name} · {source.endpointHost}</span></div><span className={source.status === "ACTIVE" ? styles.liveSourceBadge : styles.draftBadge}>{source.status}</span></div>
      <div className={styles.liveSourceMeta}><span className={healthClass(source.healthStatus)}>{source.healthStatus}</span><span>{source.providerKey.replaceAll("_", " ")}</span><span>{source.credentialType === "NONE" ? "Public endpoint" : `${source.credentialType} credential protected`}</span></div>
      <p>{source.lastHealthCheckedAt ? `Last checked ${new Date(source.lastHealthCheckedAt).toLocaleString()}${source.lastLatencyMs !== null ? ` · ${source.lastLatencyMs} ms` : ""}` : "Connection not tested yet."}</p>
      {(source.startsAt || source.endsAt) ? <small>Window: {source.startsAt ? new Date(source.startsAt).toLocaleString() : "now"} → {source.endsAt ? new Date(source.endsAt).toLocaleString() : "open ended"}</small> : <small>Open-ended controlled live window</small>}
      {source.canControl ? <div className={styles.cardActions}><button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => act(source, "PROBE")}>Test connection</button>{source.status !== "ACTIVE" && source.healthStatus === "HEALTHY" ? <button type="button" className={styles.primaryButton} disabled={busy !== ""} onClick={() => act(source, "ACTIVATE")}>Take live</button> : null}{source.status === "ACTIVE" ? <button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => act(source, "SUSPEND")}>Take off air</button> : null}{source.canArchive ? <button type="button" className={styles.secondaryButton} disabled={busy !== "" || source.status === "ACTIVE"} onClick={() => act(source, "ARCHIVE")}>Archive</button> : null}</div> : null}
    </article>)}</div> : <div className={styles.emptyState}>No external live sources yet. Add one below, test it, then take it live when the presenter or upstream automation is ready.</div>}
    {data?.djAccess ? <div className={styles.notice}>Presenter access active for this browser: {data.djAccess.label}. It ends {new Date(data.djAccess.endsAt).toLocaleString()}.</div> : null}
    {data?.canManage ? <form className={styles.schedulerForm} onSubmit={create}>
      <div className={styles.smartFormHeader}><div><h3>Add an external live source</h3><p>Saving is safe and does not change what listeners hear. Testing and activation are separate steps.</p></div></div>
      <div className={styles.formGrid}>
        <label><span>Source name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Remote breakfast studio" /></label>
        <label><span>Channel</span><select required value={form.channelId} onChange={(event) => setForm({ ...form, channelId: event.target.value })}><option value="">Choose channel</option>{(data.channels || []).map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}</select></label>
        <label><span>Provider type</span><select value={form.providerKey} onChange={(event) => setForm({ ...form, providerKey: event.target.value })}><option value="GENERIC_HTTP">Generic HTTP audio</option><option value="ICECAST">Icecast</option><option value="SHOUTCAST">SHOUTcast</option></select></label>
        <label><span>Public audio endpoint</span><input required type="url" value={form.streamUrl} onChange={(event) => setForm({ ...form, streamUrl: event.target.value })} placeholder="https://audio.example.com/live" /></label>
        <label><span>Authentication</span><select value={form.credentialType} onChange={(event) => setForm({ ...form, credentialType: event.target.value, credentialUsername: "", credentialSecret: "" })}><option value="NONE">None</option><option value="BASIC">Username and password</option><option value="BEARER">Bearer token</option></select></label>
        {form.credentialType === "BASIC" ? <label><span>Username</span><input required value={form.credentialUsername} onChange={(event) => setForm({ ...form, credentialUsername: event.target.value })} autoComplete="off" /></label> : null}
        {form.credentialType !== "NONE" ? <label><span>{form.credentialType === "BEARER" ? "Access token" : "Password"}</span><input required type="password" value={form.credentialSecret} onChange={(event) => setForm({ ...form, credentialSecret: event.target.value })} autoComplete="new-password" /></label> : null}
        <label><span>Live from <small>(optional)</small></span><input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
        <label><span>Live until <small>(optional)</small></span><input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label>
      </div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>Save → test → controlled activation</span><button className={styles.primaryButton} disabled={busy !== ""}>{busy === "create" ? "Saving…" : "Save live source"}</button></div>
    </form> : <div className={styles.readOnlyMessage}>{data?.djAccess ? "Your DJ grant allows only the listed channel actions. Source credentials and configuration remain manager-only." : "You can inspect External Live status. An organisation owner or manager controls credentials and activation."}</div>}
  </section>;
}
