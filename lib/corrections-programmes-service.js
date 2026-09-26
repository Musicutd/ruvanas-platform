import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { correctionsRenderEvidence, correctionsSubmissionEvidence, correctionsReviewTransition, correctionsSchedulingGate, CORRECTIONS_REVIEW_POLICY_VERSION, normalizeCorrectionsProgramme } from "@/lib/corrections-workflow.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { correctionsProgrammePermission } from "@/lib/corrections-workflow.mjs";
import { correctionsStudioSourcesAvailable } from "@/lib/corrections-studio-source-service";

const renderInclude = { outputMediaAsset: true, outputPromoVersion: true, version: { select: { state: true } }, project: { select: { organisationId: true, createdByUserId: true, currentVersion: true, title: true } } };
const programmeInclude = { facility: { select: { id: true, name: true } }, submissions: { orderBy: { revision: "desc" }, take: 1, include: { reviews: { orderBy: { reviewedAt: "asc" }, select: { stage: true, decision: true, note: true, reviewedAt: true } } } } };

export function safeCorrectionsProgramme(programme) {
  const latest = programme.submissions?.[0] || null;
  return {
    id: programme.id, facilityId: programme.facilityId, facilityName: programme.facility?.name || null,
    title: programme.title, description: programme.description, status: programme.status,
    latestRevision: programme.latestRevision, createdByUserId: programme.createdByUserId,
    updatedAt: programme.updatedAt,
    submission: latest ? { id: latest.id, revision: latest.revision, status: latest.status, submittedAt: latest.submittedAt, dualApprovalRequired: latest.dualApprovalRequired, reviewAudioUrl: latest.evidenceSnapshot?.mediaAssetId ? `/api/media/${latest.evidenceSnapshot.mediaAssetId}/stream` : null, reviews: latest.reviews } : null
  };
}

async function currentService(tx, organisationId) {
  const subscription = await tx.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
  if (!resolveEntitlements(subscription).correctionsRadioEnabled) throw new Error("Ruvanas Inside is no longer active for this organisation.");
}

async function currentFacilityPermission(tx, access, facilityId, action) {
  const member = await tx.organisationMember.findUnique({ where: { id: access.context.membership.id }, select: { userId: true, organisationId: true, role: true } });
  if (!member || member.userId !== access.context.user.id || member.organisationId !== access.organisationId || member.role !== access.context.membership.role) throw new Error("Your organisation access changed. Reload before continuing.");
  const assignment = access.context.membership.role === "OWNER" ? null : await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: access.context.membership.id, facilityId } } });
  if (!correctionsProgrammePermission({ role: access.context.membership.role, organisationId: access.organisationId, memberId: access.context.membership.id, facilityId, assignment, action })) throw new Error("You do not have permission for this facility action.");
}

async function currentPolicies(tx, organisationId, facilityId) {
  const [organisationPolicy, facilityPolicy] = await Promise.all([
    tx.correctionsProfile.findUnique({ where: { organisationId } }),
    tx.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId, status: { not: "CLOSED" } } }, include: { location: { select: { organisationId: true, countryCode: true } } } })
  ]);
  if (!organisationPolicy?.policyConfiguredAt || !facilityPolicy?.policyConfiguredAt || !facilityPolicy.location.countryCode) throw new Error("Save organisation and facility policies and the facility country before submitting audio.");
  return { organisationPolicy, facilityPolicy };
}

export async function listCorrectionsProgrammes(access) {
  let facilityIds = null;
  if (access.context.membership.role !== "OWNER") {
    const grants = await prisma.correctionsFacilityGrant.findMany({ where: { organisationId: access.organisationId, organisationMemberId: access.context.membership.id }, select: { facilityId: true } });
    facilityIds = grants.map((grant) => grant.facilityId);
  }
  const programmes = await prisma.correctionsProgramme.findMany({
    where: { organisationId: access.organisationId, ...(facilityIds ? { facilityId: { in: facilityIds } } : {}) },
    orderBy: { updatedAt: "desc" }, take: 100, include: programmeInclude
  });
  return programmes.map(safeCorrectionsProgramme);
}

export async function getCorrectionsProgramme(access, programmeId) {
  const programme = await prisma.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId }, include: programmeInclude });
  return programme ? safeCorrectionsProgramme(programme) : null;
}

export async function availableCorrectionsStudioRenders(access) {
  const renders = await prisma.audioRender.findMany({
    where: { organisationId: access.organisationId, status: "SUCCEEDED", ...(access.context.membership.role === "CONTENT_EDITOR" ? { project: { createdByUserId: access.context.user.id } } : {}) },
    orderBy: { completedAt: "desc" }, take: 50, include: renderInclude
  });
  return renders.flatMap((render) => {
    try {
      correctionsRenderEvidence(render);
      return [{ id: render.id, projectTitle: render.project?.title || "Studio render", completedAt: render.completedAt }];
    } catch { return []; }
  });
}

export async function createCorrectionsProgramme(access, facilityId, input) {
  const data = normalizeCorrectionsProgramme(input);
  return runSerializableTransaction(prisma, async (tx) => {
    await currentService(tx, access.organisationId);
    await currentFacilityPermission(tx, access, facilityId, "CREATE");
    const facility = await tx.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId: access.organisationId, status: { not: "CLOSED" } } }, select: { locationId: true } });
    if (!facility) throw new Error("Choose a facility in your organisation.");
    const programme = await tx.correctionsProgramme.create({ data: { organisationId: access.organisationId, facilityId, ...data, createdByUserId: access.context.user.id }, include: programmeInclude });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_PROGRAMME_CREATED", entityType: "CorrectionsProgramme", entityId: programme.id, details: { facilityId } } });
    return safeCorrectionsProgramme(programme);
  });
}

export async function editCorrectionsProgramme(access, programmeId, input) {
  const data = normalizeCorrectionsProgramme(input);
  return runSerializableTransaction(prisma, async (tx) => {
    await currentService(tx, access.organisationId);
    const current = await tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId }, select: { id: true, facilityId: true, status: true } });
    if (!current) return null;
    await currentFacilityPermission(tx, access, current.facilityId, "EDIT");
    if (!["DRAFT", "CHANGES_REQUESTED", "REJECTED", "APPROVED"].includes(current.status)) throw new Error("Wait for review before changing this programme.");
    const programme = await tx.correctionsProgramme.update({ where: { id: programmeId }, data: { ...data, status: "DRAFT" }, include: programmeInclude });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_PROGRAMME_EDITED", entityType: "CorrectionsProgramme", entityId: programmeId, details: { facilityId: current.facilityId, previousStatus: current.status, approvalInvalidated: current.status === "APPROVED" } } });
    return safeCorrectionsProgramme(programme);
  });
}

export async function submitCorrectionsProgramme(access, programmeId, renderId) {
  return runSerializableTransaction(prisma, async (tx) => {
    await currentService(tx, access.organisationId);
    const programme = await tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId } });
    if (!programme) return null;
    await currentFacilityPermission(tx, access, programme.facilityId, "SUBMIT");
    if (!["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(programme.status)) throw new Error("Edit or create a draft before submitting another version.");
    const { organisationPolicy, facilityPolicy } = await currentPolicies(tx, access.organisationId, programme.facilityId);
    const render = await tx.audioRender.findFirst({ where: { id: renderId, organisationId: access.organisationId }, include: renderInclude });
    if (!render || render.project.organisationId !== access.organisationId || (access.context.membership.role === "CONTENT_EDITOR" && render.project.createdByUserId !== access.context.user.id)) throw new Error("Choose an approved Studio render you may use for this organisation.");
    const evidence = correctionsRenderEvidence(render);
    const revision = programme.latestRevision + 1;
    const submission = await tx.correctionsSubmission.create({ data: {
      programmeId, organisationId: access.organisationId, facilityId: programme.facilityId,
      revision, renderId, sourceFingerprint: evidence.fingerprint,
      organisationPolicyVersion: organisationPolicy.policyVersion, facilityPolicyVersion: facilityPolicy.policyVersion,
      dualApprovalRequired: facilityPolicy.dualApprovalRequired,
      titleSnapshot: programme.title, descriptionSnapshot: programme.description,
      evidenceSnapshot: { reviewPolicyVersion: CORRECTIONS_REVIEW_POLICY_VERSION, ...evidence, facilityId: programme.facilityId, programmeId, revision, organisationPolicyVersion: organisationPolicy.policyVersion, facilityPolicyVersion: facilityPolicy.policyVersion },
      submittedByUserId: access.context.user.id
    } });
    await tx.correctionsProgramme.update({ where: { id: programmeId }, data: { status: "SUBMITTED", latestRevision: revision } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_PROGRAMME_SUBMITTED", entityType: "CorrectionsSubmission", entityId: submission.id, details: { programmeId, facilityId: programme.facilityId, revision, renderId, fingerprint: evidence.fingerprint, dualApprovalRequired: submission.dualApprovalRequired } } });
    return { id: submission.id, programmeId, revision, status: submission.status, dualApprovalRequired: submission.dualApprovalRequired };
  });
}

export async function reviewCorrectionsProgramme(access, programmeId, { stage, decision, note }) {
  return runSerializableTransaction(prisma, async (tx) => {
    await currentService(tx, access.organisationId);
    const programme = await tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId } });
    if (!programme) return null;
    await currentFacilityPermission(tx, access, programme.facilityId, "REVIEW");
    const submission = await tx.correctionsSubmission.findUnique({ where: { programmeId_revision: { programmeId, revision: programme.latestRevision } }, include: { reviews: true } });
    if (!submission) throw new Error("There is no submitted version to review.");
    const { organisationPolicy, facilityPolicy } = await currentPolicies(tx, access.organisationId, programme.facilityId);
    const render = await tx.audioRender.findFirst({ where: { id: submission.renderId, organisationId: access.organisationId }, include: renderInclude });
    if (!render || correctionsSubmissionEvidence(render, submission).fingerprint !== submission.sourceFingerprint) throw new Error("The submitted audio has changed. Create a new reviewed version.");
    if (submission.studioSessionId && !await correctionsStudioSourcesAvailable(tx, { organisationId: access.organisationId,
      projectId: submission.studioProjectId, versionState: render.version.state })) throw new Error("A submitted source is no longer approved or available. Request a new version.");
    const transition = correctionsReviewTransition({ submission, programme, stage, decision, reviewerUserId: access.context.user.id, note, reviews: submission.reviews, organisationPolicy, facilityPolicy });
    const reviewedAt = new Date();
    const review = await tx.correctionsReview.create({ data: {
      submissionId: submission.id, stage, decision, note: transition.note, reviewedByUserId: access.context.user.id, reviewedAt,
      evidenceSnapshot: { reviewPolicyVersion: CORRECTIONS_REVIEW_POLICY_VERSION, submissionId: submission.id, programmeId, facilityId: programme.facilityId, revision: submission.revision, sourceFingerprint: submission.sourceFingerprint, organisationPolicyVersion: submission.organisationPolicyVersion, facilityPolicyVersion: submission.facilityPolicyVersion, stage, decision, reviewedAt: reviewedAt.toISOString() }
    } });
    await tx.correctionsSubmission.update({ where: { id: submission.id }, data: { status: transition.submissionStatus } });
    await tx.correctionsProgramme.update({ where: { id: programmeId }, data: { status: transition.programmeStatus } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_PROGRAMME_REVIEWED", entityType: "CorrectionsReview", entityId: review.id, details: { programmeId, facilityId: programme.facilityId, submissionId: submission.id, stage, decision, sourceFingerprint: submission.sourceFingerprint } } });
    return { id: review.id, submissionId: submission.id, stage, decision, programmeStatus: transition.programmeStatus };
  });
}

export async function correctionsProgrammeReadiness(access, programmeId) {
  const programme = await prisma.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId } });
  if (!programme) return null;
  const submission = await prisma.correctionsSubmission.findUnique({ where: { programmeId_revision: { programmeId, revision: programme.latestRevision } }, include: { reviews: true } });
  const [policies, render] = await Promise.all([
    currentPolicies(prisma, access.organisationId, programme.facilityId).catch(() => ({ organisationPolicy: null, facilityPolicy: null })),
    submission ? prisma.audioRender.findFirst({ where: { id: submission.renderId, organisationId: access.organisationId }, include: renderInclude }) : null
  ]);
  const gate = correctionsSchedulingGate({ programme, submission, reviews: submission?.reviews || [], ...policies, render });
  if (gate.allowed && submission.studioSessionId && !await correctionsStudioSourcesAvailable(prisma, { organisationId: access.organisationId,
    projectId: submission.studioProjectId, versionState: render.version.state })) return { programmeId, allowed: false, reason: "SOURCE_NO_LONGER_APPROVED", playbackEnabled: false };
  return { programmeId, ...gate, playbackEnabled: false };
}
