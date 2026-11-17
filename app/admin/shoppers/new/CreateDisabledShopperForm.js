"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import styles from "../../organisations/new-client-admin/client-admin.module.css";

export default function CreateDisabledShopperForm({ organisations }) {
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState(null);
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || created) return;
    const form = event.currentTarget, fields = new FormData(form);
    inFlight.current = true; setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin/shoppers/disabled", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId: fields.get("organisationId"), email: fields.get("email"),
          displayName: fields.get("displayName"), confirmCreate: fields.get("confirmCreate") === "on" }) });
      const data = await response.json();
      if (!response.ok || !data.ok) { setMessage(data.error || "Unable to prepare the shopper. Check the details."); return; }
      form.reset(); setCreated(data);
    } catch { setMessage("The result could not be confirmed. Refresh this page and check Recent shopper setups before trying again."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  if (created) return <section className={styles.panel} aria-live="polite">
    <h2>Disabled shopper prepared</h2>
    <dl className={styles.receipt}>
      <dt>Shopper</dt><dd>{created.shopper.displayName} · {created.shopper.email}</dd>
      <dt>Test workspace</dt><dd>{created.organisation.name}</dd>
      <dt>Status</dt><dd>Disabled — cannot sign in or use coupons</dd>
    </dl>
    <p>No password, invitation or membership was created. Activation is a separate step.</p>
    <Link href="/admin/organisations">Return to organisations →</Link>
  </section>;
  return <form method="post" action="/api/admin/shoppers/disabled" onSubmit={submit} className={styles.panel}>
    <noscript>Enable JavaScript to use this form.</noscript>
    <fieldset disabled={saving || !organisations.length} className={styles.fields}>
      <legend>Disabled shopper details</legend>
      <label>Test workspace<select name="organisationId" required defaultValue="">
        <option value="" disabled>Choose the test workspace</option>
        {organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select></label>
      <p className={styles.help}>This records where the test was prepared. It gives the shopper no business access.</p>
      <label>Shopper name<input name="displayName" required maxLength={80} autoComplete="off" /></label>
      <label>Shopper email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label className={styles.confirm}><input name="confirmCreate" type="checkbox" required />
        <span>Prepare this shopper as disabled, without sign-in access, invitations or coupon membership.</span>
      </label>
      <button type="submit">{saving ? "Preparing…" : "Prepare disabled shopper"}</button>
    </fieldset>
    {!organisations.length ? <p role="alert">Create the test workspace first.</p> : null}
    {message ? <p className={styles.error} role="alert">{message}</p> : null}
    <p className={styles.help}>Use a separate email from the Client Admin. Rewards, public registration and streams stay unchanged.</p>
  </form>;
}
