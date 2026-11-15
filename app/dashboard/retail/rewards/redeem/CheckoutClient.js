"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutAmountMinor, checkoutAttempt, checkoutMessage, checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import { shopperCouponSummary, shopperMoney } from "@/lib/retail-rewards/shopper-ui.mjs";
import { offerDateLabel } from "@/lib/retail-rewards/offer-ui.mjs";
import styles from "./checkout.module.css";
import { reversalReasonLabel } from "@/lib/retail-rewards/reversal-ui.mjs";
import { parseCheckoutInput } from "@/lib/retail-rewards/checkout-qr.mjs";
import { createCheckoutScanner, scannerStatusMessage } from "@/lib/retail-rewards/checkout-scanner.mjs";

export default function CheckoutClient({ initialData, transport = checkoutTransport, previewOnly = false, scannerFactory = createCheckoutScanner }) {
  const [locations, setLocations] = useState({ locations: [], page: 1, hasMore: false, ...initialData });
  const [locationId, setLocationId] = useState(""), [token, setToken] = useState("");
  const [review, setReview] = useState(null), [amount, setAmount] = useState(""), [confirmed, setConfirmed] = useState(false), [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(initialData?.ok === false ? checkoutMessage(initialData.code) : ""), [retry, setRetry] = useState(false);
  const pending = useRef(false), attempt = useRef(null), active = useRef(null), alive = useRef(true), resultRef = useRef(null);
  const scanner = useRef(null), video = useRef(null), scanCanvas = useRef(null), selectedShop = useRef(locationId);
  const [scanState, setScanState] = useState("");
  selectedShop.current = locationId;
  const cameraActive = ["STARTING", "SCANNING", "INVALID_CODE"].includes(scanState);
  useEffect(() => { alive.current = true; return () => { alive.current = false; scanner.current?.dispose(); active.current?.abort(); attempt.current = null; }; }, []);
  useEffect(() => { if (review || receipt || error) resultRef.current?.focus(); }, [review, receipt, error]);
  function clearReview(resetAttempt = true) { setReview(null); setAmount(""); setConfirmed(false); setReceipt(null); setError(""); setRetry(false); if (resetAttempt) attempt.current = null; }
  function stopCamera() { scanner.current?.stop(); }
  function nextCustomer() { stopCamera(); clearReview(); setToken(""); setScanState(""); }
  function startCamera() {
    if (!locationId || pending.current || cameraActive) return;
    scanner.current?.dispose(); clearReview(); setToken("");
    const shop = locationId;
    scanner.current = scannerFactory({ video: video.current, canvas: scanCanvas.current,
      onState: state => { if (alive.current) setScanState(state); },
      onToken: value => {
        if (!alive.current || selectedShop.current !== shop || pending.current || document.hidden) return;
        const parsed = parseCheckoutInput(value); if (!parsed) return;
        clearReview(); setToken(parsed); // Scan fills only; the user must review and confirm separately.
      }
    });
    scanner.current.start();
  }
  async function run(path, options, onSuccess) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const controller = new AbortController(); active.current = controller; const timer = setTimeout(() => controller.abort(), 20_000);
    try { const result = await checkoutRequest(transport, path, { ...options, signal: controller.signal }); if (alive.current) onSuccess(result); }
    catch (problem) { if (alive.current) setError(checkoutMessage(problem.code)); }
    finally { clearTimeout(timer); pending.current = false; active.current = null; if (alive.current) setBusy(false); }
  }
  async function loadLocations(page) {
    if (pending.current) return; stopCamera(); clearReview(); setToken(""); setLocationId("");
    await run(`/api/retail-rewards/checkout/locations?page=${page}`, {}, setLocations);
  }
  async function reviewCoupon(event) {
    event.preventDefault(); if (pending.current) return;
    const normalized = parseCheckoutInput(token);
    if (!locationId || !normalized) { setError("Choose your shop and scan its checkout QR or paste the complete private code."); return; }
    stopCamera(); setToken(normalized); clearReview(false);
    await run("/api/retail-rewards/checkout/validate", { method: "POST", body: { token: normalized, locationId } }, result => setReview(result.review));
  }
  async function redeem(event) {
    event.preventDefault(); if (!review || pending.current) return;
    const eligibleSpendMinor = checkoutAmountMinor(amount);
    if (eligibleSpendMinor === null || eligibleSpendMinor < review.terms.minimumSpendMinor || !confirmed) { setError("Enter the qualifying amount, meet the minimum spend and confirm that you checked the offer conditions."); return; }
    const payload = { token, locationId, eligibleSpendMinor, currency: review.terms.currency, termsConfirmed: true };
    stopCamera(); attempt.current = checkoutAttempt(attempt.current, payload); setRetry(true);
    await run("/api/retail-rewards/checkout/redeem", { method: "POST", body: { ...payload, idempotencyKey: attempt.current.key } }, result => { setReceipt(result.receipt); setReview(null); setToken(""); setAmount(""); setConfirmed(false); setRetry(false); attempt.current = null; });
  }
  const summary = review ? shopperCouponSummary(review.terms) : null;
  return <main className={styles.page}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL STAFF CHECKOUT PREVIEW</strong> · Synthetic shop and coupons · No real redemption or payment</p>}
    <div className={styles.container}><a className={styles.back} href="/dashboard/retail/rewards">← Shop offers</a><p className={styles.eyebrow}>RUVANAS REWARDS · SHOP STAFF</p><h1>Redeem a coupon.</h1><p className={styles.lead}>Check the shopper’s code and the purchase conditions, then confirm one redemption.</p><ol className={styles.steps} aria-label="Checkout steps"><li aria-current={!review && !receipt ? "step" : undefined}>1 · Check code</li><li aria-current={review ? "step" : undefined}>2 · Review purchase</li><li aria-current={receipt ? "step" : undefined}>3 · Confirmation</li></ol>
      {receipt ? <section className={styles.receipt} aria-label="Redemption receipt" tabIndex={-1} ref={resultRef}><p className={styles.eyebrow}>{receipt.reversal ? "REDEMPTION REVERSED" : "COUPON REDEEMED"}</p><h2>{receipt.offerTitle}</h2><p>{receipt.shopName}</p><dl><div><dt>Original qualifying amount</dt><dd>{shopperMoney(receipt.eligibleSpendMinor, receipt.currency)}</dd></div><div><dt>Original coupon saving</dt><dd>{receipt.discountMinor === null ? "Apply the published buy/get offer manually" : shopperMoney(receipt.discountMinor, receipt.currency)}</dd></div><div><dt>Recorded</dt><dd>{offerDateLabel(receipt.redeemedAt, "Europe/Malta")} · Europe/Malta</dd></div><div><dt>Confirmation</dt><dd>{receipt.id}</dd></div></dl>{receipt.reversal && <div className={styles.note}><strong>Correction recorded</strong><p>{reversalReasonLabel(receipt.reversal.reason)} · {offerDateLabel(receipt.reversal.reversedAt, "Europe/Malta")} (Europe/Malta).</p><p>The old coupon and checkout code remain used. A fresh claim must meet current terms and limits. No automatic replacement or refund is made; the original receipt stays unchanged.</p></div>}<p className={styles.note}>This records a coupon redemption. Complete the purchase in your normal checkout system; no payment has been processed here.</p><button type="button" className={styles.primary} onClick={nextCustomer}>Check another coupon</button></section> : <div className={styles.columns}>
        <section className={styles.card}><h2>1. Check the code</h2><p className={styles.help}>Use the shopper’s current code. Scanning or reviewing it does not redeem or reserve the offer.</p><form onSubmit={reviewCoupon} noValidate><label className={styles.field}>Your shop<select value={locationId} onChange={event => { stopCamera(); setLocationId(event.target.value); setToken(""); setScanState(""); clearReview(); }} disabled={busy}><option value="">Choose an authorised shop</option>{locations.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          {(locations.hasMore || locations.page > 1) && <div className={styles.pagination}><button type="button" disabled={busy || locations.page <= 1} onClick={() => loadLocations(locations.page - 1)}>Previous shops</button><span>Page {locations.page}</span><button type="button" disabled={busy || !locations.hasMore} onClick={() => loadLocations(locations.page + 1)}>More shops</button></div>}
          <div className={styles.scanner}><div className={styles.scanActions}><button type="button" className={styles.secondary} disabled={busy || !locationId || cameraActive} onClick={startCamera}>Start camera</button>{cameraActive && <button type="button" className={styles.secondary} onClick={stopCamera}>Cancel scanning</button>}</div><p className={styles.help}>Choose your shop, then scan the shopper’s QR. Camera access starts only when you choose it and stops after a scan or one minute.</p><video ref={video} muted playsInline hidden={!cameraActive} className={styles.camera} aria-label="Checkout camera preview" /><canvas ref={scanCanvas} hidden aria-hidden="true" />{scanState && <p role="status" className={styles.scanStatus}>{scannerStatusMessage(scanState)}{scanState === "SUCCESS" && " Select Review coupon when you are ready."}</p>}</div>
          <label className={styles.field}>Checkout code<input type="password" name="checkoutCode" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} onChange={event => { stopCamera(); setToken(event.target.value); setScanState(""); clearReview(); }} disabled={busy} /></label><p className={styles.help}>Or paste the complete private code. If camera access is unavailable, manual entry still works. Never put the code in the page address.</p><button type="submit" className={styles.primary} disabled={busy || !locations.locations.length}>{busy ? "Checking…" : "Review coupon"}</button></form>
          {!locations.locations.length && <p className={styles.note}>No authorised shops are available on this page. Your Client Admin manages staff checkout permissions.</p>}
        </section>
        {review ? <section className={styles.card} tabIndex={-1} ref={resultRef} aria-label="Review coupon before redemption"><p className={styles.eyebrow}>2. REVIEW THE PURCHASE</p><h2>{review.offerTitle}</h2><p className={styles.benefit}>{summary.benefit}</p><p><strong>{review.shopName}</strong> · issued version {review.revision}</p><div className={styles.note}><strong>{summary.spend}</strong><p>{summary.usage}. {summary.daily}.</p><p>Code expires {offerDateLabel(review.tokenExpiresAt, review.terms.timezone)} ({review.terms.timezone}).</p></div><details className={styles.terms} open><summary>Purchase conditions to check</summary><p className={styles.preWrap}>{review.terms.legalTerms}</p>{review.terms.exclusions && <p><strong>Exclusions: </strong>{review.terms.exclusions}</p>}<p>{summary.combinable}. {summary.pause}</p><p>Coupon expires {offerDateLabel(review.claimExpiresAt, review.terms.timezone)} ({review.terms.timezone}).</p></details>
          <form onSubmit={redeem} noValidate><label className={styles.field}>Qualifying purchase amount ({review.terms.currency})<input type="text" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false); setRetry(false); }} placeholder="0.00" disabled={busy} /></label><p className={styles.help}>Enter eligible items only, before this coupon saving. The server checks the minimum and calculates percentage or fixed savings. Buy/get quantities must be checked manually.</p><label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} /><span>I checked the qualifying purchase, exclusions and all issued offer conditions.</span></label><button type="submit" className={styles.primary} disabled={busy || !confirmed}>{busy ? "Confirming…" : retry ? "Retry the same redemption" : "Confirm redemption"}</button><p className={styles.help}>This confirmation uses the coupon once. It does not process payment. If a response is lost, retrying the same details checks the original request.</p></form></section> : <aside className={styles.guidance}><h2>The shop confirms each use.</h2><p>The shopper presents a code. Only authorised shop staff can confirm redemption for the selected shop.</p><p>Use limits and expiry are checked again when you confirm. A successful review is not a reservation.</p></aside>}
      </div>}
      {error && <p className={styles.error} role="alert" ref={!review && !receipt ? resultRef : undefined} tabIndex={-1}>{error}</p>}
    </div>
  </main>;
}
