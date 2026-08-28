import assert from "node:assert/strict";
import test from "node:test";
import { invalidatedRundownData, orderedPositions, showItemDurationMs, transitionSchoolRundown, validateShowItem } from "../lib/show-builder.mjs";

test("show rundown requires playable approved sources before review", () => {
  assert.throws(() => transitionSchoolRundown({ currentStatus: "DRAFT", action: "SUBMIT", items: [{ id: "note", type: "SCRIPT_NOTE", label: "Presenter note" }] }), /playable item/);
  const transition = transitionSchoolRundown({ currentStatus: "DRAFT", action: "SUBMIT", items: [{ id: "voice", type: "VOICE_TRACK", label: "Welcome link", sourceTakeId: "take-1" }] });
  assert.equal(transition.status, "IN_REVIEW");
  assert.throws(() => validateShowItem({ type: "VOICE_TRACK", label: "Missing take" }), /approved audio source/);
});

test("rundown approval is explicit and changes invalidate the locked revision", () => {
  assert.equal(transitionSchoolRundown({ currentStatus: "IN_REVIEW", action: "APPROVE", items: [] }).status, "APPROVED");
  assert.throws(() => transitionSchoolRundown({ currentStatus: "IN_REVIEW", action: "REQUEST_CHANGES", items: [] }), /notes are required/);
  assert.deepEqual(invalidatedRundownData({ revision: 4 }), { revision: 5, status: "DRAFT", approvedRevision: null, submittedAt: null, reviewedAt: null, reviewedByUserId: null, reviewNotes: null });
});

test("rundown reordering stays contiguous and deterministic", () => {
  const items = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];
  assert.deepEqual(orderedPositions(items, "b", "UP"), [{ id: "b", position: 0 }, { id: "a", position: 1 }, { id: "c", position: 2 }]);
  assert.deepEqual(orderedPositions(items, "a", "UP"), items);
});

test("show duration uses immutable source metadata", () => {
  assert.equal(showItemDurationMs({ sourceTake: { durationMs: 12_345 } }), 12_345);
  assert.equal(showItemDurationMs({ sourceTrack: { mediaAsset: { durationSeconds: 180 } } }), 180_000);
  assert.equal(showItemDurationMs({ estimatedDurationMs: 45_000, sourceTrack: { mediaAsset: { durationSeconds: 180 } } }), 45_000);
});

