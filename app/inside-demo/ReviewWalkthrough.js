"use client";

import { useReducer } from "react";
import { applyInsideDemoReview, initialInsideDemoReview } from "@/lib/inside-demo-review.mjs";
import styles from "./tour.module.css";

const statusLabels = {
  DRAFT: "Draft · no submitted render",
  PENDING_REVIEW: "Pending independent staff review",
  CHANGES_REQUESTED: "Changes requested · original retained",
  APPROVED: "Approved exact version · not scheduled",
  REJECTED: "Rejected · cannot be scheduled"
};

export default function ReviewWalkthrough() {
  const [state, dispatch] = useReducer(applyInsideDemoReview, undefined, initialInsideDemoReview);
  const canSubmit = state.status === "DRAFT" || state.status === "CHANGES_REQUESTED";
  const canReview = state.status === "PENDING_REVIEW";

  return <div className={styles.walkthrough}>
    <div className={styles.walkthroughIntro}>
      <div><p className={styles.eyebrow}>Click-through example · browser only</p><h3>Follow one fictional submission</h3></div>
      <p>Try the hand-off yourself. These controls change only this illustration in your browser. They do not sign you in, create a record, approve content, or contact a player.</p>
    </div>
    <div className={styles.reviewState} aria-live="polite" aria-atomic="true">
      <span>Current example</span><strong>{statusLabels[state.status]}</strong>
      <p>{state.history.length ? `Exact version: SYNTHETIC-RENDER-${String(state.revision).padStart(3, "0")}` : "There is no submitted version yet."}</p>
    </div>
    <div className={styles.reviewActions}>
      {canSubmit && <button type="button" onClick={() => dispatch("SUBMIT")}>Simulate contributor {state.status === "DRAFT" ? "submission" : "resubmission"}</button>}
      {canReview && <>
        <button type="button" onClick={() => dispatch("REQUEST_CHANGES")}>Simulate staff requesting changes</button>
        <button type="button" onClick={() => dispatch("APPROVE")}>Simulate staff approval</button>
        <button type="button" onClick={() => dispatch("REJECT")}>Simulate staff rejection</button>
      </>}
      {state.history.length > 0 && <button type="button" className={styles.reset} onClick={() => dispatch("RESET")}>Reset fictional example</button>}
    </div>
    <ol className={styles.reviewHistory} aria-label="Fictional review history">
      {state.history.map((item, index) => <li key={`${index}-${item.action}`}><span>{item.actor}</span><strong>{item.label}</strong><small>{item.renderId} · synthetic, browser-only</small></li>)}
    </ol>
    {state.status === "APPROVED" && <p className={styles.reviewReminder}>Even in this illustration, approval is not a schedule or a broadcast. Scheduling would require a separate authorised action and valid policy.</p>}
  </div>;
}
