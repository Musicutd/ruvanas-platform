import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageSubscriberAudio,
  prepareSubscriberPromoSubmission,
  subscriberAudioProcessingSummary,
  subscriberAudioReviewState
} from "../lib/subscriber-audio-review.mjs";

const draft = (overrides = {}) => ({
  status: "DRAFT",
  qcNotes: null,
  mediaAsset: { status: "READY" },
  processingJobs: [{ status: "QUEUED" }, { status: "SUCCEEDED" }],
  ...overrides
});

test("subscriber audio editing excludes view-only members", () => {
  assert.equal(canManageSubscriberAudio("OWNER"), true);
  assert.equal(canManageSubscriberAudio("MANAGER"), true);
  assert.equal(canManageSubscriberAudio("CONTENT_EDITOR"), true);
  assert.equal(canManageSubscriberAudio("VIEWER"), false);
});

test("a securely stored draft can be deliberately submitted while analysis continues", () => {
  assert.deepEqual(prepareSubscriberPromoSubmission(draft()), {
    status: "IN_REVIEW",
    qcStatus: "PENDING"
  });
  assert.equal(subscriberAudioProcessingSummary(draft()).state, "CHECKING");
});

test("failed processing and non-draft versions cannot be submitted", () => {
  assert.throws(
    () => prepareSubscriberPromoSubmission(draft({ processingJobs: [{ status: "FAILED" }] })),
    /needs attention/i
  );
  assert.throws(
    () => prepareSubscriberPromoSubmission(draft({ status: "IN_REVIEW" })),
    /only a draft/i
  );
});

test("review states guide approval, replacement and scheduling", () => {
  assert.equal(subscriberAudioReviewState(draft()).canSubmit, true);
  assert.equal(subscriberAudioReviewState(draft({ status: "IN_REVIEW" })).key, "IN_REVIEW");
  assert.equal(subscriberAudioReviewState(draft({ status: "APPROVED" })).key, "APPROVED");
  const rejected = subscriberAudioReviewState(draft({ status: "REJECTED", qcNotes: "Replace the clipped ending." }));
  assert.equal(rejected.canReplace, true);
  assert.match(rejected.description, /clipped ending/i);
});
