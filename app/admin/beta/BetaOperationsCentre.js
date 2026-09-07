"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BETA_PRODUCTS,
  betaFeedbackCategoryLabel,
  betaProductLabel
} from "@/lib/beta-operations.mjs";
import styles from "./beta-operations.module.css";

async function callApi(payload) {
  const response = await fetch("/api/admin/beta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The beta operation could not be completed.");
  return body;
}

export default function BetaOperationsCentre({ role, initialProgrammes, organisations, summary }) {
  const [programmes, setProgrammes] = useState(initialProgrammes);
  const [selectedId, setSelectedId] = useState(initialProgrammes[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canControl = role === "SUPER_ADMIN";
  const selected = useMemo(() => programmes.find((item) => item.id === selectedId) || programmes[0] || null, [programmes, selectedId]);

  async function run(payload, success) {
    setBusy(true); setMessage("");
    try {
      await callApi(payload);
      setMessage(success);
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function createProgramme(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run({
      action: "CREATE_PROGRAMME",
      name: form.get("name"),
      description: form.get("description") || null,
      maxOrganisations: Number(form.get("maxOrganisations")),
      startsAt: form.get("startsAt") ? new Date(form.get("startsAt")).toISOString() : null,
      endsAt: form.get("endsAt") ? new Date(form.get("endsAt")).toISOString() : null
    }, "Beta programme created as a draft.");
  }

  function addParticipant(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run({ action: "ADD_PARTICIPANT", programmeId: selected.id, organisationId: form.get("organisationId"), product: form.get("product"), internalNote: form.get("internalNote") || null }, "Organisation added to the controlled beta.");
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>STAGE 30A · CONTROLLED BETA</p><h1>Beta operations</h1><p>Admit selected organisations by product, track their participation and turn structured feedback into an accountable delivery queue.</p></div>
        <div className={styles.boundary}><strong>No billing changes</strong><span>Beta participation never creates a subscription, changes a plan, grants a product or issues a complimentary code.</span></div>
      </header>

      {message ? <p className={styles.message} role="status">{message}</p> : null}
      <section className={styles.metrics} aria-label="Beta programme summary"><Metric value={summary.activeProgrammes} label="Active programmes" /><Metric value={summary.activeParticipants} label="Active participants" /><Metric value={summary.openFeedback} label="Open feedback" /><Metric value={summary.blockers} label="Testing blockers" warning={summary.blockers > 0} /></section>

      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}><h2>Programmes</h2>{canControl ? <span>Super Admin control</span> : <span>Read and triage</span>}</div>
          {!programmes.length ? <p className={styles.muted}>No beta programme has been created.</p> : programmes.map((programme) => <button key={programme.id} data-active={programme.id === selected?.id} onClick={() => setSelectedId(programme.id)}><strong>{programme.name}</strong><span>{programme.status.toLowerCase()} · {programme.participants.length} participants</span></button>)}
          {canControl ? <details className={styles.create} open={!programmes.length}><summary>Create programme</summary><form onSubmit={createProgramme}>
            <label>Name<input name="name" required minLength="3" maxLength="120" placeholder="Ruvanas controlled beta" /></label>
            <label>Purpose<textarea name="description" maxLength="4000" rows="4" /></label>
            <label>Maximum organisations<input name="maxOrganisations" type="number" min="1" max="500" defaultValue="25" required /></label>
            <div className={styles.columns}><label>Starts<input name="startsAt" type="datetime-local" /></label><label>Ends<input name="endsAt" type="datetime-local" /></label></div>
            <button disabled={busy}>Create draft</button>
          </form></details> : null}
        </aside>

        <section className={styles.main}>
          {!selected ? <div className={styles.empty}><h2>Create the first controlled beta</h2><p>Begin with a small cohort and admit only organisations whose existing product access has already been verified.</p></div> : <>
            <div className={styles.programmeHeader}><div><p className={styles.eyebrow}>{selected.status}</p><h2>{selected.name}</h2><p>{selected.description || "No programme description."}</p></div>{canControl ? <ProgrammeActions programme={selected} busy={busy} run={run} /> : null}</div>

            <section className={styles.section}>
              <div className={styles.sectionHeader}><div><h2>Participants</h2><p>Admission checks the organisation’s existing product entitlement and the cohort capacity.</p></div><span>{selected.participants.filter((item) => item.status === "ACTIVE").length} active</span></div>
              {canControl && ["DRAFT", "ACTIVE"].includes(selected.status) ? <form className={styles.admit} onSubmit={addParticipant}>
                <label>Organisation<select name="organisationId" required defaultValue=""><option value="" disabled>Choose organisation</option>{organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name} · {organisation.planName}</option>)}</select></label>
                <label>Product<select name="product" required defaultValue=""><option value="" disabled>Choose product</option>{BETA_PRODUCTS.map((product) => <option key={product.value} value={product.value}>{product.label}</option>)}</select></label>
                <label>Internal note<input name="internalNote" maxLength="1000" placeholder="Purpose or contact reference" /></label>
                <button disabled={busy}>Add participant</button>
              </form> : null}
              {!selected.participants.length ? <p className={styles.muted}>No organisations are enrolled.</p> : <div className={styles.list}>{selected.participants.map((participant) => <ParticipantRow key={participant.id} participant={participant} canControl={canControl} busy={busy} run={run} />)}</div>}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}><div><h2>Feedback queue</h2><p>Support can triage feedback. A response is required before an item is resolved or closed.</p></div><Link href="/admin/compliance">Open support operations</Link></div>
              {!selected.feedback.length ? <p className={styles.muted}>No beta feedback has been submitted.</p> : <div className={styles.feedbackList}>{selected.feedback.map((feedback) => <FeedbackRow key={feedback.id} feedback={feedback} busy={busy} run={run} />)}</div>}
            </section>
          </>}
        </section>
      </div>
    </main>
  );
}

function Metric({ value, label, warning }) { return <div data-warning={warning}><strong>{value}</strong><span>{label}</span></div>; }

function ProgrammeActions({ programme, busy, run }) {
  const actions = programme.status === "DRAFT" ? ["ACTIVE", "CLOSED"] : programme.status === "ACTIVE" ? ["PAUSED", "CLOSED"] : programme.status === "PAUSED" ? ["ACTIVE", "CLOSED"] : [];
  return <div className={styles.actions}>{actions.map((status) => <button key={status} disabled={busy} onClick={() => run({ action: "SET_PROGRAMME_STATUS", programmeId: programme.id, status }, `Programme changed to ${status.toLowerCase()}.`)}>{status === "ACTIVE" ? "Activate" : status === "PAUSED" ? "Pause" : "Close"}</button>)}</div>;
}

function ParticipantRow({ participant, canControl, busy, run }) {
  const actions = participant.status === "ACTIVE" ? ["PAUSED", "COMPLETED", "REMOVED"] : participant.status === "PAUSED" ? ["ACTIVE", "COMPLETED", "REMOVED"] : participant.status === "COMPLETED" ? ["ACTIVE"] : [];
  return <article className={styles.row}><div><strong>{participant.organisation.name}</strong><p>{betaProductLabel(participant.product)} · admitted {new Date(participant.admittedAt).toLocaleDateString()} · {participant.status.toLowerCase()}</p>{participant.internalNote ? <small>{participant.internalNote}</small> : null}</div>{canControl ? <div className={styles.actions}>{actions.map((status) => <button key={status} disabled={busy} onClick={() => run({ action: "SET_PARTICIPANT_STATUS", participantId: participant.id, status }, `Participant changed to ${status.toLowerCase()}.`)}>{status.toLowerCase()}</button>)}</div> : null}</article>;
}

function FeedbackRow({ feedback, busy, run }) {
  const [status, setStatus] = useState(feedback.status);
  const [response, setResponse] = useState(feedback.adminResponse || "");
  return <article className={styles.feedback} data-blocker={feedback.severity === "BLOCKER" && !["RESOLVED", "CLOSED"].includes(feedback.status)}>
    <div className={styles.feedbackTop}><div><span>{feedback.severity} · {betaFeedbackCategoryLabel(feedback.category)}</span><h3>{feedback.subject}</h3></div><b>{feedback.status.replaceAll("_", " ")}</b></div>
    <p>{feedback.description}</p><small>{feedback.organisation.name} · {betaProductLabel(feedback.product)} · {feedback.createdBy.name || feedback.createdBy.email} · {new Date(feedback.createdAt).toLocaleString()}{feedback.rating ? ` · ${feedback.rating}/5` : ""}</small>
    <div className={styles.triage}><select value={status} onChange={(event) => setStatus(event.target.value)}><option>NEW</option><option>TRIAGED</option><option>PLANNED</option><option>IN_PROGRESS</option><option>RESOLVED</option><option>CLOSED</option></select><input value={response} onChange={(event) => setResponse(event.target.value)} maxLength="4000" placeholder="Response or resolution note" /><button disabled={busy || (status === feedback.status && response === (feedback.adminResponse || ""))} onClick={() => run({ action: "TRIAGE_FEEDBACK", feedbackId: feedback.id, status, adminResponse: response || null }, "Feedback updated and recorded.")}>Save</button></div>
  </article>;
}
