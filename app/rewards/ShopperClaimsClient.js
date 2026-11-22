"use client";

import { useEffect, useRef, useState } from "react";
import { shopperCouponSummary, shopperMoney, shopperVoucherUsage } from "@/lib/retail-rewards/shopper-ui.mjs";
import { offerDateLabel } from "@/lib/retail-rewards/offer-ui.mjs";
import { checkoutAttempt, checkoutMessage, checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import styles from "./shopper-claims.module.css";
import { reversalReasonLabel } from "@/lib/retail-rewards/reversal-ui.mjs";
import { renderCheckoutQr } from "@/lib/retail-rewards/checkout-qr.mjs";
import { ShopperHeader, ShopperNav } from "./ShopperChrome";
import shopperStyles from "./shopper-discovery.module.css";

function CheckoutQr({ token }) {
  const canvas = useRef(null), [state, setState] = useState("PREPARING");
  useEffect(() => {
    let cancelled = false;
    const target = canvas.current, staging = document.createElement("canvas");
    setState("PREPARING"); target?.getContext("2d")?.clearRect(0, 0, target.width, target.height);
    // Render away from the visible element. A stale asynchronous result must
    // never overwrite the currently displayed token's QR after rotation.
    renderCheckoutQr(staging, token).then(() => {
      if (cancelled || !target || document.hidden) return;
      target.width = staging.width; target.height = staging.height;
      target.getContext("2d").drawImage(staging, 0, 0); setState("READY");
    }).catch(() => { if (!cancelled) setState("UNAVAILABLE"); }).finally(() => { staging.width = 0; staging.height = 0; });
    return () => { cancelled = true; if (target) { target.width = 0; target.height = 0; } staging.width = 0; staging.height = 0; };
  }, [token]);
  return <div className={styles.qr}><canvas ref={canvas} role="img" aria-label="Private checkout QR code" hidden={state !== "READY"} />{state !== "READY" && <p className={styles.help} role="status">{state === "PREPARING" ? "Preparing your QR code…" : "QR code unavailable. Use the private text code below."}</p>}<p className={styles.help}>Shop staff can scan this QR or enter the same code below. Scanning alone does not redeem your coupon.</p></div>;
}

function ClaimUsage({ claim, compact = false }) {
  const usage = shopperVoucherUsage(claim);
  return <div className={compact ? styles.walletUsage : styles.usagePanel} aria-label="Your voucher uses">
    <span className={styles.usageType}>{claim.terms.usage === "REUSABLE" ? "Reusable voucher" : "Single-use voucher"}</span>
    <strong>{usage.known ? usage.label : "Uses left unavailable"}</strong>
    {usage.known && <div className={styles.usageTrack} aria-hidden="true"><span style={{ width: `${100 * usage.remaining / usage.limit}%` }} /></div>}
    <p>{!usage.known ? `${usage.label}. Refresh to check uses left.` : usage.exhausted ? "All uses under these terms have been used." : "Only completed, non-reversed redemptions count."}</p>
    {!compact && usage.known && <p>Checked {offerDateLabel(usage.asOf, claim.terms.timezone)} ({claim.terms.timezone}). Daily limits and availability are still checked at checkout.</p>}
  </div>;
}

function WalletClaimCard({ claim, onOpen }) {
  const summary = shopperCouponSummary(claim.terms);
  const history = claim.status === "REDEEMED" || claim.status === "REVERSED";
  return <article className={styles.card}>
    <div className={styles.topline}><span className={styles.walletBrand}>RUVANAS REWARDS</span><span className={styles.badge}>{claim.status.toLowerCase().replaceAll("_", " ")}</span></div>
    <p className={styles.walletBenefit}>{summary.benefit}</p><h2>{claim.shop.name}</h2><p>{claim.terms.title}</p>
    <ClaimUsage claim={claim} compact />
    <p className={styles.walletExpiry}>Checkout voucher expires {offerDateLabel(claim.expiresAt, claim.terms.timezone)} · {claim.terms.timezone}</p>
    {history && <p className={styles.walletState}>This voucher stays used. Any remaining uses require a new voucher from the offer.</p>}
    {claim.status === "EXPIRED" && <p className={styles.walletState}>This checkout voucher has expired. Any remaining uses require a new voucher from the offer.</p>}
    {claim.status === "UNAVAILABLE" && <p className={styles.walletState}>This voucher is currently unavailable, even if uses remain.</p>}
    <button type="button" className={styles.secondary} onClick={() => onOpen(claim)} aria-label={history ? `View receipt for ${claim.terms.title}` : `Open coupon ${claim.terms.title}`}>{history ? "View receipt →" : "Open voucher →"}</button>
  </article>;
}

function Receipt({ receipt }) {
  return <section className={styles.receipt} aria-label="Coupon receipt"><p className={styles.eyebrow}>{receipt.reversal ? "REDEMPTION REVERSED" : "REDEMPTION CONFIRMED"}</p><h3>{receipt.offerTitle}</h3><p>{receipt.shopName}</p><dl><div><dt>Original qualifying purchase</dt><dd>{shopperMoney(receipt.eligibleSpendMinor, receipt.currency)}</dd></div><div><dt>Original coupon saving</dt><dd>{receipt.discountMinor === null ? "Applied manually by the shop" : shopperMoney(receipt.discountMinor, receipt.currency)}</dd></div><div><dt>Recorded</dt><dd>{offerDateLabel(receipt.redeemedAt, "Europe/Malta")} · Europe/Malta</dd></div><div><dt>Confirmation</dt><dd>{receipt.id}</dd></div></dl>{receipt.reversal && <div className={styles.notice}><strong>Correction recorded</strong><p>{reversalReasonLabel(receipt.reversal.reason)} · {offerDateLabel(receipt.reversal.reversedAt, "Europe/Malta")} (Europe/Malta).</p><p>This old coupon and its code remain used. Get a fresh coupon if you still meet the offer’s current terms and limits. A replacement is not guaranteed.</p><p>No payment or refund was processed. The original receipt remains unchanged.</p></div>}<p className={styles.help}>This confirms coupon redemption. It is not a payment receipt or proof of purchase.</p></section>;
}

function IssuedClaim({ claim, transport = checkoutTransport, onUpdate, compact = false }) {
  const [code, setCode] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const pending = useRef(false), active = useRef(null), alive = useRef(true), codeEpoch = useRef(0);
  function clearCode() { codeEpoch.current++; active.current?.abort(); setCode(null); }
  useEffect(() => {
    alive.current = true;
    const hidden = () => { if (document.hidden) clearCode(); }, leaving = () => clearCode();
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", leaving);
    return () => { alive.current = false; codeEpoch.current++; active.current?.abort(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leaving); };
  }, []);
  useEffect(() => { clearCode(); setMessage(""); setError(""); }, [claim.id, claim.status]);
  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(() => { clearCode(); setMessage("The checkout code has expired. Request a fresh code if this coupon is still available."); }, Math.max(0, Date.parse(code.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [code]);
  const summary = shopperCouponSummary(claim.terms), ready = claim.status === "READY" && Date.parse(claim.expiresAt) > Date.now();
  async function showCode() {
    if (!ready || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage(""); setCode(null); const epoch = ++codeEpoch.current;
    const controller = new AbortController(); active.current = controller; const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await checkoutRequest(transport, `/api/rewards/claims/${encodeURIComponent(claim.id)}/credential`, { method: "POST", body: {}, signal: controller.signal });
      if (!alive.current || epoch !== codeEpoch.current || document.hidden) return;
      if (result.claim?.id !== claim.id || result.claim.status !== "READY" || result.claim.receipt !== null || !/^[a-f0-9]{64}$/.test(result.token || "") || !Number.isFinite(Date.parse(result.tokenExpiresAt)) || Date.parse(result.tokenExpiresAt) <= Date.now()) throw new Error("Invalid code response");
      onUpdate?.(result.claim); setCode({ token: result.token, expiresAt: result.tokenExpiresAt });
    } catch (problem) { if (alive.current && epoch === codeEpoch.current) setError(checkoutMessage(problem.code)); }
    finally { clearTimeout(timer); pending.current = false; active.current = null; if (alive.current) setBusy(false); }
  }
  async function copyCode() {
    if (!code || Date.parse(code.expiresAt) <= Date.now()) { setCode(null); return; }
    try { await navigator.clipboard.writeText(code.token); setMessage("Code copied. Share it only with staff at this shop."); }
    catch { setMessage("Copy is unavailable here. Select the code and copy it manually."); }
  }
  return <section className={styles.detail} aria-label="Your issued coupon">
    <div className={styles.topline}><span className={styles.badge}>{claim.status === "REVERSED" ? "Redemption reversed" : claim.status === "REDEEMED" ? "Redeemed" : ready ? "Ready for checkout" : "Not available"}</span><span className={styles.help}>Issued terms · version {claim.revision}</span></div>
    {!compact && <><p className={styles.benefit}>{summary.benefit}</p><h3>{claim.terms.title}</h3><p className={styles.shop}>{claim.shop.name}</p></>}
    <ClaimUsage claim={claim} />
    {claim.receipt ? <Receipt receipt={claim.receipt} /> : ready ? <section className={styles.checkoutBox} aria-label="Show at checkout"><h4>Show this at the shop</h4><p>Staff at <strong>{claim.shop.name}</strong> confirm your redemption. Showing the code does not use the voucher.</p>
      {code ? <><p className={styles.help}>Show this private code to staff. It expires at {offerDateLabel(code.expiresAt, claim.terms.timezone)} ({claim.terms.timezone}).</p><CheckoutQr token={code.token} /><output aria-label="Checkout code" className={styles.code}>{code.token}</output><div className={styles.actions}><button type="button" className={styles.primary} onClick={copyCode}>Copy code</button><button type="button" className={styles.secondary} onClick={() => { clearCode(); setMessage("Code hidden. A fresh code replaces the previous one."); }}>Hide code</button></div></> : <button type="button" className={styles.primary} disabled={busy} onClick={showCode}>{busy ? "Preparing code…" : "Show checkout code"}</button>}
      {code && <button type="button" className={styles.textButton} disabled={busy} onClick={showCode}>Get a fresh code</button>}<p className={styles.help}>Codes expire within five minutes and hide when you leave this page. A fresh code replaces the previous one.</p>
    </section> : <p className={styles.notice}>This issued coupon cannot currently be used. Refresh your coupons to check its latest status.</p>}
    <details className={styles.terms}><summary>Voucher conditions and limits</summary><dl className={styles.facts}><div><dt>Minimum spend</dt><dd>{summary.spend}</dd></div><div><dt>Coupon expires</dt><dd>{offerDateLabel(claim.expiresAt, claim.terms.timezone)}<small>{claim.terms.timezone}</small></dd></div><div><dt>Offer use limits</dt><dd>{summary.usage}<small>{summary.daily}</small></dd></div></dl><p>{claim.terms.description}</p><p className={styles.preWrap}>{claim.terms.legalTerms}</p>{claim.terms.exclusions && <p><strong>Exclusions: </strong>{claim.terms.exclusions}</p>}<p>{summary.combinable}. {summary.pause}</p><p>The offer allows up to {claim.terms.totalLimit} successful uses across all shoppers. These limits are checked at checkout; a coupon does not reserve a use.</p><p>Offer dates: {summary.starts} to {summary.ends} ({claim.terms.timezone}).</p></details>
    {claim.terms.usage === "REUSABLE" && <p className={styles.help}>After a successful use, return to the offer to get a new coupon. Lifetime and daily use limits still apply.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.notice} role="status">{message}</p>}
  </section>;
}

export function ClaimOfferAction({ shopSlug, offer, transport = checkoutTransport }) {
  const [claim, setClaim] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const attempt = useRef(null), pending = useRef(false), active = useRef(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); attempt.current = null; }; }, []);
  async function getCoupon() {
    if (pending.current || claim) return;
    const payload = { shopSlug, offerSlug: offer.slug, expectedRevision: offer.revision };
    attempt.current = checkoutAttempt(attempt.current, payload);
    pending.current = true; setBusy(true); setError("");
    const controller = new AbortController(); active.current = controller; const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await checkoutRequest(transport, "/api/rewards/claims", { method: "POST", body: { ...payload, idempotencyKey: attempt.current.key }, signal: controller.signal });
      if (alive.current) { setClaim(result.claim); attempt.current = null; }
    } catch (problem) { if (alive.current) setError(checkoutMessage(problem.code)); }
    finally { clearTimeout(timer); pending.current = false; active.current = null; if (alive.current) setBusy(false); }
  }
  if (claim) return <IssuedClaim key={claim.id} claim={claim} transport={transport} onUpdate={setClaim} compact />;
  return <section className={styles.claimAction} aria-label="Get this coupon"><h3>Ready to use your voucher?</h3><p>Get a voucher for these terms, then show its checkout code to the shop.</p><button type="button" className={styles.primary} disabled={busy} onClick={getCoupon}>{busy ? "Getting your coupon…" : error ? "Retry getting coupon" : "Get coupon"}</button><p className={styles.help}>Only staff-confirmed redemption uses your allowance. Getting a voucher does not reserve availability.</p>{error && <p className={styles.error} role="alert">{error}</p>}</section>;
}

export default function ShopperClaimsClient({ initialData, transport = checkoutTransport, previewOnly = false, onBrowse, onSavings, onAccount }) {
  const [data, setData] = useState({ claims: [], page: 1, hasMore: false, ...initialData }), [selected, setSelected] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(initialData?.ok === false ? checkoutMessage(initialData.code) : "");
  const active = useRef(null), sequence = useRef(0);
  useEffect(() => () => { sequence.current++; active.current?.abort(); }, []);
  async function refresh(page = data.page) {
    active.current?.abort(); const request = ++sequence.current, controller = new AbortController(); active.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000); setBusy(true); setError(""); setSelected(null); setData({ claims: [], page, hasMore: false });
    try { const result = await checkoutRequest(transport, `/api/rewards/claims?page=${page}`, { signal: controller.signal }); if (sequence.current === request) setData(result); }
    catch (problem) { if (sequence.current === request) setError(checkoutMessage(problem.code)); }
    finally { clearTimeout(timer); if (sequence.current === request) { setBusy(false); active.current = null; } }
  }
  function updateClaim(claim) { setSelected(claim); setData(current => ({ ...current, claims: current.claims.map(item => item.id === claim.id ? claim : item) })); }
  return <main className={`${styles.page} ${shopperStyles.page}`}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL PREVIEW</strong> · Sample vouchers only · No live checkout or accounts</p>}
    <ShopperHeader onHome={onBrowse} />
    <div className={styles.container}><div className={styles.heading}><div><p className={styles.eyebrow}>YOUR REWARDS</p><h1>My vouchers</h1><p>Ready for your next visit. Open a voucher to show it at the shop.</p></div><button type="button" className={styles.secondary} disabled={busy} onClick={() => refresh()}>Refresh vouchers</button></div>
      {selected ? <><button type="button" className={styles.textButton} onClick={() => setSelected(null)}>← Back to my vouchers</button><IssuedClaim key={selected.id} claim={selected} transport={transport} onUpdate={updateClaim} /></> : <section className={styles.cards} aria-label="Your coupons">{data.claims.map(claim => <WalletClaimCard key={claim.id} claim={claim} onOpen={setSelected} />)}</section>}
      {!selected && !busy && !error && data.claims.length === 0 && <p className={styles.notice}>No coupons on this page. Browse a shop’s offers to get one, or continue to the next page if available.</p>}
      {busy && <p role="status">Loading your coupons…</p>}{error && <p className={styles.error} role="alert">{error}</p>}
      {!selected && !error && <div className={styles.pagination}><button type="button" className={styles.secondary} disabled={busy || data.page <= 1} onClick={() => refresh(data.page - 1)}>← Previous</button><span>Page {data.page}</span><button type="button" className={styles.secondary} disabled={busy || !data.hasMore} onClick={() => refresh(data.page + 1)}>Next →</button></div>}
      <footer className={styles.footer}>A checkout code is private and temporary. The shop must validate it before applying the offer. This is coupon confirmation, not payment processing.</footer>
    </div>
    <ShopperNav active="wallet" onExplore={onBrowse} onSavings={onSavings} onAccount={onAccount} />
  </main>;
}
