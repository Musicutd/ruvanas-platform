import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertCorrectionsSchedulingAllowed } from "../lib/corrections-scheduling-lock.mjs";
import { correctionsGrantAllowed, correctionsProgrammePermission, correctionsRenderEvidence, correctionsReviewTransition, correctionsSchedulingGate } from "../lib/corrections-workflow.mjs";

const policy = { policyVersion: 3, policyConfiguredAt: new Date() };
const render = {
  id: "render-1", organisationId: "org-a", versionId: "version-1", status: "SUCCEEDED", completedAt: new Date(),
  resultJson: { checksumSha256: "a".repeat(64) },
  outputMediaAsset: { id: "media-1", organisationId: "org-a", status: "READY", sizeBytes: 1234n, storageKey: "private/render-1" },
  outputPromoVersion: { id: "promo-1", mediaAssetId: "media-1", status: "APPROVED", qcStatus: "PASSED", checksumSha256: "a".repeat(64) }
};
const evidence = correctionsRenderEvidence(render);
const programme = { id: "programme-1", organisationId: "org-a", facilityId: "facility-1", latestRevision: 1, status: "SUBMITTED" };
const submission = { id: "submission-1", programmeId: "programme-1", organisationId: "org-a", facilityId: "facility-1", revision: 1, renderId: "render-1", submittedByUserId: "editor-1", sourceFingerprint: evidence.fingerprint, organisationPolicyVersion: 3, facilityPolicyVersion: 3, dualApprovalRequired: true, status: "SUBMITTED" };

test("Corrections staff grants cannot cross facility, tenant, member or role", () => {
  const assignment = { organisationId: "org-a", organisationMemberId: "member-1", facilityId: "facility-1", permission: "EDITOR" };
  const args = { role: "CONTENT_EDITOR", organisationId: "org-a", memberId: "member-1", facilityId: "facility-1", assignment, action: "SUBMIT" };
  assert.equal(correctionsGrantAllowed("VIEWER", "MANAGER"), false);
  assert.equal(correctionsGrantAllowed("CONTENT_EDITOR", "MANAGER"), false);
  assert.equal(correctionsProgrammePermission(args), true);
  assert.equal(correctionsProgrammePermission({ ...args, organisationId: "org-b" }), false);
  assert.equal(correctionsProgrammePermission({ ...args, facilityId: "facility-2" }), false);
  assert.equal(correctionsProgrammePermission({ ...args, action: "REVIEW" }), false);
  assert.equal(correctionsProgrammePermission({ ...args, role: "MANAGER" }), false);
});

test("submission evidence is bound to a verified immutable Studio output", () => {
  assert.match(evidence.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(evidence.checksum, "a".repeat(64));
  assert.throws(() => correctionsRenderEvidence({ ...render, resultJson: { checksumSha256: "b".repeat(64) } }), /checksum/);
  assert.throws(() => correctionsRenderEvidence({ ...render, outputPromoVersion: { ...render.outputPromoVersion, qcStatus: "PENDING" } }), /Approve/);
});

test("dual approval requires separate staff and facility reviewers, never the submitter", () => {
  assert.throws(() => correctionsReviewTransition({ submission, programme, stage: "STAFF", decision: "APPROVE", reviewerUserId: "editor-1", organisationPolicy: policy, facilityPolicy: policy }), /submitter/);
  const first = correctionsReviewTransition({ submission, programme, stage: "STAFF", decision: "APPROVE", reviewerUserId: "manager-1", organisationPolicy: policy, facilityPolicy: policy });
  assert.equal(first.submissionStatus, "STAFF_APPROVED");
  const staffReview = { stage: "STAFF", decision: "APPROVE", reviewedByUserId: "manager-1" };
  const partlyApproved = { ...submission, status: "STAFF_APPROVED" };
  assert.throws(() => correctionsReviewTransition({ submission: partlyApproved, programme, stage: "FACILITY", decision: "APPROVE", reviewerUserId: "manager-1", reviews: [staffReview], organisationPolicy: policy, facilityPolicy: policy }), /different person/);
  const second = correctionsReviewTransition({ submission: partlyApproved, programme, stage: "FACILITY", decision: "APPROVE", reviewerUserId: "owner-1", reviews: [staffReview], organisationPolicy: policy, facilityPolicy: policy });
  assert.equal(second.submissionStatus, "APPROVED");
  assert.throws(() => correctionsReviewTransition({ submission, programme, stage: "STAFF", decision: "REJECT", reviewerUserId: "manager-1", organisationPolicy: policy, facilityPolicy: policy }), /reason/);
});

test("policy changes, new edits and source changes invalidate scheduling evidence", () => {
  const approved = { ...programme, status: "APPROVED" };
  const accepted = { ...submission, status: "APPROVED" };
  const reviews = [{ stage: "STAFF", decision: "APPROVE", reviewedByUserId: "manager-1" }, { stage: "FACILITY", decision: "APPROVE", reviewedByUserId: "owner-1" }];
  const gate = (changes = {}) => correctionsSchedulingGate({ programme: approved, submission: accepted, reviews, organisationPolicy: policy, facilityPolicy: policy, render, ...changes });
  assert.equal(gate().allowed, true);
  assert.equal(gate({ programme: { ...approved, status: "DRAFT" } }).allowed, false);
  assert.equal(gate({ organisationPolicy: { ...policy, policyVersion: 4 } }).reason, "POLICY_CHANGED");
  assert.equal(gate({ render: { ...render, outputMediaAsset: { ...render.outputMediaAsset, sizeBytes: 12n } } }).reason, "SOURCE_CHANGED");
  assert.equal(gate({ reviews: [reviews[0]] }).reason, "APPROVAL_EVIDENCE_INCOMPLETE");
});

test("shared scheduling entry points fail closed for Corrections targets", async () => {
  const client = {
    correctionsFacility: { findFirst: async ({ where }) => where.locationId === "facility-1" || where.location?.zones?.some?.id === "zone-1" ? { locationId: "facility-1" } : null },
    channel: { findFirst: async ({ where }) => where.id === "channel-1" ? { id: "channel-1" } : null }
  };
  await assert.rejects(assertCorrectionsSchedulingAllowed(client, { organisationId: "org-a", locationId: "facility-1" }), { code: "CORRECTIONS_SCHEDULING_LOCKED" });
  await assert.rejects(assertCorrectionsSchedulingAllowed(client, { organisationId: "org-a", zoneId: "zone-1" }), { code: "CORRECTIONS_SCHEDULING_LOCKED" });
  await assert.rejects(assertCorrectionsSchedulingAllowed(client, { organisationId: "org-a", channelId: "channel-1" }), { code: "CORRECTIONS_SCHEDULING_LOCKED" });
  await assert.doesNotReject(assertCorrectionsSchedulingAllowed(client, { organisationId: "org-a", channelId: "other-channel" }));
  for (const path of ["lib/advanced-scheduler-service.js", "lib/generated-playlist-service.js", "app/api/programming/route.js", "app/api/admin/music-schedules/route.js", "app/api/programming/autodj/route.js", "app/api/programming/simple/nonstop/route.js"]) {
    assert.match(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), /assertCorrectionsSchedulingAllowed/);
  }
});
