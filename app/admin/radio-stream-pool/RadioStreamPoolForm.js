"use client";

import { useEffect, useState } from "react";
import { manualStreamRegistrationPayload } from "@/lib/preprovisioned-radio-stream-form.mjs";
import styles from "./RadioStreamPoolForm.module.css";

const initial = {
  centovaUsername: "", streamUrl: "", serverHost: "", sourcePort: "",
  serverPort: "", sourceUsername: "", sourcePassword: "",
  listenerLimit: "10", maxBitrateKbps: "128"
};

const statusLabels = {
  QUARANTINED: "Needs verification",
  AVAILABLE: "Ready to assign",
  CLAIMED: "Assigned",
  RETIRED: "Retired"
};

function Field({ name, label, help, value, onChange, type = "text", required = true, placeholder, min, max }) {
  return <label className={styles.field}>
    <span>{label}</span>
    <input name={name} type={type} value={value} onChange={onChange} required={required}
      placeholder={placeholder} min={min} max={max}
      autoComplete={type === "password" ? "new-password" : "off"} />
    {help ? <small>{help}</small> : null}
  </label>;
}

export default function RadioStreamPoolForm() {
  const [fields, setFields] = useState(initial);
  const [differentPort, setDifferentPort] = useState(false);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function update(event) {
    setFields((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function refresh() {
    const response = await fetch("/api/admin/preprovisioned-radio-streams", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load prepared streams.");
    setSlots(body.slots || []);
  }

  useEffect(() => {
    refresh().catch((failure) => setError(failure.message)).finally(() => setLoading(false));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/preprovisioned-radio-streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualStreamRegistrationPayload(fields, { differentPort }))
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save this stream.");
      setFields(initial);
      setDifferentPort(false);
      setNotice("Stream saved for verification. It is not assigned to a station and will not start audio.");
      await refresh();
    } catch (failure) {
      setError(failure.message || "Unable to save this stream.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className={styles.panel} aria-labelledby="streamerr-instructions">
      <p className={styles.eyebrow}>Step 1 · In Streamerr</p>
      <h2 id="streamerr-instructions">Create the stream manually</h2>
      <ol className={styles.steps}>
        <li>Create a separate Centova account in your Streamerr reseller panel. Set its listener limit and bitrate.</li>
        <li>Keep Centova AutoDJ off if Ruvanas will provide the audio.</li>
        <li>Copy the secure listener URL from <strong>Quick Links</strong>, the host and port from <strong>Live Source Connections → when AutoDJ is not running</strong>, and the source password from <strong>Stream settings</strong>.</li>
      </ol>
      <p className={styles.warning}>Use the <strong>source password</strong>, never the Streamerr or Centova administrator password. Do not use an account or endpoint already serving another station.</p>
    </section>

    <section className={styles.panel} aria-labelledby="register-stream">
      <p className={styles.eyebrow}>Step 2 · In Ruvanas Super Admin</p>
      <h2 id="register-stream">Save the connection details</h2>
      <p className={styles.intro}>If Streamerr gives the same listener and live-source port, enter it once. If they differ, use Advanced details below.</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {notice ? <p role="status" className={styles.success}>{notice}</p> : null}
      <form onSubmit={submit} autoComplete="off">
        <div className={styles.grid}>
          <Field name="centovaUsername" label="Centova account username" help="The separate account you created in Streamerr." value={fields.centovaUsername} onChange={update} placeholder="e.g. my_test_station" />
          <Field name="streamUrl" label="Secure listener URL" help="From Quick Links; must begin with https://" value={fields.streamUrl} onChange={update} type="url" placeholder="https://your-station.radioca.st/stream" />
          <Field name="serverHost" label="Live-source hostname" help="From Live Source Connections, without http:// or a port." value={fields.serverHost} onChange={update} placeholder="e.g. pollux.shoutca.st" />
          <Field name="sourcePort" label="Live-source port" help="Use the value for ‘when AutoDJ is not running’." value={fields.sourcePort} onChange={update} type="number" min="1" max="65535" placeholder="Port number" />
          <Field name="sourcePassword" label="Source password" help="Stored encrypted; never displayed again. Do not enter the administrator password." value={fields.sourcePassword} onChange={update} type="password" />
          <Field name="listenerLimit" label="Listener capacity" help="Match the limit you set in Streamerr; check the suggested 10." value={fields.listenerLimit} onChange={update} type="number" min="1" max="100000" />
          <Field name="maxBitrateKbps" label="Maximum bitrate (kbps)" help="Match the account's maximum; check the suggested 128." value={fields.maxBitrateKbps} onChange={update} type="number" min="8" max="320" />
        </div>

        <details className={styles.advanced}>
          <summary>Advanced details (only if Streamerr gave different ports or a source username)</summary>
          <div className={styles.grid}>
            <div className={styles.field}>
              <span>Listener/server port</span>
              <label className={styles.checkbox}><input type="checkbox" checked={differentPort} onChange={(event) => setDifferentPort(event.target.checked)} /> Streamerr gave me a different listener port</label>
              {differentPort ? <Field name="serverPort" label="Separate listener port" help="This is not the HTTPS URL's 443 port; use the port shown in Centova." value={fields.serverPort} onChange={update} type="number" min="1" max="65535" /> : <small>We will use the live-source port entered above.</small>}
            </div>
            <Field name="sourceUsername" label="Live-source username (optional)" help="Leave blank for source-password-only Shoutcast v1." value={fields.sourceUsername} onChange={update} required={false} />
          </div>
        </details>
        <button type="submit" disabled={busy} className={styles.button}>{busy ? "Saving…" : "Save stream for verification"}</button>
      </form>
      <p className={styles.footerNote}>Saving does not create a Streamerr account, attach it to a station, enable Ruvanas AutoDJ or broadcast audio.</p>
    </section>

    <section className={styles.panel} aria-labelledby="stream-inventory">
      <h2 id="stream-inventory">Prepared streams</h2>
      <p className={styles.intro}>A new stream shows “Needs verification” until its provider connection and listener output have been checked. Source passwords are never shown here.</p>
      {loading ? <p>Loading prepared streams…</p> : !slots.length ? <p>No streams saved yet.</p> : <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th scope="col">Account</th><th scope="col">Secure listener</th><th scope="col">Capacity</th><th scope="col">Status</th></tr></thead>
          <tbody>{slots.map((slot) => <tr key={slot.id}>
            <td>{slot.centovaUsername}</td>
            <td>{slot.streamUrl}</td>
            <td>{slot.listenerLimit} listeners · {slot.maxBitrateKbps} kbps</td>
            <td>{statusLabels[slot.status] || slot.status}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </>;
}
