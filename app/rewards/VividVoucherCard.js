"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { categoryPalette, displayVoucherNumber, verifiedCardCode, voucherQrMatrix } from "@/lib/retail-rewards/vivid-voucher-ui.mjs";
import styles from "./vivid-voucher-card.module.css";

function Icon({ name, ...props }) {
  const paths = {
    contactless: <><path d="M7 9a5 5 0 0 1 0 6M11 6a9 9 0 0 1 0 12M15 3a13 13 0 0 1 0 18" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    flip: <><path d="M5 8a8 8 0 1 1-1 9M5 3v5H0" /></>,
    dining: <><path d="M5 3v6c0 3 6 3 6 0V3M8 3v18M19 3v18M19 3c-4 2-5 9 0 10" /></>,
    tech: <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" />,
    fashion: <><path d="M5 8h14l1 13H4L5 8Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    coffee: <><path d="M4 8h13v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8ZM17 9h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3m4-3v3" /></>,
    entertainment: <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="m3 8 17-5-1-3L2 5l1 3Zm4-4 3 3m3-5 3 3M8 13h8" /></>,
    wellness: <><path d="M20 4c-3-3-7-1-8 1-1-2-5-4-8-1-5 5 3 12 8 16 5-4 13-11 8-16Z" /><path d="M5 10h4l2-3 2 7 2-4h4" /></>
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.bookmark}</svg>;
}

function Chip() {
  return <span className={styles.chip} aria-hidden="true"><svg viewBox="0 0 48 36" fill="none"><rect x=".5" y=".5" width="47" height="35" rx="5" stroke="#ac862d" /><path d="M17 0v11H0m17 25V25H0m31-25v11h17M31 36V25h17M0 18h16m16 0h16M17 11h14v14H17z" stroke="#927330" strokeWidth="1.2" /><path d="M2 3h10M34 32h10" stroke="#fff4bd" strokeWidth="1.6" /></svg></span>;
}

export function voucherAccessibleName(card) {
  return typeof card.accessibleName === "string" && card.accessibleName.trim()
    ? card.accessibleName : card.shopName || "Ruvanas";
}

export default function VividVoucherCard({ card, saved = false, onSave, onRedeem, onCopy, previewOnly = false, compact = false }) {
  const [flipped, setFlipped] = useState(false), [notice, setNotice] = useState("");
  const [time, setTime] = useState(() => Date.now());
  const front = useRef(null), back = useRef(null), alive = useRef(true), toastTimer = useRef(null);
  const palette = categoryPalette(card.category), name = card.shopName || "Ruvanas", accessibleName = voucherAccessibleName(card);
  const code = verifiedCardCode(card, { previewOnly, now: time });
  const qr = useMemo(() => code ? voucherQrMatrix(card.qrPayload, { previewOnly, credentialExpiresAt: card.credentialExpiresAt, now: time }) : null,
    [code, card.qrPayload, card.credentialExpiresAt, previewOnly, time]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(toastTimer.current); }; }, []);
  useEffect(() => {
    setFlipped(false); setNotice(""); setTime(Date.now());
    if (!previewOnly && card.credentialExpiresAt) {
      const timer = setTimeout(() => { setTime(Date.now()); setNotice("Your checkout code has expired. Prepare a fresh code at checkout."); }, Math.max(0, Date.parse(card.credentialExpiresAt) - Date.now()));
      return () => clearTimeout(timer);
    }
  }, [card.id, card.code, card.qrPayload, card.credentialExpiresAt, previewOnly]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { setFlipped(false); setNotice(""); setTime(Date.now()); } };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  function announce(value) {
    clearTimeout(toastTimer.current); setNotice(value);
    toastTimer.current = setTimeout(() => { if (alive.current) setNotice(""); }, 3500);
  }
  function flip(next) {
    setFlipped(next); setTime(Date.now());
    requestAnimationFrame(() => (next ? back.current : front.current)?.focus({ preventScroll: true }));
  }
  async function copy() {
    if (!code || !verifiedCardCode(card, { previewOnly })) { announce("Prepare a fresh code at checkout."); return; }
    try {
      await navigator.clipboard.writeText(code);
      if (alive.current) { announce("Code copied"); onCopy?.(code); }
    } catch { if (alive.current) announce("Copy is unavailable. Select the code to copy it manually."); }
  }
  const remaining = typeof card.usesLabel === "string" ? card.usesLabel : Number.isInteger(card.usesLeft) && card.usesLeft >= 0 ? `${card.usesLeft} ${card.usesLeft === 1 ? "use" : "uses"} left` : "Check uses at checkout";
  const unavailable = card.disabled || card.usesLeft === 0;
  return <article className={`${styles.card} ${compact ? styles.compact : ""}`} data-voucher-id={card.id} data-voucher-ratio data-testid="voucher-ratio" data-palette={palette} data-flipped={flipped ? "true" : "false"} aria-label={`${accessibleName} ${card.benefit} voucher`}>
    <div className={styles.rotor}>
      <button type="button" ref={front} className={`${styles.face} ${styles.front}`} data-voucher-face="front" onClick={() => flip(true)} tabIndex={flipped ? -1 : 0} aria-hidden={flipped} aria-label={`Flip ${accessibleName} voucher`} aria-expanded={flipped}>
        <span className={styles.sheen} aria-hidden="true" />
        <span className={styles.topline}><span className={styles.merchantIcon}><Icon name={palette} /></span><span className={styles.merchant}><strong>{name}</strong><span>{card.subtitle || "A little more for you."}</span></span><span className={styles.category}>{card.category}</span></span>
        <span className={styles.middle}><span className={styles.smartCard}><Chip /><Icon name="contactless" width="18" height="21" /></span><span className={styles.offer}><strong className={String(card.benefit).length > 13 ? styles.longBenefit : ""}>{card.benefit}</strong><span>{remaining}</span></span></span>
        <span className={styles.bottomline}><span className={styles.number}>{displayVoucherNumber(card.number)}</span><span className={styles.bottomRight}>{saved && <span className={styles.walletBadge}><Icon name="bookmark" width="11" height="11" />Wallet</span>}<span className={styles.expiry}><small>Valid thru</small><strong>{card.expires || "See terms"}</strong></span></span></span>
      </button>
      <section className={`${styles.face} ${styles.back}`} data-voucher-face="back" aria-hidden={!flipped}>
        <div className={styles.stripe}><span>RUVANAS · {previewOnly ? "DEMO PASS" : "REWARDS PASS"}</span><button ref={back} type="button" onClick={() => flip(false)} tabIndex={flipped ? 0 : -1} aria-label={`Back to ${accessibleName} voucher`}><Icon name="flip" width="13" height="13" />Flip back</button></div>
        <div className={styles.backContent}>
          {qr ? <svg className={styles.qr} viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={previewOnly ? "Sample voucher QR code" : "Private checkout QR code"} shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="white" /><path d={qr.path} fill="#101727" /></svg> : <span className={styles.qrPlaceholder}><Icon name="bookmark" width="28" height="28" /><span>Prepare at checkout</span></span>}
          <div className={styles.backCopy}><span className={styles.codeLabel}>{previewOnly ? "Demo code" : "Checkout code"}</span>{code ? <div className={styles.codeRow}><code>{code}</code><button type="button" onClick={copy} tabIndex={flipped ? 0 : -1} aria-label={`Copy ${accessibleName} code`}><Icon name="copy" width="12" height="12" />Copy</button></div> : <strong className={styles.prepareCode}>Your code is prepared when you redeem.</strong>}<p>{card.terms || "View the full terms before you redeem."}</p></div>
        </div>
        <div className={styles.actions}><button type="button" tabIndex={flipped ? 0 : -1} onClick={() => onSave?.(card)} disabled={!onSave} aria-pressed={saved} aria-label={saved ? `Remove ${accessibleName} from wallet` : `Save ${accessibleName} to wallet`}><Icon name={saved ? "check" : "bookmark"} width="14" height="14" />{saved ? "Saved to Wallet" : "Save to Wallet"}</button><button type="button" tabIndex={flipped ? 0 : -1} className={styles.redeem} onClick={() => onRedeem?.(card)} disabled={!onRedeem || unavailable} aria-label={`Redeem ${accessibleName} voucher`}><Icon name="contactless" width="14" height="14" />{unavailable ? "No uses left" : "Redeem Now"}</button></div>
      </section>
    </div>
    {notice && <div className={styles.toast} role="status">{notice}</div>}
  </article>;
}
