"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import { safePilotPreparationSnapshot } from "@/lib/retail-rewards/pilot-preparation-contracts.mjs";
import { pilotReadinessRow } from "@/lib/retail-rewards/pilot-readiness-ui.mjs";
import shared from "../pilot/pilot-admin.module.css";
import styles from "./preparation.module.css";

const dateLabel = value => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Malta" }).format(new Date(value));
const message = code => ({
  AUTH_REQUIRED: "Your Super Admin session could not be confirmed. Sign in again before checking this workspace.",
  UNAUTHENTICATED: "Your Super Admin session could not be confirmed. Sign in again before checking this workspace.",
  FORBIDDEN: "This preparation snapshot is not available to your session for the selected test workspace.",
  RATE_LIMITED: "Please wait a moment, then refresh the snapshot.",
  FEATURE_DISABLED: "This read-only preparation view is unavailable in the current configuration. No saved snapshot is being shown.",
  PREPARATION_UNAVAILABLE: "This read-only preparation view is unavailable for the current workspace or configuration. No earlier snapshot is being shown.",
  REVIEW_TOO_LARGE: "This test workspace has more records than this preparation view can safely check. No partial snapshot is being shown."
})[code] || "The preparation snapshot could not be verified. Refresh to try again. No earlier snapshot is being shown.";

function Count({ label, value }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export default function PilotPreparation({ organisationId, initialSnapshot = null, transport = checkoutTransport }) {
  const [snapshot, setSnapshot] = useState(() => safePilotPreparationSnapshot(initialSnapshot, organisationId));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const epoch = useRef(0), active = useRef(null), alive = useRef(true), errorRef = useRef(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; epoch.current++; active.current?.abort(); };
  }, []);
  useEffect(() => {
    epoch.current++; active.current?.abort(); active.current = null;
    setSnapshot(safePilotPreparationSnapshot(initialSnapshot, organisationId)); setBusy(false); setError("");
  }, [organisationId, initialSnapshot]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const validTarget = typeof organisationId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(organisationId);

  async function refresh() {
    if (!validTarget) return;
    active.current?.abort();
    const controller = new AbortController(), request = ++epoch.current;
    active.current = controller; setBusy(true); setError(""); setSnapshot(null);
    const timer = setTimeout(() => controller.abort(), 20000);
    const current = () => alive.current && request === epoch.current;
    try {
      const raw = await checkoutRequest(transport, `/api/admin/retail-rewards/preparation?organisationId=${encodeURIComponent(organisationId)}`, { signal: controller.signal });
      const next = safePilotPreparationSnapshot(raw, organisationId);
      if (!next) throw new Error("Unverified snapshot");
      if (current()) setSnapshot(next);
    } catch (problem) {
      if (current()) setError(message(problem.code));
    } finally {
      clearTimeout(timer);
      if (current()) { setBusy(false); active.current = null; }
    }
  }

  // A prop change must never show the previous workspace while effects run.
  const data = snapshot?.organisation.id === organisationId ? snapshot : null;
  const checks = data ? Object.fromEntries(data.readiness.checks.map(check => [check.key, check])) : null;
  const expired = data && data.grantExpiresAt <= data.checkedAt;
  return <div className={shared.page}>
    <div className={shared.container}>
      <a className={styles.back} href="/admin/organisations">← Organisations</a>
      <p className={shared.eyebrow}>RUVANAS REWARDS · SUPER ADMIN</p>
      <h1>Pilot preparation</h1>
      <p className={shared.lead}>Review the test shop and shopper setup before arranging a rehearsal.</p>
      <p className={shared.notice}><strong>Read-only preparation.</strong> This page checks saved setup. It does not enable Rewards, renew access, issue invitations or change the stream.</p>
      <section className={shared.card} aria-label="Preparation snapshot">
        <div className={shared.heading}>
          <div><h2>{data ? data.organisation.name : "Test workspace snapshot"}</h2><p className={styles.caption}>Refresh to check the latest saved state.</p></div>
          <button type="button" className={shared.primary} onClick={refresh} disabled={busy || !validTarget}>{busy ? "Checking…" : "Refresh snapshot"}</button>
        </div>
        {busy && <p role="status" className={shared.status}>Checking this workspace. Previous results are hidden while the snapshot loads.</p>}
        {error && <p role="alert" ref={errorRef} tabIndex={-1} className={shared.error}>{error}</p>}
        {!data && !busy && !error && <p className={shared.empty}>No verified snapshot is loaded. Refresh to check this test workspace.</p>}
        {data && <>
          <div className={styles.summary} aria-live="polite">
            <span className={shared.badge}>Rewards off</span>
            <span className={shared.badge}>End-to-end test not verified</span>
          </div>
          <p role="status" className={shared.checked}>Snapshot checked <time dateTime={data.checkedAt}>{dateLabel(data.checkedAt)}</time> Malta time. This is saved state at that time, not a live session report.</p>
        </>}
      </section>
      {data && <div className={styles.sections}>
        <section className={shared.card} aria-labelledby="preparation-shop-heading">
          <h2 id="preparation-shop-heading">1 · Test shop setup</h2>
          <p className={styles.caption}>Saved records for this test workspace.</p>
          <dl className={styles.counts}>
            <Count label="Client Admin owners configured" value={checks.owner.configuredCount} />
            <Count label="Published shop profiles configured" value={checks.shops.configuredCount} />
            <Count label="Coupon revisions approved for discovery" value={checks.coupons.configuredCount} />
            <Count label="Checkout access configured" value={checks.cashiers.configuredCount} />
          </dl>
          <p className={styles.caution}><strong>Client Admin sign-in: not verified.</strong> A configured account does not prove its owner has signed in or completed a checkout.</p>
        </section>
        <section className={shared.card} aria-labelledby="preparation-access-heading">
          <h2 id="preparation-access-heading">2 · Saved access window</h2>
          <dl className={styles.counts}>
            <div><dt>Access end (Malta time)</dt><dd><time dateTime={data.grantExpiresAt}>{dateLabel(data.grantExpiresAt)}</time></dd></div>
            <div><dt>Window at the last check</dt><dd>{expired ? "Expired" : "End time is still in the future"}</dd></div>
          </dl>
          <p>{pilotReadinessRow(checks.entitlement).message}</p>
          <p className={styles.caption}>A future end time does not open Rewards or confirm usable access. This page does not extend the window or change allowances.</p>
        </section>
        <section className={shared.card} aria-labelledby="preparation-shopper-heading">
          <h2 id="preparation-shopper-heading">3 · Shopper setup and invitations</h2>
          <p className={styles.caption}>Counts only. Invitation codes, passwords and shopper contact details are not displayed here.</p>
          <dl className={styles.counts}>
            <Count label="Prepared shopper accounts" value={data.preparedShoppers.total} />
            <Count label="Disabled accounts" value={data.preparedShoppers.disabled} />
            <Count label="Active account records" value={data.preparedShoppers.active} />
            <Count label="Suspended accounts" value={data.preparedShoppers.suspended} />
            <Count label="Pending invitations" value={data.readiness.pendingInvitations} />
            <Count label="Revoked invitations" value={data.preparedShoppers.revokedInvitations} />
            <Count label="Expired memberships" value={data.preparedShoppers.expiredMemberships} />
          </dl>
          <p className={styles.caution}><strong>Shopper sign-in: not verified.</strong> An active account or accepted invitation does not prove a current sign-in. The shopper must test their own session.</p>
        </section>
        <section className={shared.card} aria-labelledby="preparation-gates-heading">
          <h2 id="preparation-gates-heading">4 · Before a rehearsal</h2>
          <p><strong>End-to-end test not verified.</strong> Rewards is off. A rehearsal needs a separate authorised access window, sign-in checks and a complete claim and redemption test.</p>
          <ul className={styles.gates}>{data.readiness.checks.map(check => {
            const row = pilotReadinessRow(check);
            return <li key={check.key}>
              <div className={styles.gateHeading}><h3>{row.title}</h3><span className={shared.badge}>{check.status === "READY" ? "Meets this check" : check.status === "MISSING" ? "Setup missing" : "Blocked"}</span></div>
              <p>{row.message}</p>
              <small>{check.configuredCount} configured · {check.eligibleCount} eligible at the snapshot time</small>
            </li>;
          })}</ul>
          <p className={styles.caution}>These checks do not confirm shopper discovery, claiming, redemption, receipts or repeat-use limits. Those results must be observed through the separate shopper and shop accounts.</p>
        </section>
      </div>}
    </div>
  </div>;
}
