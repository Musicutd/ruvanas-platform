"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutAttempt, checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import { REVERSAL_REASON_OPTIONS, reversalMessage, reversalReasonLabel, reversalWindowOpen } from "@/lib/retail-rewards/reversal-ui.mjs";
import { shopperMoney } from "@/lib/retail-rewards/shopper-ui.mjs";
import { offerDateLabel } from "@/lib/retail-rewards/offer-ui.mjs";
import styles from "./corrections.module.css";

export default function CorrectionClient({ initialData, transport = checkoutTransport, previewOnly = false }) {
  const [locations, setLocations] = useState({ locations: [], page: 1, hasMore: false, ...initialData });
  const [locationId, setLocationId] = useState(""), [redemptionId, setRedemptionId] = useState("");
  const [review, setReview] = useState(null), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(false), [now, setNow] = useState(Date.now());
  const [error, setError] = useState(initialData?.ok === false ? reversalMessage(initialData.code) : "");
  const pending = useRef(false), attempt = useRef(null), active = useRef(null), alive = useRef(true), resultRef = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); attempt.current = null; }; }, []);
  useEffect(() => { if (review || error) resultRef.current?.focus(); }, [review, error]);
  useEffect(() => { if (!review?.deadline) return; const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, [review?.deadline]);
  function clearReview(resetAttempt = true) { setReview(null); setReason(""); setConfirmed(false); setError(""); setRetry(false); if (resetAttempt) attempt.current = null; }
  async function run(path, options, success) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const controller = new AbortController(); active.current = controller; const timeout = setTimeout(() => controller.abort(), 20_000);
    try { const result = await checkoutRequest(transport, path, { ...options, signal: controller.signal }); if (alive.current) success(result); }
    catch (problem) { if (alive.current) setError(reversalMessage(problem.code)); }
    finally { clearTimeout(timeout); pending.current = false; active.current = null; if (alive.current) { setBusy(false); setNow(Date.now()); } }
  }
  async function loadLocations(page) {
    if (pending.current) return; clearReview(); setLocationId(""); setRedemptionId("");
    await run(`/api/retail-rewards/reversals/locations?page=${page}`, {}, setLocations);
  }
  async function inspect(event) {
    event.preventDefault(); if (pending.current) return;
    const id = redemptionId.trim();
    if (!locationId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(id)) { setError("Choose your shop and enter the receipt’s complete confirmation ID."); return; }
    setRedemptionId(id); clearReview(false);
    await run("/api/retail-rewards/reversals/inspect", { method: "POST", body: { redemptionId: id, locationId } }, setReview);
  }
  async function reverse(event) {
    event.preventDefault(); if (!review || pending.current) return;
    if ((!retry && !reversalWindowOpen(review)) || !confirmed || !REVERSAL_REASON_OPTIONS.some(option => option.value === reason)) { setError("Review an eligible receipt, choose a reason and confirm this correction."); return; }
    const payload = { redemptionId: review.receipt.id, locationId, reason, correctionConfirmed: true };
    attempt.current = checkoutAttempt(attempt.current, payload); setRetry(true);
    await run("/api/retail-rewards/reversals/reverse", { method: "POST", body: { ...payload, idempotencyKey: attempt.current.key } }, result => {
      setReview(current => ({ ...current, receipt: result.receipt, canReverse: false })); setReason(""); setConfirmed(false); setRetry(false); attempt.current = null;
    });
  }
  const receipt = review?.receipt, corrected = Boolean(receipt?.reversal), canReverse = reversalWindowOpen(review, now);
  return <main className={styles.page}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL MANAGER PREVIEW</strong> · Synthetic receipts only · No live corrections or refunds</p>}
    <div className={styles.container}><a className={styles.back} href="/dashboard/retail/rewards">← Shop offers</a><p className={styles.eyebrow}>RUVANAS REWARDS · OWNER / MANAGER</p><h1>Correct a redemption.</h1><p className={styles.lead}>Use the receipt’s confirmation ID to correct a mistaken coupon use within 24 hours. The original record stays intact.</p>
      <ol className={styles.steps} aria-label="Correction steps"><li aria-current={!review ? "step" : undefined}>1 · Find receipt</li><li aria-current={review && !corrected ? "step" : undefined}>2 · Review correction</li><li aria-current={corrected ? "step" : undefined}>3 · Recorded</li></ol>
      <div className={styles.columns}><section className={styles.card}><h2>Find the original receipt</h2><p className={styles.help}>Only shops where you have correction permission are available. Reviewing a receipt changes nothing.</p><form onSubmit={inspect} noValidate>
        <label className={styles.field}>Your shop<select value={locationId} onChange={event => { setLocationId(event.target.value); clearReview(); }} disabled={busy}><option value="">Choose an authorised shop</option>{locations.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        {(locations.hasMore || locations.page > 1) && <div className={styles.pagination}><button type="button" disabled={busy || locations.page <= 1} onClick={() => loadLocations(locations.page - 1)}>Previous shops</button><span>Page {locations.page}</span><button type="button" disabled={busy || !locations.hasMore} onClick={() => loadLocations(locations.page + 1)}>More shops</button></div>}
        <label className={styles.field}>Receipt confirmation ID<input type="text" maxLength={191} autoComplete="off" autoCapitalize="none" spellCheck={false} value={redemptionId} onChange={event => { setRedemptionId(event.target.value); clearReview(); }} disabled={busy} /></label><p className={styles.help}>Use the confirmation on the redemption receipt, not the shopper’s checkout code.</p><button type="submit" className={styles.primary} disabled={busy || !locations.locations.length}>{busy ? "Checking…" : "Review receipt"}</button></form>
        {!locations.locations.length && <p className={styles.note}>No authorised shops are available on this page. Your Client Admin manages correction permissions.</p>}
      </section>
      {receipt ? <section className={styles.card} tabIndex={-1} ref={resultRef} aria-label="Original redemption and correction"><span className={`${styles.badge} ${corrected ? styles.corrected : ""}`}>{corrected ? "Redemption reversed" : canReverse ? "Eligible for correction" : "Correction unavailable"}</span><h2>{receipt.offerTitle}</h2><p>{receipt.shopName} · original offer version {receipt.revision}</p><dl className={styles.facts}><div><dt>Original purchase amount</dt><dd>{shopperMoney(receipt.eligibleSpendMinor, receipt.currency)}</dd></div><div><dt>Original coupon saving</dt><dd>{receipt.discountMinor === null ? "Buy/get offer applied manually" : shopperMoney(receipt.discountMinor, receipt.currency)}</dd></div><div><dt>Original redemption</dt><dd>{offerDateLabel(receipt.redeemedAt, "Europe/Malta")}<small>Europe/Malta</small></dd></div><div><dt>Receipt confirmation</dt><dd>{receipt.id}</dd></div></dl>
        {corrected ? <div className={styles.result} role="status"><h3>Correction recorded</h3><p><strong>{reversalReasonLabel(receipt.reversal.reason)}</strong></p><p>{offerDateLabel(receipt.reversal.reversedAt, "Europe/Malta")} · Europe/Malta</p><p className={styles.help}>Correction confirmation: {receipt.reversal.id}</p><p>The original receipt and amounts above remain unchanged.</p></div> : <p className={styles.note}><strong>Correction deadline</strong><br />{offerDateLabel(review.deadline, "Europe/Malta")} · Europe/Malta. Corrections must finish before this time. The server rechecks permission and the deadline when you confirm.</p>}
        {(canReverse || retry) && !corrected ? <form onSubmit={reverse} noValidate><label className={styles.field}>Reason for correction<select value={reason} disabled={busy} onChange={event => { setReason(event.target.value); setConfirmed(false); setRetry(false); }}><option value="">Choose a reason</option>{REVERSAL_REASON_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className={styles.confirm}><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I checked this receipt and confirm one full correction of this mistaken redemption.</span></label><button type="submit" className={styles.primary} disabled={busy || !confirmed || !reason}>{busy ? "Recording…" : retry ? "Retry the same correction" : "Reverse redemption"}</button><p className={styles.help}>If the response is lost, retry with the same details to check the original request. This does not create a second correction.</p></form> : !corrected && <p className={styles.note}>This receipt cannot be corrected here. The correction window may have ended or it is no longer eligible.</p>}
        <div className={styles.guidance}><h3>What a correction changes</h3><p>The mistaken use stops counting towards the offer’s and shopper’s use limits. It still counts towards the shop’s monthly service usage.</p><p>The old coupon and code stay used. The shopper needs a fresh coupon that passes current terms and limits; a replacement is not guaranteed.</p><p><strong>No payment, refund or stock change is made.</strong></p></div>
      </section> : <aside className={styles.guidance}><h2>For mistaken coupon use.</h2><p>Only an authorised owner or manager can record a correction. Shop cashier access alone does not allow it.</p><p>One correction is allowed per receipt. Use your normal checkout system for any payment or refund.</p></aside>}</div>
      {error && <p className={styles.error} role="alert" tabIndex={-1} ref={!review ? resultRef : undefined}>{error}</p>}
    </div>
  </main>;
}
