import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCorrectionsStudioToken, hashCorrectionsStudioToken, correctionsStudioCan,
  correctionsStudioSessionAvailable, correctionsStudioSupervisorAllowed } from "../lib/corrections-studio-policy.mjs";
import { correctionsContributorRenderEvidence, correctionsRenderEvidence, correctionsSubmissionEvidence,
  correctionsReviewTransition, correctionsSchedulingGate } from "../lib/corrections-workflow.mjs";
import { correctionsStudioSourceIds, correctionsStudioSourcesCurrent } from "../lib/corrections-studio-sources.mjs";

const policy = { policyVersion: 1, policyConfiguredAt: new Date() };
const checksum = "b".repeat(64);
const pendingRender = {
  id: "render-2", organisationId: "org-a", projectId: "project-1", versionId: "version-2",
  status: "SUCCEEDED", completedAt: new Date(), resultJson: { checksumSha256: checksum, immutableSource: true },
  outputMediaAsset: { id: "media-2", organisationId: "org-a", status: "READY", sizeBytes: 900n, storageKey: "private/render-2" },
  outputPromoVersion: { id: "promo-2", mediaAssetId: "media-2", status: "IN_REVIEW", qcStatus: "PENDING",
    sourceReference: "audio-render:render-2", checksumSha256: checksum }
};
const session = {
  organisationId: "org-a", facilityId: "facility-1", status: "ACTIVE", accessTokenHash: "hash",
  activatedAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000),
  capabilityScope: ["RECORD", "EDIT", "RENDER", "SUBMIT"], contributor: { organisationId: "org-a", facilityId: "facility-1", status: "ACTIVE" },
  facility: { organisationId: "org-a", status: "ACTIVE" },
  programme: { organisationId: "org-a", facilityId: "facility-1", status: "DRAFT" }, project: { organisationId: "org-a" }
};

test("a Corrections contributor may submit a pending exact render; ordinary Studio still requires prior approval", () => {
  assert.throws(() => correctionsRenderEvidence(pendingRender), /Approve/);
  const evidence = correctionsContributorRenderEvidence(pendingRender, { organisationId: "org-a", projectId: "project-1", versionId: "version-2" });
  assert.match(evidence.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(correctionsSubmissionEvidence(pendingRender, { organisationId: "org-a", studioProjectId: "project-1", studioVersionId: "version-2", evidenceSnapshot: { sourceKind: "SUPERVISED_STUDIO_PENDING_REVIEW" } }).fingerprint, evidence.fingerprint);
  assert.throws(() => correctionsContributorRenderEvidence({ ...pendingRender, projectId: "other" }, { organisationId: "org-a", projectId: "project-1", versionId: "version-2" }), /version-pinned/);
  assert.throws(() => correctionsContributorRenderEvidence({ ...pendingRender, resultJson: { checksumSha256: checksum } }, { organisationId: "org-a", projectId: "project-1", versionId: "version-2" }), /version-pinned/);
  assert.throws(() => correctionsContributorRenderEvidence({ ...pendingRender, outputPromoVersion: { ...pendingRender.outputPromoVersion, status: "APPROVED" } }, { organisationId: "org-a", projectId: "project-1", versionId: "version-2" }), /pending Corrections review/);
  assert.notEqual(correctionsContributorRenderEvidence({ ...pendingRender, outputMediaAsset: { ...pendingRender.outputMediaAsset, sizeBytes: 901n } }, { organisationId: "org-a", projectId: "project-1", versionId: "version-2" }).fingerprint, evidence.fingerprint);
});

test("supervised session token and assignment fail closed across time, facility and capability", () => {
  const token = createCorrectionsStudioToken();
  assert.equal(token.length, 43);
  assert.match(hashCorrectionsStudioToken(token), /^[a-f0-9]{64}$/);
  assert.equal(hashCorrectionsStudioToken("bad"), null);
  assert.equal(correctionsStudioSessionAvailable(session), true);
  assert.equal(correctionsStudioSessionAvailable({ ...session, expiresAt: new Date(Date.now() - 1) }), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, facility: { organisationId: "org-b", status: "ACTIVE" } }), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, contributor: { ...session.contributor, facilityId: "facility-2" } }), false);
  assert.equal(correctionsStudioSessionAvailable({ ...session, programme: { ...session.programme, status: "APPROVED" } }), false);
  assert.equal(correctionsStudioCan(session, "SUBMIT"), true);
  assert.equal(correctionsStudioCan({ ...session, capabilityScope: ["RECORD"] }, "SUBMIT"), false);
  assert.equal(correctionsStudioCan(session, "PUBLISH"), false);
});

test("only current owner or facility manager may supervise", () => {
  const args = { role: "MANAGER", organisationId: "org-a", memberId: "member-a", facilityId: "facility-1",
    grant: { organisationId: "org-a", organisationMemberId: "member-a", facilityId: "facility-1", permission: "MANAGER" } };
  assert.equal(correctionsStudioSupervisorAllowed(args), true);
  assert.equal(correctionsStudioSupervisorAllowed({ ...args, facilityId: "facility-2" }), false);
  assert.equal(correctionsStudioSupervisorAllowed({ ...args, role: "CONTENT_EDITOR" }), false);
  assert.equal(correctionsStudioSupervisorAllowed({ ...args, grant: { ...args.grant, permission: "VIEWER" } }), false);
});

test("the exact submitted version keeps only current approved project sources", () => {
  const ids = correctionsStudioSourceIds({ multitrack: { tracks: [{ clips: [
    { kind: "SOURCE", mediaAssetId: "bed-1" }, { kind: "SOURCE", mediaAssetId: "voice-1" },
    { kind: "SOURCE", mediaAssetId: "bed-1" }
  ] }] } });
  assert.deepEqual(ids, ["bed-1", "voice-1"]);
  const approved = { id: "version-1", status: "APPROVED", qcStatus: "PASSED", promoAsset: { status: "ACTIVE", currentApprovedVersionId: "version-1" } };
  const takes = [
    { mediaAssetId: "bed-1", status: "READY", trashedAt: null, mediaAsset: { status: "READY" }, promoVersion: approved },
    { mediaAssetId: "voice-1", status: "READY", trashedAt: null, mediaAsset: { status: "READY" }, promoVersion: null }
  ];
  assert.equal(correctionsStudioSourcesCurrent(ids, takes), true);
  assert.equal(correctionsStudioSourcesCurrent(ids, [{ ...takes[0], promoVersion: { ...approved, status: "SUPERSEDED" } }, takes[1]]), false);
  assert.equal(correctionsStudioSourcesCurrent(ids, [takes[0]]), false);
});

test("staff review, not contributor submission, is the broadcast gate", () => {
  const evidence = correctionsContributorRenderEvidence(pendingRender, { organisationId: "org-a", projectId: "project-1", versionId: "version-2" });
  const programme = { id: "programme-1", organisationId: "org-a", facilityId: "facility-1", latestRevision: 2, status: "SUBMITTED" };
  const submission = { programmeId: "programme-1", organisationId: "org-a", facilityId: "facility-1", revision: 2,
    renderId: "render-2", submittedByUserId: "supervisor-1", sourceFingerprint: evidence.fingerprint,
    organisationPolicyVersion: 1, facilityPolicyVersion: 1, dualApprovalRequired: false, status: "SUBMITTED",
    studioProjectId: "project-1", studioVersionId: "version-2", evidenceSnapshot: { sourceKind: "SUPERVISED_STUDIO_PENDING_REVIEW" } };
  const gate = (p = programme, s = submission, reviews = []) => correctionsSchedulingGate({ programme: p, submission: s,
    reviews, organisationPolicy: policy, facilityPolicy: policy, render: pendingRender });
  assert.equal(gate().allowed, false);
  assert.throws(() => correctionsReviewTransition({ submission, programme, stage: "STAFF", decision: "APPROVE",
    reviewerUserId: "supervisor-1", organisationPolicy: policy, facilityPolicy: policy }), /submitter/);
  const decision = correctionsReviewTransition({ submission, programme, stage: "STAFF", decision: "APPROVE",
    reviewerUserId: "reviewer-2", organisationPolicy: policy, facilityPolicy: policy });
  assert.equal(decision.submissionStatus, "APPROVED");
  assert.equal(gate({ ...programme, status: "APPROVED" }, { ...submission, status: "APPROVED" },
    [{ stage: "STAFF", decision: "APPROVE", reviewedByUserId: "reviewer-2" }]).allowed, true);
  assert.equal(gate({ ...programme, status: "APPROVED", latestRevision: 3 }, { ...submission, status: "APPROVED" },
    [{ stage: "STAFF", decision: "APPROVE", reviewedByUserId: "reviewer-2" }]).allowed, false);
});

test("contributor API has no normal product-handoff, scheduling or approval operation", async () => {
  const paths = ["app/api/corrections/contributor/audio-lab/projects/[projectId]/editor/route.js",
    "app/api/corrections/contributor/multitrack/projects/[projectId]/route.js", "app/api/corrections/contributor/submit/route.js"];
  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /APPROVE_OUTPUT|StudioProductHandoff|studioProductHandoff|schedule\.create|publish/i);
    assert.match(source, /sameOrigin/);
  }
  const normalHandoff = await readFile(new URL("../lib/studio-product-handoff.mjs", import.meta.url), "utf8");
  assert.match(normalHandoff, /status !== "APPROVED"/);
});
