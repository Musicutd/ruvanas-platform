"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/app/components/PageHeader";
import SkipLink from "@/app/components/SkipLink";
import EmptyState from "@/app/components/EmptyState";
import { safeInterfaceMessage } from "@/lib/interface-guidance.mjs";
import {
  SUBSCRIBER_SUPPORT_CATEGORIES,
  subscriberSupportCategoryLabel,
  subscriberSupportStatus
} from "@/lib/subscriber-support.mjs";
import styles from "./subscriber-support.module.css";

const initialForm = { category: "", subject: "", description: "" };

export default function SubscriberSupportClient({ organisationName, membershipRole }) {
  const [tickets, setTickets] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/support/requests", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load support requests.");
      setTickets(body.tickets || []);
    } catch (loadError) {
      setError(safeInterfaceMessage(loadError?.message, "Unable to load support requests."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to send the support request.");
      setForm(initialForm);
      setNotice(`Request ${body.ticket.reference} was received. Keep this reference for follow-up.`);
      await load();
    } catch (submitError) {
      setError(safeInterfaceMessage(submitError?.message, "Unable to send the support request."));
    } finally {
      setBusy(false);
    }
  }

  const organisationWide = ["OWNER", "MANAGER"].includes(membershipRole);

  return (
    <main className={styles.page}>
      <SkipLink />
      <section id="main-content" className={styles.shell}>
        <PageHeader
          eyebrow="Help and support"
          title="Support requests"
          description={`${organisationName} · Send a bounded request to Ruvanas and follow its operational status.`}
          backHref="/dashboard/help"
          backLabel="Help Centre"
          tone="dark"
        >
          <button type="button" className={styles.secondary} onClick={load}>Refresh</button>
        </PageHeader>

        <div className={styles.guidance}>
          <strong>Check the Help Centre first.</strong>
          <span>Do not include passwords, enrolment codes, payment details or other secrets. For an urgent safety issue, use your agreed direct operational contact.</span>
          <Link href="/dashboard/help">Open help articles</Link>
        </div>

        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}

        <div className={styles.grid}>
          <form className={styles.card} onSubmit={submit}>
            <h2>Ask Ruvanas for help</h2>
            <label>
              <span>What do you need help with?</span>
              <select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                <option value="">Select a category</option>
                {SUBSCRIBER_SUPPORT_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
            </label>
            <label>
              <span>Short subject</span>
              <input required minLength={3} maxLength={160} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Example: Shop player is offline" />
            </label>
            <label>
              <span>What happened, and what did you already try?</span>
              <textarea required minLength={20} maxLength={4000} rows={7} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              <small>{form.description.length} / 4,000 characters</small>
            </label>
            <button className={styles.primary} disabled={busy}>{busy ? "Sending…" : "Send support request"}</button>
          </form>

          <section className={styles.card} aria-labelledby="request-history-title">
            <h2 id="request-history-title">Request history</h2>
            <p className={styles.muted}>{organisationWide ? "Owners and managers can see requests from this organisation." : "You can see requests that you submitted."}</p>
            {tickets === null ? <p role="status" className={styles.muted}>Loading requests…</p> : tickets.length === 0 ? (
              <EmptyState compact tone="dark" title="No support requests" description="Use the form when the Help Centre does not answer your question." />
            ) : <div className={styles.list}>{tickets.map((ticket) => (
              <article key={ticket.id} className={styles.ticket}>
                <div className={styles.ticketHeader}>
                  <strong>{ticket.subject}</strong>
                  <span data-status={ticket.status}>{subscriberSupportStatus(ticket.status)}</span>
                </div>
                <p>{ticket.description}</p>
                <dl>
                  <div><dt>Reference</dt><dd>{ticket.reference}</dd></div>
                  <div><dt>Category</dt><dd>{subscriberSupportCategoryLabel(ticket.linkedEntityId)}</dd></div>
                  <div><dt>Updated</dt><dd>{new Date(ticket.updatedAt).toLocaleString()}</dd></div>
                </dl>
              </article>
            ))}</div>}
          </section>
        </div>
      </section>
    </main>
  );
}

