"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutRequest } from "@/lib/retail-rewards/checkout-ui.mjs";
import { pilotRenewalReview, pilotRenewalExpiry, pilotRenewalAttempt, pilotRenewalResult, pilotMessage, PILOT_LIMIT_FIELDS, PILOT_LIMIT_LABELS } from "@/lib/retail-rewards/pilot-admin-ui.mjs";
import styles from "./pilot-admin.module.css";

const BASE = "/api/admin/retail-rewards/pilot";
const dateLabel = value => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Malta" }).format(new Date(value));
const renewalError = code => ["FEATURE_DISABLED", "FORBIDDEN", "UNAUTHENTICATED", "NOT_ENTITLED", "CONFLICT", "INVALID_REQUEST", "RATE_LIMITED", "INVITATION_UNAVAILABLE"].includes(code)
  ? pilotMessage(code) : "The renewal result could not be confirmed.";

export default function PilotAccessRenewal({ organisationId, shoppers = [], transport, onRefresh }) {
  const candidates = shoppers.filter(s => s.status === "DISABLED" && s.invitationStatus === "REVOKED" && new Date(s.membershipExpiresAt) <= new Date());
  const [shopperId, setShopperId] = useState(""), [review, setReview] = useState(null), [expiry, setExpiry] = useState("");
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(null), [uncertain, setUncertain] = useState(false), [saved, setSaved] = useState(null);
  const epoch = useRef(0), active = useRef(null), alive = useRef(true), errorRef = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; active.current?.abort(); }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function discard() {
    epoch.current++; active.current?.abort(); active.current = null;
    setReview(null); setExpiry(""); setConfirm(false); setBusy(""); setError(""); setAttempt(null); setUncertain(false); setSaved(null);
  }
  function select(value) { discard(); setShopperId(value); }
  function start(operation) {
    active.current?.abort(); const number = ++epoch.current, controller = new AbortController();
    active.current = controller; setBusy(operation); setError("");
    return { number, controller, timer: setTimeout(() => controller.abort(), 20000) };
  }
  const current = req => alive.current && epoch.current === req.number;
  function finish(req) { clearTimeout(req.timer); if (current(req)) { setBusy(""); active.current = null; } }
  async function readReview() {
    if (busy || !candidates.some(s => s.shopperId === shopperId)) return;
    discard(); const req = start("review"), targetShopper = shopperId;
    try {
      const raw = await checkoutRequest(transport, `${BASE}/renewalReview?organisationId=${encodeURIComponent(organisationId)}&shopperId=${encodeURIComponent(targetShopper)}`, { signal: req.controller.signal });
      const checked = pilotRenewalReview(raw, organisationId, targetShopper);
      if (!checked) throw new Error();
      if (current(req)) setReview(checked);
    } catch (problem) { if (current(req)) setError(problem.code ? renewalError(problem.code) : "The saved access could not be reviewed. Refresh the pilot and try again."); } finally { finish(req); }
  }
  async function renew(event, retry = false) {
    event?.preventDefault();
    if (busy || !review || saved || !candidates.some(s => s.shopperId === review.shopperId)) return;
    let submitted;
    try {
      if (retry) { if (!uncertain || !attempt) return; submitted = attempt; }
      else {
        if (!confirm || uncertain) return;
        submitted = pilotRenewalAttempt(attempt, review, pilotRenewalExpiry(expiry));
        setAttempt(submitted);
      }
    } catch (problem) { setError(problem.message); return; }
    const req = start("renew");
    try {
      const raw = await checkoutRequest(transport, `${BASE}/renew`, { method: "POST", body: submitted.body, signal: req.controller.signal });
      const checked = pilotRenewalResult(raw, submitted, review);
      if (!checked) throw new Error();
      if (current(req)) { setSaved(checked); setUncertain(false); setConfirm(false); }
    } catch (problem) {
      if (current(req)) {
        setUncertain(true);
        setError(`${renewalError(problem.code)} Keep this review open to retry the same renewal, or refresh the saved pilot before starting another review.`);
      }
    } finally { finish(req); }
  }
  return <section className={styles.review} aria-label="Renew expired pilot access">
    <h4>Renew an expired private test</h4>
    <p>Review the existing shop access and its disabled shopper. Renewal keeps the same accounts, allowances and history. It does not activate the shopper or create an invitation.</p>
    {!candidates.length ? <p>No disabled shopper with an expired membership and revoked invitation is available for this renewal. Refresh the pilot to check its saved state.</p> : <>
      <label className={styles.field}>Existing test shopper<select aria-label="Existing test shopper" value={shopperId} disabled={!!busy || uncertain || !!saved} onChange={e => select(e.target.value)}><option value="">Choose a shopper</option>{candidates.map(s => <option key={s.shopperId} value={s.shopperId}>{s.displayName}</option>)}</select></label>
      {!uncertain && !saved && <button type="button" className={styles.secondary} disabled={!!busy || !shopperId} onClick={readReview}>{busy === "review" ? "Checking…" : "Review renewal"}</button>}
      {busy && <p role="status">{busy === "review" ? "Reading the saved access…" : "Checking and renewing the reviewed access…"}</p>}
      {error && <p role="alert" ref={errorRef} tabIndex={-1} className={styles.error}>{error}</p>}
      {review && !saved && <form onSubmit={renew}>
        <h4>Review {review.displayName}’s access</h4><p>{review.email}</p>
        <dl className={styles.summary}>
          <div><dt>Shop access expired</dt><dd>{dateLabel(review.grant.expiresAt)} Malta</dd></div>
          <div><dt>Shopper access expired</dt><dd>{dateLabel(review.membership.expiresAt)} Malta</dd></div>
          <div><dt>Invitation</dt><dd>Revoked — stays revoked</dd></div>
          {PILOT_LIMIT_FIELDS.map(k => <div key={k}><dt>{PILOT_LIMIT_LABELS[k]} — unchanged</dt><dd>{review.grant.limits[k]}</dd></div>)}
          <div><dt>Report exports</dt><dd>{review.grant.limits.exportEnabled ? "Included" : "Off"}</dd></div><div><dt>Custom branding</dt><dd>{review.grant.limits.brandingEnabled ? "Included" : "Off"}</dd></div>
        </dl>
        <p className={styles.help}>These are the existing allowances, not a fresh balance. Used capacity is not reset. Review checked {dateLabel(review.checkedAt)} Malta time.</p>
        <label className={styles.field}>New access end (Malta time)<input aria-label="New access end (Malta time)" type="datetime-local" required value={expiry} disabled={!!busy || uncertain} onChange={e => { setExpiry(e.target.value); setConfirm(false); setAttempt(null); }} /></label>
        <p className={styles.help}>Choose an end within the next two hours, only for an approved attended test. Both access periods end at that time.</p>
        <label className={styles.check}><input aria-label="Confirm pilot renewal" type="checkbox" required checked={confirm} disabled={!!busy || uncertain} onChange={e => setConfirm(e.target.checked)} />Renew only this reviewed pilot access. Keep the shopper disabled and the invitation revoked.</label>
        {!uncertain && <button className={styles.primary} disabled={!!busy || !confirm || !expiry}>Renew reviewed access</button>}
      </form>}
      {uncertain && <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy || !attempt} onClick={event => renew(event, true)}>Retry same renewal</button><button type="button" className={styles.secondary} disabled={!!busy} onClick={onRefresh}>Refresh saved pilot</button></div>}
      {saved && <div role="status" className={styles.success}><strong>Access renewed until {dateLabel(saved.expiresAt)} Malta time.</strong><p>The shopper is still disabled and the invitation is still revoked. Review the saved pilot, then use Replace invitation as a separate action when ready.</p><button type="button" className={styles.secondary} onClick={onRefresh}>Refresh pilot and review invitations</button></div>}
    </>}
  </section>;
}
