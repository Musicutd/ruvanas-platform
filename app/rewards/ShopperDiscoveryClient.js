"use client";

import { useEffect, useRef, useState } from "react";
import { REWARD_CATEGORIES } from "@/lib/retail-rewards/offer-contracts.mjs";
import { shopperCouponSummary, shopperInitials, shopperReadPath } from "@/lib/retail-rewards/shopper-ui.mjs";
import styles from "./shopper-discovery.module.css";
import { ClaimOfferAction } from "./ShopperClaimsClient";

const labels = Object.fromEntries(REWARD_CATEGORIES.map(row => [row.value, row.label]));
const emptyShops = { shops: [], page: 1, hasMore: false };
const defaultTransport = (path, options) => fetch(path, options);
const locality = shop => [shop.locality, shop.countryCode].filter(Boolean).join(" · ");

function PublicShopBadge({ shop, large = false }) {
  return <span aria-hidden="true" className={`${styles.shopMark} ${large ? styles.largeMark : ""}`}>{shopperInitials(shop.name)}</span>;
}

function Pagination({ page, hasMore, loading, onPage }) {
  return <div className={styles.pagination}><button type="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>← Previous</button><span>Page {page}</span><button type="button" disabled={loading || !hasMore} onClick={() => onPage(page + 1)}>Next →</button></div>;
}

function CouponCard({ offer, loading, onOpen }) {
  const terms = offer.terms;
  const summary = shopperCouponSummary(terms);
  return <article className={styles.couponCard}>
    <div className={styles.cardTop}><span className={styles.categoryLabel}>{labels[terms.category]}</span><span className={`${styles.usageBadge} ${terms.usage === "REUSABLE" ? styles.reusable : ""}`}>{terms.usage === "REUSABLE" ? "Use again" : "One use"}</span></div>
    <p className={styles.couponBenefit}>{summary.benefit}</p><h3>{terms.title}</h3>
    <p className={styles.spend}>{summary.spend}</p><p className={styles.muted}>{summary.usage}</p>
    <div className={styles.cardFooter}><span>Until {summary.ends}<small>{terms.timezone}</small></span><button type="button" disabled={loading} className={styles.textButton} onClick={onOpen}>View terms →</button></div>
  </article>;
}

export default function ShopperDiscoveryClient({ initialData, apiBase = "/api/rewards/discovery", transport = defaultTransport, previewOnly = false, enableSignOut = false, onSignOut, enableClaims = false }) {
  const [shopsData, setShopsData] = useState({ ...emptyShops, ...initialData });
  const [shopData, setShopData] = useState(null);
  const [offerData, setOfferData] = useState(null);
  const [view, setView] = useState("shops");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ category: "", search: "" });
  const [shopCategory, setShopCategory] = useState("");
  const [shopSlug, setShopSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialData?.ok === false ? initialData.error : "");
  const [announcement, setAnnouncement] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [claimViewRevision, setClaimViewRevision] = useState(0);
  const signOutPending = useRef(false);
  const requestSequence = useRef(0);
  const activeController = useRef(null);
  const screenHeading = useRef(null);

  useEffect(() => () => { requestSequence.current++; activeController.current?.abort(); }, []);

  async function read(path, onSuccess, actionLabel) {
    if (signOutPending.current || signedOut) return;
    activeController.current?.abort();
    const sequence = ++requestSequence.current;
    const controller = new AbortController(); activeController.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    setLoading(true); setError(""); setAnnouncement("");
    try {
      const response = await transport(path, { method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const body = typeof response?.json === "function" ? await response.json() : response;
      if (sequence !== requestSequence.current) return;
      if (!body || body.ok !== true || response?.ok === false) throw new Error(body?.error || "These offers are not available right now.");
      onSuccess(body); setAnnouncement(actionLabel);
      requestAnimationFrame(() => screenHeading.current?.focus());
    } catch (problem) {
      if (sequence !== requestSequence.current) return;
      setError(problem.name === "AbortError" ? "Loading took too long. Please try again." : problem.message || "These offers are not available right now.");
    } finally {
      clearTimeout(timer);
      if (sequence === requestSequence.current) { setLoading(false); activeController.current = null; }
    }
  }
  function browse(nextFilters = filters, page = 1) {
    setView("shops"); setFilters(nextFilters); setShopData(null); setOfferData(null); setShopSlug("");
    // Clear previous results during a fresh read, including after withdrawn access.
    setShopsData(emptyShops);
    return read(shopperReadPath(apiBase, { ...nextFilters, page }), body => setShopsData(body), "Participating shops updated.");
  }
  function openShop(slug, category = filters.category, page = 1) {
    setView("shop"); setShopSlug(slug); setShopCategory(category); setShopData(null); setOfferData(null);
    return read(shopperReadPath(apiBase, { shopSlug: slug, category, page }), body => setShopData(body), "Shop offers loaded.");
  }
  function openOffer(slug) {
    setView("offer"); setOfferData(null);
    return read(shopperReadPath(apiBase, { shopSlug, offerSlug: slug }), body => setOfferData(body), "Published offer terms loaded.");
  }

  async function signOut() {
    if (!enableSignOut || signOutPending.current || signedOut) return;
    signOutPending.current = true; setSigningOut(true); setSignOutError(""); setClaimViewRevision(value => value + 1);
    activeController.current?.abort(); requestSequence.current++; setLoading(false);
    const controller = new AbortController(); activeController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await transport("/api/rewards/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = typeof response?.json === "function" ? await response.json() : response;
      if (controller.signal.aborted || result?.ok !== true || response?.ok === false) throw new Error("Sign-out unavailable");
      setShopsData(emptyShops); setShopData(null); setOfferData(null); setSignedOut(true);
      if (onSignOut) onSignOut();
      else window.location.replace("/rewards");
    } catch {
      setSignOutError("We couldn’t confirm sign-out. Please try again. Your shopper session may still be active.");
    } finally {
      clearTimeout(timeout); activeController.current = null; signOutPending.current = false; setSigningOut(false);
    }
  }

  const currentShop = view === "offer" ? offerData?.shop : shopData?.shop;
  const selected = offerData?.offer;
  const selectedSummary = selected ? shopperCouponSummary(selected.terms) : null;

  if (signedOut) return <main className={styles.page}><div className={styles.container}><h1>Signed out of Rewards</h1><p>Your business or administrator session has not been changed.</p><a href="/rewards/sign-in">Shopper sign-in</a></div></main>;
  return <main className={styles.page}>
    {previewOnly && <div className={styles.previewBanner}><strong>LOCAL SHOPPER PREVIEW</strong> · Sample shops and offers · No live accounts, claims or payments</div>}
    <header className={styles.siteHeader}><div className={styles.headerInner}><button type="button" className={styles.brand} onClick={() => { setSearch(""); browse({ category: "", search: "" }); }} aria-label="Ruvanas Rewards, browse all shops"><span>RUVANAS</span><strong>Rewards</strong></button><div className={styles.accountActions}><span className={styles.shopperLabel}>Shopper</span>{enableSignOut && <button type="button" className={styles.signOut} disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out"}</button>}</div></div></header>
    <div className={styles.container}>
      {enableClaims && <nav aria-label="Your Rewards"><a className={styles.walletLink} href="/rewards/wallet">Your coupons →</a></nav>}
      {signOutError && <p className={styles.error} role="alert">{signOutError}</p>}
      {view === "shops" ? <>
        <section className={styles.hero}><p className={styles.eyebrow}>FOR YOUR NEXT VISIT</p><h1 tabIndex={-1} ref={screenHeading}>Find a shop. Discover a saving.</h1><p>Explore a category, choose a shop and compare its offers.</p>
          <form className={styles.search} onSubmit={event => { event.preventDefault(); browse({ ...filters, search }); }}><label className={styles.screenReaderOnly} htmlFor="shopper-search">Search shops</label><input id="shopper-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search shops" autoComplete="off" /><button className={styles.primary} disabled={loading}>Search</button></form>
        </section>
        <nav className={styles.categories} aria-label="Offer categories"><button type="button" aria-pressed={!filters.category} onClick={() => browse({ ...filters, category: "" })}>All categories</button>{REWARD_CATEGORIES.map(category => <button type="button" key={category.value} aria-pressed={filters.category === category.value} onClick={() => browse({ ...filters, category: category.value })}>{category.label}</button>)}</nav>
        <div className={styles.sectionHead}><div><h2>{filters.category ? `${labels[filters.category]} shops` : "Participating shops"}</h2><p>{filters.search ? `Results for “${filters.search}”` : "Each shop has its own offers and conditions."}</p></div><button type="button" className={styles.textButton} disabled={loading} onClick={() => browse(filters, shopsData.page)}>Refresh</button></div>
        {!loading && !error && shopsData.shops.length === 0 && <section className={styles.empty}><h3>No shops to show on this page</h3><p>Try another category or search, or continue to the next page if one is available.</p></section>}
        <section className={styles.shopGrid} aria-label="Participating shop results">{shopsData.shops.map(shop => <article className={styles.shopCard} key={shop.slug}><PublicShopBadge shop={shop} /><div className={styles.shopCopy}><h3>{shop.name}</h3><p className={styles.locality}>{locality(shop)}</p><p>{shop.description}</p><div className={styles.tags}>{shop.categories.map(category => <span key={category}>{labels[category] || category}</span>)}</div></div><button type="button" className={styles.shopLink} disabled={loading} onClick={() => openShop(shop.slug)} aria-label={`View offers from ${shop.name}`}>View offers <span aria-hidden="true">→</span></button></article>)}</section>
        {!error && <Pagination page={shopsData.page} hasMore={shopsData.hasMore} loading={loading} onPage={page => browse(filters, page)} />}
      </> : <>
        <nav className={styles.breadcrumbs} aria-label="Shopper navigation"><button type="button" onClick={() => browse(filters)}>← Browse shops</button>{view === "offer" && <><span aria-hidden="true">/</span><button type="button" onClick={() => openShop(shopSlug, shopCategory)}>Back to shop offers</button></>}</nav>
        {currentShop && <section className={styles.shopHero}><PublicShopBadge shop={currentShop} large /><div><p className={styles.eyebrow}>{locality(currentShop)}</p><h1 tabIndex={-1} ref={screenHeading}>{currentShop.name}</h1><p>{currentShop.description}</p></div></section>}
        {view === "shop" && shopData && <>
          <div className={styles.sectionHead}><div><h2>{shopCategory ? `${labels[shopCategory]} offers` : "Offers from this shop"}</h2><p>Choose an offer to see its complete terms.</p></div>{shopCategory && <button type="button" className={styles.textButton} onClick={() => openShop(shopSlug, "")} disabled={loading}>See all this shop’s offers</button>}</div>
          {shopData.offers.length === 0 && <section className={styles.empty}><h3>No offers to show on this page</h3><p>This shop may have no available offers matching the selected category.</p></section>}
          <section className={styles.couponGrid} aria-label="Shop coupons">{shopData.offers.map(offer => <CouponCard key={offer.slug} offer={offer} loading={loading} onOpen={() => openOffer(offer.slug)} />)}</section>
          <Pagination page={shopData.page} hasMore={shopData.hasMore} loading={loading} onPage={page => openShop(shopSlug, shopCategory, page)} />
        </>}
        {view === "offer" && selected && <section className={styles.offerDetail} aria-label="Published coupon terms">
          <div className={styles.offerTop}><span className={styles.categoryLabel}>{labels[selected.terms.category]}</span><span className={`${styles.usageBadge} ${selected.terms.usage === "REUSABLE" ? styles.reusable : ""}`}>{selected.terms.usage === "REUSABLE" ? "Repeat-use offer" : "Once per shopper"}</span></div>
          <p className={styles.detailBenefit}>{selectedSummary.benefit}</p><h2>{selected.terms.title}</h2><p className={styles.detailDescription}>{selected.terms.description}</p>
          <div className={styles.keyTerms}><div><span>Minimum spend</span><strong>{selectedSummary.spend}</strong></div><div><span>Your use limit</span><strong>{selectedSummary.usage}</strong><small>{selectedSummary.daily}</small></div></div>
          <dl className={styles.validity}><div><dt>Valid from</dt><dd>{selectedSummary.starts}</dd></div><div><dt>Valid until</dt><dd>{selectedSummary.ends}</dd></div><div><dt>Time zone</dt><dd>{selected.terms.timezone}</dd></div><div><dt>Valid at</dt><dd>{currentShop.name}<small>{locality(currentShop)}</small></dd></div></dl>
          <section className={styles.fullTerms}><h3>What you need to know</h3><p className={styles.preWrap}>{selected.terms.legalTerms}</p>{selected.terms.exclusions && <p className={styles.preWrap}><strong>Exclusions: </strong>{selected.terms.exclusions}</p>}<ul><li>{selectedSummary.combinable}.</li><li>This offer allows up to {selected.terms.totalLimit} uses across all shoppers. This is the offer limit, not a count of uses remaining.</li>{selected.terms.usage === "REUSABLE" && <li>Every use needs a fresh, separately validated claim. A used claim cannot be used again.</li>}<li>{selectedSummary.pause}</li></ul></section>
          {enableClaims ? !signingOut && <ClaimOfferAction key={`${shopSlug}:${selected.slug}:${selected.revision}:${claimViewRevision}`} shopSlug={shopSlug} offer={selected} transport={transport} /> : <div className={styles.claimNotice}><strong>Browse and compare for now</strong><p>Saving, claiming and redeeming coupons are not available in this stage. This page is not a coupon to present at checkout.</p></div>}
        </section>}
      </>}
      {loading && <p className={styles.loading} role="status">Loading available offers…</p>}
      {error && <section className={styles.error} role="alert"><strong>Unable to show these offers</strong><p>{error}</p><button type="button" className={styles.secondary} onClick={() => browse(filters)}>Back to available shops</button></section>}
      <p className={styles.screenReaderOnly} role="status">{announcement}</p>
      <footer className={styles.footer}><span>Ruvanas Rewards · Shopper</span><p>{enableClaims ? "Each coupon use needs a current checkout code and confirmation by authorised shop staff. Getting a coupon does not reserve a use or process a payment." : "Browse published offer terms. Shopper claims and checkout validation are not available in this preview."}</p></footer>
    </div>
  </main>;
}
