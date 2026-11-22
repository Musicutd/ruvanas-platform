"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import { safeShopperSavingsSnapshot } from "@/lib/retail-rewards/shopper-savings-contracts.mjs";
import { shopperMoney } from "@/lib/retail-rewards/shopper-ui.mjs";
import { ShopperHeader, ShopperIcon, ShopperNav } from "./ShopperChrome";
import shared from "./shopper-discovery.module.css";
import styles from "./shopper-savings.module.css";

const message = code => ({
  UNAUTHENTICATED: "Sign in with your shopper account to see your savings.",
  FORBIDDEN: "Your shopper access could not be confirmed. Sign in again before checking your savings.",
  FEATURE_DISABLED: "Your savings are not available right now.",
  RATE_LIMITED: "Please wait a moment before refreshing your savings."
})[code] || "We couldn’t verify your savings. Refresh to try again.";
const dateLabel = value => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Malta" }).format(new Date(value));

function Benefit({ row }) {
  if (row.netBenefitMinor === null) return <>
    <p className={styles.benefitValue}>Not available yet</p>
    <p>{row.subscriptionPaidMinor === null ? "Your subscription payment total is not available yet. We’ll show your net benefit when it can be verified." : "Some redeemed offers have no recorded money value. Your net benefit cannot be calculated yet."}</p>
  </>;
  const value = shopperMoney(Math.abs(row.netBenefitMinor), row.currency);
  return <>
    <p className={styles.benefitValue}>{row.netBenefitMinor > 0 ? "+" : row.netBenefitMinor < 0 ? "−" : ""}{value}</p>
    <p>{row.netBenefitMinor > 0 ? `With Ruvanas, you have an extra ${value} in your pocket so far.`
      : row.netBenefitMinor === 0 ? "Your recorded coupon savings have covered your subscription payments so far."
      : `You’re ${value} away from covering your subscription payments with coupon savings.`}</p>
  </>;
}

export default function ShopperSavingsClient({ initialData = null, transport = checkoutTransport, previewOnly = false, onBrowse, onWallet, onAccount }) {
  const [snapshot, setSnapshot] = useState(() => safeShopperSavingsSnapshot(initialData));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => initialData && !safeShopperSavingsSnapshot(initialData) ? message(initialData.code) : "");
  const epoch = useRef(0), active = useRef(null), alive = useRef(true), heading = useRef(null), errorFocus = useRef(null);
  useEffect(() => { alive.current = true; heading.current?.focus(); return () => { alive.current = false; epoch.current++; active.current?.abort(); }; }, []);
  useEffect(() => {
    epoch.current++; active.current?.abort(); active.current = null;
    const next = safeShopperSavingsSnapshot(initialData);
    setSnapshot(next); setBusy(false); setError(initialData && !next ? message(initialData.code) : "");
  }, [initialData]);
  useEffect(() => { if (error) errorFocus.current?.focus(); }, [error]);

  async function refresh() {
    active.current?.abort(); const controller = new AbortController(), sequence = ++epoch.current;
    active.current = controller; setBusy(true); setError(""); setSnapshot(null);
    const current = () => alive.current && sequence === epoch.current;
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await checkoutRequest(transport, "/api/rewards/savings", { signal: controller.signal });
      const next = safeShopperSavingsSnapshot(result);
      if (!next) throw new Error("Invalid savings snapshot");
      if (current()) setSnapshot(next);
    } catch (problem) { if (current()) setError(message(problem.code)); }
    finally { clearTimeout(timer); if (current()) { setBusy(false); active.current = null; } }
  }

  return <main className={shared.page}>
    {previewOnly && <div className={shared.previewBanner}><strong>LOCAL PREVIEW</strong> · Example savings · No payments or live accounts</div>}
    <ShopperHeader onHome={onBrowse} />
    <div className={`${shared.container} ${styles.container}`}>
      <section className={styles.heading}>
        <div><p className={shared.stepLabel}>YOUR REWARDS</p><h1 tabIndex={-1} ref={heading}>My savings</h1><p>See what your vouchers have saved you.</p></div>
        <button type="button" className={shared.secondary} onClick={refresh} disabled={busy}>{busy ? "Checking…" : "Refresh savings"}</button>
      </section>
      {busy && <p role="status" className={styles.notice}>Checking your savings. Previous totals are hidden while we check.</p>}
      {error && <p role="alert" tabIndex={-1} ref={errorFocus} className={shared.error}>{error}</p>}
      {!snapshot && !busy && !error && <p className={styles.notice}>Refresh to check your recorded savings.</p>}
      {snapshot && <>
        <p className={styles.timestamp}>All time · checked <time dateTime={snapshot.checkedAt}>{dateLabel(snapshot.checkedAt)}</time> Malta time.</p>
        {snapshot.currencies.length === 0 && <section className={styles.empty}><ShopperIcon name="savings" width="32" height="32" /><h2>Your savings start here</h2><p>No coupon savings have been recorded yet. Browse the shops and use a voucher on your next visit.</p><p>{snapshot.paymentEvidence === "UNAVAILABLE" ? "Your subscription payment total is not available yet." : "No settled subscription payments have been recorded."}</p><a href="/rewards" onClick={onBrowse ? event => { event.preventDefault(); onBrowse(); } : undefined} className={shared.primary}>Explore vouchers</a></section>}
        {snapshot.currencies.map(row => <section className={styles.currencySection} key={row.currency} aria-label={`${row.currency} savings`}>
          <div className={styles.currencyHeading}><span>{row.currency}</span><p>Your savings so far</p></div>
          <dl className={styles.totals}>
            <div><dt>Subscription paid</dt><dd>{row.subscriptionPaidMinor === null ? "Not available" : shopperMoney(row.subscriptionPaidMinor, row.currency)}<small style={{display:"block",fontSize:11,fontWeight:400,letterSpacing:0,marginTop:10,color:"#586677"}}>Payments after refunds</small></dd></div>
            <div><dt>Coupon savings</dt><dd>{shopperMoney(row.couponSavingsMinor, row.currency)}<small style={{display:"block",fontSize:11,fontWeight:400,letterSpacing:0,marginTop:10,color:"#586677"}}>{row.valuedRedemptions} {row.valuedRedemptions === 1 ? "valued redemption" : "valued redemptions"}</small></dd></div>
          </dl>
          <div className={styles.benefit} data-tone={row.netBenefitMinor > 0 ? "positive" : "neutral"}>
            <span className={styles.cardAccent} aria-hidden="true"><ShopperIcon name="savings" /></span>
            <h2>Your net benefit</h2><Benefit row={row} />
          </div>
          {row.unvaluedRedemptions > 0 && <p className={styles.notice}>{row.unvaluedRedemptions} {row.unvaluedRedemptions === 1 ? "redeemed offer has" : "redeemed offers have"} no recorded money value and {row.unvaluedRedemptions === 1 ? "is" : "are"} excluded from the coupon savings shown above.</p>}
        </section>)}
        <details className={styles.explanation}><summary>How your savings are counted</summary><p>Coupon savings come from confirmed redemptions with a recorded money value. Saved or unused vouchers do not count. Reversed redemptions are removed.</p><p>Net benefit is coupon savings minus your subscription payments after refunds. It appears only when both totals can be verified for the same currency and period.</p><p>Different currencies are shown separately. These totals record coupon savings; they do not process a payment or refund.</p></details>
      </>}
    </div>
    <ShopperNav active="savings" onExplore={onBrowse} onWallet={onWallet} onAccount={onAccount} />
  </main>;
}
