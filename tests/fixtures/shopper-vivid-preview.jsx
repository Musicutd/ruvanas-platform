import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ShopperVoucherDashboard, { VividIcon } from "../../app/rewards/ShopperVoucherDashboard";
import { createVividShopperPreview } from "./shopper-vivid-preview.mjs";
import styles from "../../app/rewards/shopper-vivid-dashboard.module.css";
import demo from "./shopper-vivid-preview.module.css";

let fixture = createVividShopperPreview();
const euro = amount => new Intl.NumberFormat("en-MT", { style: "currency", currency: "EUR" }).format(amount / 100);
function App() {
  const [, update] = useState(0), [revision, setRevision] = useState(0);
  const [checkout, setCheckout] = useState(null), [receipt, setReceipt] = useState(null), [error, setError] = useState("");
  const [spend, setSpend] = useState(""), [savings, setSavings] = useState(false), [confirming, setConfirming] = useState(false);
  const dialog = useRef(null), modalTitle = useRef(null), restoreFocus = useRef(null), pending = useRef(false);
  const refresh = () => update(value => value + 1);
  window.vividPreview = { fixture, reset() { fixture = createVividShopperPreview(); setCheckout(null); setSavings(false); setReceipt(null); setError(""); setRevision(value => value + 1); refresh(); } };
  const modalOpen = Boolean(checkout || savings);
  useEffect(() => { if (modalOpen) dialog.current?.querySelector("button")?.focus(); }, [modalOpen]);
  useEffect(() => { if (receipt) modalTitle.current?.focus(); }, [receipt]);
  function close() {
    if (checkout && !receipt) fixture.cancelRedemption(checkout.attemptId);
    setCheckout(null); setSavings(false); setReceipt(null); setError("");
    requestAnimationFrame(() => restoreFocus.current?.focus());
  }
  function openCheckout(card) {
    const result = fixture.prepareRedemption(card.id);
    if (!result.ok) { setError(result.error); return; }
    restoreFocus.current = document.activeElement; setCheckout(result); setReceipt(null); setError(""); setSpend((result.suggestedSpendMinor / 100).toFixed(2));
  }
  function confirm(event) {
    event.preventDefault(); if (pending.current || receipt) return;
    pending.current = true; setConfirming(true); setError("");
    const value = spend.trim();
    if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value)) { setError("Enter the qualifying purchase amount, using up to two decimal places."); pending.current = false; setConfirming(false); return; }
    const [whole, cents = ""] = value.replace(",", ".").split(".");
    const amount = Number(whole) * 100 + Number(cents.padEnd(2, "0"));
    const result = fixture.confirmDemoRedemption(checkout.attemptId, amount);
    if (result.ok) { setReceipt(result.receipt); refresh(); }
    else setError(result.error);
    pending.current = false; setConfirming(false);
  }
  function trap(event) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const items = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),summary,a[href]')];
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <ShopperVoucherDashboard key={revision} previewOnly defaultLocation="" cards={fixture.listCards()} savedIds={fixture.savedIDs()} totalSavedMinor={fixture.totalSavedMinor()} onToggleSave={id => { fixture.toggleSave(id); refresh(); }} onRedeem={openCheckout} onSavings={() => { restoreFocus.current = document.activeElement; setSavings(true); }} modalOpen={modalOpen}>
    {modalOpen && <div className={styles.overlay} onClick={event => { if (event.target === event.currentTarget) close(); }}><section className={`${styles.picker} ${demo.checkout}`} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="checkout-title" onKeyDown={trap}>
      <button type="button" className={styles.close} onClick={close} aria-label={savings ? "Close savings" : "Close checkout"}><VividIcon name="close" /></button>
      <p className={styles.eyebrow}>{savings ? "YOUR LITTLE WINS" : "DEMO CHECKOUT · NO REAL PURCHASE"}</p>
      <h2 id="checkout-title" ref={modalTitle} tabIndex={-1}>{savings ? "Your savings so far" : receipt ? "Demo redemption confirmed" : `Redeem at ${checkout.card.shopName}`}</h2>
      {savings ? <><div className={demo.bigTotal}>{euro(fixture.totalSavedMinor())}</div><p>Saved through {fixture.receipts().length} confirmed demo {fixture.receipts().length === 1 ? "redemption" : "redemptions"}.</p><div className={demo.receipts}>{fixture.receipts().map(item => <div key={item.id}><span>{item.shopName}</span><strong>{euro(item.discountMinor)}</strong></div>)}</div><p className={demo.notice}>This preview records simulated shop confirmations. Subscription payments and net benefit are unavailable until real payment records are connected.</p><button className={demo.primary} type="button" onClick={close}>Keep exploring</button></>
      : receipt ? <><div className={demo.success}><VividIcon name="check" width="32" height="32" /><strong>You saved {euro(receipt.discountMinor)}</strong><span>{receipt.shopName}</span></div><dl className={demo.receipt}><div><dt>Qualifying purchase</dt><dd>{euro(receipt.eligibleSpendMinor)}</dd></div><div><dt>Voucher saving</dt><dd>−{euro(receipt.discountMinor)}</dd></div><div><dt>After voucher</dt><dd>{euro(receipt.finalAmountMinor)}</dd></div><div><dt>Uses left</dt><dd>{fixture.listCards().find(card => card.id === receipt.cardId).usesLeft}</dd></div></dl><p className={demo.notice}>The sample shop confirmation updated Total saved. No real voucher was redeemed and no payment was processed.</p><button className={demo.primary} type="button" onClick={close}>Back to my vouchers</button></>
      : <><div className={demo.offerSummary}><span>{checkout.card.benefit}</span><strong>{checkout.card.shopName}</strong><small>{checkout.card.usesLeft} uses left · Valid until {checkout.card.expires}</small></div><p className={demo.notice}>At the shop, staff scan your QR and confirm the eligible purchase. For this local preview, you can simulate that confirmation below.</p><form onSubmit={confirm}><label className={demo.label} htmlFor="demo-spend">Qualifying purchase (€)</label><input className={demo.amount} id="demo-spend" type="text" inputMode="decimal" value={spend} onChange={event => setSpend(event.target.value)} autoComplete="off" maxLength={11} /><small className={demo.minimum}>Minimum {euro(checkout.minimumSpendMinor)} · {checkout.confirmationLabel}</small>{error && <p className={demo.error} role="alert">{error}</p>}<details className={demo.terms}><summary>Voucher terms & conditions</summary><p>{checkout.card.terms}</p></details><button type="submit" className={demo.primary} disabled={confirming}>{confirming ? "Confirming…" : "Confirm demo redemption"}</button></form></>}
    </section></div>}
  </ShopperVoucherDashboard>;
}
createRoot(document.getElementById("root")).render(<App />);
