"use client";

import { useEffect, useRef, useState } from "react";
import { shopperCouponSummary, shopperMoney } from "@/lib/retail-rewards/shopper-ui.mjs";
import { offerDateLabel } from "@/lib/retail-rewards/offer-ui.mjs";
import { checkoutAttempt, checkoutMessage, checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import styles from "./shopper-claims.module.css";
import { reversalReasonLabel } from "@/lib/retail-rewards/reversal-ui.mjs";
import { renderCheckoutQr } from "@/lib/retail-rewards/checkout-qr.mjs";

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

function Receipt({ receipt }) {
  return <section className={styles.receipt} aria-label="Coupon receipt"><p className={styles.eyebrow}>{receipt.reversal ? "REDEMPTION REVERSED" : "REDEMPTION CONFIRMED"}</p><h3>{receipt.offerTitle}</h3><p>{receipt.shopName}</p><dl><div><dt>Original qualifying purchase</dt><dd>{shopperMoney(receipt.eligibleSpendMinor, receipt.currency)}</dd></div><div><dt>Original coupon saving</dt><dd>{receipt.discountMinor === null ? "Applied manually by the shop" : shopperMoney(receipt.discountMinor, receipt.currency)}</dd></div><div><dt>Recorded</dt><dd>{offerDateLabel(receipt.redeemedAt, "Europe/Malta")} · Europe/Malta</dd></div><div><dt>Confirmation</dt><dd>{receipt.id}</dd></div></dl>{receipt.reversal && <div className={styles.notice}><strong>Correction recorded</strong><p>{reversalReasonLabel(receipt.reversal.reason)} · {offerDateLabel(receipt.reversal.reversedAt, "Europe/Malta")} (Europe/Malta).</p><p>This old coupon and its code remain used. Get a fresh coupon if you still meet the offer’s current terms and limits. A replacement is not guaranteed.</p><p>No payment or refund was processed. The original receipt remains unchanged.</p></div>}<p className={styles.help}>This confirms coupon redemption. It is not a payment receipt or proof of purchase.</p></section>;
}

function IssuedClaim({ claim, transport = checkoutTransport, onUpdate }) {
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
    <p className={styles.benefit}>{summary.benefit}</p><h3>{claim.terms.title}</h3><p className={styles.shop}>{claim.shop.name}</p>
    <dl className={styles.facts}><div><dt>Minimum spend</dt><dd>{summary.spend}</dd></div><div><dt>Coupon expires</dt><dd>{offerDateLabel(claim.expiresAt, claim.terms.timezone)}<small>{claim.terms.timezone}</small></dd></div><div><dt>Offer use limits</dt><dd>{summary.usage}<small>{summary.daily}</small></dd></div></dl>
    <details className={styles.terms}><summary>Read the issued conditions</summary><p>{claim.terms.description}</p><p className={styles.preWrap}>{claim.terms.legalTerms}</p>{claim.terms.exclusions && <p><strong>Exclusions: </strong>{claim.terms.exclusions}</p>}<p>{summary.combinable}. {summary.pause}</p><p>The offer allows up to {claim.terms.totalLimit} successful uses across all shoppers. These limits are checked by the server at checkout; a coupon does not reserve a use.</p><p>Offer dates: {summary.starts} to {summary.ends} ({claim.terms.timezone}).</p></details>
    {claim.receipt ? <Receipt receipt={claim.receipt} /> : ready ? <section className={styles.checkoutBox} aria-label="Show at checkout"><h4>Ready to use it at the shop?</h4><p>Ask staff at <strong>{claim.shop.name}</strong> to review your code and confirm the redemption. You cannot redeem it yourself.</p>
      {code ? <><p className={styles.help}>Show this private code to staff. It expires at {offerDateLabel(code.expiresAt, claim.terms.timezone)} ({claim.terms.timezone}).</p><CheckoutQr token={code.token} /><output aria-label="Checkout code" className={styles.code}>{code.token}</output><div className={styles.actions}><button type="button" className={styles.primary} onClick={copyCode}>Copy code</button><button type="button" className={styles.secondary} onClick={() => { clearCode(); setMessage("Code hidden. A fresh code replaces the previous one."); }}>Hide code</button></div></> : <button type="button" className={styles.primary} disabled={busy} onClick={showCode}>{busy ? "Preparing code…" : "Show checkout code"}</button>}
      <button type="button" className={styles.textButton} disabled={busy} onClick={showCode}>Get a fresh code</button><p className={styles.help}>A fresh code invalidates the previous code. Codes last at most five minutes. Both QR and text clear when you hide this page or leave it.</p>
    </section> : <p className={styles.notice}>This issued coupon cannot currently be used. Refresh your coupons to check its latest status.</p>}
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
  if (claim) return <IssuedClaim key={claim.id} claim={claim} transport={transport} onUpdate={setClaim} />;
  return <section className={styles.claimAction} aria-label="Get this coupon"><h3>Use this offer at the shop</h3><p>Get a coupon for the published conditions above, then show a short-lived code to shop staff at checkout. Staff confirm the redemption.</p><button type="button" className={styles.primary} disabled={busy} onClick={getCoupon}>{busy ? "Getting your coupon…" : error ? "Retry getting coupon" : "Get coupon"}</button><p className={styles.help}>Getting a coupon does not reserve availability or count as a redemption. Each repeat use needs a fresh coupon.</p>{error && <p className={styles.error} role="alert">{error}</p>}</section>;
}

export default function ShopperClaimsClient({ initialData, transport = checkoutTransport, previewOnly = false }) {
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
  return <main className={styles.page}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL SHOPPER PREVIEW</strong> · Sample coupons only · No live checkout or accounts</p>}
    <header className={styles.header}><a href="/rewards">RUVANAS <strong>Rewards</strong></a><span>Shopper</span></header>
    <div className={styles.container}><a className={styles.back} href="/rewards">← Browse shops</a><div className={styles.heading}><div><p className={styles.eyebrow}>YOUR COUPONS</p><h1>Ready for your next visit.</h1><p>Open an issued coupon to see its conditions and show a code to shop staff.</p></div><button type="button" className={styles.secondary} disabled={busy} onClick={() => refresh()}>Refresh coupons</button></div>
      {selected ? <><button type="button" className={styles.textButton} onClick={() => setSelected(null)}>← Back to your coupons</button><IssuedClaim key={selected.id} claim={selected} transport={transport} onUpdate={updateClaim} /></> : <section className={styles.cards} aria-label="Your coupons">{data.claims.map(claim => <article className={styles.card} key={claim.id}><div className={styles.topline}><span className={styles.badge}>{claim.status.toLowerCase().replaceAll("_", " ")}</span><span className={styles.help}>Version {claim.revision}</span></div><h2>{claim.terms.title}</h2><p>{claim.shop.name}</p><p className={styles.help}>Expires {offerDateLabel(claim.expiresAt, claim.terms.timezone)} · {claim.terms.timezone}</p><button type="button" className={styles.secondary} onClick={() => setSelected(claim)} aria-label={`Open coupon ${claim.terms.title}`}>Open coupon →</button></article>)}</section>}
      {!selected && !busy && !error && data.claims.length === 0 && <p className={styles.notice}>No coupons on this page. Browse a shop’s offers to get one, or continue to the next page if available.</p>}
      {busy && <p role="status">Loading your coupons…</p>}{error && <p className={styles.error} role="alert">{error}</p>}
      {!selected && !error && <div className={styles.pagination}><button type="button" className={styles.secondary} disabled={busy || data.page <= 1} onClick={() => refresh(data.page - 1)}>← Previous</button><span>Page {data.page}</span><button type="button" className={styles.secondary} disabled={busy || !data.hasMore} onClick={() => refresh(data.page + 1)}>Next →</button></div>}
      <footer className={styles.footer}>A checkout code is private and temporary. The shop must validate it before applying the offer. This is coupon confirmation, not payment processing.</footer>
    </div>
  </main>;
}
