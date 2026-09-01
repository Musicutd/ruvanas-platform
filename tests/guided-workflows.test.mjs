import test from "node:test";
import assert from "node:assert/strict";
import {
  mediaWorkflowSteps,
  playerWorkflowSteps,
  safeWorkflowMessage,
  scheduleWorkflowSteps,
  stationWorkflowSteps
} from "../lib/guided-workflows.mjs";

function statuses(steps) {
  return steps.map((step) => step.status);
}

test("station guidance advances from identity to private stream setup", () => {
  assert.deepEqual(statuses(stationWorkflowSteps()), ["CURRENT", "UPCOMING", "UPCOMING"]);
  assert.deepEqual(statuses(stationWorkflowSteps({ stationCreated: true })), ["COMPLETE", "CURRENT", "UPCOMING"]);
  assert.deepEqual(statuses(stationWorkflowSteps({ stationCreated: true, streamConnected: true })), ["COMPLETE", "COMPLETE", "COMPLETE"]);
});

test("schedule guidance advances only through completed prerequisites", () => {
  assert.deepEqual(statuses(scheduleWorkflowSteps({ organisationSelected: true })), ["COMPLETE", "CURRENT", "UPCOMING", "UPCOMING"]);
  assert.deepEqual(statuses(scheduleWorkflowSteps({ organisationSelected: true, targetSelected: true, slotsReady: true })), ["COMPLETE", "COMPLETE", "COMPLETE", "CURRENT"]);
});

test("player guidance uses verified connection and playback evidence", () => {
  assert.deepEqual(statuses(playerWorkflowSteps({ configured: true, enrolled: true })), ["COMPLETE", "COMPLETE", "CURRENT", "UPCOMING"]);
  assert.deepEqual(statuses(playerWorkflowSteps({ configured: true, enrolled: true, connected: true, playbackConfirmed: true })), ["COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE"]);
});

test("media guidance keeps review between file selection and upload", () => {
  assert.deepEqual(statuses(mediaWorkflowSteps({ fileSelected: true })), ["COMPLETE", "CURRENT", "UPCOMING"]);
  assert.deepEqual(statuses(mediaWorkflowSteps({ fileSelected: true, detailsReviewed: true, uploaded: true })), ["COMPLETE", "COMPLETE", "COMPLETE"]);
});

test("workflow feedback is bounded and has a safe fallback", () => {
  assert.equal(safeWorkflowMessage(null, "Try again."), "Try again.");
  assert.equal(safeWorkflowMessage(new Error("  Please   choose a file.  "), "Try again."), "Please choose a file.");
  assert.equal(safeWorkflowMessage("x".repeat(500), "Try again.").length, 300);
});
