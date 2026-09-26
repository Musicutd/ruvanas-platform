import { createHash } from "node:crypto";
import { correctionsFacilityPermission } from "./corrections-policy.mjs";
import { assertStudioRenderReady } from "./studio-product-handoff.mjs";

export const CORRECTIONS_REVIEW_POLICY_VERSION = "C3.1";

export function correctionsGrantAllowed(memberRole, permission) {
  return (memberRole === "MANAGER" && ["MANAGER", "VIEWER"].includes(permission)) ||
    (memberRole === "CONTENT_EDITOR" && ["EDITOR", "VIEWER"].includes(permission)) ||
    (memberRole === "VIEWER" && permission === "VIEWER");
}

export function correctionsProgrammePermission({ role, organisationId, memberId, facilityId, assignment, action = "READ" } = {}) {
  if (!correctionsFacilityPermission({ role, organisationId, memberId, locationId: facilityId, assignment })) return false;
  if (action === "READ") return true;
  if (role === "OWNER") return true;
  if (role === "MANAGER" && assignment?.permission === "MANAGER") return true;
  return ["CREATE", "EDIT", "SUBMIT"].includes(action) && role === "CONTENT_EDITOR" && assignment?.permission === "EDITOR";
}

export function normalizeCorrectionsProgramme(input = {}) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (title.length < 3 || title.length > 160) throw new Error("Programme title must be 3–160 characters.");
  if (description.length > 2000) throw new Error("Programme description must be no more than 2,000 characters.");
  return { title, description: description || null };
}

export function correctionsRenderEvidence(render) {
  assertStudioRenderReady(render);
  const media = render.outputMediaAsset;
  const promo = render.outputPromoVersion;
  const checksum = promo.checksumSha256?.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(checksum || "") || render.resultJson?.checksumSha256 !== checksum) {
    throw new Error("Create a new verified Studio render with a recorded audio checksum before submitting.");
  }
  if (media.organisationId !== render.organisationId || promo.mediaAssetId !== media.id || !render.versionId || !render.completedAt) {
    throw new Error("The Studio render and approved audio version do not match.");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({ renderId: render.id, versionId: render.versionId, mediaAssetId: media.id, promoVersionId: promo.id, checksum, sizeBytes: String(media.sizeBytes), storageKey: media.storageKey })).digest("hex");
  return { fingerprint, checksum, renderId: render.id, versionId: render.versionId, mediaAssetId: media.id, promoVersionId: promo.id };
}

export function correctionsReviewTransition({ submission, programme, stage, decision, reviewerUserId, note = "", reviews = [], organisationPolicy, facilityPolicy } = {}) {
  if (!submission || !programme || !reviewerUserId) throw new Error("Choose a current submission and reviewer.");
  if (programme.latestRevision !== submission.revision || programme.id !== submission.programmeId) throw new Error("Only the latest programme revision can be reviewed.");
  if (!organisationPolicy?.policyConfiguredAt || !facilityPolicy?.policyConfiguredAt || organisationPolicy.policyVersion !== submission.organisationPolicyVersion || facilityPolicy.policyVersion !== submission.facilityPolicyVersion) throw new Error("Policy changed. Submit a new revision for review.");
  if (reviewerUserId === submission.submittedByUserId) throw new Error("A submitter cannot review their own programme.");
  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (trimmedNote.length > 2000 || (decision !== "APPROVE" && trimmedNote.length < 5)) throw new Error("Give a short reason for changes or rejection (maximum 2,000 characters).");
  if (!["APPROVE", "CHANGES_REQUESTED", "REJECT"].includes(decision)) throw new Error("Choose an approved review decision.");
  if (stage === "STAFF") {
    if (submission.status !== "SUBMITTED" || reviews.length) throw new Error("This submission is not awaiting staff review.");
    if (decision === "APPROVE") return { submissionStatus: submission.dualApprovalRequired ? "STAFF_APPROVED" : "APPROVED", programmeStatus: submission.dualApprovalRequired ? "STAFF_APPROVED" : "APPROVED", note: trimmedNote };
  } else if (stage === "FACILITY") {
    const first = reviews.find((review) => review.stage === "STAFF" && review.decision === "APPROVE");
    if (!submission.dualApprovalRequired || submission.status !== "STAFF_APPROVED" || !first || reviews.some((review) => review.stage === "FACILITY")) throw new Error("A first staff approval is required before facility review.");
    if (first.reviewedByUserId === reviewerUserId) throw new Error("The second reviewer must be a different person.");
    if (decision === "APPROVE") return { submissionStatus: "APPROVED", programmeStatus: "APPROVED", note: trimmedNote };
  } else throw new Error("Choose a valid review stage.");
  return { submissionStatus: decision === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED", programmeStatus: decision === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED", note: trimmedNote };
}

export function correctionsSchedulingGate({ programme, submission, reviews = [], organisationPolicy, facilityPolicy, render } = {}) {
  if (!programme || !submission || programme.status !== "APPROVED" || submission.status !== "APPROVED" || programme.latestRevision !== submission.revision || programme.id !== submission.programmeId || programme.facilityId !== submission.facilityId || programme.organisationId !== submission.organisationId) return { allowed: false, reason: "PROGRAMME_NOT_CURRENTLY_APPROVED" };
  if (!organisationPolicy?.policyConfiguredAt || !facilityPolicy?.policyConfiguredAt || organisationPolicy.policyVersion !== submission.organisationPolicyVersion || facilityPolicy.policyVersion !== submission.facilityPolicyVersion) return { allowed: false, reason: "POLICY_CHANGED" };
  const first = reviews.find((review) => review.stage === "STAFF" && review.decision === "APPROVE");
  const second = reviews.find((review) => review.stage === "FACILITY" && review.decision === "APPROVE");
  if (!first || first.reviewedByUserId === submission.submittedByUserId || (submission.dualApprovalRequired && (!second || second.reviewedByUserId === first.reviewedByUserId || second.reviewedByUserId === submission.submittedByUserId))) return { allowed: false, reason: "APPROVAL_EVIDENCE_INCOMPLETE" };
  try {
    if (render?.organisationId !== submission.organisationId || render.id !== submission.renderId || correctionsRenderEvidence(render).fingerprint !== submission.sourceFingerprint) return { allowed: false, reason: "SOURCE_CHANGED" };
  } catch { return { allowed: false, reason: "SOURCE_NOT_VERIFIED" }; }
  return { allowed: true, reason: "GUARD_APPROVED" };
}
