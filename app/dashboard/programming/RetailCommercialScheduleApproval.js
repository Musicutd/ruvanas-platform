"use client";

import { useEffect, useRef, useState } from "react";
import { RETAIL_PLANNER_STATION_ID } from "@/lib/retail-weekly-planner-ui.mjs";
import { retailCommercialRuleDescription } from "@/lib/retail-commercial-policy.mjs";
import { RETAIL_COMMERCIAL_SCHEDULE_APPROVAL_ENDPOINT as ENDPOINT, retailCommercialSubscriberReview, retailCommercialSubscriberApprovalBody } from "@/lib/retail-commercial-subscriber-review-ui.mjs";
import styles from "./retail-control-tabs.module.css";

export default function RetailCommercialScheduleApproval({ stationId, savedDraftId, hasUnsavedChanges }) {
  const [view, setView] = useState(null), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [uncertain, setUncertain] = useState(false);
  const pending = useRef(false), abort = useRef(null), sequence = useRef(0);
  const canApprove = view?.canApprove && !hasUnsavedChanges && view.draft?.id === savedDraftId && !uncertain;
  async function load(approve = false) {
    if (pending.current || stationId !== RETAIL_PLANNER_STATION_ID || approve && (!confirmed || !canApprove)) return;
    let input;
    if (approve) try { input = retailCommercialSubscriberApprovalBody(view, { requestId: crypto.randomUUID(), responsibilityConfirmed: confirmed, savedDraftId, hasUnsavedChanges }); }
    catch (caught) { setError(caught.message); return; }
    pending.current = true; const read = ++sequence.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000); setBusy(true); setError(""); setMessage(""); setConfirmed(false);
    try {
      const response = await fetch(ENDPOINT, { method: approve ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        ...(input ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}) });
      const body = await response.json(); if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The commercial schedule review is unavailable.");
      const next = retailCommercialSubscriberReview(body);
      if (approve && (body.accepted !== true || body.approvedDraftId !== input.draftId || next.approval?.draftId !== input.draftId || body.activeApprovalId !== next.approval?.id))
        throw new Error("The approval result could not be confirmed. Refresh the saved review before continuing.");
      if (read !== sequence.current) return;
      setView(next); setUncertain(false);
      if (approve) setMessage("Commercial schedule approved. Your Retail stream will use this saved version after its next safety check. This confirmation does not prove a spot has played yet.");
    } catch (caught) { if (read === sequence.current) { setUncertain(true); setError(caught.name === "AbortError" ? "Confirmation timed out. Refresh the saved review before another approval." : caught.message); } }
    finally { clearTimeout(timer); if (read === sequence.current) { pending.current = false; setBusy(false); } }
  }
  useEffect(() => { pending.current = false; setConfirmed(false); setView(null); void load(); return () => { sequence.current++; abort.current?.abort(); }; }, [stationId, savedDraftId]);
  useEffect(() => { setConfirmed(false); }, [hasUnsavedChanges, savedDraftId]);
  if (stationId !== RETAIL_PLANNER_STATION_ID) return null;
  return <section className={styles.scheduleApproval} aria-labelledby="retail-commercial-approval-title">
    <div className={styles.commercialHeader}><div><p className={styles.eyebrow}>YOUR FINAL REVIEW</p><h3 id="retail-commercial-approval-title">Approve your commercial schedule</h3><p>Check the exact saved breaks below. Your approval makes this version available to your running Retail stream.</p></div><button type="button" disabled={busy} onClick={() => void load()}>Refresh saved review</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
    {hasUnsavedChanges && <p className={styles.notice}>Save or discard your changes above before approving a commercial schedule. Unsaved edits cannot go on air.</p>}
    {!view ? <p role="status">{busy ? "Loading the saved commercial review…" : "Refresh to review your saved commercial schedule."}</p> : <>
      <p><strong>{view.approval ? `Approved commercial schedule: version ${view.approval.draftVersion}.` : "No commercial schedule is approved yet."}</strong></p>
      {view.approval?.approvedAt && <p className={styles.hint}>Approved {new Date(view.approval.approvedAt).toLocaleString("en-GB", { timeZone: "Europe/Malta" })} Malta time. Saved approval is separate from confirmation of audio playback.</p>}
      {view.warnings.map((warning, position) => <p className={styles.notice} key={position}>{warning}</p>)}
      {view.draft ? <>
        <h4>Saved version {view.draft.version}: {view.draft.name}</h4>
        <p className={styles.hint}>{view.approval?.draftId === view.draft.id ? "This saved version is approved." : "Awaiting your approval — this saved version is not on air."}</p>
        {view.draft.id !== savedDraftId && <p className={styles.notice}>A different saved draft is available. Refresh the saved draft above, then review this schedule again.</p>}
        {view.draft.rules.length ? <ol className={styles.savedRules}>{view.draft.rules.map((rule, position) => <li key={position}><strong>{rule.name}</strong><p>{retailCommercialRuleDescription(rule)}</p><p>{rule.spotIds.map(id => view.spots.find(spot => spot.id === id)?.name || "Unavailable recording").join(" → ")}</p></li>)}</ol> : <p>This saved version has no breaks. Approving it turns off commercial insertion while music continues.</p>}
        <p className={styles.notice}>Times use Malta time. Timed breaks can interrupt a song; weekly programme boundaries take priority. Overlapping or unavailable breaks are skipped. Song and minute intervals restart when approval changes or the encoder reconnects.</p>
        <label className={styles.approvalConfirm}><input type="checkbox" checked={confirmed} disabled={busy || !canApprove} onChange={event => setConfirmed(event.target.checked)} /><span>I have reviewed saved version {view.draft.version}, accept responsibility for these commercials and their timing, and approve this schedule for my Retail stream.</span></label>
        <div className={styles.commercialActions}><button type="button" className={styles.primary} disabled={busy || !canApprove || !confirmed} onClick={() => void load(true)}>Approve this saved schedule for air</button></div>
      </> : <p>Save a commercial draft above, then review and approve it here.</p>}
    </>}
  </section>;
}
