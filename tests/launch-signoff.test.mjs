import assert from "node:assert/strict";
import test from "node:test";
import {
  LAUNCH_OPERATOR_CHECK_IDS,
  LAUNCH_SIGNOFF_ACTIONS,
  launchEvidenceEntityId,
  launchSignoffState
} from "../lib/launch-signoff.mjs";

const actor = { name: "Release Operator", email: "operator@example.test" };

function confirmation(checkId, minute) {
  return {
    action: LAUNCH_SIGNOFF_ACTIONS.CONFIRM,
    createdAt: `2026-08-31T09:${String(minute).padStart(2, "0")}:00.000Z`,
    actor,
    details: { checkId, evidenceReference: `evidence-${checkId}`, note: "Evidence reviewed by the accountable operator." }
  };
}

test("launch evidence identity is release and environment specific", () => {
  assert.equal(launchEvidenceEntityId("ruvanas-platform", "abc123"), "ruvanas-platform:abc123");
  assert.equal(launchEvidenceEntityId("", "abc123"), null);
  assert.equal(launchEvidenceEntityId("ruvanas-platform", ""), null);
});

test("all external confirmations are required before final sign-off can be recorded", () => {
  const events = LAUNCH_OPERATOR_CHECK_IDS.map((id, index) => confirmation(id, index));
  const state = launchSignoffState({ events, readinessStatus: "READY_FOR_OPERATOR_SIGN_OFF" });
  assert.equal(state.confirmedCount, LAUNCH_OPERATOR_CHECK_IDS.length);
  assert.equal(state.allOperatorChecksConfirmed, true);
  assert.equal(state.canFinalize, true);
  assert.equal(state.signedOff, false);

  const blocked = launchSignoffState({ events, readinessStatus: "BLOCKED" });
  assert.equal(blocked.canFinalize, false);
  assert.equal(blocked.signedOff, false);
});

test("confirmation revocation invalidates a later launch decision until reconfirmed", () => {
  const events = LAUNCH_OPERATOR_CHECK_IDS.map((id, index) => confirmation(id, index));
  events.push({
    action: LAUNCH_SIGNOFF_ACTIONS.FINALIZE,
    createdAt: "2026-08-31T09:10:00.000Z",
    actor,
    details: { launchScope: "Internal pilot", note: "All approved checks were reviewed." }
  });
  events.push({
    action: LAUNCH_SIGNOFF_ACTIONS.REVOKE,
    createdAt: "2026-08-31T09:11:00.000Z",
    actor,
    details: { checkId: LAUNCH_OPERATOR_CHECK_IDS[0], note: "The linked CI evidence was superseded." }
  });

  const state = launchSignoffState({ events, readinessStatus: "READY_FOR_OPERATOR_SIGN_OFF" });
  assert.equal(state.confirmedCount, LAUNCH_OPERATOR_CHECK_IDS.length - 1);
  assert.equal(state.canFinalize, false);
  assert.equal(state.finalSignoff, null);
});

test("final sign-off remains conditional on current automated evidence", () => {
  const events = LAUNCH_OPERATOR_CHECK_IDS.map((id, index) => confirmation(id, index));
  events.push({
    action: LAUNCH_SIGNOFF_ACTIONS.FINALIZE,
    createdAt: "2026-08-31T09:10:00.000Z",
    actor,
    details: { launchScope: "School pilot", note: "Approved only for the named pilot scope." }
  });

  const ready = launchSignoffState({ events, readinessStatus: "READY_FOR_OPERATOR_SIGN_OFF" });
  assert.equal(ready.signedOff, true);
  assert.equal(ready.finalSignoff.launchScope, "School pilot");

  const degraded = launchSignoffState({ events, readinessStatus: "ATTENTION" });
  assert.equal(degraded.finalSignoff.launchScope, "School pilot");
  assert.equal(degraded.signedOff, false);
});
