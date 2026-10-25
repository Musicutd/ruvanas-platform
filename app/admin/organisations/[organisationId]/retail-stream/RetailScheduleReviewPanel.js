"use client";

import { useEffect, useRef, useState } from "react";
import { RETAIL_REVIEW_ORGANISATION_ID, retailScheduleReviewView, retailReviewDays, retailReviewedApproval,
  retailTestDraftForm, retailTestDraftRequest, retailReviewSource, retailScheduleReviewNotice } from "@/lib/retail-schedule-review-ui.mjs";
import styles from "./retail-stream.module.css";
import reviewStyles from "./retail-schedule-review.module.css";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const when = (value, timezone, precise = false) => value ? new Date(value).toLocaleString("en-GB", {
  timeZone: timezone || "Europe/Malta", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  ...(precise ? { fractionalSecondDigits: 3 } : {})
}) : "Not available";

export function RetailSourceTiming({ report, timezone }) {
  const timing = report?.fresh && report.timing;
  if (!timing || !timing.presentationAt && timing.sourceLatenessMs == null && !timing.programme) return null;
  return <details className={styles.accessDetails}><summary>Source timing details</summary>
    <dl className={styles.summary}>
      {timing.presentationAt && <><dt>Planned source time</dt><dd>{when(timing.presentationAt, timezone, true)} · {timezone}</dd></>}
      {timing.sourceLatenessMs != null && <><dt>Source delay</dt><dd>{Number(timing.sourceLatenessMs.toFixed(2))} ms after the planned source time</dd></>}
      {timing.programme?.startsAt && <><dt>Programme start</dt><dd>{when(timing.programme.startsAt, timezone, true)}</dd></>}
      {timing.programme?.endsAt && <><dt>Programme end</dt><dd>{when(timing.programme.endsAt, timezone, true)}</dd></>}
      {timing.programme?.occurrenceId && <><dt>Programme occurrence</dt><dd>{timing.programme.occurrenceId}</dd></>}
      {timing.programme?.scheduleRevision && <><dt>Schedule revision</dt><dd>{timing.programme.scheduleRevision}</dd></>}
    </dl>
    <p className={styles.hint}>These are encoder-side timing reports for the current track. They do not measure listener buffering or prove an earlier handover. Refresh around the boundary to compare the programme mode and occurrence.</p>
  </details>;
}

export function RetailOwnerSavedWeek({ view }) {
  const days = retailReviewDays(view), draft = view.draft, timezone = view.schedule?.timezone || "Europe/Malta";
  const name = id => view.sources.find(source => source.id === id)?.name || "Saved Retail playlist";
  if (!draft) return null;
  return <section className={reviewStyles.savedReview} aria-labelledby="retail-saved-week-title">
    <h3 id="retail-saved-week-title">Review saved version {draft.version}{draft.diagnostic ? " · short handover test" : ""}</h3>
    <p><strong>{view.schedule.name} · {timezone}</strong></p>
    <p>This is the saved plan for approval. It does not confirm what listeners can hear. Starts can cut the current song; random AutoDJ resumes after each programme while the shared stream remains enabled.</p>
    {draft.preservedDraftVersionId && <p className={styles.notice}>The subscriber’s separate draft has been preserved. Approving this test does not approve that draft.</p>}
    <h4>All saved programmes</h4>
    <ol className={reviewStyles.programmeList}>{draft.items.map((item, index) => <li key={`${item.sourceId}:${index}`}>
      <strong>{item.label}</strong><span>{name(item.sourceId)}</span>
      <span>{item.recurrence === "WEEKLY" ? `Every ${weekdays[item.weekday]} at ${item.startTime}` : when(item.startsAt, timezone)} · {item.durationMinutes} minutes</span>
      <small>Overlap priority: {item.priority}</small>
    </li>)}</ol>
    <h4>Next seven days</h4>
    <p className={styles.hint}>The cards show the saved preview. Later one-off programmes remain in the list above. Approval rechecks conflicts and music permissions over the next 31 days.</p>
    {days.length ? <div className={reviewStyles.weekGrid}>{days.map(day => <section className={reviewStyles.day} key={day.date}>
      <h5>{day.label}</h5>{day.items.length ? <ol>{day.items.map((item, index) => <li key={`${item.sourceId}:${item.startsAt}:${index}`}>
        <strong>{item.startLabel}–{item.endLabel}</strong><span>{item.label}</span><small>{name(item.sourceId)}</small>
      </li>)}</ol> : <p>No scheduled programme. Random AutoDJ can continue while enabled.</p>}
    </section>)}</div> : <p role="alert" className={styles.error}>The saved preview is unavailable. Refresh and resolve its review warnings before approval.</p>}
    {(draft.preview?.warnings || []).map((warning, index) => <p className={styles.notice} key={index}>{warning}</p>)}
  </section>;
}

export default function RetailScheduleReviewPanel({ organisationId }) {
  const [view, setView] = useState(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(null), [acknowledged, setAcknowledged] = useState(false), [uncertain, setUncertain] = useState(false);
  const [testForm, setTestForm] = useState(() => retailTestDraftForm(null)), [observedNow, setObservedNow] = useState(() => new Date());
  const pending = useRef(false), mounted = useRef(true), controller = useRef(null);
  const endpoint = `/api/admin/organisations/${encodeURIComponent(organisationId)}/retail-schedule`;
  const clearReview = () => { setReviewed(null); setAcknowledged(false); };

  async function request(action = null) {
    if (organisationId !== RETAIL_REVIEW_ORGANISATION_ID || pending.current || action && uncertain) return;
    let input = null;
    try {
      if (action === "approve") {
        input = retailReviewedApproval(view, reviewed, acknowledged, crypto.randomUUID());
        if (!input) throw new Error("Review the saved week and acknowledge its exact-start handovers before approving.");
      } else if (action === "prepare-test") input = retailTestDraftRequest(view, testForm, crypto.randomUUID());
      else if (action !== null) return;
    } catch (caught) { setError(caught.message); return; }
    pending.current = true; setBusy(action || "load"); setError(""); setMessage(""); clearReview();
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await fetch(endpoint, { method: action ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        ...(input ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}) });
      const body = await response.json();
      if (!response.ok) throw new Error(retailScheduleReviewNotice(body?.code));
      const next = retailScheduleReviewView(body, organisationId);
      if (action && (body.accepted !== true || body.action !== action)) throw new Error("The schedule change could not be confirmed. Refresh before another change.");
      if (action === "approve" && (body.approvedVersionId !== input.versionId || next.approved?.versionId !== input.versionId))
        throw new Error("Approval could not be confirmed for the reviewed version. Refresh the saved week before continuing.");
      if (action === "prepare-test" && (!next.draft?.diagnostic || body.savedVersionId !== next.draft.id))
        throw new Error("The new test draft could not be confirmed. Refresh before preparing another test.");
      if (mounted.current) {
        setView(next); setTestForm(retailTestDraftForm(next)); setUncertain(false); setObservedNow(new Date());
        if (action === "prepare-test") setMessage(`Test draft version ${next.draft.version} is saved. Review its exact time and approve it separately before it can affect the stream.`);
        if (action === "approve") setMessage(`Version ${next.approved.version} has administrator approval. The encoder was not started or stopped. Refresh the source report around both handovers and check listening separately.`);
      }
    } catch (caught) {
      if (mounted.current) {
        setUncertain(true);
        setError(caught.name === "AbortError" ? "The request timed out and its result is uncertain. Refresh the saved week before another change."
          : caught.message || "The result is uncertain. Refresh the saved week before another change.");
      }
    } finally {
      clearTimeout(timeout); pending.current = false; controller.current = null;
      if (mounted.current) setBusy("");
    }
  }
  useEffect(() => {
    mounted.current = true;
    const initialRead = setTimeout(() => { if (mounted.current) void request(); }, 0);
    const clock = setInterval(() => setObservedNow(new Date()), 1000);
    return () => { mounted.current = false; clearTimeout(initialRead); clearInterval(clock); controller.current?.abort(); };
  }, [organisationId]);

  if (organisationId !== RETAIL_REVIEW_ORGANISATION_ID) return null;
  const timezone = view?.schedule?.timezone || "Europe/Malta", sourceReport = retailReviewSource(view, observedNow);
  const canApprove = !busy && !uncertain && Boolean(retailReviewedApproval(view, reviewed, acknowledged, "review-only"));
  const canPrepare = view?.canPrepareTest === true && Boolean(view.channelId) && view.sources.some(source => source.readyForSchedule) && !busy && !uncertain;
  const changeTest = (field, value) => { setTestForm(previous => ({ ...previous, [field]: value })); setMessage(""); };

  return <section className={styles.card} id="retail-schedule-review" aria-labelledby="retail-schedule-review-title">
    <p className={styles.eyebrow}>OWNER REVIEW · TEST RETAIL ONLY</p>
    <h2 id="retail-schedule-review-title">Review and approve the weekly plan</h2>
    <p className={styles.intro}>Subscribers build playlists and save private drafts. Only the platform owner can approve a saved version for this shared Retail stream. Approval changes the schedule used by the running encoder; it does not start or stop audio.</p>
    <div className={styles.actions}><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => request()}>{busy === "load" ? "Checking saved week…" : "Refresh saved week and source report"}</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
    {!view ? <p className={styles.notice}>{busy ? "Loading Test Retail’s saved schedule…" : "No verified schedule is available yet. Refresh to continue."}</p> : <>
      <div className={reviewStyles.approvalSummary}>
        <div><span className={styles.status}>CURRENT OWNER APPROVAL</span><h3>{view.approved ? `Version ${view.approved.version}${view.approved.diagnostic ? " · short test" : ""}` : "No owner-approved version"}</h3>
          <p>{view.approved ? view.approved.enabled ? "Eligible for the worker. This is configuration, not proof of live audio." : "Saved approval exists, but the schedule is not currently eligible for the worker. Review the warnings below." : "Random AutoDJ can continue while enabled; subscriber drafts are not automatically used."}</p>
          {view.approved?.effectiveAt && <small>Effective from {when(view.approved.effectiveAt, timezone)} · {timezone}</small>}
        </div>
        <div><span className={styles.status}>PENDING REVIEW</span><h3>{view.draft ? `Draft version ${view.draft.version}${view.draft.diagnostic ? " · short test" : ""}` : "No pending draft"}</h3>
          <p>{view.draft ? `${view.draft.itemCount} saved programme${view.draft.itemCount === 1 ? "" : "s"}. ${view.draft.readyToApprove ? "Ready for owner review." : "Resolve the warnings before approval."}` : "The subscriber can save the next weekly draft in their planner."}</p>
        </div>
      </div>
      {view.warnings.map((warning, index) => <p role="note" className={styles.notice} key={index}>{warning}</p>)}
      {view.blockers.map((blocker, index) => <p role="note" className={styles.notice} key={`blocker-${index}`}>{retailScheduleReviewNotice(blocker)}</p>)}
      <div className={styles.sourceReport} aria-live="polite">
        <strong>{sourceReport.label}</strong><p>{sourceReport.detail}</p>
        {view.observation?.observedAt && <small>Observed: {when(view.observation.observedAt, timezone)} · {timezone} · {sourceReport.fresh ? "fresh" : "not current"}.</small>}
        <p className={styles.hint}>Source evidence expires after 15 seconds. A saved plan or song title alone does not prove a handover. Listener buffering may delay what is heard.</p>
        <RetailSourceTiming report={sourceReport} timezone={timezone} />
      </div>
      {view.draft && <div className={styles.actions}><button type="button" disabled={Boolean(busy) || uncertain || !view.draft.preview} onClick={() => {
        setReviewed({ versionId: view.draft.id, reviewHash: view.draft.reviewHash }); setAcknowledged(false); setMessage("");
      }}>Review saved version {view.draft.version}</button></div>}
      {reviewed?.versionId === view.draft?.id && view.draft && <>
        <RetailOwnerSavedWeek view={view} />
        <label className={styles.confirm}><input type="checkbox" checked={acknowledged} disabled={Boolean(busy) || uncertain || !view.draft.readyToApprove} onChange={event => setAcknowledged(event.target.checked)} />
          <span>I reviewed version {view.draft.version}, its times in {timezone}, playlists and overlap priorities. I approve exact starts that may cut the current song and the automatic return to random AutoDJ.</span></label>
        <div className={styles.actions}><button type="button" disabled={!canApprove} onClick={() => request("approve")}>{busy === "approve" ? "Approving reviewed version…" : `Approve version ${view.draft.version} for Test Retail`}</button></div>
      </>}
      <details className={styles.accessDetails}>
        <summary>Prepare a short scheduled handover test</summary>
        <p className={styles.intro}>Create a separate draft using an existing Retail playlist. It copies the currently approved programmes and preserves any separate subscriber draft. Preparation sends no on-air command. Review and approve the new version above to allow the test.</p>
        <form onSubmit={event => { event.preventDefault(); if (canPrepare) void request("prepare-test"); }}>
          <fieldset className={reviewStyles.testFields} disabled={!canPrepare}>
            <div className={styles.formGrid}>
              <label>Saved Retail playlist<select required value={testForm.sourceId} onChange={event => changeTest("sourceId", event.target.value)}><option value="">Choose a playlist</option>{view.sources.filter(source => source.readyForSchedule).map(source => <option key={source.id} value={source.id}>{source.name} · {source.eligibleTrackCount} eligible recordings</option>)}</select></label>
              <label>Start time · {timezone}<input required type="datetime-local" value={testForm.startsAt} onChange={event => changeTest("startsAt", event.target.value)} /><small>Choose 2–60 minutes ahead. Leave time to review and approve at least one minute before the start.</small></label>
              <label>Test duration<select value={testForm.durationMinutes} onChange={event => changeTest("durationMinutes", event.target.value)}>{[1, 2, 3, 4, 5].map(minutes => <option value={minutes} key={minutes}>{minutes} minute{minutes === 1 ? "" : "s"}</option>)}</select><small>The scheduled programme ends after this duration; continuous random AutoDJ then resumes. This does not stop the stream.</small></label>
            </div>
            <div className={styles.actions}><button type="submit" disabled={!canPrepare}>{busy === "prepare-test" ? "Preparing test draft…" : "Prepare test draft — separate approval required"}</button></div>
          </fieldset>
        </form>
      </details>
      <p className={styles.footnote}>These controls apply only to Test Retail. They do not change Test Radio, public registration, plan limits, hosting budgets or other channels.</p>
    </>}
  </section>;
}
