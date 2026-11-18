"use client";

import { useEffect, useRef, useState } from "react";
import { isRetailPilotAccessOrganisation, retailPilotAccessNotice, retailPilotAccessRequest, safeRetailPilotAccessView } from "@/lib/retail-stream-pilot-access-ui.mjs";
import styles from "./retail-stream.module.css";

export default function RetailPilotAccessPanel({ organisationId, onAccessChanged }) {
  const [access, setAccess] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(null);
  const [confirmed, setConfirmed] = useState(false), [revokeConfirmed, setRevokeConfirmed] = useState(false), [uncertain, setUncertain] = useState(false);
  const pending = useRef(false), mounted = useRef(true), controller = useRef(null);
  const inScope = isRetailPilotAccessOrganisation(organisationId);
  const endpoint = `/api/admin/organisations/${encodeURIComponent(organisationId)}/retail-access`;

  async function request(action = null) {
    if (!inScope || pending.current || action && uncertain) return;
    let input;
    try { if (action) input = retailPilotAccessRequest(action, action === "revoke" ? revokeConfirmed : confirmed, access, organisationId); }
    catch (error) { setMessage({ type: "error", text: error.message }); return; }
    pending.current = true; setBusy(true); setMessage(null); setConfirmed(false); setRevokeConfirmed(false);
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(endpoint, { method: action ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}) });
      const body = await response.json();
      if (!response.ok) {
        if (mounted.current) { setUncertain(true); setMessage({ type: "error", text: retailPilotAccessNotice(body?.code) }); }
        return;
      }
      const next = safeRetailPilotAccessView(body.access, organisationId);
      if (action && (body.accepted !== true || body.action !== action || next.approved !== (action === "approve"))) throw new Error("UNCONFIRMED_ACCESS");
      if (mounted.current) {
        setAccess(next); setUncertain(false);
        if (action) {
          setMessage({ type: "success", text: action === "approve"
            ? "Test Retail music access is approved. This did not start audio, assign hosting or change plan limits."
            : "Test Retail pilot music access is revoked. This did not change its plan or any other channel." });
          // A separate read refreshes readiness. It never saves music or starts audio.
          onAccessChanged?.();
        }
      }
    } catch {
      if (mounted.current) {
        setUncertain(true);
        setMessage({ type: "error", text: action
          ? "The access change could not be confirmed. Refresh access status before another attempt; it may already have completed. No start request was sent."
          : "Retail music access could not be refreshed. No access or playback change was sent." });
      }
    } finally {
      clearTimeout(timeout); pending.current = false; controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const initialRead = setTimeout(() => { if (mounted.current && inScope) void request(); }, 0);
    return () => { mounted.current = false; clearTimeout(initialRead); controller.current?.abort(); };
  }, [organisationId]);
  if (!inScope) return null;
  const canApprove = access?.canApprove === true && !busy && !uncertain;
  const canRevoke = access?.canRevoke === true && !busy && !uncertain;

  return <section className={styles.card} aria-labelledby="retail-pilot-access-title">
    <p className={styles.eyebrow}>OWNER APPROVAL · TEST RETAIL ONLY</p>
    <h2 id="retail-pilot-access-title">Music access for this Retail pilot</h2>
    <p className={styles.intro}>Approve the existing shared catalogue for Test Retail’s saved Malta programme. This separate pilot permission keeps the current plan, shop and display allowances, and bitrate limits unchanged.</p>
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => request()}>{busy ? "Checking access…" : "Refresh music access"}</button></div>
    {message && <p role={message.type === "error" ? "alert" : "status"} className={message.type === "error" ? styles.error : styles.success}>{message.text}</p>}
    {!access ? <p className={styles.notice}>{busy ? "Checking the private Retail account…" : "No verified music-access status is available yet."}</p> : <>
      <p><span className={styles.status}>{access.approved ? "Pilot music access approved" : "Pilot music access not approved"}</span></p>
      <dl className={styles.summary}>
        <dt>Catalogue access</dt><dd>FOCUSED · existing Ruvanas and licensed catalogue recordings</dd>
        <dt>Shop country</dt><dd>Malta (MT)</dd>
        <dt>{access.approved ? "Eligible recordings" : "Recordings eligible with this approval"}</dt><dd>{access.eligibleTrackCount}</dd>
        <dt>Access expires</dt><dd>{access.expiresAt ? <time dateTime={access.expiresAt}>{new Date(access.expiresAt).toLocaleString("en-GB", { timeZone: "Europe/Malta", dateStyle: "medium", timeStyle: "short" })} Malta time</time> : "Private access period needs review"}</dd>
      </dl>
      <p className={styles.hint}>The recording count uses the saved genres and existing Retail music-rights checks. This approval grants no new music rights, uploads or downloads.</p>
      {access.blocker && <p className={styles.notice}>{retailPilotAccessNotice(access.blocker)}</p>}
      {!access.approved && <>
        <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={!canApprove} onChange={event => setConfirmed(event.target.checked)} /><span>I approve this catalogue and playback permission for Test Retail’s shared programme only. Keep Retail audio off and existing plan limits unchanged.</span></label>
        <div className={styles.actions}><button type="button" disabled={!canApprove || !confirmed} onClick={() => request("approve")}>Grant Retail music access — audio stays off</button></div>
      </>}
      {access.canRevoke && <details className={styles.accessDetails}><summary>Revoke this pilot permission</summary>
        <label className={styles.confirm}><input type="checkbox" checked={revokeConfirmed} disabled={!canRevoke} onChange={event => setRevokeConfirmed(event.target.checked)} /><span>I confirm revoking only Test Retail’s pilot music permission. A running Retail worker will recheck access and stop; other channels remain unchanged.</span></label>
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={!canRevoke || !revokeConfirmed} onClick={() => request("revoke")}>Revoke Test Retail music access</button></div>
      </details>}
    </>}
    <p className={styles.footnote}>One shared programme serves this subscriber’s shops. Hosting and Start remain separate steps below. This access approval does not purchase a service, start broadcasting, change Test Radio or open registration.</p>
  </section>;
}
