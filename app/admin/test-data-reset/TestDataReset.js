"use client";

import { useEffect, useState } from "react";
import styles from "./test-data-reset.module.css";

export default function TestDataReset({ retainedEmail }) {
  const [preview, setPreview] = useState(null);
  const [phrase, setPhrase] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("DELETE TEST SUBSCRIBERS");
  const [status, setStatus] = useState({ tone: "", message: "" });
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/test-data-reset", { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok) throw new Error(body.error || "Unable to load the reset preview.");
        setPreview(body.preview);
        setConfirmationPhrase(body.confirmationPhrase);
      })
      .catch((error) => active && setStatus({ tone: "error", message: error.message }));
    return () => { active = false; };
  }, []);

  async function reset(event) {
    event.preventDefault();
    if (phrase !== confirmationPhrase || working) return;
    setWorking(true);
    setStatus({ tone: "", message: "" });
    try {
      const response = await fetch("/api/admin/test-data-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retainedEmail, confirmation: phrase })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The reset could not be completed.");
      setPreview({ retainedUser: body.result.retainedUser, usersToDelete: 0, superAdminsToDelete: 0, organisationsToDelete: 0, codesToDelete: 0, rightsEvidenceToArchive: 0 });
      setPhrase("");
      setStatus({
        tone: "success",
        message: `Reset complete: ${body.result.deletedUsers} profiles and ${body.result.deletedOrganisations} organisations were removed. ${body.result.archivedRightsEvidence} protected rights-evidence record(s) remain in the immutable archive. ${body.result.retainedUser.email} remains Super Admin.`
      });
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>SUPER ADMIN · CONTROLLED RESET</p>
      <h1>Start subscriber testing from scratch</h1>
      <p className={styles.intro}>Remove test subscriber profiles, organisations, tenant records and previously issued complimentary-access codes while preserving the signed-in Super Admin.</p>

      <section className={styles.keepCard}>
        <span>Account that will remain</span>
        <strong>{preview?.retainedUser?.email || retainedEmail}</strong>
        <small>Role: SUPER ADMIN</small>
      </section>

      <section className={styles.grid} aria-label="Reset preview">
        <article><strong>{preview?.usersToDelete ?? "—"}</strong><span>profiles to delete</span></article>
        <article><strong>{preview?.organisationsToDelete ?? "—"}</strong><span>organisations to delete</span></article>
        <article><strong>{preview?.codesToDelete ?? "—"}</strong><span>access codes to clear</span></article>
        <article><strong>{preview?.rightsEvidenceToArchive ?? "—"}</strong><span>rights-evidence records to archive</span></article>
        <article><strong>{preview?.superAdminsToDelete ?? "—"}</strong><span>other Super Admins to delete</span></article>
      </section>

      {preview?.externalBillingRecords ? <p className={styles.error} role="alert">Reset blocked: {preview.externalBillingRecords} external billing record(s) require manual review.</p> : null}

      <section className={styles.warning}>
        <h2>Permanent action</h2>
        <p>This removes database records in one transaction. It does not remove the plan catalogue or shared Ruvanas platform configuration. Rights evidence is copied into an immutable archive before its live tenant links are removed. Protected media retained by infrastructure policies may require a separate storage-retention cleanup.</p>
      </section>

      <form onSubmit={reset} className={styles.form}>
        <label>Type <code>{confirmationPhrase}</code> to continue
          <input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" spellCheck="false" />
        </label>
        <button disabled={!preview || preview.externalBillingRecords > 0 || phrase !== confirmationPhrase || working || preview.usersToDelete + preview.organisationsToDelete + preview.codesToDelete === 0}>
          {working ? "Removing test data…" : "Delete test subscribers and start fresh"}
        </button>
      </form>
      {status.message ? <p className={status.tone === "success" ? styles.success : styles.error} role="status">{status.message}</p> : null}
    </main>
  );
}
