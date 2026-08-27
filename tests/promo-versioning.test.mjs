import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPromoProcessingJobs,
  nextPromoVersionNumber,
  normalizePromoLanguageCode,
  reviewPromoVersion
} from "../lib/promo-versioning.mjs";

test("promo language codes are normalized without inventing a language", () => {
  assert.equal(normalizePromoLanguageCode(""), "und");
  assert.equal(normalizePromoLanguageCode("MT"), "mt");
  assert.equal(normalizePromoLanguageCode("en_gb"), "en-GB");
  assert.equal(normalizePromoLanguageCode("zh-hant"), "zh-Hant");
  assert.throws(() => normalizePromoLanguageCode("not a code"), /valid language code/i);
});

test("promo version numbers increase from the highest persisted version", () => {
  assert.equal(nextPromoVersionNumber([]), 1);
  assert.equal(nextPromoVersionNumber([{ version: 3 }, { version: 1 }]), 4);
});

test("each uploaded promo version queues the required processing work", () => {
  assert.deepEqual(buildPromoProcessingJobs(), [
    { jobType: "PREVIEW", status: "QUEUED" },
    { jobType: "TRANSCODE", status: "QUEUED" },
    { jobType: "LOUDNESS_ANALYSIS", status: "QUEUED" }
  ]);
});

test("review transitions are explicit and rejection requires a reason", () => {
  assert.deepEqual(
    reviewPromoVersion({ currentStatus: "IN_REVIEW", decision: "APPROVE" }),
    { status: "APPROVED", qcStatus: "PASSED", qcNotes: null }
  );
  assert.deepEqual(
    reviewPromoVersion({ currentStatus: "IN_REVIEW", decision: "REJECT", notes: "Clipping at 0:12" }),
    { status: "REJECTED", qcStatus: "FAILED", qcNotes: "Clipping at 0:12" }
  );
  assert.throws(
    () => reviewPromoVersion({ currentStatus: "APPROVED", decision: "REJECT", notes: "No" }),
    /awaiting review/i
  );
  assert.throws(
    () => reviewPromoVersion({ currentStatus: "IN_REVIEW", decision: "REJECT" }),
    /explain why/i
  );
});
