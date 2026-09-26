import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { correctionsContributorRenderEvidence, CORRECTIONS_REVIEW_POLICY_VERSION } from "@/lib/corrections-workflow.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { correctionsStudioSourcesAvailable } from "@/lib/corrections-studio-source-service";

export async function submitCorrectionsStudioWork(access, renderId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const prior = await tx.correctionsSubmission.findUnique({ where: { studioSessionId: access.session.id } });
    if (prior) return { id: prior.id, programmeId: prior.programmeId, revision: prior.revision, status: prior.status, repeated: true };
    const session = await tx.correctionsStudioSession.findFirst({ where: {
      id: access.session.id, status: "ACTIVE", accessTokenHash: access.session.accessTokenHash,
      expiresAt: { gt: new Date() }, contributor: { status: "ACTIVE" },
      programme: { status: { in: ["DRAFT", "CHANGES_REQUESTED", "REJECTED"] } }
    }, include: { programme: true, contributor: true, project: true } });
    if (!session) throw new Error("This supervised Studio session has ended.");
    if (session.organisationId !== access.session.organisationId || session.facilityId !== session.programme.facilityId ||
        session.contributor.facilityId !== session.facilityId || session.project.organisationId !== session.organisationId) throw new Error("The supervised Studio assignment changed.");
    const [subscription, organisationPolicy, facilityPolicy, supervisorMembership] = await Promise.all([
      tx.subscription.findUnique({ where: { organisationId: session.organisationId }, include: { plan: true, billingContract: true } }),
      tx.correctionsProfile.findUnique({ where: { organisationId: session.organisationId } }),
      tx.correctionsFacility.findFirst({ where: { locationId: session.facilityId, location: { organisationId: session.organisationId, status: { not: "CLOSED" } } } }),
      tx.organisationMember.findFirst({ where: { organisationId: session.organisationId, userId: session.supervisorUserId } })
    ]);
    const entitlements = resolveEntitlements(subscription);
    if (!entitlements.correctionsRadioEnabled || entitlements.planTierNumber < 2 || !supervisorMembership ||
        !Array.isArray(session.capabilityScope) || !session.capabilityScope.includes("SUBMIT")) throw new Error("Corrections access is no longer active.");
    if (!organisationPolicy?.policyConfiguredAt || !facilityPolicy?.policyConfiguredAt) throw new Error("Save current organisation and facility policies before submitting.");
    if (supervisorMembership.role !== "OWNER") {
      const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: supervisorMembership.id, facilityId: session.facilityId } } });
      if (supervisorMembership.role !== "MANAGER" || grant?.permission !== "MANAGER") throw new Error("The supervisor no longer has facility authority.");
    }
    const render = await tx.audioRender.findFirst({ where: { id: renderId, organisationId: session.organisationId, projectId: session.projectId, requestedByUserId: session.supervisorUserId, createdAt: { gte: session.activatedAt } }, include: {
      outputMediaAsset: true, outputPromoVersion: true,
      version: { select: { id: true, projectId: true, createdAt: true, state: true } },
      project: { select: { organisationId: true } }
    } });
    if (!render || render.version.projectId !== session.projectId || render.version.createdAt < session.activatedAt || render.project.organisationId !== session.organisationId) throw new Error("Choose a completed render made during this supervised session.");
    if (!await correctionsStudioSourcesAvailable(tx, { organisationId: session.organisationId, projectId: session.projectId,
      versionState: render.version.state })) throw new Error("A source recording or approved sound is no longer available for review.");
    const evidence = correctionsContributorRenderEvidence(render, { organisationId: session.organisationId, projectId: session.projectId, versionId: render.versionId });
    const revision = session.programme.latestRevision + 1;
    const submission = await tx.correctionsSubmission.create({ data: {
      programmeId: session.programmeId, organisationId: session.organisationId, facilityId: session.facilityId,
      revision, renderId: render.id, sourceFingerprint: evidence.fingerprint,
      organisationPolicyVersion: organisationPolicy.policyVersion, facilityPolicyVersion: facilityPolicy.policyVersion,
      dualApprovalRequired: facilityPolicy.dualApprovalRequired,
      titleSnapshot: session.programme.title, descriptionSnapshot: session.programme.description,
      contributorId: session.contributorId, studioSessionId: session.id, studioProjectId: session.projectId,
      studioVersionId: render.versionId, submittedByUserId: session.supervisorUserId,
      evidenceSnapshot: { reviewPolicyVersion: CORRECTIONS_REVIEW_POLICY_VERSION, sourceKind: "SUPERVISED_STUDIO_PENDING_REVIEW", ...evidence,
        facilityId: session.facilityId, programmeId: session.programmeId, contributorId: session.contributorId,
        studioSessionId: session.id, projectId: session.projectId, revision,
        organisationPolicyVersion: organisationPolicy.policyVersion, facilityPolicyVersion: facilityPolicy.policyVersion }
    } });
    await tx.correctionsProgramme.update({ where: { id: session.programmeId }, data: { status: "SUBMITTED", latestRevision: revision } });
    await tx.correctionsStudioSession.update({ where: { id: session.id }, data: { status: "SUBMITTED", completedAt: new Date() } });
    await tx.auditLog.create({ data: { organisationId: session.organisationId, action: "CORRECTIONS_STUDIO_SUBMITTED", entityType: "CorrectionsSubmission", entityId: submission.id, details: {
      facilityId: session.facilityId, contributorId: session.contributorId, studioSessionId: session.id,
      programmeId: session.programmeId, projectId: session.projectId, renderId: render.id,
      versionId: render.versionId, fingerprint: evidence.fingerprint, revision,
      accountableSupervisorUserId: session.supervisorUserId
    } } });
    await enqueueNotificationEvent(tx, { organisationId: session.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "INFO",
      title: "Inside programme awaiting review", message: "A supervised Studio submission is ready for authorised staff review.",
      entityType: "CorrectionsSubmission", entityId: submission.id, metadata: { facilityId: session.facilityId },
      dedupeKey: `corrections-review:${submission.id}`, correlationId: randomUUID() });
    return { id: submission.id, programmeId: session.programmeId, revision, status: submission.status, repeated: false };
  });
}
