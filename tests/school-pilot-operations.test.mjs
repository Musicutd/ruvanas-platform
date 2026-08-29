import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSchoolPilotEvent,
  normalizeSchoolPilotRun,
  SCHOOL_PILOT_OPERATIONS_NOTICE,
  schoolPilotOperationsSummary,
  schoolPilotReadinessSnapshot,
  transitionSchoolPilotEvent,
  transitionSchoolPilotRun
} from "../lib/school-pilot-operations.mjs";

const ready = {
  status: "READY",
  readyForPilot: true,
  completedChecks: 5,
  totalChecks: 5,
  activeHoldCount: 1,
  prerequisiteGaps: []
};

test("supervised pilot planning validates a bounded operating window", () => {
  const run = normalizeSchoolPilotRun({
    title: " Autumn supervised pilot ",
    plannedStartAt: "2026-09-01T08:00:00.000Z",
    plannedEndAt: "2026-09-30T16:00:00.000Z",
    notes: "  Staff-led launch only.  "
  });
  assert.equal(run.title, "Autumn supervised pilot");
  assert.equal(run.notes, "Staff-led launch only.");
  assert.throws(() => normalizeSchoolPilotRun({ title: "Pilot", plannedStartAt: "2026-10-01", plannedEndAt: "2026-09-01" }), /after the start/);
  assert.throws(() => normalizeSchoolPilotRun({ title: "Pilot", plannedStartAt: "2026-01-01", plannedEndAt: "2026-05-01" }), /at most 90 days/);
});

test("a pilot can start or resume only while readiness is current and READY", () => {
  const started = transitionSchoolPilotRun("PLANNED", { action: "START", reason: "All launch checks were reconfirmed." }, ready, new Date("2026-09-01T08:00:00.000Z"));
  assert.equal(started.status, "ACTIVE");
  assert.equal(started.startedAt.toISOString(), "2026-09-01T08:00:00.000Z");
  assert.equal(started.readinessSnapshot.readyForPilot, true);
  assert.equal(started.readinessSnapshot.studentIdentitiesIncluded, false);

  assert.throws(() => transitionSchoolPilotRun("PLANNED", { action: "START", reason: "Attempted before readiness approval." }, { readyForPilot: false }), /must be READY/);
  assert.throws(() => transitionSchoolPilotRun("COMPLETED", { action: "START", reason: "Attempted to restart a completed pilot." }, ready), /cannot be changed/);
});

test("pilot transition paths preserve terminal states and explicit reasons", () => {
  assert.equal(transitionSchoolPilotRun("ACTIVE", { action: "PAUSE", reason: "Operational review is required before continuing." }, ready).status, "PAUSED");
  assert.equal(transitionSchoolPilotRun("PAUSED", { action: "RESUME", reason: "Recovery checks passed and management approved." }, ready).status, "ACTIVE");
  const completed = transitionSchoolPilotRun("ACTIVE", { action: "COMPLETE", reason: "The supervised pilot period ended successfully." }, ready, new Date("2026-09-30T16:00:00.000Z"));
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.endedAt.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.throws(() => transitionSchoolPilotRun("ACTIVE", { action: "PAUSE", reason: "Too short" }, ready), /at least 10 characters/);
});

test("drills close with an outcome while incidents require manager follow-up", () => {
  const now = new Date("2026-09-05T12:00:00.000Z");
  const drill = normalizeSchoolPilotEvent({
    pilotRunId: "pilot-1",
    kind: "DRILL",
    category: "EMERGENCY_WITHDRAWAL",
    severity: "LOW",
    outcome: "PASSED",
    summary: "Managers rehearsed the approved withdrawal procedure.",
    occurredAt: "2026-09-05T11:30:00.000Z"
  }, now);
  assert.equal(drill.status, "RESOLVED");
  assert.equal(drill.outcome, "PASSED");

  const incident = normalizeSchoolPilotEvent({
    pilotRunId: "pilot-1",
    kind: "INCIDENT",
    category: "PLATFORM_AVAILABILITY",
    severity: "HIGH",
    summary: "Playback was unavailable during a supervised operating window.",
    occurredAt: "2026-09-05T11:45:00.000Z"
  }, now);
  assert.equal(incident.status, "OPEN");
  assert.equal(incident.outcome, null);
  assert.throws(() => normalizeSchoolPilotEvent({ ...incident, kind: "DRILL", outcome: null }, now), /drill outcome/);
  assert.throws(() => normalizeSchoolPilotEvent({ ...incident, occurredAt: "2026-09-05T12:06:00.000Z" }, now), /five minutes in the future/);
});

test("incident acknowledgement, summaries, and safety language remain privacy-safe and record-only", () => {
  const acknowledged = transitionSchoolPilotEvent("OPEN", { action: "ACKNOWLEDGE", notes: "Support and school management were informed internally." }, new Date("2026-09-05T12:15:00.000Z"));
  assert.equal(acknowledged.status, "ACKNOWLEDGED");
  const resolved = transitionSchoolPilotEvent("ACKNOWLEDGED", { action: "RESOLVE", notes: "Recovery checks passed and normal supervised service resumed." });
  assert.equal(resolved.status, "RESOLVED");
  assert.throws(() => transitionSchoolPilotEvent("RESOLVED", { action: "RESOLVE", notes: "Attempted duplicate resolution record." }), /already resolved/);

  const snapshot = schoolPilotReadinessSnapshot(ready, new Date("2026-09-01T08:00:00.000Z"));
  assert.equal(snapshot.prerequisiteGapCount, 0);
  const summary = schoolPilotOperationsSummary({
    runs: [{ id: "run-1", status: "ACTIVE" }, { id: "run-2", status: "PLANNED" }],
    events: [
      { kind: "INCIDENT", status: "OPEN", severity: "CRITICAL" },
      { kind: "DRILL", status: "RESOLVED", severity: "LOW" }
    ]
  });
  assert.equal(summary.operationalRunId, "run-1");
  assert.equal(summary.openIncidents, 1);
  assert.equal(summary.criticalOpenIncidents, 1);
  assert.equal(summary.recordedDrills, 1);
  assert.equal(summary.studentIdentitiesIncluded, false);
  assert.equal(summary.automaticActionsPerformed, false);
  assert.match(SCHOOL_PILOT_OPERATIONS_NOTICE, /does not withdraw content/);
  assert.match(SCHOOL_PILOT_OPERATIONS_NOTICE, /student identities/);
});
