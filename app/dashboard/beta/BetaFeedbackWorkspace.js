"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/app/components/PageHeader";
import EmptyState from "@/app/components/EmptyState";
import {
  BETA_FEEDBACK_CATEGORIES,
  BETA_FEEDBACK_SEVERITIES,
  betaFeedbackCategoryLabel,
  betaProductLabel
} from "@/lib/beta-operations.mjs";
import styles from "./beta-feedback.module.css";

const initialForm = { participantId: "", category: "", severity: "NORMAL", rating: "", subject: "", description: "" };

export default function BetaFeedbackWorkspace({ organisationName }) {
  const [data, setData] = useState({ participations: null, feedback: null });
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch("/api/beta/feedback", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load beta feedback.");
      setData(body);
      setForm((current) => ({ ...current, participantId: current.participantId || body.participations?.[0]?.id || "" }));
    } catch (error) {
      setMessage(error.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const participation = useMemo(() => data.participations?.find((item) => item.id === form.participantId), [data.participations, form.participantId]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/beta/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, rating: form.rating ? Number(form.rating) : null })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to submit beta feedback.");
      setForm((current) => ({ ...initialForm, participantId: current.participantId }));
      await load();
      setMessage("Thank you. Your feedback is recorded for the Ruvanas team.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const loading = data.participations === null;
  const hasAccess = Boolean(data.participations?.length);

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Controlled beta"
        title="Help shape Ruvanas"
        description={`${organisationName} · Test the product your organisation has been invited to and share structured feedback directly with the Ruvanas team.`}
        backHref="/dashboard"
        backLabel="Dashboard"
        tone="dark"
      >
        <button type="button" className={styles.secondary} onClick={load}>Refresh</button>
      </PageHeader>

      <section className={styles.boundary}>
        <strong>Safe feedback</strong>
        <span>Describe what you were trying to do and what happened. Do not include passwords, payment details, student identities, private media links or other confidential information.</span>
      </section>

      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {loading ? <p className={styles.loading} role="status">Loading beta access…</p> : !hasAccess ? (
        <EmptyState tone="dark" title="No active beta invitation" description="Your normal Ruvanas services are unchanged. Contact Ruvanas if you expected this organisation to be included." actionHref="/dashboard/support" actionLabel="Contact support" />
      ) : (
        <div className={styles.grid}>
          <form className={styles.card} onSubmit={submit}>
            <p className={styles.eyebrow}>SEND FEEDBACK</p>
            <h2>Tell us about your experience</h2>
            <label>Product being tested<select required value={form.participantId} onChange={(event) => setForm({ ...form, participantId: event.target.value })}>
              {data.participations.map((item) => <option key={item.id} value={item.id}>{betaProductLabel(item.product)} · {item.programme.name}</option>)}
            </select></label>
            {participation?.programme.description ? <p className={styles.hint}>{participation.programme.description}</p> : null}
            <div className={styles.columns}>
              <label>Feedback type<select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="">Choose one</option>{BETA_FEEDBACK_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Effect on testing<select required value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}>{BETA_FEEDBACK_SEVERITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            <label>Overall experience<select value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })}><option value="">Not rated</option><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Acceptable</option><option value="2">2 · Difficult</option><option value="1">1 · Unusable</option></select></label>
            <label>Short subject<input required minLength="3" maxLength="160" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label>
            <label>What were you trying to do, what happened, and what did you expect?<textarea required minLength="20" maxLength="6000" rows="8" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><small>{form.description.length} / 6,000 characters</small></label>
            <button className={styles.primary} disabled={busy}>{busy ? "Sending…" : "Send beta feedback"}</button>
          </form>

          <section className={styles.card} aria-labelledby="feedback-history">
            <div className={styles.cardHeader}><div><p className={styles.eyebrow}>FOLLOW UP</p><h2 id="feedback-history">Feedback history</h2></div><Link href="/dashboard/support">Support requests</Link></div>
            {!data.feedback.length ? <EmptyState compact tone="dark" title="No feedback yet" description="Your submitted observations and Ruvanas responses will appear here." /> : <div className={styles.list}>{data.feedback.map((item) => (
              <article key={item.id} className={styles.feedback}>
                <div className={styles.feedbackHeader}><strong>{item.subject}</strong><span data-status={item.status}>{item.status.replaceAll("_", " ")}</span></div>
                <p>{item.description}</p>
                <dl><div><dt>Product</dt><dd>{betaProductLabel(item.product)}</dd></div><div><dt>Type</dt><dd>{betaFeedbackCategoryLabel(item.category)}</dd></div><div><dt>Priority</dt><dd>{item.severity.toLowerCase()}</dd></div><div><dt>Updated</dt><dd>{new Date(item.updatedAt).toLocaleString()}</dd></div></dl>
                {item.adminResponse ? <div className={styles.response}><strong>Ruvanas response</strong><p>{item.adminResponse}</p></div> : null}
              </article>
            ))}</div>}
          </section>
        </div>
      )}
    </main>
  );
}
