"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import styles from "./campaign-review.module.css";

const BASE = "/api/retail-rewards/campaign-review";
const idValid = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(value);
const instantValid = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const positive = value => Number.isSafeInteger(value) && value > 0;
const nameValid = value => typeof value === "string" && value.length > 0 && value.length <= 500;
function dateValid(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && instantValid(`${value}T00:00:00.000Z`) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value; }
function offerValid(value) { return value && idValid(value.id) && nameValid(value.title) && positive(value.revision) && positive(value.shopCount) && instantValid(value.startsAt) && instantValid(value.endsAt) && Date.parse(value.startsAt) < Date.parse(value.endsAt); }
function offersValid(value, page) { return value?.reviewOnly === true && Array.isArray(value.offers) && value.offers.length <= 25 && value.offers.every(offerValid) && new Set(value.offers.map(row => row.id)).size === value.offers.length && value.page === page && typeof value.hasMore === "boolean" && instantValid(value.checkedAt); }
function reviewValid(value, offer, page) {
  return value?.reviewOnly === true && offerValid(value.offer) && ["id", "title", "revision", "startsAt", "endsAt", "shopCount"].every(key => value.offer[key] === offer[key]) && value.page === page &&
    typeof value.hasMore === "boolean" && instantValid(value.checkedAt) && Array.isArray(value.campaigns) && value.campaigns.length <= 25 && new Set(value.campaigns.map(row => row.id)).size === value.campaigns.length &&
    value.campaigns.every(row => row && idValid(row.id) && nameValid(row.name) && nameValid(row.promoName) && positive(row.publicationRevision) && instantValid(row.publishedAt) && dateValid(row.startsOn) && dateValid(row.endsOn) && row.startsOn <= row.endsOn);
}
function messageFor(code) {
  return ({ REVIEW_TOO_LARGE: "This review exceeds the safe record limit. No partial results are shown. Try another coupon or contact your administrator.",
    CONFLICT: "The coupon’s published version has changed. Refresh the published coupons and choose its current version.",
    INVALID_REQUEST: "Choose a current published coupon before reviewing its audio campaigns.",
    UNAUTHENTICATED: "Your access could not be confirmed. Please sign in again.",
    FORBIDDEN: "You do not have permission to review this coupon and all of its shop targets.",
    NOT_ENTITLED: "This account’s Rewards access does not currently include this review.",
    OFFER_UNAVAILABLE: "This published coupon is no longer available for your review. Refresh the list.",
    LOCATION_UNAVAILABLE: "A shop needed for this review is no longer available to your account.",
    FEATURE_DISABLED: "Audio campaign review is not available right now.",
    RATE_LIMITED: "Too many requests. Please wait a moment before trying again."
  })[code] || "We couldn’t complete this review. Please try again.";
}
function formatInstant(value) {
  try { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)); }
  catch { return "Time unavailable"; }
}
function formatDate(value) {
  try { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)); }
  catch { return "Date unavailable"; }
}
const keyFor = offer => `${offer.id}:${offer.revision}`;

export default function CampaignReviewClient({ initialData, transport = checkoutTransport, previewOnly = false }) {
  const safeInitial = initialData?.ok === true && offersValid(initialData, initialData.page) ? initialData : { offers: [], page: 1, hasMore: false, checkedAt: null, reviewOnly: true };
  const [data, setData] = useState(safeInitial), [selected, setSelected] = useState(""), [review, setReview] = useState(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState(initialData?.ok === false ? messageFor(initialData.code) : initialData?.ok === true && !offersValid(initialData, initialData.page) ? messageFor() : "");
  const active = useRef(null), sequence = useRef(0), alive = useRef(true), resultRef = useRef(null), errorRef = useRef(null);
  const offer = data.offers.find(item => keyFor(item) === selected) || null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; active.current?.abort(); }; }, []);
  useEffect(() => { if (review) resultRef.current?.focus(); }, [review]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function invalidate() { sequence.current++; active.current?.abort(); setReview(null); setBusy(""); setError(""); }
  async function loadOffers(page = data.page) {
    invalidate(); setSelected(""); setData(current => ({ ...current, offers: [], page, hasMore: false }));
    const request = ++sequence.current, controller = new AbortController(); active.current = controller; setBusy("offers");
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await checkoutRequest(transport, `${BASE}/offers?page=${page}`, { signal: controller.signal });
      if (!alive.current || request !== sequence.current) return;
      if (!offersValid(result, page)) throw new Error("Invalid offers response");
      setData(result);
    } catch (problem) { if (alive.current && request === sequence.current) setError(messageFor(problem.code)); }
    finally { clearTimeout(timer); if (alive.current && request === sequence.current) { setBusy(""); active.current = null; } }
  }
  async function loadReview(page = 1) {
    if (!offer) { setError("Choose a current published coupon before reviewing its audio campaigns."); return; }
    const current = offer; invalidate(); const request = ++sequence.current, controller = new AbortController(); active.current = controller; setBusy("review");
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await checkoutRequest(transport, `${BASE}/review`, { method: "POST", body: { offerId: current.id, revision: current.revision, page }, signal: controller.signal });
      if (!alive.current || request !== sequence.current) return;
      if (!reviewValid(result, current, page)) throw new Error("Invalid review response");
      setReview(result);
    } catch (problem) { if (alive.current && request === sequence.current) setError(messageFor(problem.code)); }
    finally { clearTimeout(timer); if (alive.current && request === sequence.current) { setBusy(""); active.current = null; } }
  }
  return <main className={styles.page}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL CAMPAIGN REVIEW PREVIEW</strong> · Synthetic coupons and audio campaigns · No live accounts or audio</p>}
    <div className={styles.container}><a className={styles.back} href="/dashboard/retail/rewards">← Shop offers</a><p className={styles.eyebrow}>RUVANAS REWARDS · CLIENT ADMIN</p><h1>Review audio campaigns.</h1><p className={styles.lead}>See which published audio campaigns have compatible shop targets and overlapping dates with a published coupon.</p>
      <div className={styles.notice}><strong>Review only</strong><p>This does not save an association, change any audio or start a campaign. A match does not prove that an announcement played, someone listened or a sale happened.</p></div>
      <section className={styles.selectionCard} aria-label="Choose a published coupon"><div className={styles.sectionHeading}><div><span className={styles.step}>1</span><h2>Choose your coupon</h2></div><button type="button" className={styles.textButton} disabled={busy === "offers"} onClick={() => loadOffers()}>Refresh published coupons</button></div>
        <form onSubmit={event => { event.preventDefault(); loadReview(); }} noValidate><label className={styles.field}>Published coupon<select value={selected} disabled={busy === "offers"} onChange={event => { invalidate(); setSelected(event.target.value); }}><option value="">Choose a current published coupon</option>{data.offers.map(item => <option key={keyFor(item)} value={keyFor(item)}>{item.title} · version {item.revision}</option>)}</select></label>
          {offer && <div className={styles.offerSummary} aria-label="Selected published coupon"><div className={styles.offerTop}><h3>{offer.title}</h3><span className={styles.badge}>Published version {offer.revision}</span></div><dl><div><dt>Coupon dates</dt><dd>{formatInstant(offer.startsAt)} – {formatInstant(offer.endsAt)}<small>UTC</small></dd></div><div><dt>Coupon shops</dt><dd>{offer.shopCount} {offer.shopCount === 1 ? "shop" : "shops"}</dd></div></dl><p className={styles.help}>Only the current published version is reviewed. Unpublished edits are not used.</p></div>}
          <button type="submit" className={styles.primary} disabled={!!busy || !offer}>{busy === "review" ? "Reviewing campaigns…" : "Review audio campaigns"}</button>
        </form>
        {!data.offers.length && !busy && !error && <p className={styles.empty}>{data.hasMore ? "No eligible coupons on this page. Continue to the next page to check more published coupons." : "No published coupons are available for your review. You need access to the coupon and all of its shop targets."}</p>}
        {(data.hasMore || data.page > 1) && <div className={styles.pagination} aria-label="Published coupon pages"><button type="button" className={styles.secondary} disabled={!!busy || data.page <= 1} onClick={() => loadOffers(data.page - 1)}>← Previous coupons</button><span>Coupon page {data.page}</span><button type="button" className={styles.secondary} disabled={!!busy || !data.hasMore} onClick={() => loadOffers(data.page + 1)}>More coupons →</button></div>}
        {data.checkedAt && <p className={styles.checked}>Coupon list checked {formatInstant(data.checkedAt)} UTC.</p>}
      </section>
      {busy && <p className={styles.loading} role="status">{busy === "offers" ? "Checking current published coupons and access…" : "Checking published audio campaigns and their shop targets…"}</p>}
      {error && <p className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      {review && <section className={styles.results} aria-label="Compatible audio campaign review" tabIndex={-1} ref={resultRef}><div className={styles.sectionHeading}><div><span className={styles.step}>2</span><h2>Compatible audio campaigns</h2></div><button type="button" className={styles.textButton} disabled={!!busy} onClick={() => loadReview()}>Refresh review</button></div><p className={styles.resultLead}>For <strong>{review.offer.title}</strong> · published version {review.offer.revision}. {review.campaigns.length} {review.campaigns.length === 1 ? "campaign" : "campaigns"} on this page.</p>
        <div className={styles.cards}>{review.campaigns.map(campaign => <article className={styles.campaign} key={campaign.id}><div className={styles.campaignTop}><span className={styles.match}>Compatible for review</span><span className={styles.version}>Published version {campaign.publicationRevision}</span></div><h3>{campaign.name}</h3><dl><div><dt>Audio promotion</dt><dd>{campaign.promoName}</dd></div><div><dt>Campaign dates</dt><dd>{formatDate(campaign.startsOn)} – {formatDate(campaign.endsOn)}</dd></div></dl><p className={styles.checked}>Published {formatInstant(campaign.publishedAt)} UTC.</p></article>)}</div>
        {!review.campaigns.length && <div className={styles.empty}><h3>No compatible campaigns on this page.</h3><p>{review.hasMore ? "Continue to the next page to check the remaining candidates." : "No published audio campaign matched the direct shop targets and overlapping dates for this coupon. This does not indicate a problem with your music stream."}</p></div>}
        <div className={styles.pagination} aria-label="Campaign review pages"><button type="button" className={styles.secondary} disabled={!!busy || review.page <= 1} onClick={() => loadReview(review.page - 1)}>← Previous campaigns</button><span>Review page {review.page}</span><button type="button" className={styles.secondary} disabled={!!busy || !review.hasMore} onClick={() => loadReview(review.page + 1)}>More campaigns →</button></div>
        <p className={styles.checked}>Review checked {formatInstant(review.checkedAt)} UTC. Refresh to check the current publication and access again.</p>
      </section>}
      <details className={styles.explanation}><summary>What compatibility means</summary><p>This review checks direct shop targets and date overlap for the current published coupon and published audio campaigns. Broad targeting, actual play times and listener activity are not established by this screen.</p><p>No association is saved between the coupon and a campaign. There are no playback, scheduling or campaign-editing controls here. Existing music and other channels stay unchanged.</p><p>A compatible campaign is not evidence of coupon redemption, sales or campaign performance.</p></details>
    </div>
  </main>;
}
