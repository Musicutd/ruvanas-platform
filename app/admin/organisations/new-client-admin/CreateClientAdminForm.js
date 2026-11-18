"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import styles from "./client-admin.module.css";

export default function CreateClientAdminForm({ plans }) {
  const form = useRef(null);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState(null);

  function clearPasswords() {
    if (!form.current) return;
    form.current.elements.namedItem("password").value = "";
    form.current.elements.namedItem("confirmPassword").value = "";
  }

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || created) return;
    const fields = new FormData(form.current);
    const password = fields.get("password");
    if (password !== fields.get("confirmPassword")) {
      setMessage("The passwords do not match.");
      clearPasswords();
      return;
    }
    if ([...password].length < 15 || new TextEncoder().encode(password).byteLength > 72) {
      setMessage("Use at least 15 characters and no more than 72 UTF-8 bytes for the password.");
      clearPasswords();
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/organisations/with-client-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.get("name"),
          planId: fields.get("planId"),
          ownerName: fields.get("ownerName"),
          ownerEmail: fields.get("ownerEmail"),
          password,
          confirmCreate: fields.get("confirmCreate") === "on"
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setMessage(data.error || "Unable to create the workspace. Check the details and try again.");
        return;
      }
      form.current?.reset();
      setCreated(data);
    } catch {
      setMessage("The result could not be confirmed. Check Organisations before trying again.");
    } finally {
      // Credentials never go into component state, browser storage or a receipt.
      clearPasswords();
      inFlight.current = false;
      setSaving(false);
    }
  }

  if (created) return <section className={styles.panel} aria-live="polite">
    <h2>Workspace and Client Admin created</h2>
    <dl className={styles.receipt}>
      <dt>Workspace</dt><dd>{created.organisation.name}</dd>
      <dt>Client Admin</dt><dd>{created.owner.name} · {created.owner.email}</dd>
      <dt>Access</dt><dd>Owner of this workspace</dd>
    </dl>
    <p>No invitation email was sent. Rewards setup and shopper access are separate steps.</p>
    <Link href="/admin/organisations">Return to organisations →</Link>
  </section>;

  return <form ref={form} method="post" action="/api/admin/organisations/with-client-admin" onSubmit={submit} className={styles.panel}>
    <noscript>Enable JavaScript to create a workspace using this form.</noscript>
    <fieldset disabled={saving || plans.length === 0} className={styles.fields}>
      <legend>New Retail workspace</legend>
      <label>Workspace name
        <input name="name" type="text" minLength={2} maxLength={160} required autoComplete="off" />
      </label>
      <label>Trial plan
        <select name="planId" required defaultValue="">
          <option value="" disabled>Choose a Retail plan</option>
          {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
        </select>
      </label>
      <p className={styles.help}>This creates an unpaid trial record. It does not purchase a subscription or activate Rewards.</p>
      <label>Client Admin name
        <input name="ownerName" type="text" minLength={2} maxLength={100} required autoComplete="off" />
      </label>
      <label>Client Admin email
        <input name="ownerEmail" type="email" maxLength={254} required autoComplete="off" />
      </label>
      <label>Initial password
        <input name="password" type="password" minLength={15} maxLength={72} required autoComplete="new-password" aria-describedby="password-help" />
      </label>
      <p className={styles.help} id="password-help">At least 15 characters; maximum 72 UTF-8 bytes. Enter it here privately.</p>
      <label>Confirm password
        <input name="confirmPassword" type="password" minLength={15} maxLength={72} required autoComplete="new-password" />
      </label>
      <label className={styles.confirm}>
        <input name="confirmCreate" type="checkbox" required />
        <span>Create this new Client Admin with owner access to this new workspace.</span>
      </label>
      <button type="submit">{saving ? "Creating…" : "Create workspace and Client Admin"}</button>
    </fieldset>
    {plans.length === 0 ? <p role="alert">No active Retail trial plan is available.</p> : null}
    {message ? <p className={styles.error} role="alert">{message}</p> : null}
    <p className={styles.help}>Existing accounts cannot be reused by this form. No email is sent, and public registration stays unchanged.</p>
  </form>;
}
