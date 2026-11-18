"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import { pilotOrganisations, pilotOverview, pilotMutationResult, pilotExpiry, pilotFormLimits, pilotMessage, PILOT_TIERS, PILOT_LIMIT_FIELDS, PILOT_LIMIT_LABELS } from "@/lib/retail-rewards/pilot-admin-ui.mjs";
import { pilotReadiness, pilotReadinessRow, pilotNextStep, pilotReadinessMessage } from "@/lib/retail-rewards/pilot-readiness-ui.mjs";
import styles from "./pilot-admin.module.css";

const BASE = "/api/admin/retail-rewards/pilot";
const dateLabel = value => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Malta" }).format(new Date(value));
const tierLabel = value => value.replace("REWARDS_", "").toLowerCase().replace(/^./, s => s.toUpperCase());
const blankLimits = () => ({ activeOffers: "", locations: "", staffSeats: "", monthlyRedemptions: "", analyticsRetentionDays: "", exportEnabled: false, brandingEnabled: false });
const blankShop = () => ({ locationId: "", publicSlug: "", displayName: "", description: "", locality: "", countryCode: "MT", confirm: false });
const blankInvite = () => ({ email: "", displayName: "", expiresAt: "", confirm: false });
const blankPreparedInvite = () => ({ shopperId: "", expiresAt: "", confirm: false });
const blankActivation = () => ({ locationId: "", confirm: false });

export default function RewardsPilotAdmin({ initialOrganisations = [], transport = checkoutTransport, previewOnly = false }) {
  const organisations = pilotOrganisations(initialOrganisations);
  const [selected, setSelected] = useState(""), [data, setData] = useState(null), [tab, setTab] = useState("access");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState(""), [invitation, setInvitation] = useState(null);
  const [expiry, setExpiry] = useState(""), [tier, setTier] = useState("REWARDS_STARTER"), [allowances, setAllowances] = useState(blankLimits);
  const [shop, setShop] = useState(blankShop), [offer, setOffer] = useState({ id: "", publicSlug: "", confirm: false }), [invite, setInvite] = useState(blankInvite);
  const [preparedInvite, setPreparedInvite] = useState(blankPreparedInvite), [activation, setActivation] = useState(blankActivation);
  const [pendingAction, setPendingAction] = useState(null);
  const [readiness, setReadiness] = useState(null), [readinessError, setReadinessError] = useState("");
  const epoch = useRef(0), active = useRef(null), alive = useRef(true), errorRef = useRef(null), tokenRef = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; active.current?.abort(); }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (invitation) tokenRef.current?.focus(); }, [invitation]);
  function clear() { epoch.current++; active.current?.abort(); setBusy(""); setError(""); setNotice(""); setInvitation(null); setPendingAction(null); setReadiness(null); setReadinessError(""); }
  function select(value) { clear(); setSelected(value); setData(null); setTab("access"); setShop(blankShop()); setOffer({ id: "", publicSlug: "", confirm: false }); setInvite(blankInvite()); setPreparedInvite(blankPreparedInvite()); setActivation(blankActivation()); setExpiry(""); setAllowances(blankLimits()); }
  function start(operation) { clear(); const number = ++epoch.current, controller = new AbortController(); active.current = controller; setBusy(operation); return { number, controller, timer: setTimeout(() => controller.abort(), 20000) }; }
  const current = req => alive.current && epoch.current === req.number;
  function finish(req) { clearTimeout(req.timer); if (current(req)) { setBusy(""); active.current = null; } }
  async function read(organisationId, signal) { const result = await checkoutRequest(transport, `${BASE}/overview?organisationId=${encodeURIComponent(organisationId)}`, { signal }); const parsed = pilotOverview(result, organisationId); if (!parsed) throw new Error(); return parsed; }
  async function readReadiness(organisationId, req) {
    try {
      const result = await checkoutRequest(transport, `${BASE}/readiness?organisationId=${encodeURIComponent(organisationId)}`, { signal: req.controller.signal });
      const parsed = pilotReadiness(result, organisationId); if (!parsed) throw new Error();
      if (current(req)) setReadiness(parsed);
    } catch (problem) { if (current(req)) { setReadiness(null); setReadinessError(pilotReadinessMessage(problem.code)); } }
  }
  async function refresh() {
    if (!organisations.some(o => o.id === selected)) return;
    const req = start("overview"), organisationId = selected; setData(null);
    try { const result = await read(organisationId, req.controller.signal); if (current(req)) { setData(result); setShop(blankShop()); setOffer({ id: "", publicSlug: "", confirm: false }); setInvite(blankInvite()); setPreparedInvite(blankPreparedInvite()); setActivation(blankActivation()); await readReadiness(organisationId, req); } }
    catch (problem) { if (current(req)) setError(pilotMessage(problem.code)); } finally { finish(req); }
  }
  async function mutate(operation, fields) {
    if (busy || !data || data.organisation.id !== selected) return;
    const organisationId = selected, req = start(operation); setData(null);
    try {
      const raw = await checkoutRequest(transport, `${BASE}/${operation}`, { method: "POST", body: { organisationId, ...fields }, signal: req.controller.signal });
      if (!current(req)) return;
      const saved = pilotMutationResult(operation, raw, fields); if (!saved) throw new Error();
      // The one-time code is not placed in state until the selected pilot has
      // been reloaded successfully. Lost responses can be recovered by reissue.
      const refreshed = await read(organisationId, req.controller.signal); if (!current(req)) return;
      setData(refreshed); setShop(blankShop()); setOffer({ id: "", publicSlug: "", confirm: false }); setInvite(blankInvite()); setPreparedInvite(blankPreparedInvite()); setActivation(blankActivation());
      setNotice(({ prepare: "Pilot access prepared with the explicit allowances below.", activateLocation: "The existing shop is active for Rewards setup. Review and publish its shopper-facing profile next. Audio and devices were not changed.", publishShop: "Shop profile published for eligible signed-in shoppers.", approveOffer: "This exact coupon revision is approved for shopper discovery.", invite: "A new shopper invitation was created. Its one-time code is shown below.", invitePrepared: "The prepared shopper has a one-time invitation below. The account stays disabled until the shopper accepts it.", reissue: "A replacement invitation was created. The previous code no longer works.", revoke: "The pending invitation was revoked." })[operation]);
      if (["invite", "invitePrepared", "reissue"].includes(operation)) setInvitation(saved);
      await readReadiness(organisationId, req);
    } catch (problem) { if (current(req)) { setInvitation(null); setError(pilotMessage(problem.code)); } } finally { finish(req); }
  }
  function submit(event, fn) { event.preventDefault(); setError(""); try { fn(); } catch (problem) { setError(problem.message || pilotMessage("INVALID_REQUEST")); } }
  const ready = data?.program?.status === "ACTIVE" && data.program.networkOptIn === true && ["TRIAL", "ACTIVE"].includes(data.grant?.status) && new Date(data.grant.expiresAt) > new Date();
  const chosenOffer = data?.offers.find(row => row.id === offer.id);
  const chosenPrepared = data?.preparedShoppers.find(row => row.shopperId === preparedInvite.shopperId);
  const canPrepare = data && !data.program && !data.grant;
  const nextStep = pilotNextStep(readiness);
  function openSetup(step) { setTab(step); setPendingAction(null); requestAnimationFrame(() => document.getElementById(`pilot-tab-${step}`)?.focus()); }
  return <main className={styles.page}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL PILOT PREVIEW</strong> · Synthetic data · Actions stay in this tab · No live access, email or audio</p>}
    <div className={styles.container}>
      <p className={styles.eyebrow}>RUVANAS REWARDS · SUPER ADMIN</p><h1>Prepare a Rewards pilot.</h1>
      <p className={styles.lead}>Set up a test shop, approve its coupons for discovery and invite shoppers.</p>
      <p className={styles.notice}>This is temporary pilot access. Each allowance is explicit; choosing a Rewards tier does not buy or alter a paid subscription. Client admins manage shop offers. Shoppers use a separate invitation and sign-in.</p>
      <section className={styles.card} aria-label="Select a pilot organisation">
        <div className={styles.heading}><h2>Choose a test organisation</h2><span className={styles.badge}>Allowed pilots only</span></div>
        <div className={styles.selection}><label className={styles.field}>Test organisation<select aria-label="Test organisation" value={selected} onChange={e => select(e.target.value)}><option value="">Choose an organisation</option>{organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><button className={styles.primary} disabled={!selected || !!busy} onClick={refresh}>{busy === "overview" ? "Checking…" : "Review pilot"}</button></div>
        {!organisations.length && <p>No test organisations are currently available to this session.</p>}
      </section>
      {busy && <p role="status" className={styles.status}>Checking access and saved pilot state…</p>}
      {error && <p role="alert" ref={errorRef} tabIndex={-1} className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.success}>{notice}</p>}
      {invitation && <section ref={tokenRef} tabIndex={-1} className={styles.token} aria-label="One-time shopper invitation">
        <div className={styles.heading}><h2>Save this invitation code now</h2><button className={styles.secondary} onClick={() => setInvitation(null)}>Dismiss code</button></div>
        <p>This code is shown once. Share it privately with the intended test shopper, who enters it at <a href="/rewards/accept-invitation" onClick={event => { if (previewOnly) event.preventDefault(); }} aria-disabled={previewOnly || undefined}>Accept shopper invitation</a>. No email has been sent. The code does not go in a link.</p>
        <label className={styles.field}>One-time invitation code<textarea aria-label="One-time invitation code" readOnly autoComplete="off" spellCheck={false} value={invitation.invitationToken} rows={3} /></label>
        <p>Accept by {dateLabel(invitation.invitationExpiresAt)} Malta time. Shopper access ends {dateLabel(invitation.membershipExpiresAt)}.</p>
      </section>}
      {data && <section aria-label="Current pilot" className={styles.workspace}>
        <div className={styles.heading}><div><p className={styles.eyebrow}>CURRENT PILOT</p><h2>{data.organisation.name}</h2></div><span className={ready ? styles.goodBadge : styles.badge}>{ready ? "Pilot access prepared" : "Setup needed"}</span></div>
        <section className={styles.readiness} aria-label="Pilot readiness">
          <div className={styles.heading}><div><p className={styles.eyebrow}>READ-ONLY CHECK</p><h3>What is ready for the pilot?</h3></div><span className={styles.badge}>End-to-end test not verified</span></div>
          <p className={styles.readinessIntro}>See what is configured and what is eligible now. These checks do not create accounts, grant access or prove a shopper claim and shop redemption worked. Usage limits are checked again when a coupon is claimed or redeemed.</p>
          {readinessError && <p role="alert" className={styles.error}>{readinessError}</p>}
          {!readiness && !readinessError && <p role="status" className={styles.status}>Checking the selected pilot’s readiness…</p>}
          {readiness && <>
            <dl className={styles.readinessSummary}><div><dt>Configured</dt><dd>{readiness.configured ? "Setup present" : "Setup incomplete"}</dd></div><div><dt>Eligible now</dt><dd>{readiness.eligibleNow ? "Ready to test" : "Needs attention"}</dd></div><div><dt>End-to-end test</dt><dd>Not verified</dd></div></dl>
            {readiness.checks.some(check => check.code === "PRIVATE_PREVIEW_BLOCKED") && <p className={styles.compatibility}><strong>Private preview cannot run this multi-role pilot.</strong> Its tester session cannot substitute for the separate Client Admin, cashier and shopper accounts. Preparing records here does not remove that restriction.</p>}
            <ol className={styles.readinessList}>{readiness.checks.map(check => { const row = pilotReadinessRow(check); return <li key={check.key}><div className={styles.readinessRow}><h4>{row.title}</h4><span className={check.status === "READY" ? styles.goodBadge : styles.badge}>{check.status === "READY" ? "Eligible now" : check.status === "MISSING" ? "Not configured" : "Blocked now"}</span></div><p>{row.message}</p><small>{check.configuredCount} configured · {check.eligibleCount} eligible now</small>{check.key === "shoppers" && <small>{readiness.pendingInvitations} pending invitation{readiness.pendingInvitations === 1 ? "" : "s"} · awaiting acceptance</small>}</li>; })}</ol>
            {nextStep && <section className={styles.nextStep} aria-label="Next pilot action"><p className={styles.eyebrow}>NEXT STEP</p><h4>{nextStep.title}</h4><p>{nextStep.action?.text || nextStep.message}</p>{nextStep.action?.tab && <button className={styles.secondary} onClick={() => openSetup(nextStep.action.tab)}>{nextStep.action.label}</button>}</section>}
            <p className={styles.checked}>Readiness checked {dateLabel(readiness.checkedAt)} Malta time. Use Review pilot to check again. Each role signs in with its own account; this page does not impersonate another user.</p>
          </>}
        </section>
        <div className={styles.tabs} role="tablist" aria-label="Pilot setup steps">{[["access", "1 · Access"], ["shops", "2 · Shops"], ["coupons", "3 · Coupons"], ["shoppers", "4 · Shoppers"]].map(([key, name]) => <button key={key} role="tab" id={`pilot-tab-${key}`} aria-controls={`pilot-panel-${key}`} aria-selected={tab === key} onClick={() => { setTab(key); setPendingAction(null); }}>{name}</button>)}</div>
        <section className={styles.card} role="tabpanel" id={`pilot-panel-${tab}`} aria-labelledby={`pilot-tab-${tab}`}>
          {tab === "access" && <><h3>Temporary access and allowances</h3><p>Enter the pilot’s allowances explicitly. These are separate from the organisation’s paid Retail plan.</p>
            {data.grant && <><dl className={styles.summary}><div><dt>Rewards tier</dt><dd>{tierLabel(data.grant.tier)}</dd></div><div><dt>Status</dt><dd>{data.grant.status}</dd></div><div><dt>Access ends</dt><dd>{dateLabel(data.grant.expiresAt)} Malta time</dd></div>{PILOT_LIMIT_FIELDS.map(k => <div key={k}><dt>{PILOT_LIMIT_LABELS[k]}</dt><dd>{data.grant.limits[k]}</dd></div>)}<div><dt>Exports</dt><dd>{data.grant.limits.exportEnabled ? "Included" : "Off"}</dd></div><div><dt>Custom branding</dt><dd>{data.grant.limits.brandingEnabled ? "Included" : "Off"}</dd></div></dl><p className={styles.help}>Existing pilot access is shown for review. This setup does not overwrite or renew an existing grant.</p></>}
            {!canPrepare && !data.grant && <p className={styles.error}>An existing programme needs separate administrator review before access can be prepared.</p>}
            {canPrepare && <form onSubmit={e => submit(e, () => mutate("prepare", { expiresAt: pilotExpiry(expiry), tier, limits: pilotFormLimits(allowances) }))}>
              <div className={styles.grid}><label className={styles.field}>Rewards tier<select aria-label="Rewards tier" value={tier} onChange={e => setTier(e.target.value)}>{PILOT_TIERS.map(t => <option key={t} value={t}>{tierLabel(t)}</option>)}</select></label><label className={styles.field}>Pilot expiry (Malta time)<input type="datetime-local" required value={expiry} onChange={e => setExpiry(e.target.value)} /></label>{PILOT_LIMIT_FIELDS.map(k => <label key={k} className={styles.field}>{PILOT_LIMIT_LABELS[k]}<input type="number" min="0" max="1000000000" step="1" required value={allowances[k]} onChange={e => setAllowances(v => ({ ...v, [k]: e.target.value }))} /></label>)}</div>
              <div className={styles.checks}>{[["exportEnabled", "Allow report exports"], ["brandingEnabled", "Allow custom branding"]].map(([k, label]) => <label key={k}><input type="checkbox" checked={allowances[k]} onChange={e => setAllowances(v => ({ ...v, [k]: e.target.checked }))} />{label}</label>)}</div><p className={styles.help}>Access must end within 30 days. Changing the tier does not fill or increase any allowance.</p><button className={styles.primary} disabled={!!busy}>Prepare pilot access</button>
            </form>}
          </>}
          {tab === "shops" && <><h3>Shop details shoppers may see</h3><p>Choose an existing shop and review every public field. Publishing does not expose its private address or account details.</p>
            {!ready && <p className={styles.empty}>Prepare current pilot access first.</p>}
            {ready && data.locations.some(l => l.status === "DRAFT") && <section className={styles.review} aria-label="Activate a shop for Rewards">
              <h4>Prepare an existing draft shop</h4><p>Activate a shop for this Rewards pilot without setting up audio. The shop must have no assigned channels or devices. Its public profile is a separate step below.</p>
              <form onSubmit={e => submit(e, () => mutate("activateLocation", activation))}>
                <label className={styles.field}>Draft shop<select aria-label="Draft shop" required value={activation.locationId} onChange={e => setActivation({ locationId: e.target.value, confirm: false })}><option value="">Choose a draft shop</option>{data.locations.filter(l => l.status === "DRAFT").map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
                <label className={styles.check}><input required type="checkbox" checked={activation.confirm} onChange={e => setActivation(v => ({ ...v, confirm: e.target.checked }))} />Activate this existing shop for the Rewards pilot.</label>
                <button className={styles.primary} disabled={!!busy || !activation.locationId || !activation.confirm}>Activate shop for Rewards</button>
              </form>
            </section>}
            {ready && <form onSubmit={e => submit(e, () => mutate("publishShop", shop))}>
              <label className={styles.field}>Existing shop<select aria-label="Existing shop" required value={shop.locationId} onChange={e => { const row = data.locations.find(l => l.id === e.target.value); setShop({ ...blankShop(), locationId: row?.id || "", ...(row?.profile ? { publicSlug: row.profile.publicSlug, displayName: row.profile.displayName, description: row.profile.description, locality: row.profile.locality, countryCode: row.profile.countryCode } : {}) }); }}><option value="">Choose an active shop</option>{data.locations.filter(l => l.status === "ACTIVE").map(l => <option key={l.id} value={l.id}>{l.name}{l.profile?.status === "PUBLISHED" ? " · profile published" : ""}</option>)}</select></label>
              <div className={styles.grid}>{[["displayName", "Shop display name", 140], ["publicSlug", "Shop URL name", 100], ["locality", "Town or locality", 120], ["countryCode", "Country code", 2]].map(([k, label, max]) => <label key={k} className={styles.field}>{label}<input required maxLength={max} value={shop[k]} onChange={e => setShop(v => ({ ...v, [k]: k === "countryCode" ? e.target.value.toUpperCase() : e.target.value }))} /></label>)}</div>
              <label className={styles.field}>Public description<textarea maxLength={2000} rows={3} value={shop.description} onChange={e => setShop(v => ({ ...v, description: e.target.value }))} /></label>
              <label className={styles.check}><input type="checkbox" required checked={shop.confirm} onChange={e => setShop(v => ({ ...v, confirm: e.target.checked }))} />I approve these fields for eligible signed-in shoppers to see.</label><button className={styles.primary} disabled={!!busy || !shop.locationId || !shop.confirm}>Publish shop profile</button>
            </form>}
          </>}
          {tab === "coupons" && <><h3>Approve a published coupon</h3><p>Choose an exact coupon revision. A later coupon edit needs its own discovery approval.</p>
            {!ready ? <p className={styles.empty}>Prepare current pilot access first.</p> : !data.offers.length ? <p className={styles.empty}>No published coupons are available. The client admin can create and publish a coupon in Shop offers first.</p> : <form onSubmit={e => submit(e, () => { if (chosenOffer) mutate("approveOffer", { offerId: chosenOffer.id, revision: chosenOffer.revision, publicSlug: offer.publicSlug, confirm: offer.confirm }); })}>
              <label className={styles.field}>Published coupon<select aria-label="Published coupon" required value={offer.id} onChange={e => { const row = data.offers.find(o => o.id === e.target.value); setOffer({ id: row?.id || "", publicSlug: row?.discovery?.publicSlug || "", confirm: false }); }}><option value="">Choose a coupon revision</option>{data.offers.map(o => <option key={o.id} value={o.id}>{o.title} · revision {o.revision}</option>)}</select></label>
              {chosenOffer && <div className={styles.review}><strong>{chosenOffer.title} · revision {chosenOffer.revision}</strong><p>{dateLabel(chosenOffer.startsAt)} – {dateLabel(chosenOffer.endsAt)} Malta time</p><p>Shops: {chosenOffer.locationIds.map(locationId => data.locations.find(l => l.id === locationId)?.name || "Shop no longer available").join(", ")}</p><p>{chosenOffer.discovery?.discoverable && chosenOffer.discovery.revision === chosenOffer.revision ? "This revision already has discovery approval." : "This exact revision has not been approved for discovery."}</p></div>}
              <label className={styles.field}>Coupon URL name<input required maxLength={100} value={offer.publicSlug} onChange={e => setOffer(v => ({ ...v, publicSlug: e.target.value }))} /></label>
              <label className={styles.check}><input type="checkbox" required checked={offer.confirm} onChange={e => setOffer(v => ({ ...v, confirm: e.target.checked }))} />I approve this exact revision and its published shop profiles for discovery.</label><button className={styles.primary} disabled={!!busy || !chosenOffer || !offer.confirm}>Approve coupon discovery</button>
            </form>}
          </>}
          {tab === "shoppers" && <>
            <h3>Invite a prepared shopper</h3><p>Choose the disabled shopper prepared for this workspace. The same account stays disabled until the shopper accepts their invitation and chooses a password.</p>
            {!ready ? <p className={styles.empty}>Prepare current pilot access first.</p> : !data.preparedShoppers.length ? <p className={styles.empty}>No untouched prepared shoppers are available in this workspace.</p> : <form onSubmit={e => submit(e, () => {
              if (chosenPrepared) mutate("invitePrepared", { shopperId: chosenPrepared.shopperId, email: chosenPrepared.email, authVersion: chosenPrepared.authVersion, preparedAt: chosenPrepared.preparedAt, expiresAt: pilotExpiry(preparedInvite.expiresAt, new Date(), data.grant.expiresAt), confirm: preparedInvite.confirm });
            })}>
              <label className={styles.field}>Prepared shopper<select aria-label="Prepared shopper" required value={preparedInvite.shopperId} onChange={e => setPreparedInvite({ shopperId: e.target.value, expiresAt: "", confirm: false })}><option value="">Choose a prepared shopper</option>{data.preparedShoppers.map(s => <option key={s.shopperId} value={s.shopperId}>{s.displayName} · {s.email}</option>)}</select></label>
              {chosenPrepared && <p className={styles.help}>Prepared {dateLabel(chosenPrepared.preparedAt)} Malta time · disabled account</p>}
              <label className={styles.field}>Prepared shopper access expiry (Malta time)<input required type="datetime-local" value={preparedInvite.expiresAt} onChange={e => setPreparedInvite(v => ({ ...v, expiresAt: e.target.value }))} /></label>
              <p className={styles.help}>The code expires within 24 hours and access cannot outlast this pilot. No email is sent.</p>
              <label className={styles.check}><input required type="checkbox" checked={preparedInvite.confirm} onChange={e => setPreparedInvite(v => ({ ...v, confirm: e.target.checked }))} />I approve an invitation for this prepared shopper.</label>
              <button className={styles.primary} disabled={!!busy || !chosenPrepared || !preparedInvite.confirm}>Invite prepared shopper</button>
            </form>}
            <details className={styles.review}><summary>Invite a different, new shopper</summary><p>Create a separate shopper account for claiming and using coupons. An invitation is not a client-admin login, and no email is sent.</p>
            {!ready ? <p className={styles.empty}>Prepare current pilot access first.</p> : <form onSubmit={e => submit(e, () => mutate("invite", { ...invite, expiresAt: pilotExpiry(invite.expiresAt, new Date(), data.grant.expiresAt) }))}>
              <div className={styles.grid}><label className={styles.field}>Shopper display name<input required maxLength={80} autoComplete="off" value={invite.displayName} onChange={e => setInvite(v => ({ ...v, displayName: e.target.value }))} /></label><label className={styles.field}>Shopper email<input required type="email" maxLength={254} autoComplete="off" value={invite.email} onChange={e => setInvite(v => ({ ...v, email: e.target.value }))} /></label><label className={styles.field}>Shopper access expiry (Malta time)<input required type="datetime-local" value={invite.expiresAt} onChange={e => setInvite(v => ({ ...v, expiresAt: e.target.value }))} /></label></div>
              <p className={styles.help}>The invitation code expires within 24 hours. Shopper access cannot outlast this pilot’s expiry. Existing accounts are never attached by matching an email.</p><label className={styles.check}><input required type="checkbox" checked={invite.confirm} onChange={e => setInvite(v => ({ ...v, confirm: e.target.checked }))} />I approve invitation-only access for this test shopper.</label><button className={styles.primary} disabled={!!busy || !invite.confirm}>Create shopper invitation</button>
            </form>}</details>
            <div className={styles.invites}><h3>Shopper invitations from this pilot</h3>{!data.shoppers.length && <p className={styles.empty}>No shopper invitations have been created here.</p>}{data.shoppers.map(s => <article className={styles.invite} key={s.shopperId}><div><strong>{s.displayName}</strong><p>{s.invitationStatus.toLowerCase()} · shopper {s.status.toLowerCase()}</p><small>Code expires {dateLabel(s.invitationExpiresAt)} · access ends {dateLabel(s.membershipExpiresAt)}</small></div>{s.status === "DISABLED" && s.invitationStatus !== "ACCEPTED" && <div className={styles.actions}>{ready && new Date(s.membershipExpiresAt) > new Date() && <button className={styles.secondary} disabled={!!busy} onClick={() => { setInvitation(null); setPendingAction({ shopperId: s.shopperId, displayName: s.displayName, operation: "reissue" }); }}>Replace invitation</button>}{s.invitationStatus !== "REVOKED" && <button className={styles.secondary} disabled={!!busy} onClick={() => { setInvitation(null); setPendingAction({ shopperId: s.shopperId, displayName: s.displayName, operation: "revoke" }); }}>Revoke invitation</button>}</div>}</article>)}</div>
            {pendingAction && <section className={styles.review} aria-label="Confirm invitation change"><h4>{pendingAction.operation === "reissue" ? "Replace" : "Revoke"} {pendingAction.displayName}’s invitation?</h4><p>{pendingAction.operation === "reissue" ? "The old code will stop working. Save the replacement code when it appears." : "The pending code will stop working. This does not revoke an accepted shopper’s account."}</p><div className={styles.actions}><button className={styles.primary} onClick={() => mutate(pendingAction.operation, { shopperId: pendingAction.shopperId, confirm: true })}>Confirm {pendingAction.operation === "reissue" ? "replacement" : "revocation"}</button><button className={styles.secondary} onClick={() => setPendingAction(null)}>Cancel</button></div></section>}
          </>}
        </section>
        <details className={styles.audit}><summary>Recent pilot audit history ({data.audit.length})</summary><p>Permanent action records contain no invitation codes, passwords or shopper emails.</p><ol>{data.audit.map(a => <li key={a.id}><strong>{a.action.toLowerCase().replaceAll("_", " ")}</strong><span>{dateLabel(a.createdAt)} Malta time · {a.targetType.toLowerCase()}</span></li>)}</ol></details>
        <p className={styles.checked}>Checked {dateLabel(data.checkedAt)} Malta time. Refresh before acting on a changed pilot.</p>
      </section>}
    </div>
  </main>;
}



