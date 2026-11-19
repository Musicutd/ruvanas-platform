"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import styles from "./campaign-links.module.css";

const BASE = "/api/retail-rewards/campaign-links", OFFERS = "/api/retail-rewards/offers";
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const text = (value, max = 500) => typeof value === "string" && value.length > 0 && value.length <= max;
const instant = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function day(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && instant(`${value}T00:00:00Z`) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function offerSummary(row) {
  if (!row || !id(row.id) || !text(row.draft?.title, 140) || !positive(row.version) || !["DRAFT", "PUBLISHED", "PAUSED", "CANCELLED"].includes(row.state) || !(row.publishedRevision === null || positive(row.publishedRevision))) return null;
  return { id: row.id, title: row.draft.title, version: row.version, state: row.state, publishedRevision: row.publishedRevision };
}
function readList(value, page) {
  if (value?.ok !== true || !Array.isArray(value.offers) || value.offers.length > 25 || value.page !== page || typeof value.hasMore !== "boolean" || typeof value.capabilities?.manage !== "boolean") return null;
  const offers = value.offers.map(offerSummary);
  if (offers.some(row => !row) || new Set(offers.map(row => row.id)).size !== offers.length) return null;
  return { offers, page, hasMore: value.hasMore, manage: value.capabilities.manage };
}
function summaryValid(row) { return exact(row, ["id", "title", "version", "state", "publishedRevision"]) && id(row.id) && text(row.title, 140) && positive(row.version) && ["DRAFT", "PUBLISHED", "PAUSED"].includes(row.state) && (row.publishedRevision === null || positive(row.publishedRevision)); }
function selectionValid(row, historical = false) { return row === null || exact(row, historical ? ["revision", "campaignId", "name", "publicationRevision"] : ["campaignId", "name", "publicationRevision"]) && id(row.campaignId) && text(row.name) && positive(row.publicationRevision) && (!historical || positive(row.revision)); }
function reviewValid(value, current, page) {
  return exact(value, ["ok", "offer", "selection", "publishedLink", "campaigns", "page", "hasMore", "checkedAt"]) && value.ok === true && summaryValid(value.offer) &&
    Object.keys(current).every(key => current[key] === value.offer[key]) && selectionValid(value.selection) && selectionValid(value.publishedLink, true) &&
    (value.publishedLink === null || value.publishedLink.revision === value.offer.publishedRevision) && value.page === page && typeof value.hasMore === "boolean" && instant(value.checkedAt) &&
    Array.isArray(value.campaigns) && value.campaigns.length <= 25 && new Set(value.campaigns.map(row => row.id)).size === value.campaigns.length && value.campaigns.every(row =>
      exact(row, ["id", "name", "publicationRevision", "publishedAt", "startsOn", "endsOn", "promoName"]) && id(row.id) && text(row.name) && text(row.promoName) && positive(row.publicationRevision) && instant(row.publishedAt) && day(row.startsOn) && day(row.endsOn) && row.startsOn <= row.endsOn);
}
const offerKey = row => `${row.id}:${row.version}`;
const choiceKey = row => row ? `${row.campaignId || row.id}:${row.publicationRevision}` : "NONE";
const dateLabel = value => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
function message(code) { return ({ CONFLICT: "This coupon or campaign changed. Refresh your coupons, then review the current saved draft before trying again.",
  CAMPAIGN_UNAVAILABLE: "This campaign is no longer compatible. Refresh the review before choosing a campaign.",
  REVIEW_TOO_LARGE: "There are too many candidates to review safely. No partial selection is shown. Ask your administrator to narrow the published campaigns.",
  FORBIDDEN: "You do not have permission to manage this coupon and all of its shops.", UNAUTHENTICATED: "Please sign in again to manage your coupon drafts.",
  FEATURE_DISABLED: "Optional campaign links are unavailable right now.", OFFER_UNAVAILABLE: "This coupon is no longer available to edit. Refresh your coupons.",
  RATE_LIMITED: "Please wait a moment before trying again.", NOT_ENTITLED: "Rewards access is not currently available for this account." })[code] || "We couldn’t confirm the result. Refresh your coupons before trying again. A save may have completed."; }

export default function CampaignLinksClient({ initialData, transport = checkoutTransport, previewOnly = false }) {
  const first = readList(initialData, initialData?.page || 1);
  const [data, setData] = useState(first || { offers: [], page: 1, hasMore: false, manage: false });
  const [selected, setSelected] = useState(""), [review, setReview] = useState(null), [choice, setChoice] = useState("NONE");
  const [busy, setBusy] = useState(""), [error, setError] = useState(!first ? message(initialData?.code) : ""), [notice, setNotice] = useState("");
  const active = useRef(null), epoch = useRef(0), alive = useRef(true), resultRef = useRef(null), errorRef = useRef(null);
  const current = data.offers.find(row => offerKey(row) === selected) || null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; active.current?.abort(); }; }, []);
  useEffect(() => { if (review) resultRef.current?.focus(); }, [review]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function clear() { epoch.current++; active.current?.abort(); setReview(null); setChoice("NONE"); setError(""); setNotice(""); setBusy(""); }
  function start(kind) { clear(); const number = ++epoch.current, controller = new AbortController(); active.current = controller; setBusy(kind); return { number, controller, timer: setTimeout(() => controller.abort(), 20000) }; }
  const isCurrent = request => alive.current && epoch.current === request.number;
  function finish(request) { clearTimeout(request.timer); if (isCurrent(request)) { setBusy(""); active.current = null; } }
  async function refreshOffers(page = data.page) {
    const req = start("offers"); setSelected(""); setData(value => ({ ...value, offers: [], page, hasMore: false }));
    try { const response = await checkoutRequest(transport, `${OFFERS}?page=${page}`, { signal: req.controller.signal }); if (!isCurrent(req)) return;
      const next = readList(response, page); if (!next || !next.manage) throw Object.assign(new Error(), { code: "FORBIDDEN" }); setData(next);
    } catch (problem) { if (isCurrent(req)) setError(message(problem.code)); } finally { finish(req); }
  }
  async function reviewOffer(page = 1) {
    if (!current || !data.manage || current.state === "CANCELLED") return;
    const offer = current, req = start("review");
    try { const next = await checkoutRequest(transport, `${BASE}/review`, { method: "POST", body: { offerId: offer.id, expectedVersion: offer.version, page }, signal: req.controller.signal });
      if (!isCurrent(req)) return; if (!reviewValid(next, offer, page)) throw new Error(); setReview(next); setChoice(choiceKey(next.selection));
    } catch (problem) { if (isCurrent(req)) setError(message(problem.code)); } finally { finish(req); }
  }
  async function save() {
    if (!current || !review || !data.manage || busy || choice === choiceKey(review.selection)) return;
    const offer = current, candidate = review.campaigns.find(row => choiceKey(row) === choice);
    if (choice !== "NONE" && !candidate) return;
    const req = start("save");
    try {
      const response = await checkoutRequest(transport, `${BASE}/save`, { method: "POST", body: { offerId: offer.id, expectedVersion: offer.version,
        campaignId: candidate?.id || null, ...(candidate ? { campaignPublicationRevision: candidate.publicationRevision } : {}) }, signal: req.controller.signal });
      if (!isCurrent(req)) return;
      const saved = offerSummary(response.offer);
      if (!saved || saved.id !== offer.id || saved.version !== offer.version + 1 || saved.state !== offer.state || saved.publishedRevision !== offer.publishedRevision) throw new Error();
      setData(value => ({ ...value, offers: value.offers.map(row => row.id === saved.id ? saved : row) })); setSelected(offerKey(saved));
      setNotice("Draft choice saved. Publish a new coupon version from Shop offers when you are ready. The current published coupon and audio are unchanged.");
      const refreshed = await checkoutRequest(transport, `${BASE}/review`, { method: "POST", body: { offerId: saved.id, expectedVersion: saved.version, page: 1 }, signal: req.controller.signal });
      if (!isCurrent(req)) return; if (!reviewValid(refreshed, saved, 1)) throw new Error(); setReview(refreshed); setChoice(choiceKey(refreshed.selection));
    } catch (problem) { if (isCurrent(req)) setError(message(problem.code)); } finally { finish(req); }
  }
  return <main className={styles.page}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL CAMPAIGN LINKS PREVIEW</strong> · Synthetic data · Saves stay in this sample tab · No live publication or audio</p>}
    <div className={styles.container}><a className={styles.back} href="/dashboard/retail/rewards">← Shop offers</a><p className={styles.eyebrow}>RUVANAS REWARDS · CLIENT ADMIN</p><h1>A campaign for your coupon.</h1><p className={styles.lead}>Optionally connect your next coupon publication to a compatible audio campaign.</p>
      <div className={styles.notice}><strong>Your choice stays in the draft</strong><p>Saving here does not publish a coupon, schedule audio or change a playing stream. A link records the campaign associated with a new coupon version; it does not prove playback, listening or sales.</p></div>
      <section className={styles.selectionCard} aria-label="Choose a coupon draft"><div className={styles.sectionHeading}><div><span className={styles.step}>1</span><h2>Choose a saved coupon</h2></div><button className={styles.textButton} disabled={busy === "save" || busy === "offers"} onClick={() => refreshOffers()}>Refresh coupons</button></div>
        {!data.manage && !error && <p className={styles.empty}>Managing campaign choices needs permission to edit offers for every selected shop.</p>}
        <form onSubmit={event => { event.preventDefault(); reviewOffer(); }}><label className={styles.field}>Saved coupon<select value={selected} disabled={busy === "save" || busy === "offers" || !data.manage} onChange={event => { clear(); setSelected(event.target.value); }}><option value="">Choose a coupon to review</option>{data.offers.map(row => <option key={offerKey(row)} value={offerKey(row)} disabled={row.state === "CANCELLED"}>{row.title} · draft {row.version}{row.state === "CANCELLED" ? " · cancelled" : ""}</option>)}</select></label>
          {current && <p className={styles.help}>Saved draft {current.version}{current.publishedRevision ? ` · Published coupon revision ${current.publishedRevision}` : " · Not published yet"}. Compatibility uses this saved draft’s shops and dates.</p>}
          <button className={styles.primary} disabled={!!busy || !current || !data.manage || current.state === "CANCELLED"}>{busy === "review" ? "Reviewing campaigns…" : "Review compatible campaigns"}</button></form>
        {!data.offers.length && !busy && !error && <p className={styles.empty}>No saved coupons are available on this page. Create a coupon in Shop offers first.</p>}
        {(data.hasMore || data.page > 1) && <div className={styles.pagination}><button className={styles.secondary} disabled={!!busy || data.page <= 1} onClick={() => refreshOffers(data.page - 1)}>← Previous coupons</button><span>Coupon page {data.page}</span><button className={styles.secondary} disabled={!!busy || !data.hasMore} onClick={() => refreshOffers(data.page + 1)}>More coupons →</button></div>}
      </section>
      {busy && <p role="status" className={styles.loading}>{busy === "save" ? "Saving the next draft choice and checking its saved state…" : "Checking current saved data and your access…"}</p>}
      {notice && <p className={styles.success} role="status">{notice} <a href="/dashboard/retail/rewards">Open Shop offers →</a></p>}
      {error && <p ref={errorRef} tabIndex={-1} className={styles.error} role="alert">{error}</p>}
      {review && <section className={styles.results} ref={resultRef} tabIndex={-1} aria-label="Campaign choice review"><div className={styles.sectionHeading}><div><span className={styles.step}>2</span><h2>Choose an optional campaign</h2></div><button className={styles.textButton} disabled={!!busy} onClick={() => reviewOffer(review.page)}>Refresh review</button></div><p className={styles.resultLead}>For <strong>{review.offer.title}</strong> · saved draft {review.offer.version}</p>
        <div className={styles.historyGrid}><section className={styles.history}><h3>Saved for the next publication</h3><p>{review.selection ? review.selection.name : "No campaign selected"}</p>{review.selection && <small>Campaign publication {review.selection.publicationRevision}. It is checked again when you save or publish.</small>}</section><section className={styles.history}><h3>Current published coupon</h3><p>{review.publishedLink ? review.publishedLink.name : "No published campaign link"}</p>{review.publishedLink && <small>Coupon revision {review.publishedLink.revision} · campaign publication {review.publishedLink.publicationRevision}. This historical association stays unchanged when you save a new draft choice.</small>}</section></div>
        <fieldset className={styles.choices}><legend>Campaign for the next coupon publication</legend><label className={styles.noneChoice}><input type="radio" name="campaign" checked={choice === "NONE"} onChange={() => setChoice("NONE")} /> <span><strong>No campaign</strong><small>Remove the draft selection. Published history is retained.</small></span></label>
          <div className={styles.cards}>{review.campaigns.map(row => <label className={`${styles.campaign} ${choice === choiceKey(row) ? styles.selectedCampaign : ""}`} key={row.id}><span className={styles.campaignTop}><input type="radio" name="campaign" checked={choice === choiceKey(row)} onChange={() => { setChoice(choiceKey(row)); setNotice(""); }} /><span className={styles.match}>Compatible with this draft</span><span className={styles.version}>Publication {row.publicationRevision}</span></span><strong className={styles.campaignTitle}>{row.name}</strong><span className={styles.promo}>{row.promoName}</span><span className={styles.dates}>{dateLabel(row.startsOn)} – {dateLabel(row.endsOn)}</span></label>)}</div>
        </fieldset>
        {!review.campaigns.length && <p className={styles.empty}>No compatible campaigns on this page. You can keep the coupon without a campaign.</p>}
        <div className={styles.pagination}><button className={styles.secondary} disabled={!!busy || review.page <= 1} onClick={() => reviewOffer(review.page - 1)}>← Previous campaigns</button><span>Campaign page {review.page}</span><button className={styles.secondary} disabled={!!busy || !review.hasMore} onClick={() => reviewOffer(review.page + 1)}>More campaigns →</button></div>
        <div className={styles.savePanel}><div><strong>{choice === choiceKey(review.selection) ? "No unsaved change" : choice === "NONE" ? "Remove the draft campaign selection" : "New draft campaign choice"}</strong><p>Only a separate publication in Shop offers creates a new coupon revision with this choice. Existing claims keep their original association.</p></div><button className={styles.primary} onClick={save} disabled={!!busy || choice === choiceKey(review.selection) || choice !== "NONE" && !review.campaigns.some(row => choiceKey(row) === choice)}>{choice === "NONE" ? "Save without a campaign" : "Save draft choice"}</button></div>
        <p className={styles.checked}>Checked {dateLabel(review.checkedAt)}. Campaign pages are reviewed separately; changing page discards an unsaved choice.</p>
      </section>}
      <details className={styles.explanation}><summary>What this link means</summary><p>Compatibility checks the saved coupon’s direct shop targets and date overlap. It does not establish exact play times, audio delivery, listener activity or sales.</p><p>Saving or removing a choice affects the next draft publication only. There are no audio controls here, and old coupon claims are not relinked.</p></details>
    </div>
  </main>;
}
