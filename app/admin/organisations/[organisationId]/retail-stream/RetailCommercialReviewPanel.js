"use client";

import { useEffect, useRef, useState } from "react";
import { retailCommercialRuleDescription } from "@/lib/retail-commercial-policy.mjs";
import styles from "./retail-stream.module.css";

const ORG = "cmvmeq5880005lf2knwtw1b93", STATION = "cmvmg7rp1000flf2kelb1kzax";
export default function RetailCommercialReviewPanel({ organisationId }) {
  const [view, setView] = useState(null), [busy, setBusy] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [uncertain, setUncertain] = useState(false);
  const pending = useRef(false), request = useRef(null), mounted = useRef(true);
  const endpoint = `/api/admin/organisations/${encodeURIComponent(organisationId)}/retail-commercials`;
  async function load(approve = false) {
    if (pending.current || organisationId !== ORG || approve && (!acknowledged || uncertain || view?.canApprove !== true)) return;
    const input = approve ? { action: "approve", draftId: view.draft.id, reviewHash: view.reviewHash,
      baseApprovalId: view.baseApprovalId, requestId: crypto.randomUUID(), acknowledged: true } : null;
    pending.current = true; setBusy(true); setError(""); setMessage(""); setAcknowledged(false);
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, { method: approve ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        ...(input ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Commercial review is unavailable.");
      if (body.stationId !== STATION || !Array.isArray(body.spots) || typeof body.canApprove !== "boolean" ||
          approve && (body.accepted !== true || body.approvedDraftId !== input.draftId || body.approval?.draftId !== input.draftId)) throw new Error("The approval result could not be verified. Refresh before continuing.");
      if (mounted.current) { setView(body); setUncertain(false); if (approve) setMessage("Commercial approval saved. The running Retail worker will recheck it before playing any spot. Approval is not proof of audio playback."); }
    } catch (caught) { if (mounted.current) { setUncertain(true); setError(caught.name === "AbortError" ? "The request timed out. Refresh to confirm its result before another approval." : caught.message); } }
    finally { clearTimeout(timer); pending.current = false; request.current = null; if (mounted.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; const timer = setTimeout(() => void load(), 0);
    return () => { mounted.current = false; clearTimeout(timer); request.current?.abort(); }; }, [organisationId]);
  if (organisationId !== ORG) return null;
  return <section className={styles.card} id="retail-commercial-review" aria-labelledby="retail-commercial-review-title">
    <p className={styles.eyebrow}>OWNER REVIEW · TEST RETAIL</p><h2 id="retail-commercial-review-title">Review commercial breaks</h2>
    <p>Review the subscriber’s saved commercial plan and its approved recordings. Approval lets the Retail worker use these rules while AutoDJ is running.</p>
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => load()}>Refresh commercial review</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
    {!view ? <p>{busy ? "Loading the saved commercial plan…" : "Refresh to review the saved plan."}</p> : <>
      <p><strong>{view.approval ? `Approved commercial draft: version ${view.approval.draftVersion}.` : "No commercial plan has administrator approval."}</strong></p>
      {view.approval?.approvedAt && <p className={styles.hint}>Approved {new Date(view.approval.approvedAt).toLocaleString("en-GB", { timeZone: "Europe/Malta" })} Malta time. This is saved approval, not confirmation of live playback.</p>}
      {(view.warnings || []).map((warning, index) => <p className={styles.notice} key={index}>{warning}</p>)}
      {view.draft ? <><h3>Draft {view.draft.version}: {view.draft.name}</h3>
        <p className={styles.status}>{view.approval?.draftId === view.draft.id ? "This version has owner approval" : "Pending owner approval · these changes are not on air"}</p>
        {view.draft.rules.length ? <ol>{view.draft.rules.map((rule, index) => <li key={index} style={{ marginBottom: 16 }}>
          <strong>{rule.name}</strong><p>{retailCommercialRuleDescription(rule)}</p>
          <p>{rule.spotIds.map(id => view.spots.find(spot => spot.id === id)?.name || "Unavailable recording").join(" → ")}</p>
        </li>)}</ol> : <p>This draft contains no breaks. Approving it removes commercial insertion; music continues.</p>}
        <p className={styles.notice}>Times use Malta time. Timed breaks can interrupt a song. Weekly programme boundaries take priority; overlapping or unavailable breaks are skipped. Frequency rules count completed music songs, and reset when the worker restarts or approval changes.</p>
        <label className={styles.confirm}><input type="checkbox" checked={acknowledged} disabled={busy || uncertain || !view.canApprove} onChange={event => setAcknowledged(event.target.checked)} /> I have reviewed this exact draft and approve its commercial breaks for Test Retail.</label>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || uncertain || !acknowledged || !view.canApprove} onClick={() => load(true)}>Approve commercial plan</button></div>
      </> : <p>The subscriber has not saved a commercial draft yet.</p>}
    </>}
  </section>;
}
