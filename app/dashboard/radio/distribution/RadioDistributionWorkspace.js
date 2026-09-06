"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./distribution.module.css";

const initial = { stationId: "", channelId: "", kind: "DIRECTORY", providerKey: "", listingName: "", endpointUrl: "", territoryCodes: "WORLDWIDE", languageCodes: "en", categories: "Music" };
const kindLabels = { DIRECTORY: "Radio directory", STREAM_CDN: "Streaming/CDN partner", APP_PLATFORM: "App platform", VOICE_ASSISTANT: "Voice assistant" };

export default function RadioDistributionWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(initial);
  const [secret, setSecret] = useState("");
  const [working, setWorking] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/radio-distribution", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load station distribution.");
      setData(payload);
      setForm((current) => ({ ...current, stationId: current.stationId || payload.stations[0]?.id || "", listingName: current.listingName || payload.stations[0]?.name || "" }));
    } catch (loadError) { setError(loadError.message); } finally { setWorking(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(body, success) {
    setWorking(body.action); setError(""); setNotice("");
    try {
      const response = await fetch("/api/radio-distribution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The distribution action could not be completed.");
      if (payload.signingSecret) setSecret(payload.signingSecret);
      setNotice(payload.notice || success); await load(); return true;
    } catch (actionError) { setError(actionError.message); return false; } finally { setWorking(""); }
  }

  const selectedStation = useMemo(() => data?.stations.find((station) => station.id === form.stationId), [data, form.stationId]);
  async function create(event) {
    event.preventDefault();
    const created = await act({ action: "CREATE", ...form, channelId: form.kind === "STREAM_CDN" ? form.channelId : null }, "Draft destination created.");
    if (created) setForm({ ...initial, stationId: form.stationId, listingName: selectedStation?.name || "" });
  }

  if (working === "load" && !data) return <section className={styles.panel}>Loading station distribution…</section>;
  return <div className={styles.workspace}>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {secret ? <section className={styles.secret}><div><strong>Copy the signing secret now</strong><p>Send it to the destination provider through an approved secure channel. It cannot be shown again.</p></div><code>{secret}</code><button onClick={() => navigator.clipboard.writeText(secret)}>Copy secret</button></section> : null}
    <section className={styles.metrics}>
      <div><strong>{data?.summary.total || 0}</strong><span>Destinations</span></div><div><strong>{data?.summary.active || 0}</strong><span>Active adapters</span></div><div><strong>{data?.summary.attention || 0}</strong><span>Need attention</span></div><div><strong>{data?.summary.delivered || 0}</strong><span>Recent deliveries</span></div>
    </section>

    {data?.permissions.canManage ? <form className={styles.panel} onSubmit={create}>
      <div className={styles.heading}><div><p className={styles.kicker}>NEW DESTINATION</p><h2>Connect an approved provider adapter</h2></div><span>Starts as draft</span></div>
      <div className={styles.formGrid}>
        <label><span>Station</span><select required value={form.stationId} onChange={(event) => { const station = data.stations.find((item) => item.id === event.target.value); setForm({ ...form, stationId: event.target.value, channelId: "", listingName: station?.name || form.listingName }); }}><option value="">Choose…</option>{data.stations.map((station) => <option key={station.id} value={station.id}>{station.name} · {station.status}</option>)}</select></label>
        <label><span>Destination type</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value, channelId: "" })}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.kind === "STREAM_CDN" ? <label><span>Channel</span><select required value={form.channelId} onChange={(event) => setForm({ ...form, channelId: event.target.value })}><option value="">Choose…</option>{(selectedStation?.channels || []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label> : null}
        <label><span>Provider key</span><input required value={form.providerKey} onChange={(event) => setForm({ ...form, providerKey: event.target.value })} placeholder="DIRECTORY_PARTNER_V1" /></label>
        <label><span>Public listing name</span><input required value={form.listingName} onChange={(event) => setForm({ ...form, listingName: event.target.value })} /></label>
        <label className={styles.wide}><span>Secure HTTPS adapter endpoint</span><input required type="url" value={form.endpointUrl} onChange={(event) => setForm({ ...form, endpointUrl: event.target.value })} placeholder="https://partner.example/stations/sync" /></label>
        <label><span>Territories</span><input required value={form.territoryCodes} onChange={(event) => setForm({ ...form, territoryCodes: event.target.value })} placeholder="WORLDWIDE or MT,GB" /></label>
        <label><span>Languages</span><input required value={form.languageCodes} onChange={(event) => setForm({ ...form, languageCodes: event.target.value })} placeholder="en,mt" /></label>
        <label className={styles.wide}><span>Categories</span><input required value={form.categories} onChange={(event) => setForm({ ...form, categories: event.target.value })} placeholder="Music,Talk" /></label>
      </div>
      <div className={styles.actions}><button className={styles.primary} disabled={Boolean(working)}>Create draft destination</button></div>
    </form> : <section className={styles.panel}><p className={styles.muted}>Your role has read-only access. An owner or manager can change destinations.</p></section>}

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>DESTINATIONS</p><h2>Lifecycle and delivery evidence</h2></div><span>{data?.destinations.length || 0} configured</span></div>
      <p className={styles.muted}>Provider acceptance remains external. Delivery evidence confirms transport only, not publication or certification.</p>
      <div className={styles.cards}>{data?.destinations.length ? data.destinations.map((destination) => {
        const latest = destination.connection?.deliveries?.[0];
        return <article className={styles.card} key={destination.id}>
          <div className={styles.cardHead}><div><b>{kindLabels[destination.kind]}</b><h3>{destination.listingName}</h3><p>{destination.station.name}{destination.channel ? ` · ${destination.channel.name}` : ""}</p></div><span className={styles.badge}>{destination.status}</span></div>
          <dl><div><dt>Provider</dt><dd>{destination.providerKey}</dd></div><div><dt>Endpoint</dt><dd>{destination.connection?.endpointOrigin}</dd></div><div><dt>Connection</dt><dd>{destination.connection?.status}</dd></div><div><dt>Latest delivery</dt><dd>{latest ? `${latest.status} · ${new Date(latest.createdAt).toLocaleString()}` : "Not sent"}</dd></div></dl>
          <p className={styles.muted}>{destination.territoryCodes.join(", ")} · {destination.languageCodes.join(", ")} · {destination.categories.join(", ")}</p>
          {data.permissions.canManage && destination.status !== "REVOKED" ? <div className={styles.actions}>{["DRAFT", "PAUSED"].includes(destination.status) ? <button disabled={Boolean(working)} onClick={() => act({ action: "ACTIVATE", destinationId: destination.id }, "Destination activated and sync queued.")}>Activate</button> : null}{destination.status === "ACTIVE" ? <><button disabled={Boolean(working)} onClick={() => act({ action: "SYNC", destinationId: destination.id }, "Fresh station profile queued.")}>Sync now</button><button className={styles.secondary} disabled={Boolean(working)} onClick={() => act({ action: "PAUSE", destinationId: destination.id }, "Destination paused.")}>Pause</button></> : null}<button className={styles.danger} disabled={Boolean(working)} onClick={() => window.confirm("Revoke this destination? This cannot be undone.") && act({ action: "REVOKE", destinationId: destination.id, reason: "Revoked by the organisation manager." }, "Destination revoked.")}>Revoke</button></div> : null}
        </article>;
      }) : <p className={styles.muted}>No destinations yet. Add one after a provider supplies its approved HTTPS adapter endpoint.</p>}</div>
    </section>
  </div>;
}
