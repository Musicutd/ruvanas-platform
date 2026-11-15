"use client";

import { useMemo, useRef, useState } from "react";
import { REWARD_CATEGORIES, validateOfferTerms } from "@/lib/retail-rewards/offer-contracts.mjs";
import { emptyOfferForm, termsToOfferForm, offerFormToTerms, offerBenefit, offerDateLabel } from "@/lib/retail-rewards/offer-ui.mjs";
import styles from "./reward-offers.module.css";

const label = value => value?.charAt(0) + value?.slice(1).toLowerCase().replaceAll("_", " ");
const categories = Object.fromEntries(REWARD_CATEGORIES.map(row => [row.value, row.label]));
const sameTerms = (left, right) => {
  const a = validateOfferTerms(left), b = validateOfferTerms(right);
  return a.ok && b.ok && JSON.stringify({ ...a.terms, locationIds: [...a.terms.locationIds].sort() }) === JSON.stringify({ ...b.terms, locationIds: [...b.terms.locationIds].sort() });
};
const EMPTY = { offers: [], locations: [], capabilities: { manage: false, publish: false }, limits: {}, page: 1, hasMore: false };
const TRANSITIONS = {
  PUBLISH: { title: "Publish these offer terms?", verb: "Publish offer", note: "This saves the exact terms as a published revision. Shopper discovery requires separate approval for this revision. Claiming and checkout also depend on current access and the offer’s dates and use limits." },
  PAUSE: { title: "Pause this offer?", verb: "Pause offer", note: "The offer stops accepting new claims. Already-issued coupons follow the pause policy in their issued terms. Its saved terms and history are kept." },
  RESUME: { title: "Resume the published offer?", verb: "Resume offer", note: "This resumes the last published revision. Any newer draft changes stay unpublished." },
  CANCEL: { title: "Cancel this offer?", verb: "Cancel offer", note: "Cancellation is final for this offer. Its history is kept; create a new offer if you need another one." }
};

async function browserTransport(path, options = {}) {
  const response = await fetch(path, { method: options.method || "GET", credentials: "same-origin", cache: "no-store", signal: options.signal,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json().catch(() => ({ ok: false, error: "The server returned an unexpected response." }));
  if (!response.ok) return { ...data, ok: false, status: response.status };
  return data;
}

function TermsPreview({ terms, locations, heading = "Offer preview" }) {
  const names = new Map(locations.map(row => [row.id, row.name]));
  const money = amount => new Intl.NumberFormat("en-GB", { style: "currency", currency: terms.currency }).format(amount / 100);
  return <section className={styles.coupon} aria-label={heading}>
    <p className={styles.eyebrow}>{heading} · {categories[terms.category]}</p>
    <strong className={styles.benefit}>{offerBenefit(terms)}</strong><h3>{terms.title}</h3>
    {terms.description && <p>{terms.description}</p>}
    <dl className={styles.termsGrid}>
      <div><dt>Minimum spend</dt><dd>{terms.minimumSpendMinor ? money(terms.minimumSpendMinor) : "No minimum spend"}</dd></div>
      <div><dt>Shopper use</dt><dd>{terms.usage === "SINGLE_USE" ? "Once per shopper" : `Up to ${terms.perShopperLimit} uses per shopper · ${terms.perShopperDailyLimit} per day`}</dd></div>
      <div><dt>Valid from</dt><dd>{offerDateLabel(terms.startsAt, terms.timezone)}</dd></div>
      <div><dt>Valid until</dt><dd>{offerDateLabel(terms.endsAt, terms.timezone)}</dd></div>
      <div><dt>Participating shops</dt><dd>{terms.locationIds.map(id => names.get(id) || "Shop unavailable").join(", ")}</dd></div>
      <div><dt>Total uses across this offer</dt><dd>{terms.totalLimit}</dd></div>
    </dl>
    <p className={styles.small}>{terms.timezone} · {terms.combinable ? "Can be combined with other offers" : "Cannot be combined with other offers"}</p>
    {terms.exclusions && <p><strong>Exclusions: </strong>{terms.exclusions}</p>}
    <p className={styles.preWrap}><strong>Terms: </strong>{terms.legalTerms}</p>
    <p className={styles.small}>If paused: {terms.pausedClaimsPolicy === "HONOUR_ISSUED" ? "already-issued claims keep their published terms" : "already-issued claims are blocked while the offer is paused"}.</p>
    {terms.usage === "REUSABLE" && <p className={styles.small}>Each use will need a fresh, separately validated claim. This preview is not a redeemable coupon.</p>}
  </section>;
}

export default function RewardOffersClient({ initialData, apiBase = "/api/retail-rewards/offers", transport = browserTransport, previewOnly = false }) {
  const [data, setData] = useState({ ...EMPTY, ...initialData });
  const [filters, setFilters] = useState({ search: "", category: "", state: "" });
  const [appliedFilters, setAppliedFilters] = useState({ search: "", category: "", state: "" });
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(null);
  const [baseline, setBaseline] = useState("");
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialData?.ok === false ? initialData.error : "");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState(undefined);
  const inFlight = useRef(false);
  const editorRef = useRef(null);
  const hasChanges = form !== null && JSON.stringify(form) !== baseline;
  const preview = useMemo(() => {
    if (!form) return null;
    try {
      const result = validateOfferTerms(offerFormToTerms(form));
      return result.ok ? result : { ok: false, error: result.issues.map(issue => `${label(issue.field)}: ${issue.message}`).slice(0, 5).join(" ") };
    } catch (problem) { return { ok: false, error: problem.message }; }
  }, [form]);
  const update = (key, value) => { setForm(current => ({ ...current, [key]: value })); setConfirm(null); setError(""); };

  function openEditor(offer) {
    if (busy) return;
    if (hasChanges) { setReplaceTarget(offer); return; }
    applyEditor(offer);
  }
  function applyEditor(offer) {
    const next = offer ? termsToOfferForm(offer.draft) : emptyOfferForm();
    setEditor(offer || { id: null }); setForm(next); setBaseline(JSON.stringify(next));
    setStep(1); setError(""); setMessage(""); setConflict(false); setConfirm(null); setConfirmed(false); setReplaceTarget(undefined);
    requestAnimationFrame(() => editorRef.current?.focus());
  }
  function closeEditor() {
    if (hasChanges) { setReplaceTarget("CLOSE"); return; }
    setEditor(null); setForm(null); setConfirm(null);
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await transport(path, { ...options, signal: controller.signal });
      if (!result || result.ok !== true) {
        if (result?.code === "CONFLICT") setConflict(true);
        throw new Error(result?.error || "The request could not be completed.");
      }
      return result;
    } catch (problem) {
      if (problem.name === "AbortError") throw new Error(options.method ? "The save could not be confirmed. Reload the saved offers before trying again; the server may have completed it." : "Loading took too long. Try again.");
      throw problem;
    } finally { clearTimeout(timer); }
  }
  async function load(page = 1, selectedFilters = appliedFilters) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const query = new URLSearchParams({ page: String(page) });
      for (const [key, value] of Object.entries(selectedFilters)) if (value.trim()) query.set(key, value.trim());
      const result = await request(`${apiBase}?${query}`);
      setData({ ...EMPTY, ...result }); setAppliedFilters({ ...selectedFilters });
      setMessage("Saved offers refreshed. Unsaved editor changes have been kept.");
    } catch (problem) { setError(problem.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function rememberOffer(offer) {
    setData(current => ({ ...current, offers: current.offers.some(row => row.id === offer.id) ? current.offers.map(row => row.id === offer.id ? offer : row) : [offer, ...current.offers] }));
    setEditor(offer); const saved = termsToOfferForm(offer.draft); setForm(saved); setBaseline(JSON.stringify(saved)); setConflict(false);
  }
  async function save(event) {
    event.preventDefault();
    if (step !== 3) { setStep(current => Math.min(3, current + 1)); return; }
    if (!data.capabilities.manage || busy || inFlight.current || !form || conflict) return;
    if (!preview?.ok) { setError(preview?.error || "Complete the offer details first."); setStep(3); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await request(editor.id ? `${apiBase}/${encodeURIComponent(editor.id)}` : apiBase,
        { method: editor.id ? "PATCH" : "POST", body: { terms: preview.terms, ...(editor.id ? { expectedVersion: editor.version } : {}) } });
      rememberOffer(result.offer); setMessage("Draft saved. Published terms have not changed."); setStep(3);
    } catch (problem) { setError(problem.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function transition() {
    if (!confirm || !confirmed || !editor?.id || inFlight.current || hasChanges || conflict) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await request(`${apiBase}/${encodeURIComponent(editor.id)}/${confirm.toLowerCase()}`, { method: "POST", body: { expectedVersion: editor.version } });
      rememberOffer(result.offer); setMessage(confirm === "PUBLISH" ? `Offer revision ${result.offer.publishedRevision} published. This revision needs separate approval for shopper discovery. Claiming and checkout remain subject to current access, dates and use limits.` : `Offer ${confirm === "CANCEL" ? "cancelled" : confirm === "PAUSE" ? "paused" : "resumed"}.`);
      setConfirm(null); setConfirmed(false);
    } catch (problem) { setError(problem.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function askTransition(action) { setConfirm(action); setConfirmed(false); setError(""); }

  return <main className={styles.page} aria-busy={busy}>
    <div className={styles.container}>
      {previewOnly && <div className={styles.previewBanner}><strong>LOCAL PREVIEW</strong> · Sample shops and offers · Changes stay in this tab · No live accounts or charges</div>}
      <header className={styles.hero}><div><p className={styles.eyebrow}>RUVANAS RETAIL REWARDS · CLIENT ADMIN</p><h1>Give shoppers a reason to return.</h1><p>Create offers for your own shops. Choose the saving, set clear conditions, then review the exact terms before publishing.</p></div>
        {data.capabilities.manage && <button type="button" className={styles.primary} onClick={() => openEditor(null)} disabled={busy}>＋ Create an offer</button>}</header>
      <p className={styles.stageNote}>Manage offers for your own shops. Published revisions need separate approval for shopper discovery. Shoppers use their own accounts; authorised shop staff confirm redemptions under the issued terms and use limits.</p>
      <div className={styles.workspace}>
        <section className={styles.listPanel} aria-label="Your offers">
          <div className={styles.sectionHead}><div><h2>Your offers</h2><p>Only your organisation’s offers and shops.</p></div><button type="button" className={styles.subtle} onClick={() => load(data.page)} disabled={busy}>Refresh</button></div>
          <form className={styles.filters} onSubmit={event => { event.preventDefault(); load(1, filters); }}>
            <label className={styles.search}>Find an offer<input type="search" maxLength={140} placeholder="Search offer names" value={filters.search} onChange={e => setFilters(current => ({ ...current, search: e.target.value }))} /></label>
            <label>Category<select aria-label="Category" value={filters.category} onChange={e => setFilters(current => ({ ...current, category: e.target.value }))}><option value="">All categories</option>{REWARD_CATEGORIES.map(row => <option value={row.value} key={row.value}>{row.label}</option>)}</select></label>
            <label>Status<select aria-label="Status" value={filters.state} onChange={e => setFilters(current => ({ ...current, state: e.target.value }))}><option value="">All statuses</option>{["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "CANCELLED"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
            <button className={styles.secondary} disabled={busy}>Search</button>
          </form>
          <div className={styles.offerList}>{data.offers.length === 0 ? <div className={styles.empty}><h3>{appliedFilters.search || appliedFilters.category || appliedFilters.state ? "No matching offers" : "Create your first offer"}</h3><p>One shop can have several offers, each with its own terms and usage limits.</p></div> : data.offers.map(offer => <article key={offer.id} className={`${styles.offerCard} ${editor?.id === offer.id ? styles.selectedCard : ""}`}>
            <div className={styles.cardTop}><span className={styles.category}>{categories[offer.draft.category]}</span><span className={styles.badge} data-state={offer.displayState}>{label(offer.displayState || offer.state)}</span></div>
            <h3>{offer.draft.title}</h3><p className={styles.offerSaving}>{offerBenefit(offer.draft)}{offer.draft.minimumSpendMinor > 0 && <span> when spending {new Intl.NumberFormat("en-GB", { style: "currency", currency: offer.draft.currency }).format(offer.draft.minimumSpendMinor / 100)}</span>}</p>
            <p className={styles.small}>{offer.draft.usage === "SINGLE_USE" ? "Once per shopper" : `Up to ${offer.draft.perShopperLimit} uses per shopper`} · {offer.draft.locationIds.length} {offer.draft.locationIds.length === 1 ? "shop" : "shops"}</p>
            {offer.publishedRevision && !sameTerms(offer.draft, offer.publishedTerms) && <p className={styles.draftNote}>Unpublished draft changes</p>}
            <div className={styles.cardBottom}><small>{offer.publishedRevision ? `Published revision ${offer.publishedRevision}` : "Not published"}</small><button type="button" className={styles.subtle} onClick={() => openEditor(offer)} disabled={busy}>{data.capabilities.manage && offer.state !== "CANCELLED" ? "Review / edit" : "View offer"} →</button></div>
          </article>)}</div>
          <div className={styles.pagination}><button type="button" disabled={busy || data.page <= 1} onClick={() => load(data.page - 1)}>← Previous</button><span>Page {data.page}</span><button type="button" disabled={busy || !data.hasMore} onClick={() => load(data.page + 1)}>Next →</button></div>
          {Number.isInteger(data.limits?.activeOffers) && <p className={styles.small}>Current allowance: up to {data.limits.activeOffers} unexpired published offers across {data.limits.locations} shops. Paused and scheduled offers count toward this allowance.</p>}
        </section>
        {editor && form && <section className={styles.editor} ref={editorRef} tabIndex={-1} aria-label="Offer editor">
          <div className={styles.sectionHead}><div><p className={styles.eyebrow}>{editor.id ? `SAVED VERSION ${editor.version}` : "NEW OFFER"}</p><h2>{editor.id ? "Review your offer" : "Create an offer"}</h2></div><button type="button" className={styles.subtle} onClick={closeEditor} disabled={busy}>Close</button></div>
          <nav className={styles.steps} aria-label="Offer details">{["The offer", "Shops & rules", "Review"].map((name, index) => <button type="button" key={name} aria-current={step === index + 1 ? "step" : undefined} onClick={() => setStep(index + 1)}>{index + 1}. {name}</button>)}</nav>
          <form onSubmit={save} noValidate>
            <fieldset className={styles.fields} disabled={busy || !data.capabilities.manage || editor.state === "CANCELLED"}>
              {step === 1 && <>
                <label>Offer name<input maxLength={140} value={form.title} onChange={e => update("title", e.target.value)} placeholder="For example, 15% off everything" autoComplete="off" /></label>
                <label>Category<select aria-label="Category" value={form.category} onChange={e => update("category", e.target.value)}>{REWARD_CATEGORIES.map(row => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
                <label>Offer type<select aria-label="Offer type" value={form.type} onChange={e => update("type", e.target.value)}><option value="PERCENT_OFF">Percentage off</option><option value="FIXED_AMOUNT">Money off</option><option value="BOGO">Buy one / get one</option></select></label>
                <div className={styles.twoColumns}>
                  {form.type === "PERCENT_OFF" && <label>Discount (%)<input inputMode="decimal" value={form.percent} onChange={e => update("percent", e.target.value)} /></label>}
                  {form.type === "FIXED_AMOUNT" && <label>Discount amount<input inputMode="decimal" value={form.amount} onChange={e => update("amount", e.target.value)} /></label>}
                  {form.type === "BOGO" && <><label>Buy quantity<input inputMode="numeric" value={form.buyQuantity} onChange={e => update("buyQuantity", e.target.value)} /></label><label>Free quantity<input inputMode="numeric" value={form.getQuantity} onChange={e => update("getQuantity", e.target.value)} /></label></>}
                  <label>Currency<select aria-label="Currency" value={form.currency} onChange={e => update("currency", e.target.value)}>{["EUR", "USD", "GBP", "CAD"].map(value => <option key={value}>{value}</option>)}</select></label>
                </div>
                <label>Short description (optional)<textarea rows={3} maxLength={2000} value={form.description} onChange={e => update("description", e.target.value)} placeholder="Tell shoppers what makes this offer useful." /></label>
              </>}
              {step === 2 && <>
                <fieldset className={styles.shopChoices}><legend>Choose participating shops</legend>{data.locations.length ? data.locations.map(location => <label key={location.id} className={styles.check}><input type="checkbox" checked={form.locationIds.includes(location.id)} onChange={e => update("locationIds", e.target.checked ? [...form.locationIds, location.id] : form.locationIds.filter(id => id !== location.id))} />{location.name}</label>) : <p>No eligible shops are available. Ask your administrator to check your Rewards access.</p>}</fieldset>
                {data.locationSelectionTruncated && <p className={styles.warning}>Only the first 500 eligible shops are shown. This form cannot select shops beyond that list.</p>}
                {form.locationIds.some(id => !data.locations.some(row => row.id === id)) && <div className={styles.warning}><p>A previously selected shop is no longer available. Review the participating shops before saving.</p><button type="button" className={styles.secondary} onClick={() => update("locationIds", form.locationIds.filter(id => data.locations.some(row => row.id === id)))}>Remove unavailable selections</button></div>}
                <div className={styles.twoColumns}><label>Starts<input type="datetime-local" value={form.startsAt} onChange={e => update("startsAt", e.target.value)} /></label><label>Ends<input type="datetime-local" value={form.endsAt} onChange={e => update("endsAt", e.target.value)} /></label></div>
                <label>Timezone<input value={form.timezone} maxLength={64} list="reward-timezones" onChange={e => update("timezone", e.target.value)} /><datalist id="reward-timezones"><option value="Europe/Malta" /><option value="Europe/London" /><option value="America/New_York" /><option value="UTC" /></datalist><small>Both dates above use this timezone, even if your computer is elsewhere.</small></label>
                <div className={styles.twoColumns}><label>Minimum spend ({form.currency})<input inputMode="decimal" value={form.minimumSpend} onChange={e => update("minimumSpend", e.target.value)} /><small>Use 0 for no minimum.</small></label><label>Shopper use<select aria-label="Shopper use" value={form.usage} onChange={e => update("usage", e.target.value)}><option value="SINGLE_USE">Once per shopper</option><option value="REUSABLE">More than once</option></select></label></div>
                {form.usage === "REUSABLE" && <div className={styles.twoColumns}><label>Uses per shopper<input inputMode="numeric" value={form.perShopperLimit} onChange={e => update("perShopperLimit", e.target.value)} /></label><label>Maximum per shopper per day<input inputMode="numeric" value={form.perShopperDailyLimit} onChange={e => update("perShopperDailyLimit", e.target.value)} /></label></div>}
                <label>Total uses across all shoppers<input inputMode="numeric" value={form.totalLimit} onChange={e => update("totalLimit", e.target.value)} /></label>
                <label>Offer terms<textarea rows={4} maxLength={5000} value={form.legalTerms} onChange={e => update("legalTerms", e.target.value)} placeholder="State what is included and how the offer can be used." /></label>
                <details className={styles.moreRules}><summary>Exclusions, combining offers & pauses</summary><label>Exclusions (optional)<textarea rows={2} maxLength={2000} value={form.exclusions} onChange={e => update("exclusions", e.target.value)} /></label><label className={styles.check}><input type="checkbox" checked={form.combinable} onChange={e => update("combinable", e.target.checked)} />Can be combined with other offers</label><label>What happens to issued claims if you pause?<select value={form.pausedClaimsPolicy} onChange={e => update("pausedClaimsPolicy", e.target.value)}><option value="HONOUR_ISSUED">Honour their published terms</option><option value="BLOCK_WHILE_PAUSED">Block them while the offer is paused</option></select></label><p className={styles.small}>These conditions are included in each issued coupon and checked at checkout. Getting a coupon does not reserve a use.</p></details>
              </>}
              {step === 3 && (preview?.ok ? <TermsPreview terms={preview.terms} locations={data.locations} heading="Draft terms" /> : <p className={styles.warning}>Please complete the earlier steps. {preview?.error}</p>)}
            </fieldset>
            <div className={styles.formActions}>{step > 1 && <button type="button" className={styles.secondary} onClick={() => setStep(step - 1)}>← Back</button>}{step < 3 ? <button key="next-step" type="button" className={styles.primary} onClick={event => { event.preventDefault(); setStep(step + 1); }}>Next: {step === 1 ? "shops & rules" : "review"} →</button> : data.capabilities.manage && editor.state !== "CANCELLED" && <button key="save-draft" type="submit" className={styles.primary} disabled={busy || conflict || !preview?.ok || (Boolean(editor.id) && !hasChanges)}>{busy ? "Saving…" : "Save draft"}</button>}</div>
          </form>
          {editor.publishedTerms && <details className={styles.published}><summary>Published revision {editor.publishedRevision} · saved separately from this draft</summary><TermsPreview terms={editor.publishedTerms} locations={data.locations} heading="Published terms" /></details>}
          {conflict && <div className={styles.warning} role="alert"><strong>This offer changed in another session.</strong><p>Your edits are kept here. Refresh saved offers, then open the latest version before applying your changes again.</p><button type="button" className={styles.secondary} onClick={() => load(data.page)} disabled={busy}>Refresh saved offers</button></div>}
          {editor.id && editor.state !== "CANCELLED" && data.capabilities.publish && <section className={styles.publishActions}><h3>Publication</h3><p>Saving a draft does not replace its published terms. Review the saved draft before publishing.</p>{hasChanges && <p className={styles.warning}>Save your changes first.</p>}
            <div className={styles.actionRow}><button type="button" className={styles.primary} disabled={busy || hasChanges || conflict || !preview?.ok} onClick={() => askTransition("PUBLISH")}>Review & publish</button>
              {editor.state === "PUBLISHED" && <button type="button" className={styles.secondary} disabled={busy || hasChanges || conflict} onClick={() => askTransition("PAUSE")}>Pause</button>}
              {editor.state === "PAUSED" && <button type="button" className={styles.secondary} disabled={busy || hasChanges || conflict} onClick={() => askTransition("RESUME")}>Resume published offer</button>}
              <button type="button" className={styles.danger} disabled={busy || hasChanges || conflict} onClick={() => askTransition("CANCEL")}>Cancel offer</button></div>
          </section>}
          {confirm && <section className={styles.confirmation} role="region" aria-label="Confirm offer change"><h3>{TRANSITIONS[confirm].title}</h3><p>{TRANSITIONS[confirm].note}</p><p><strong>{editor.draft.title}</strong> · version {editor.version}</p><label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />I have reviewed this change and the saved offer terms.</label><div className={styles.actionRow}><button type="button" className={confirm === "CANCEL" ? styles.danger : styles.primary} disabled={busy || !confirmed || hasChanges || conflict} onClick={transition}>{busy ? "Confirming…" : TRANSITIONS[confirm].verb}</button><button type="button" className={styles.secondary} onClick={() => setConfirm(null)} disabled={busy}>Keep as it is</button></div></section>}
        </section>}
      </div>
      {replaceTarget !== undefined && <section className={styles.discard} role="alert"><strong>You have unsaved changes.</strong><p>Keep editing, or discard those changes before continuing.</p><div className={styles.actionRow}><button type="button" className={styles.secondary} onClick={() => setReplaceTarget(undefined)}>Keep editing</button><button type="button" className={styles.danger} onClick={() => { if (replaceTarget === "CLOSE") { setEditor(null); setForm(null); setReplaceTarget(undefined); } else applyEditor(replaceTarget); }}>Discard unsaved changes</button></div></section>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {message && <p role="status" className={styles.success}>{message}</p>}
    </div>
  </main>;
}
