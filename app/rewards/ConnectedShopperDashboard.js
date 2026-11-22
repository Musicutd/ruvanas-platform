"use client";

import { useEffect, useRef, useState } from "react";
import ShopperVoucherDashboard from "./ShopperVoucherDashboard";
import ConnectedShopBrowsePane, { ConnectedPagination } from "./ConnectedShopBrowsePane";
import { ClaimOfferAction } from "./ShopperClaimsClient";
import { connectedRequest, connectedVoucherCard, connectedVoucherCards, connectedVoucherKey, connectedWalletCards, connectedSavingsPill } from "@/lib/retail-rewards/connected-voucher-ui.mjs";
import { shopperReadPath, shopperCouponSummary, shopperVoucherUsage } from "@/lib/retail-rewards/shopper-ui.mjs";
import { REWARD_CATEGORIES } from "@/lib/retail-rewards/offer-contracts.mjs";
import styles from "./connected-shopper.module.css";

const defaultTransport = (path, options) => fetch(path, options);
const emptyLocations = { locations: [], page: 1, hasMore: false };
const emptyShops = { shops: [], page: 1, hasMore: false };
const emptyWallet = { items: [], page: 1, hasMore: false, savedCount: 0 };
const initialBrowse = () => ({ step: "locations", location: null, category: null, locationSearch: "", shopSearch: "", voucherSearch: "", shopSlug: "" });
const unavailable = "We couldn’t load this right now. Please try again.";
const accessDeniedCodes = new Set(["UNAUTHENTICATED", "FORBIDDEN", "FEATURE_DISABLED"]);

function CheckoutDialog({ checkout, enableClaims, transport, onClose }) {
  const panel = useRef(null), close = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    const key = event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const nodes = [...(panel.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]') || [])].filter(node => node.getClientRects().length);
      if (!nodes.length) { event.preventDefault(); panel.current?.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.isConnected && previous.focus(); };
  }, []);
  const { shop, offer } = checkout, summary = offer ? shopperCouponSummary(offer.terms) : null;
  const usage = offer ? shopperVoucherUsage(offer) : null;
  return <div className={styles.overlay}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="connected-checkout-title" ref={panel} tabIndex={-1}><div className={styles.dialogTop}><div><small>{shop?.name || checkout.card.shopName}</small><h2 id="connected-checkout-title">{offer?.terms.title || "Prepare your voucher"}</h2></div><button type="button" ref={close} onClick={onClose} aria-label="Close voucher checkout">Close</button></div>
    {checkout.loading && <p role="status">Checking the current offer and your uses…</p>}{checkout.error && <p className={styles.notice} role="alert">{checkout.error}</p>}
    {offer && <><p><strong>{summary.benefit}</strong> · {summary.spend}</p><p>{usage.label} · {summary.daily}</p><p>Valid {summary.starts} to {summary.ends} ({offer.terms.timezone}).</p><details open><summary>Terms and conditions</summary><p className={styles.terms}>{offer.terms.legalTerms}</p>{offer.terms.exclusions && <p className={styles.terms}><strong>Exclusions: </strong>{offer.terms.exclusions}</p>}<p>{summary.combinable}. {summary.pause}</p></details>
      {usage.exhausted ? <p className={styles.notice}>You’ve used all your redemptions for this offer.</p> : enableClaims ? <ClaimOfferAction key={`${shop.slug}:${offer.slug}:${offer.revision}`} shopSlug={shop.slug} offer={offer} transport={transport} /> : <p className={styles.notice}>Checkout is not available right now. Your saved voucher remains in your wallet.</p>}
    </>}
  </section></div>;
}

/** Real same-origin shopper services. No fixture data or browser-stored wallet
 * is used here; saving does not issue a claim or record a redemption. */
export default function ConnectedShopperDashboard({ initialData, initialWallet = null, initialSavings = null, transport = defaultTransport, enableSignOut = false, enableClaims = false, onNavigate, onSignOut }) {
  const [browse, setBrowse] = useState(initialBrowse), [locationsData, setLocationsData] = useState(initialData?.ok === true ? initialData : emptyLocations);
  const [shopsData, setShopsData] = useState(emptyShops), [shopData, setShopData] = useState(null);
  const [browseBusy, setBrowseBusy] = useState(false), [browseError, setBrowseError] = useState("");
  const [wallet, setWallet] = useState(initialWallet?.ok ? initialWallet : emptyWallet), [walletReady, setWalletReady] = useState(Boolean(initialWallet?.ok));
  const [walletBusy, setWalletBusy] = useState(false), [walletError, setWalletError] = useState("");
  const [savedStatus, setSavedStatus] = useState({}), [statusReady, setStatusReady] = useState(false);
  const [savings, setSavings] = useState(initialSavings), [checkout, setCheckout] = useState(null);
  const [signingOut, setSigningOut] = useState(false), [signedOut, setSignedOut] = useState(false), [accountError, setAccountError] = useState("");
  const [accessUnavailable, setAccessUnavailable] = useState(false), accessLost = useRef(false);
  const lanes = useRef(new Map()), alive = useRef(true), generation = useRef(0), saving = useRef(false), signingOutRef = useRef(false), retry = useRef(() => {});
  const browseRef = useRef(browse), walletRef = useRef(wallet), shopRef = useRef(shopData), statusRef = useRef(savedStatus), accountPanel = useRef(null);
  browseRef.current = browse; walletRef.current = wallet; shopRef.current = shopData; statusRef.current = savedStatus;
  function cancel(lane) { const previous = lanes.current.get(lane); previous?.controller.abort(); if (previous) clearTimeout(previous.timer); lanes.current.delete(lane); }
  function cancelAll() { for (const lane of [...lanes.current.keys()]) cancel(lane); generation.current++; }
  function begin(lane) {
    cancel(lane); const controller = new AbortController(), epoch = generation.current;
    const entry = { controller, timer: setTimeout(() => controller.abort(), 15000) }; lanes.current.set(lane, entry);
    return { signal: controller.signal, current: () => alive.current && !accessLost.current && !signingOutRef.current && generation.current === epoch && lanes.current.get(lane) === entry,
      finish: () => { clearTimeout(entry.timer); if (lanes.current.get(lane) === entry) lanes.current.delete(lane); } };
  }
  const navigate = path => onNavigate ? onNavigate(path) : window.location.assign(path);
  function clearDeniedAccess(problem) {
    if (!accessDeniedCodes.has(problem?.code)) return false;
    // All private projections share one shopper authority. A revoked membership
    // must invalidate every lane, including a checkout child and late responses.
    accessLost.current = true; cancelAll(); setAccessUnavailable(true);
    setWallet(emptyWallet); setWalletReady(false); setWalletBusy(false); setWalletError("");
    setSavedStatus({}); setStatusReady(false); setSavings(null); setCheckout(null);
    setBrowse(initialBrowse()); setLocationsData(emptyLocations); setShopsData(emptyShops); setShopData(null); setBrowseBusy(false); setBrowseError("");
    setAccountError("Shopper access is no longer available. Please sign in again.");
    return true;
  }
  async function guardedCheckoutTransport(path, options) {
    const epoch = generation.current;
    const response = await transport(path, options);
    const value = typeof response?.clone === "function" ? await response.clone().json().catch(() => null) : response;
    if (alive.current && !accessLost.current && !signingOutRef.current && generation.current === epoch && value?.ok === false) clearDeniedAccess(value);
    // Preserve the original response for the existing claim/credential flow.
    // Closing checkout unmounts that flow and clears any displayed credential.
    return response;
  }
  function setStatusRows(rows) {
    setSavedStatus(previous => { const next = { ...previous }; for (const row of rows) { const key = connectedVoucherKey(row.shopSlug, row.offerSlug); if (key) next[key] = row.savedId; } return next; });
  }
  async function refreshStatus(shop, offers, allowDuringSave = false) {
    if (accessLost.current || saving.current && !allowDuringSave || signingOutRef.current || signedOut) return;
    setStatusReady(false); const job = begin("status");
    try {
      const references = offers.map(offer => ({ shopSlug: shop.slug, offerSlug: offer.slug }));
      if (!references.length) { if (job.current()) setStatusReady(true); return; }
      const body = await connectedRequest(transport, "/api/rewards/saved-wallet/status", { method: "POST", body: { offers: references }, signal: job.signal });
      if (!job.current()) return;
      if (!Array.isArray(body.items) || body.items.length !== references.length || references.some(ref => !body.items.some(row => row.shopSlug === ref.shopSlug && row.offerSlug === ref.offerSlug))) throw new Error("Invalid saved status");
      setStatusRows(body.items); setStatusReady(true);
    } catch (problem) { if (job.current() && !clearDeniedAccess(problem)) setWalletError("Saved status is unavailable. Refresh your wallet before saving another voucher."); }
    finally { job.finish(); }
  }
  async function refreshWallet(page = walletRef.current.page || 1, allowDuringSave = false) {
    if (accessLost.current || signingOutRef.current || signedOut || saving.current && !allowDuringSave) return;
    const job = begin("wallet"); setWalletBusy(true); setWalletError("");
    try {
      const body = await connectedRequest(transport, `/api/rewards/saved-wallet?page=${page}`, { signal: job.signal });
      if (!job.current()) return;
      if (!Array.isArray(body.items) || body.items.length > 25 || !Number.isSafeInteger(body.savedCount)) throw new Error("Invalid wallet");
      setWallet(body); setWalletReady(true);
      setStatusRows(body.items.filter(row => row.status === "AVAILABLE").map(row => ({ shopSlug: row.shop.slug, offerSlug: row.offer.slug, savedId: row.id })));
      if (!saving.current && shopRef.current) await refreshStatus(shopRef.current.shop, shopRef.current.offers);
    } catch (problem) { if (job.current() && !clearDeniedAccess(problem)) {
      setWalletError("Your saved wallet could not be refreshed. Please try again."); setWalletReady(false); setWallet(emptyWallet); setSavedStatus({}); setStatusReady(false);
    } }
    finally { if (job.current()) setWalletBusy(false); job.finish(); }
  }
  async function refreshSavings() {
    if (accessLost.current || signingOutRef.current || signedOut) return;
    const job = begin("savings");
    try { const body = await connectedRequest(transport, "/api/rewards/savings", { signal: job.signal }); if (job.current()) setSavings(body); }
    catch (problem) { if (job.current() && !clearDeniedAccess(problem)) setSavings(null); }
    finally { job.finish(); }
  }
  useEffect(() => {
    alive.current = true; if (!initialWallet) refreshWallet(1); if (!initialSavings) refreshSavings();
    const visible = () => { if (!document.hidden) { refreshWallet(); refreshSavings(); if (shopRef.current) refreshStatus(shopRef.current.shop, shopRef.current.offers); } };
    document.addEventListener("visibilitychange", visible);
    return () => { alive.current = false; cancelAll(); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    const focusAccount = () => { if (window.location.hash === "#account") accountPanel.current?.focus(); };
    focusAccount(); window.addEventListener("hashchange", focusAccount);
    return () => window.removeEventListener("hashchange", focusAccount);
  }, []);
  useEffect(() => { if (accessUnavailable) accountPanel.current?.focus(); }, [accessUnavailable]);
  async function readBrowse(path, onSuccess, rerun) {
    if (accessLost.current || signingOutRef.current || signedOut) return;
    retry.current = rerun; const job = begin("browse"); setBrowseBusy(true); setBrowseError("");
    try { const body = await connectedRequest(transport, path, { signal: job.signal }); if (job.current()) onSuccess(body); }
    catch (problem) { if (job.current() && !clearDeniedAccess(problem)) setBrowseError(unavailable); }
    finally { if (job.current()) setBrowseBusy(false); job.finish(); }
  }
  function showLocations(query = "", page = 1) {
    if (typeof query !== "string") query = "";
    cancel("status"); setStatusReady(false); setShopData(null); setShopsData(emptyShops); setLocationsData(emptyLocations);
    setBrowse({ ...initialBrowse(), locationSearch: query });
    return readBrowse(shopperReadPath("/api/rewards/discovery", { locations: true, search: query, page }), setLocationsData, () => showLocations(query, page));
  }
  function chooseLocation(location) { cancel("browse"); cancel("status"); setBrowseBusy(false); setBrowseError(""); setShopData(null); setShopsData(emptyShops); setBrowse({ ...initialBrowse(), step: "categories", location }); }
  function showCategories() { if (browseRef.current.location) chooseLocation(browseRef.current.location); else showLocations(); }
  function showShops(page = 1, search = browseRef.current.shopSearch, category = browseRef.current.category) {
    const location = browseRef.current.location; if (!location || category === null) return;
    cancel("status"); setStatusReady(false); setShopData(null); setShopsData(emptyShops);
    setBrowse(current => ({ ...current, step: "shops", category, shopSearch: search, voucherSearch: "", shopSlug: "" }));
    return readBrowse(shopperReadPath("/api/rewards/discovery", { ...location, category, search, page }), setShopsData, () => showShops(page, search, category));
  }
  function chooseCategory(category) { if (category !== "" && !REWARD_CATEGORIES.some(row => row.value === category)) return; return showShops(1, "", category); }
  function openShop(slug, page = 1, search = "") {
    cancel("status"); setStatusReady(false); setShopData(null);
    setBrowse(current => ({ ...current, step: "shop", shopSlug: slug, voucherSearch: search }));
    // The category chooses shops. Once inside, show every eligible voucher at
    // that shop, with server-side pagination and optional voucher search.
    return readBrowse(shopperReadPath("/api/rewards/discovery", { shopSlug: slug, page, search }), body => { setShopData(body); refreshStatus(body.shop, body.offers); }, () => openShop(slug, page, search));
  }
  const cards = connectedVoucherCards(shopData?.shop, shopData?.offers);
  const walletCards = connectedWalletCards(wallet.items);
  const savedIds = [...new Set([...Object.entries(savedStatus).filter(([, id]) => Boolean(id)).map(([key]) => key), ...walletCards.map(card => card.id)])];
  async function toggleSave(id) {
    if (accessLost.current || saving.current || signingOutRef.current || signedOut) return false;
    const card = [...cards, ...walletCards].find(row => row.id === id); if (!card) return false;
    const savedId = statusRef.current[id] || card.savedId;
    if (!savedId && !statusReady) return false;
    saving.current = true; cancel("wallet"); cancel("status"); setWalletBusy(false); setStatusReady(false); const job = begin("save");
    try {
      const body = await connectedRequest(transport, savedId ? `/api/rewards/saved-wallet/${encodeURIComponent(savedId)}` : "/api/rewards/saved-wallet", { method: savedId ? "DELETE" : "POST", ...(savedId ? {} : { body: { shopSlug: card.shopSlug, offerSlug: card.offerSlug } }), signal: job.signal });
      if (!job.current()) return false;
      if (!savedId && !body.item?.id) throw new Error("Save unavailable");
      setSavedStatus(current => ({ ...current, [id]: savedId ? null : body.item.id }));
      setWallet(current => ({ ...current, items: savedId ? current.items.filter(item => item.id !== savedId) : current.items }));
      await refreshWallet(savedId && walletRef.current.items.length === 1 && walletRef.current.page > 1 ? walletRef.current.page - 1 : walletRef.current.page, true);
      if (job.current() && shopRef.current) await refreshStatus(shopRef.current.shop, shopRef.current.offers, true);
      return true;
    } catch (problem) { if (job.current() && !clearDeniedAccess(problem)) { setWalletError("That wallet change could not be confirmed. Refresh before trying again."); setStatusReady(false); } throw new Error("Wallet change unavailable"); }
    finally { job.finish(); saving.current = false; }
  }
  async function removeUnavailable(id) {
    if (accessLost.current || saving.current || signingOutRef.current) return;
    saving.current = true; cancel("wallet"); cancel("status"); setWalletBusy(false); setStatusReady(false); const job = begin("save");
    try { await connectedRequest(transport, `/api/rewards/saved-wallet/${encodeURIComponent(id)}`, { method: "DELETE", signal: job.signal }); if (job.current()) { await refreshWallet(walletRef.current.page > 1 && walletRef.current.items.length === 1 ? walletRef.current.page - 1 : walletRef.current.page, true); if (shopRef.current) await refreshStatus(shopRef.current.shop, shopRef.current.offers, true); } }
    catch (problem) { if (job.current() && !clearDeniedAccess(problem)) setWalletError("That removal could not be confirmed. Refresh and try again."); }
    finally { job.finish(); saving.current = false; }
  }
  async function openRedeem(card) {
    if (accessLost.current || signingOutRef.current || signedOut) return;
    const job = begin("checkout"); setCheckout({ card, loading: true });
    try {
      const body = await connectedRequest(transport, shopperReadPath("/api/rewards/discovery", { shopSlug: card.shopSlug, offerSlug: card.offerSlug }), { signal: job.signal });
      if (!job.current()) return;
      if (body.shop?.slug !== card.shopSlug || body.offer?.slug !== card.offerSlug || !connectedVoucherCard(body.shop, body.offer)) throw new Error("Offer changed");
      setCheckout({ card, shop: body.shop, offer: body.offer, loading: false });
    } catch (problem) { if (job.current() && !clearDeniedAccess(problem)) setCheckout({ card, loading: false, error: "This voucher is not available right now. Close this window and refresh the shop or your wallet." }); }
    finally { job.finish(); }
  }
  function closeCheckout() { cancel("checkout"); setCheckout(null); refreshWallet(); refreshSavings(); }
  async function signOut() {
    if (signingOutRef.current) return;
    signingOutRef.current = true; setSigningOut(true); setAccountError(""); cancelAll(); setCheckout(null); setBrowseBusy(false); setWalletBusy(false);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      await connectedRequest(transport, "/api/rewards/auth/logout", { method: "POST", body: {}, signal: controller.signal });
      if (!alive.current) return;
      setWallet(emptyWallet); setSavedStatus({}); setShopData(null); setShopsData(emptyShops); setLocationsData(emptyLocations); setSavings(null); setSignedOut(true);
      if (onSignOut) onSignOut(); else window.location.replace("/rewards/sign-in");
    } catch { if (alive.current) setAccountError("We couldn’t confirm sign-out. Please try again. Your shopper session may still be active."); }
    finally { clearTimeout(timer); signingOutRef.current = false; if (alive.current) setSigningOut(false); }
  }
  const actions = { locations: showLocations, categories: showCategories, chooseLocation, chooseCategory, shops: showShops, shop: openShop, field: (name, value) => setBrowse(current => ({ ...current, [name]: value })), retry: () => retry.current() };
  const accountActions = <section id="account" ref={accountPanel} tabIndex={-1} aria-label="Your Rewards account" className={styles.accountActions}><a href="/rewards/savings" onClick={event => { event.preventDefault(); navigate("/rewards/savings"); }}>My savings</a>{enableClaims && <a href="/rewards/wallet" onClick={event => { event.preventDefault(); navigate("/rewards/wallet"); }}>Issued vouchers & receipts</a>}{enableSignOut && <button type="button" disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out of Rewards"}</button>}{accountError && <p role="alert">{accountError}</p>}{accessUnavailable && <a href="/rewards/sign-in">Sign in to Rewards</a>}{walletError && <p role="alert">{walletError}</p>}</section>;
  const walletNotice = <>{walletBusy ? <p role="status">Refreshing your saved wallet…</p> : <p>{walletReady ? `${wallet.savedCount} saved in your shopper account. ` : "Your wallet is not available yet. "}Saving doesn’t use a voucher. Issued checkout codes and receipts are separate.</p>}{walletError && <p role="alert">{walletError}</p>}</>;
  const walletFooter = <><div className={styles.walletControls}><button type="button" disabled={walletBusy} onClick={() => { refreshWallet(); if (shopRef.current) refreshStatus(shopRef.current.shop, shopRef.current.offers); }}>Refresh wallet</button>{enableClaims && <a href="/rewards/wallet" onClick={event => { event.preventDefault(); navigate("/rewards/wallet"); }}>Issued vouchers & receipts</a>}</div>{wallet.items.filter(item => item.status === "UNAVAILABLE").map(item => <section key={item.id} className={styles.unavailable}><strong>Saved voucher unavailable</strong><p>This offer or shop is no longer available to browse. You can remove this saved entry.</p><button type="button" onClick={() => removeUnavailable(item.id)}>Remove unavailable voucher</button></section>)}<ConnectedPagination {...wallet} busy={walletBusy} label="Saved wallet" onPage={refreshWallet} />{wallet.hasMore || wallet.page > 1 ? <p>Cards and Stack show this page of your saved wallet.</p> : null}</>;
  if (signedOut) return <main><h1>Signed out of Rewards</h1><a href="/rewards/sign-in">Shopper sign-in</a></main>;
  return <ShopperVoucherDashboard cards={cards} walletCards={walletCards} savedIds={savedIds} savedCount={walletReady ? wallet.savedCount : undefined} {...connectedSavingsPill(savings)} canSaveCard={card => !accessUnavailable && !signingOut && (Boolean(card.savedId) ? walletReady : statusReady)} onToggleSave={signingOut || accessUnavailable ? undefined : toggleSave} onRedeem={signingOut || accessUnavailable ? undefined : openRedeem} onSavings={() => navigate("/rewards/savings")} onViewChange={() => { refreshWallet(); refreshSavings(); }} accountActions={accountActions} walletNotice={walletNotice} walletFooter={walletFooter} locationLabel={browse.location?.locality || "Choose location"} onHome={showLocations} modalOpen={Boolean(checkout)} renderExplore={renderCard => <><ConnectedShopBrowsePane state={browse} locationsData={locationsData} shopsData={shopsData} shopData={shopData} cards={cards} busy={browseBusy || signingOut} error={browseError} actions={actions} renderCard={renderCard} />{browse.step === "shop" && cards.length > 0 && !statusReady && !walletError && <p role="status">Checking your saved wallet…</p>}</>}>
    {checkout && <CheckoutDialog checkout={checkout} enableClaims={enableClaims && !signingOut && !accessUnavailable} transport={guardedCheckoutTransport} onClose={closeCheckout} />}
  </ShopperVoucherDashboard>;
}
