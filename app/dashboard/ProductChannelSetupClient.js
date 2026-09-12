"use client";

import { useState } from "react";
import styles from "./product-channel-setup.module.css";

export default function ProductChannelSetupClient({ product, initialStations = [] }) {
  const [stations, setStations] = useState(initialStations);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/product-channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product, name: form.get("name"), description: form.get("description"), audiencePolicy: form.get("audiencePolicy"), listenerRequestsEnabled: form.get("listenerRequestsEnabled") === "on" }) });
    const payload = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(payload.error || "The channel could not be created.");
    setStations((current) => [...current, payload.station]); event.currentTarget.reset(); setMessage("Channel created and ready for programming.");
  }
  const health = product === "HEALTH";
  return <div className={styles.grid}>
    <section className={styles.card}><p className={styles.eyebrow}>EXISTING CHANNELS</p><h2>{health ? "Health channels" : "Faith channels"}</h2>
      {stations.length ? <ul>{stations.map((station) => <li key={station.id}><strong>{station.name}</strong><span>{station.audiencePolicy.toLowerCase()} listening · {station.status.toLowerCase()}</span><a href={`/stations/${station.id}`}>Manage channel, player and listening page →</a></li>)}</ul> : <p>No channel yet. Create the first one beside this list.</p>}
    </section>
    <form className={styles.card} onSubmit={submit}><p className={styles.eyebrow}>GUIDED SETUP</p><h2>Create a channel</h2>
      <label>Channel name<input name="name" required minLength={2} maxLength={120} /></label>
      <label>Purpose<textarea name="description" maxLength={500} /></label>
      <label>Listening access<select name="audiencePolicy" defaultValue="INTERNAL"><option value="INTERNAL">Internal only</option><option value="RESTRICTED">Restricted link</option><option value="PUBLIC">Public</option></select></label>
      {health ? <label className={styles.check}><input type="checkbox" name="listenerRequestsEnabled" /> Allow moderated song requests (song/artist only)</label> : null}
      <button disabled={busy}>{busy ? "Creating…" : "Create channel"}</button>
      {message ? <p role="status" className={styles.message}>{message}</p> : null}
    </form>
  </div>;
}
