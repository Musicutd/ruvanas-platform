"use client";

import { useEffect, useRef, useState } from "react";
import { REWARD_CATEGORIES } from "@/lib/retail-rewards/offer-contracts.mjs";
import { shopperCouponSummary, shopperInitials, shopperReadPath, shopperLocationKey, mergeShopperLocations, shopperVoucherUsage, shopperShortExpiry } from "@/lib/retail-rewards/shopper-ui.mjs";
import styles from "./shopper-discovery.module.css";
import { ClaimOfferAction } from "./ShopperClaimsClient";
import { ShopperHeader, ShopperIcon, ShopperNav } from "./ShopperChrome";

const labels = Object.fromEntries(REWARD_CATEGORIES.map(row => [row.value, row.label]));
const emptyShops = { shops: [], page: 1, hasMore: false };
const emptyLocations = { locations: [], page: 1, hasMore: false };
const defaultTransport = (path, options) => fetch(path, options);
const locality = shop => [shop?.locality, shop?.countryCode].filter(Boolean).join(" · ");
const locationLabel = location => location?.locality || (location?.countryCode ? `Other locations · ${location.countryCode}` : "Choose location");
const categoryDescriptions = { FASHION: "Clothes, shoes & accessories", RESTAURANTS: "Meals, cafés & places to eat", HOME: "Home essentials & furnishings", ELECTRONICS: "Technology, gadgets & appliances", BEAUTY: "Beauty & personal care", HEALTH: "Health & wellbeing", LEISURE: "Days out & things to do", GROCERY: "Food & everyday shopping", SERVICES: "Helpful local services", OTHER: "More places to discover" };

function CategoryArt({ category }) {
  if (category === "ELECTRONICS") return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M8 21h8m-4-5v5" /></svg>;
  return <ShopperIcon name={({ FASHION: "fashion", RESTAURANTS: "food", HOME: "home" })[category] || "sparkle"} width="28" height="28" />;
}

function Pagination({ page, hasMore, loading, onPage }) {
  if (page <= 1 && !hasMore) return null;
  return <div className={styles.pagination}><button type="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page}</span><button type="button" disabled={loading || !hasMore} onClick={() => onPage(page + 1)}>Next</button></div>;
}

function ShopArt({ shop }) {
  const category = shop.categories?.[0], icon = ({ FASHION: "fashion", RESTAURANTS: "food", HOME: "home" })[category];
  return <span aria-hidden="true" className={`${styles.shopArt} ${styles[`art${category}`] || ""}`}>{icon ? <ShopperIcon name={icon} width="43" height="43" /> : <span>{shopperInitials(shop.name)}</span>}</span>;
}

export function VoucherCard({ offer, shopName, loading = false, onOpen, detail = false }) {
  const summary = shopperCouponSummary(offer.terms), usage = shopperVoucherUsage(offer);
  return <article className={`${styles.voucherCard} ${offer.terms.usage === "REUSABLE" ? styles.violetCard : styles.tealCard}`} aria-label={`${summary.benefit} voucher`}>
    <div className={styles.cardTop}><div><span className={styles.cardBrand}>RUVANAS REWARDS</span><strong className={styles.cardShop}>{shopName}</strong></div><span className={styles.usageBadge}>{offer.terms.usage === "REUSABLE" ? "Reusable" : "Single use"}</span></div>
    <p className={`${styles.couponBenefit} ${summary.benefit.length > 14 ? styles.longBenefit : ""}`}>{summary.benefit}</p>
    <p className={styles.cardSpend}>{summary.spend}</p>
    <div className={styles.cardMeta}><strong className={styles.remaining}>{usage.label}</strong><span>Until {shopperShortExpiry(offer.terms)}</span></div>
    <span className={styles.cardMonogram} aria-hidden="true">R</span>
    {!detail && <button type="button" className={styles.useVoucher} disabled={loading || usage.exhausted} onClick={onOpen} aria-label={`Use voucher: ${offer.terms.title}`}>{usage.exhausted ? "All uses redeemed" : "Use voucher"}<ShopperIcon name="arrow" width="17" height="17" /></button>}
  </article>;
}

export default function ShopperDiscoveryClient({ initialData, apiBase = "/api/rewards/discovery", transport = defaultTransport, previewOnly = false, enableSignOut = false, onSignOut, enableClaims = false, onOpenWallet, onOpenSavings }) {
  const [locationsData, setLocationsData] = useState({ ...emptyLocations, ...(initialData?.locations ? initialData : {}) });
  const [shopsData, setShopsData] = useState(emptyShops);
  const [shopData, setShopData] = useState(null), [offerData, setOfferData] = useState(null);
  const [view, setView] = useState("locations"), [chosenLocation, setChosenLocation] = useState(null);
  const [locationSearch, setLocationSearch] = useState(""), [locationQuery, setLocationQuery] = useState("");
  const [search, setSearch] = useState(""), [filters, setFilters] = useState({ category: "", search: "" });
  const [categoryChosen, setCategoryChosen] = useState(false);
  const [shopCategory, setShopCategory] = useState(""), [shopSlug, setShopSlug] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState(initialData?.ok === false ? initialData.error : "");
  const [announcement, setAnnouncement] = useState("");
  const [signingOut, setSigningOut] = useState(false), [signOutError, setSignOutError] = useState(""), [signedOut, setSignedOut] = useState(false);
  const [claimViewRevision, setClaimViewRevision] = useState(0);
  const signOutPending = useRef(false), requestSequence = useRef(0), activeController = useRef(null), screenHeading = useRef(null);
  useEffect(() => {
    if (window.location.hash === "#account") setView("account");
    return () => { requestSequence.current++; activeController.current?.abort(); };
  }, []);
  function cancelRead() { activeController.current?.abort(); requestSequence.current++; setLoading(false); }
  function focusHeading() { requestAnimationFrame(() => screenHeading.current?.focus()); }
  async function read(path, onSuccess, actionLabel) {
    if (signOutPending.current || signedOut) return;
    activeController.current?.abort();
    const sequence = ++requestSequence.current, controller = new AbortController(); activeController.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    setLoading(true); setError(""); setAnnouncement("");
    try {
      const response = await transport(path, { method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const body = typeof response?.json === "function" ? await response.json() : response;
      if (sequence !== requestSequence.current) return;
      if (!body || body.ok !== true || response?.ok === false) throw new Error(body?.error || "These vouchers are not available right now.");
      onSuccess(body); setAnnouncement(actionLabel); focusHeading();
    } catch (problem) {
      if (sequence !== requestSequence.current) return;
      setError(problem.name === "AbortError" ? "Loading took too long. Please try again." : problem.message || "These vouchers are not available right now.");
    } finally { clearTimeout(timer); if (sequence === requestSequence.current) { setLoading(false); activeController.current = null; } }
  }
  function showLocations(query = "", page = 1) {
    if (signOutPending.current || signedOut) return;
    setView("locations"); setLocationQuery(query); setShopData(null); setOfferData(null);
    if (page === 1) { setLocationsData(emptyLocations); setChosenLocation(null); setCategoryChosen(false); setFilters({ category: "", search: "" }); setSearch(""); }
    return read(shopperReadPath(apiBase, { locations: true, search: query, page }), body => {
      setLocationsData(previous => ({ ...body, locations: page === 1 ? mergeShopperLocations([], body.locations) : mergeShopperLocations(previous.locations, body.locations) }));
    }, "Locations updated.");
  }
  function showCategories() {
    if (signOutPending.current || signedOut) return;
    if (!chosenLocation) return showLocations();
    cancelRead(); setView("categories"); setShopData(null); setOfferData(null); setShopsData(emptyShops); setError(""); setAnnouncement("Choose a category."); focusHeading();
  }
  function chooseCategory(category) {
    if (category !== "" && !Object.hasOwn(labels, category)) return;
    setCategoryChosen(true); setSearch(""); return browse({ category, search: "" });
  }
  function browse(nextFilters = filters, page = 1) {
    if (signOutPending.current || signedOut) return;
    if (!chosenLocation) return showLocations();
    setView("shops"); setFilters(nextFilters); setShopData(null); setOfferData(null); setShopSlug(""); setShopsData(emptyShops);
    return read(shopperReadPath(apiBase, { ...nextFilters, ...chosenLocation, page }), body => setShopsData(body), "Shops updated.");
  }
  function openShop(slug, category = filters.category, page = 1) {
    if (signOutPending.current || signedOut) return;
    setView("shop"); setShopSlug(slug); setShopCategory(category); setShopData(null); setOfferData(null);
    return read(shopperReadPath(apiBase, { shopSlug: slug, category, page }), body => setShopData(body), "Shop vouchers loaded.");
  }
  function openOffer(slug) {
    if (signOutPending.current || signedOut) return;
    setView("offer"); setOfferData(null); setShopData(null);
    return read(shopperReadPath(apiBase, { shopSlug, offerSlug: slug }), body => setOfferData(body), "Voucher terms loaded.");
  }
  function openAccount() { if (signOutPending.current || signedOut) return; cancelRead(); setOfferData(null); setError(""); setView("account"); focusHeading(); }
  function openWallet() { if (signOutPending.current || signedOut) return; cancelRead(); setOfferData(null); if (onOpenWallet) onOpenWallet(); else window.location.assign("/rewards/wallet"); }
  async function signOut() {
    if (!enableSignOut || signOutPending.current || signedOut) return;
    signOutPending.current = true; setSigningOut(true); setSignOutError(""); setClaimViewRevision(value => value + 1);
    cancelRead(); const controller = new AbortController(); activeController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await transport("/api/rewards/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = typeof response?.json === "function" ? await response.json() : response;
      if (controller.signal.aborted || result?.ok !== true || response?.ok === false) throw new Error("Sign-out unavailable");
      setLocationsData(emptyLocations); setChosenLocation(null); setShopsData(emptyShops); setShopData(null); setOfferData(null); setSignedOut(true);
      if (onSignOut) onSignOut(); else window.location.replace("/rewards");
    } catch { setSignOutError("We couldn’t confirm sign-out. Please try again. Your shopper session may still be active."); }
    finally { clearTimeout(timeout); activeController.current = null; signOutPending.current = false; setSigningOut(false); }
  }
  const currentShop = view === "offer" ? offerData?.shop : shopData?.shop;
  const selected = offerData?.offer, selectedSummary = selected ? shopperCouponSummary(selected.terms) : null;
  const selectedUsage = selected ? shopperVoucherUsage(selected) : null;
  const locationButton = chosenLocation && <button type="button" className={styles.locationPill} onClick={() => { setLocationSearch(""); showLocations(); }} aria-label={`Change location: ${locationLabel(chosenLocation)}`}><ShopperIcon name="pin" width="18" height="18" /><span>{locationLabel(chosenLocation)}</span><ShopperIcon name="down" width="18" height="18" /></button>;
  if (signedOut) return <main className={styles.page}><ShopperHeader /><div className={styles.container}><h1>Signed out of Rewards</h1><p>Your business or administrator session has not been changed.</p><a href="/rewards/sign-in">Shopper sign-in</a></div></main>;
  return <main className={styles.page}>
    {previewOnly && <div className={styles.previewBanner}><strong>LOCAL PREVIEW</strong> · Example shops and vouchers · No live checkout</div>}
    <ShopperHeader onHome={() => { setLocationSearch(""); showLocations(); }} />
    <div className={styles.container}>
      {signOutError && <p className={styles.error} role="alert">{signOutError}</p>}
      {view === "locations" && <>
        <section className={styles.hero}><p className={styles.stepLabel}>1 / 4 · YOUR LOCATION</p><h1 tabIndex={-1} ref={screenHeading}>Where are you<br className={styles.mobileBreak} /> shopping?</h1><p>Choose your town.</p></section>
        <form className={styles.search} onSubmit={event => { event.preventDefault(); showLocations(locationSearch); }}><ShopperIcon name="search" /><label className={styles.screenReaderOnly} htmlFor="location-search">Search location</label><input id="location-search" type="search" maxLength={100} value={locationSearch} onChange={event => setLocationSearch(event.target.value)} placeholder="Search location" autoComplete="off" /><button type="submit" aria-label="Search locations" disabled={loading}><ShopperIcon name="arrow" /></button></form>
        <fieldset className={styles.locationChoices}><legend className={styles.screenReaderOnly}>Choose your town</legend>{locationsData.locations.map(location => {
          const key = shopperLocationKey(location), checked = chosenLocation && shopperLocationKey(chosenLocation) === key;
          return <label key={key} className={`${styles.locationChoice} ${checked ? styles.selectedLocation : ""}`}><input type="radio" name="shopper-location" value={key} checked={Boolean(checked)} onChange={() => setChosenLocation(location)} disabled={loading || Boolean(error)} /><ShopperIcon name="pin" /><span>{locationLabel(location)}<small>{location.countryCode}</small></span>{checked && <span className={styles.choiceCheck}><ShopperIcon name="check" width="18" height="18" /></span>}</label>;
        })}</fieldset>
        {!loading && !error && locationsData.locations.length === 0 && <section className={styles.empty}><h2>No locations on this page</h2><p>Try another town or load more locations below.</p></section>}
        {locationsData.hasMore && <button type="button" className={styles.textButton} disabled={loading} onClick={() => showLocations(locationQuery, locationsData.page + 1)}>More locations</button>}
        <div className={styles.locationDecoration} aria-hidden="true"><span /><span /><ShopperIcon name="pin" width="38" height="38" /></div>
        <button type="button" className={styles.primary} disabled={!chosenLocation || loading || Boolean(error)} onClick={showCategories}>Choose category <ShopperIcon name="arrow" /></button>
      </>}
      {view === "categories" && <>
        <div className={styles.locationBar}>{locationButton}</div>
        <section className={styles.hero}><p className={styles.stepLabel}>2 / 4 · CATEGORY</p><h1 tabIndex={-1} ref={screenHeading}>What are you looking for?</h1><p>Choose a category to find shops in {locationLabel(chosenLocation)}.</p></section>
        <section className={styles.categoryGrid} aria-label="Shop categories">{REWARD_CATEGORIES.map(category => <button type="button" key={category.value} className={styles.categoryCard} aria-label={`Choose ${category.label}`} aria-pressed={categoryChosen && filters.category === category.value} onClick={() => chooseCategory(category.value)}>
          <span className={`${styles.categoryArt} ${styles[`art${category.value}`] || ""}`}><CategoryArt category={category.value} /></span><span><strong>{category.label}</strong><small>{categoryDescriptions[category.value]}</small></span><ShopperIcon name="arrow" width="16" height="16" />
        </button>)}</section>
        <button type="button" className={styles.allCategories} onClick={() => chooseCategory("")}>All categories <ShopperIcon name="arrow" width="17" height="17" /></button>
      </>}
      {view === "shops" && <>
        <div className={styles.backRow}><button type="button" className={styles.backButton} onClick={showCategories}><ShopperIcon name="back" width="18" height="18" />Categories</button>{locationButton}</div>
        <section className={styles.hero}><p className={styles.stepLabel}>3 / 4 · SHOPS</p><h1 tabIndex={-1} ref={screenHeading}>Choose a shop</h1><p>{labels[filters.category] || "All categories"} · {locationLabel(chosenLocation)}</p></section>
        <form className={styles.search} onSubmit={event => { event.preventDefault(); browse({ ...filters, search }); }}><ShopperIcon name="search" /><label className={styles.screenReaderOnly} htmlFor="shopper-search">Search shops</label><input id="shopper-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search shops" autoComplete="off" /><button type="submit" disabled={loading} aria-label="Search shops"><ShopperIcon name="arrow" /></button></form>
        {!loading && !error && shopsData.shops.length === 0 && <section className={styles.empty}><h2>No matching shops yet</h2><p>Try another category or town{filters.search ? ", or clear your search" : ""}.</p><button type="button" className={styles.textButton} onClick={showCategories}>Choose another category</button>{filters.search && <button type="button" className={styles.textButton} onClick={() => { setSearch(""); browse({ ...filters, search: "" }); }}>Clear search</button>}</section>}
        <section className={styles.shopGrid} aria-label="Participating shop results">{shopsData.shops.map(shop => <button type="button" className={styles.shopCard} key={shop.slug} disabled={loading} onClick={() => openShop(shop.slug)} aria-label={`View vouchers from ${shop.name}`}><ShopArt shop={shop} /><span className={styles.shopCopy}><strong>{shop.name}</strong><span>{shop.categories.map(category => labels[category] || category).join(" · ")}</span><small>View vouchers</small></span><ShopperIcon name="arrow" /></button>)}</section>
        {!error && <Pagination page={shopsData.page} hasMore={shopsData.hasMore} loading={loading} onPage={page => browse(filters, page)} />}
      </>}
      {(view === "shop" || view === "offer") && <>
        <div className={styles.backRow}><button type="button" className={styles.backButton} onClick={() => view === "offer" ? openShop(shopSlug, shopCategory) : browse(filters)}><ShopperIcon name="back" width="18" height="18" />{view === "offer" ? "Vouchers" : "Shops"}</button>{locationButton}</div>
        <section className={styles.hero}><p className={styles.stepLabel}>4 / 4 · VOUCHERS</p><h1 tabIndex={-1} ref={screenHeading}>{currentShop?.name || "Shop vouchers"}</h1><p>{view === "offer" ? "Your next little saving." : "Choose your voucher"}</p></section>
        {view === "shop" && shopData && <>
          {shopCategory && <button type="button" className={styles.textButton} onClick={() => openShop(shopSlug, "")} disabled={loading}>See all vouchers at this shop</button>}
          {shopData.offers.length === 0 && <section className={styles.empty}><h2>No vouchers on this page</h2><p>Try another category or check back soon.</p></section>}
          <section className={styles.couponGrid} aria-label="Shop vouchers">{shopData.offers.map(offer => <div key={offer.slug}><VoucherCard offer={offer} shopName={shopData.shop.name} loading={loading} onOpen={() => openOffer(offer.slug)} /><button type="button" className={styles.termsLink} onClick={() => openOffer(offer.slug)} aria-label={`View terms: ${offer.terms.title}`}>View terms</button></div>)}</section>
          <div className={styles.usageNote}><p>Uses left are your remaining redemptions, checked when these vouchers loaded. Daily and shop limits also apply.</p><button type="button" className={styles.textButton} disabled={loading} onClick={() => openShop(shopSlug, shopCategory, shopData.page)}>Refresh uses</button></div>
          <Pagination page={shopData.page} hasMore={shopData.hasMore} loading={loading} onPage={page => openShop(shopSlug, shopCategory, page)} />
        </>}
        {view === "offer" && selected && <section className={styles.offerDetail} aria-label="Published voucher terms">
          <VoucherCard offer={selected} shopName={currentShop.name} detail />
          <h2 className={styles.offerTitle}>{selected.terms.title}</h2>
          {selected.terms.description && <p className={styles.detailDescription}>{selected.terms.description}</p>}
          <div className={styles.keyTerms}><p><strong>{selectedSummary.spend}</strong><span>{selectedSummary.daily}</span></p><p><strong>Valid until {shopperShortExpiry(selected.terms)}</strong><span>{selectedSummary.ends} · {selected.terms.timezone}</span></p></div>
          {selectedUsage.exhausted ? <p className={styles.notice}>You’ve used all your redemptions for this offer. Choose another voucher.</p> : enableClaims ? !signingOut && <ClaimOfferAction key={`${shopSlug}:${selected.slug}:${selected.revision}:${claimViewRevision}`} shopSlug={shopSlug} offer={selected} transport={transport} /> : <p className={styles.notice}>You can browse these vouchers. Checkout is not available right now.</p>}
          <details className={styles.fullTerms}><summary>Full voucher terms</summary><p className={styles.preWrap}>{selected.terms.legalTerms}</p>{selected.terms.exclusions && <p className={styles.preWrap}><strong>Exclusions: </strong>{selected.terms.exclusions}</p>}<dl><div><dt>Valid at</dt><dd>{currentShop.name} · {locality(currentShop)}</dd></div><div><dt>Starts</dt><dd>{selectedSummary.starts} · {selected.terms.timezone}</dd></div><div><dt>Your limit</dt><dd>{selectedSummary.usage}. {selectedSummary.daily}.</dd></div></dl><ul><li>{selectedSummary.combinable}.</li><li>The offer allows up to {selected.terms.totalLimit} uses across all shoppers. This is a total limit, not a count of available vouchers.</li>{selected.terms.usage === "REUSABLE" && <li>Each use needs a fresh checkout claim. Used codes cannot be reused.</li>}<li>{selectedSummary.pause}</li></ul></details>
        </section>}
      </>}
      {view === "account" && <section className={styles.accountPanel}><p className={styles.stepLabel}>YOUR REWARDS</p><h1 tabIndex={-1} ref={screenHeading}>Your account</h1><p>Your vouchers and checkout codes belong to your shopper account.</p>{previewOnly && <p className={styles.notice}>You’re exploring a local demo. No real account is signed in.</p>}<button className={styles.secondary} type="button" onClick={openWallet} disabled={!enableClaims}>My vouchers <ShopperIcon name="voucher" /></button>{enableSignOut && <button className={styles.secondary} type="button" disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out of Rewards"}</button>}</section>}
      {loading && <p className={styles.loading} role="status">Loading…</p>}
      {error && <section className={styles.error} role="alert"><strong>We couldn’t load this just now</strong><p>{error}</p><button type="button" className={styles.secondary} onClick={() => { setLocationSearch(""); showLocations(); }}>Try locations again</button></section>}
      <p className={styles.screenReaderOnly} role="status">{announcement}</p>
    </div>
      <ShopperNav active={view === "account" ? "account" : "explore"} onExplore={() => chosenLocation ? categoryChosen ? browse(filters) : showCategories() : showLocations()} onWallet={openWallet} onAccount={openAccount} onSavings={onOpenSavings} enableWallet={enableClaims} />
  </main>;
}
