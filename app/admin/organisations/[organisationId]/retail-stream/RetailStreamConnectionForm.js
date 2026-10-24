"use client";

import { useEffect, useRef, useState } from "react";
import { retailStreamConnectionForm, retailStreamDraftRequest, retailStreamSetupNotice, safeRetailStreamSetupView } from "@/lib/retail-stream-setup-ui.mjs";
import styles from "./retail-stream.module.css";

export default function RetailStreamConnectionForm({ initialSetup }) {
  const [setup, setSetup] = useState(initialSetup), [form, setForm] = useState(() => retailStreamConnectionForm(initialSetup));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(null), [uncertain, setUncertain] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const password = useRef(null), pending = useRef(false), controller = useRef(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const existing = Boolean(setup.station && setup.connection), credentialConfigured = setup.connection?.credentialConfigured === true;
  const canSave = setup.canSaveDraft === true && !busy && !uncertain;
  const update = event => { setForm(previous => ({ ...previous, [event.target.name]: event.target.value })); setMessage(null); };
  function reload() { if (!pending.current) window.location.reload(); }

  async function save(event) {
    event.preventDefault();
    if (pending.current || !canSave || !acknowledged) return;
    let input;
    try {
      input = retailStreamDraftRequest(form, password.current?.value || "", {
        maximumBitrateKbps: setup.entitlements.maxBitrateKbps, credentialConfigured
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }
    pending.current = true; setBusy(true); setMessage(null);
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await fetch(`/api/admin/organisations/${encodeURIComponent(setup.organisation.id)}/retail-stream`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
      });
      let body;
      try { body = await response.json(); } catch { throw new Error("UNCONFIRMED_SAVE"); }
      if (!response.ok) {
        if (mounted.current) {
          if (response.status >= 500 || ["RETAIL_STREAM_SETUP_CONCURRENT_CHANGE", "RETAIL_STREAM_SETUP_PERSISTENCE_UNAVAILABLE"].includes(body?.code)) setUncertain(true);
          setMessage({ type: "error", text: retailStreamSetupNotice(body?.code) });
        }
        return;
      }
      if (body?.saved !== true) throw new Error("UNCONFIRMED_SAVE");
      const saved = safeRetailStreamSetupView(body.setup, setup.organisation.id);
      if (saved.station?.status !== "DRAFT" || !saved.connection?.credentialConfigured) throw new Error("UNCONFIRMED_SAVE");
      if (mounted.current) {
        setSetup(saved); setForm(retailStreamConnectionForm(saved)); setAcknowledged(false);
        setMessage({ type: "success", text: "Private Retail draft saved. Audio, public listening and connection probes remain off. No provider connection was tested and no worker or paid service was started." });
      }
    } catch {
      if (mounted.current) {
        setUncertain(true);
        setMessage({ type: "error", text: "The save result is uncertain. The password has been cleared. Reload saved status before another attempt; the request may already have completed. Nothing here starts broadcasting." });
      }
    } finally {
      clearTimeout(timeout);
      if (password.current) password.current.value = "";
      input = null; pending.current = false; controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  if (!setup.canSaveDraft) return <section className={styles.card} aria-labelledby="retail-stream-protected-title">
    <h2 id="retail-stream-protected-title">This connection needs administrator review</h2>
    <p className={styles.error} role="alert">{retailStreamSetupNotice(setup.blockedReason)}</p>
    {setup.station && <p className={styles.status}>Observed station status: {setup.station.status}</p>}
    <p className={styles.hint}>Connection details and editing controls are hidden for this protected or unavailable setup. Its current audio state has not been verified by this page, and no existing stream has been changed.</p>
    <div className={styles.actions}><button type="button" className={styles.secondary} onClick={reload}>Reload saved status</button></div>
  </section>;

  return <>
    <section className={styles.boundary} aria-label="Retail setup boundary">
      <strong>One shared programme for this subscriber’s shops · draft only</strong>
      <p>This saves connection details, not a working stream. It does not start or test Centova, allocate an encoder, change Test Radio or activate music. The shared catalogue remains subject to Retail rights and the current plan.</p>
    </section>
    <section className={styles.card} aria-labelledby="retail-stream-current-status">
      <h2 id="retail-stream-current-status">Saved connection</h2>
      <p><span className={styles.status}>{setup.station ? `Station status: ${setup.station.status}` : "No Retail draft saved"}</span></p>
      <dl className={styles.summary}>
        <dt>Organisation</dt><dd>{setup.organisation.name}</dd>
        <dt>Source password</dt><dd>{credentialConfigured ? "Stored privately · never shown again" : "Not configured"}</dd>
        <dt>Connection verification</dt><dd>Not performed by this form</dd>
        <dt>Current bitrate ceiling</dt><dd>{setup.entitlements.maxBitrateKbps == null ? "Needs plan review" : `${setup.entitlements.maxBitrateKbps} kbps`}</dd>
      </dl>
      <p className={styles.hint}>Shop counts, display counts and commercial limits are not changed here. Additional capacity or live activation needs a separate review and any required cost approval.</p>
      {setup.requiresPlanLimitReview && <p className={styles.notice}>Site and display allowances still need plan review. Saving a connection draft does not approve new limits or delivery.</p>}
    </section>
    <section className={styles.card} aria-labelledby="retail-stream-connection-fields">
      <h2 id="retail-stream-connection-fields">Centova connection details</h2>
      <p className={styles.intro}>Use the subscriber’s own provider account. Platform storage and catalogue credentials stay with Ruvanas; no music files are copied for this setup.</p>
      {existing && <p className={styles.notice}>The saved destination is read-only here. Its source password is kept unchanged. Changing the provider destination or password requires a separate administrator review.</p>}
      <form onSubmit={save} autoComplete="off">
        <fieldset disabled={!canSave} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className={styles.formGrid}>
            <label>Streaming provider<input value="Centova Cast · MP3" readOnly /></label>
            <label>Centova account username<input name="centovaUsername" value={form.centovaUsername} onChange={update} readOnly={existing} required maxLength={80} autoComplete="off" autoCapitalize="none" spellCheck={false} /><small>The provider account username, not its administrator password.</small></label>
            <label className={styles.wide}>HTTPS listener address<input name="streamUrl" type="url" value={form.streamUrl} onChange={update} readOnly={existing} required maxLength={2048} placeholder="https://your-station.example.com/stream" autoComplete="off" autoCapitalize="none" spellCheck={false} /><small>Use the public HTTPS listening address without a password, query parameters or fragment. It is not opened or tested when you save.</small></label>
            <label>Source server host<input name="serverHost" value={form.serverHost} onChange={update} readOnly={existing} required maxLength={254} placeholder="server.provider.com" autoComplete="off" autoCapitalize="none" spellCheck={false} /><small>Hostname only—no protocol, path or port.</small></label>
            <label>Server port (optional)<input name="serverPort" type="number" min="1" max="65535" step="1" value={form.serverPort} onChange={update} readOnly={existing} /><small>Enter this only if your provider supplies it. It is not used to guess the live-source port.</small></label>
            <label>Live-source port<input name="sourcePort" type="number" min="1" max="65535" step="1" value={form.sourcePort} onChange={update} readOnly={existing} required /><small>Copy the exact encoder/source port. It may differ from the listener or server port.</small></label>
            <label>Live-source username (optional)<input name="sourceUsername" value={form.sourceUsername} onChange={update} readOnly={existing} maxLength={120} autoComplete="off" autoCapitalize="none" spellCheck={false} /><small>Leave empty unless Centova supplies a separate live-source username.</small></label>
            <label>Output bitrate (kbps)<input name="bitrateKbps" type="number" min="8" max={setup.entitlements.maxBitrateKbps || 320} step="1" value={form.bitrateKbps} onChange={update} required /><small>This does not change the plan’s bitrate allowance or start audio.</small></label>
            {!credentialConfigured && <label>Live-source password<input ref={password} name="sourcePassword" type="password" required maxLength={1024} autoComplete="new-password" autoCapitalize="none" spellCheck={false} /><small>Source/encoder password only. It is sent securely for private storage, never displayed in the save result, and cleared after each request.</small></label>}
          </div>
          <label className={styles.confirm}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I am saving a private Retail draft only. This does not verify credentials, approve music rights, start broadcasting or authorise additional cost.</span></label>
        </fieldset>
        {message && <p role={message.type === "error" ? "alert" : "status"} className={message.type === "error" ? styles.error : styles.success}>{message.text}</p>}
        <div className={styles.actions}>
          <button type="submit" disabled={!canSave || !acknowledged}>{busy ? "Saving private draft…" : "Save private draft — audio stays off"}</button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={reload}>Reload saved status</button>
        </div>
      </form>
      <p className={styles.footnote}>This connection form only saves provider details. Use the separate shared programme section to review music, hosting and any activation requirements. Registration and other subscribers’ channels are unchanged.</p>
    </section>
  </>;
}
