"use client";

import { useEffect, useRef, useState } from "react";
import VividVoucherCard, { voucherAccessibleName } from "./VividVoucherCard";
import ShopBrowsePane, { initialShopBrowse } from "./ShopBrowsePane";
import styles from "./shopper-vivid-dashboard.module.css";

export function VividIcon({ name, ...props }) {
  const shapes = {
    sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    moon: <path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    explore: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2 6-6 2 2-6Z" /></>,
    wallet: <><rect x="3" y="6" width="18" height="15" rx="3" /><path d="M3 9V5a2 2 0 0 1 2-2h13v3m3 6h-6v5h6m-3-2.5h.01" /></>,
    stack: <><path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 17l9 5 9-5" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    flip: <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{shapes[name] || shapes.sparkle}</svg>;
}

const money = (amount, currency) => new Intl.NumberFormat("en-MT", { style: "currency", currency }).format(amount / 100);

export default function ShopperVoucherDashboard({ cards = [], savedIds = [], walletCards, savedCount, totalSavedMinor = null, savingsLabel, currency = "EUR", onToggleSave, canSaveCard, onRedeem, onSavings, renderExplore, onViewChange, walletNotice, walletFooter, accountActions, locationLabel, onHome, previewOnly = false, modalOpen = false, children }) {
  const [theme, setTheme] = useState("dark"), [view, setView] = useState("explore");
  const [search, setSearch] = useState(""), [browseState, setBrowseState] = useState(initialShopBrowse);
  const [selectedId, setSelectedId] = useState(null), [toast, setToast] = useState("");
  const heading = useRef(null), stackCard = useRef(null), pendingSaves = useRef(new Set());
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [view]);
  const saved = new Set(savedIds), query = search.trim().toLowerCase();
  const deck = walletCards === undefined ? cards.filter(card => saved.has(card.id)) : walletCards;
  const count = Number.isSafeInteger(savedCount) && savedCount >= 0 ? savedCount : savedIds.length;
  const matching = deck.filter(card => !query || [card.shopName, card.subtitle, card.benefit, card.category].join(" ").toLowerCase().includes(query));
  function resetBrowse() { setBrowseState(initialShopBrowse()); setView("explore"); setSearch(""); onHome?.(); onViewChange?.("explore"); }
  const activeIndex = Math.max(0, deck.findIndex(card => card.id === selectedId));
  const active = deck[activeIndex];
  const fanStart = Math.max(0, Math.min(activeIndex - 2, deck.length - 5));
  const fanDeck = deck.slice(fanStart, fanStart + 5);
  function moveCard(delta) { if (deck.length) setSelectedId(deck[(activeIndex + delta + deck.length) % deck.length].id); }
  async function saveCard(card) {
    if (!onToggleSave || pendingSaves.current.has(card.id)) return;
    pendingSaves.current.add(card.id);
    const wasSaved = saved.has(card.id);
    try {
      const result = await onToggleSave(card.id);
      if (result !== false) setToast(wasSaved ? "Removed from My Wallet" : "Saved to My Wallet");
    } catch { setToast("Your wallet could not be updated. Please try again."); }
    finally { pendingSaves.current.delete(card.id); }
  }
  function changeView(next) { setSearch(""); setView(next); onViewChange?.(next); }
  const renderCard = card => <VividVoucherCard key={card.id} card={card} previewOnly={previewOnly} saved={saved.has(card.id)} onSave={onToggleSave && (!canSaveCard || canSaveCard(card)) ? () => saveCard(card) : undefined} onRedeem={onRedeem ? () => onRedeem(card) : undefined} />;
  const knownSavings = Number.isSafeInteger(totalSavedMinor) && totalSavedMinor >= 0;
  return <main className={styles.page} data-theme={theme}>
    {previewOnly && <div className={styles.preview}><span>LOCAL PREVIEW</span> · Fictional vouchers · No live purchases</div>}
    <div inert={modalOpen ? "" : undefined}>
      <header className={styles.header}>
        <button type="button" className={styles.brand} onClick={resetBrowse} aria-label="Ruvanas Rewards home"><span className={styles.brandMark}><VividIcon name="sparkle" /></span><span><strong>Ruvanas<span> Rewards</span></strong><small>GOOD THINGS. BETTER VALUE.</small></span></button>
        <div className={styles.headerActions}><button type="button" className={styles.savingsPill} aria-label="View total savings" onClick={onSavings}><span className={styles.savingsDot} /><span><small>Total saved</small><strong data-testid="total-saved">{savingsLabel || (knownSavings ? money(totalSavedMinor, currency) : "Not available")}</strong></span></button><button type="button" className={styles.themeButton} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><VividIcon name={theme === "dark" ? "sun" : "moon"} /></button></div>
      </header>
      <div className={styles.container}>
        {accountActions && <div className={styles.accountActions}>{accountActions}</div>}
        {view === "explore" && (renderExplore ? renderExplore(renderCard) : <ShopBrowsePane previewOnly={previewOnly} cards={cards} state={browseState} onState={setBrowseState} renderCard={renderCard} />)}
        {view !== "explore" && <><div className={styles.contextRow}><button type="button" className={styles.location} onClick={resetBrowse}><VividIcon name="pin" />{locationLabel || browseState.location || "Choose location"}</button></div><section className={styles.hero}>
          <div><p className={styles.eyebrow}>{view === "explore" ? "A LITTLE MORE FOR YOU" : view === "wallet" ? "YOUR COLLECTION" : "YOUR WALLET, REIMAGINED"}</p><h1 tabIndex={-1} ref={heading}>{view === "explore" ? "Explore your next little win." : view === "wallet" ? "Good finds. All yours." : "A pocket full of possibilities."}</h1><p>{view === "explore" ? "Find a favourite. Flip the card. Make your day." : view === "wallet" ? "Your saved vouchers, ready for your next visit." : "Pick a card from your personal collection."}</p></div>
          <span className={styles.flipHint}><VividIcon name="flip" width="15" height="15" />Tap a card to flip</span>
        </section></>}
        {view !== "explore" && walletNotice}
        {view === "wallet" && <>
          <div className={styles.search}><VividIcon name="search" /><label className={styles.sr} htmlFor="vivid-search">{previewOnly ? "Search vouchers" : "Search this wallet page"}</label><input id="vivid-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search shops, offers or categories…" maxLength={100} autoComplete="off" /><span>{matching.length} {matching.length === 1 ? "find" : "finds"}</span></div>
          {view === "wallet" && <p className={styles.walletNote}><VividIcon name="wallet" width="16" height="16" />{count} {previewOnly ? "saved for this visit." : "saved in your wallet."} Saving a card doesn’t use a voucher.</p>}
          <section className={styles.grid} aria-label={view === "wallet" ? "Saved vouchers" : "Available vouchers"}>{matching.map(renderCard)}</section>
          {matching.length === 0 && <section className={styles.empty}><VividIcon name={view === "wallet" ? "wallet" : "search"} width="36" height="36" /><h2>{view === "wallet" ? "Your next favourite belongs here." : "No matches just yet."}</h2><p>{view === "wallet" ? "Flip a card and select Save to Wallet to keep it here." : "Try another category, shop or search."}</p><button type="button" onClick={() => { setSearch(""); changeView("explore"); }}>Explore vouchers</button></section>}
        </>}
        {view === "stack" && <section className={styles.stackSection} aria-label="Stack wallet deck">
          {active ? <><div className={styles.deck}>
            <div className={styles.fan} aria-label="Choose a saved card">{fanDeck.map((card, index) => <button type="button" key={card.id} className={styles.fanCard} data-category={card.category} aria-label={`Select ${voucherAccessibleName(card)} card`} aria-pressed={active.id === card.id} style={{ "--fan-index": index - (fanDeck.length - 1) / 2 }} onClick={() => setSelectedId(card.id)}><span>{card.shopName}</span><small>{card.benefit}</small></button>)}</div>
            <div className={styles.activeCard} ref={stackCard}>{renderCard(active)}</div>
          </div><div className={styles.deckControls}><button type="button" aria-label="Previous card" onClick={() => moveCard(-1)}><VividIcon name="chevron" style={{ transform: "rotate(180deg)" }} /></button><p><strong data-testid="stack-selection">{active.shopName}</strong><span>{activeIndex + 1} of {deck.length} saved cards</span></p><button type="button" aria-label="Next card" onClick={() => moveCard(1)}><VividIcon name="chevron" /></button></div><div className={styles.deckDots}>{deck.map(card => <button type="button" key={card.id} aria-label={`Show ${voucherAccessibleName(card)}`} aria-pressed={active.id === card.id} onClick={() => setSelectedId(card.id)} />)}</div><button type="button" className={styles.openSelected} onClick={() => stackCard.current?.querySelector('button[aria-label^="Flip "]')?.click()}>Open selected card<VividIcon name="flip" width="16" height="16" /></button></>
            : <section className={styles.empty}><VividIcon name="stack" width="36" height="36" /><h2>Your deck is waiting.</h2><p>Save a few vouchers to build your own stack.</p><button type="button" onClick={() => changeView("explore")}>Find your first voucher</button></section>}
        </section>}
        {view !== "explore" && walletFooter}
        <footer className={styles.footer}><span className={styles.footerBrand}>Ruvanas Rewards</span><span>Little savings. More possibilities.</span>{previewOnly && <small>Demo savings update only after a simulated shop confirmation.</small>}</footer>
      </div>
      <nav className={styles.nav} aria-label="Voucher navigation">{[["explore", "Explore"], ["wallet", "My Wallet"], ["stack", "Stack"]].map(([key, label]) => <button type="button" key={key} aria-current={view === key ? "page" : undefined} onClick={() => changeView(key)} className={view === key ? styles.activeNav : ""}><VividIcon name={key} width="18" height="18" /><span>{label}</span>{key === "wallet" && count > 0 && <small>{count}</small>}</button>)}</nav>
    </div>
    {toast && <div className={styles.toast} role="status"><VividIcon name="check" width="16" height="16" />{toast}</div>}
    {children}
  </main>;
}
