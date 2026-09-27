import { prisma } from "@/lib/prisma";
import { correctionsNetworkAuthority } from "@/lib/corrections-network-service";
import { approvedCorrectionsNetworkSource } from "@/lib/corrections-network-programming-service";
import { correctionsProgrammePermission } from "@/lib/corrections-workflow.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

async function facilityOfferAuthority(tx, access, facilityId) {
  const member = await tx.organisationMember.findFirst({ where: { id: access.context.membership.id,
    organisationId: access.organisationId, userId: access.context.user.id }, select: { id: true, role: true } });
  const subscription = await tx.subscription.findUnique({ where: { organisationId: access.organisationId },
    include: { plan: true, billingContract: true } });
  const entitlement = resolveEntitlements(subscription);
  const assignment = member?.role === "OWNER" ? null : await tx.correctionsFacilityGrant.findUnique({
    where: { organisationMemberId_facilityId: { organisationMemberId: member?.id || "", facilityId } } });
  if (!member || !entitlement.correctionsRadioEnabled || Number(entitlement.planTierNumber) < 4 ||
      !correctionsProgrammePermission({ role: member.role, organisationId: access.organisationId, memberId: member.id,
        facilityId, assignment, action: "SUBMIT" })) throw bad("This facility cannot offer network audio.", 403);
  return member;
}

export async function offerCorrectionsSyndication(access, programmeId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const programme = await tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId },
      select: { id: true, facilityId: true } });
    if (!programme) throw bad("Programme not found in this authority.", 404);
    await facilityOfferAuthority(tx, access, programme.facilityId);
    const source = await approvedCorrectionsNetworkSource(tx, access.organisationId, programmeId);
    const existing = await tx.correctionsSyndicationOffer.findUnique({ where: { submissionId: source.submission.id } });
    if (existing) throw bad("This exact revision has already been offered for central review.", 409);
    const offer = await tx.correctionsSyndicationOffer.create({ data: {
      organisationId: access.organisationId, sourceFacilityId: programme.facilityId,
      programmeId, submissionId: source.submission.id, offeredByUserId: access.context.user.id
    } });
    await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "CORRECTIONS_REVIEW_REQUEST",
      severity: "INFO", title: "Inside network programme offered", message: "An approved facility programme awaits separate central syndication acceptance.",
      entityType: "CorrectionsSyndicationOffer", entityId: offer.id,
      dedupeKey: `corrections-syndication-offer:${offer.id}`, correlationId: offer.id });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_SYNDICATION_OFFERED", entityType: "CorrectionsSyndicationOffer", entityId: offer.id,
      details: { sourceFacilityId: programme.facilityId, programmeId, submissionId: source.submission.id,
        sourceFingerprint: source.submission.sourceFingerprint } } });
    return { id: offer.id, status: offer.status, submissionId: offer.submissionId };
  });
}

export async function decideCorrectionsSyndication(access, offerId, decision) {
  if (!["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(decision)) throw bad("Choose accept, reject, or withdraw.");
  return runSerializableTransaction(prisma, async (tx) => {
    const offer = await tx.correctionsSyndicationOffer.findFirst({ where: { id: offerId,
      organisationId: access.organisationId } });
    if (!offer) throw bad("Syndication offer not found.", 404);
    if (decision === "WITHDRAWN" && offer.offeredByUserId === access.context.user.id) {
      await facilityOfferAuthority(tx, access, offer.sourceFacilityId);
    } else await correctionsNetworkAuthority(tx, access, "distribute");
    if (decision === "ACCEPTED" && offer.offeredByUserId === access.context.user.id) {
      throw bad("A different central staff member must accept a facility offer.", 403);
    }
    if (decision === "WITHDRAWN" && offer.status === "WITHDRAWN") return { id: offer.id, status: offer.status };
    if ((decision === "WITHDRAWN" && !["OFFERED", "ACCEPTED"].includes(offer.status)) ||
        (decision !== "WITHDRAWN" && offer.status !== "OFFERED")) throw bad("This offer can no longer change to that state.", 409);
    if (decision === "ACCEPTED") {
      const source = await approvedCorrectionsNetworkSource(tx, access.organisationId, offer.programmeId, offer.submissionId);
      if (source.programme.facilityId !== offer.sourceFacilityId || source.submission.id !== offer.submissionId) {
        throw bad("The offered exact version is no longer eligible.", 409);
      }
    }
    const now = new Date();
    await tx.correctionsSyndicationOffer.update({ where: { id: offer.id }, data: {
      status: decision, ...(decision === "ACCEPTED" ? { acceptedByUserId: access.context.user.id, acceptedAt: now } : {}),
      ...(decision === "WITHDRAWN" ? { withdrawnAt: now } : {})
    } });
    if (decision === "WITHDRAWN") {
      const distributions = await tx.correctionsProgrammeDistribution.findMany({ where: {
        syndicationOfferId: offer.id, organisationId: access.organisationId }, select: { id: true, targetFacilityId: true } });
      await tx.correctionsProgrammeDistribution.updateMany({ where: { syndicationOfferId: offer.id, status: "ACTIVE" },
        data: { status: "WITHDRAWN", withdrawnAt: now } });
      const ids = distributions.map((item) => item.id);
      const windows = await tx.correctionsNetworkWindow.findMany({ where: { distributionId: { in: ids }, active: true },
        select: { id: true, distributionId: true } });
      await tx.correctionsNetworkWindow.updateMany({ where: { distributionId: { in: ids }, active: true },
        data: { active: false } });
      for (const window of windows) {
        const distribution = distributions.find((item) => item.id === window.distributionId);
        await tx.playoutIntent.updateMany({ where: { organisationId: access.organisationId,
          locationId: distribution.targetFacilityId, sourceRevision: { startsWith: `c7:${window.id}:${distribution.id}:` },
          cancelledAt: null, expiresAt: { gt: now } }, data: { cancelledAt: now } });
      }
      await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "CORRECTIONS_REVIEW_REQUEST",
        severity: "WARNING", title: "Private Inside syndication withdrawn",
        message: "Receiving facilities must review their current approved fallback after this version was withdrawn.",
        entityType: "CorrectionsSyndicationOffer", entityId: offer.id,
        dedupeKey: `corrections-syndication-withdrawn:${offer.id}`, correlationId: offer.id });
    }
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: `CORRECTIONS_SYNDICATION_${decision}`, entityType: "CorrectionsSyndicationOffer", entityId: offer.id,
      details: { sourceFacilityId: offer.sourceFacilityId, programmeId: offer.programmeId,
        submissionId: offer.submissionId } } });
    return { id: offer.id, status: decision };
  });
}

export async function listCorrectionsSyndication(access) {
  if (!access.entitlements.correctionsRadioEnabled || Number(access.entitlements.planTierNumber) < 4) {
    throw bad("Inside Network is not active for this authority.", 403);
  }
  const member = access.context.membership;
  const grant = member.role === "OWNER" ? null : await prisma.correctionsNetworkGrant.findUnique({
    where: { organisationMemberId: member.id } });
  const facilityGrants = member.role === "OWNER" ? [] : await prisma.correctionsFacilityGrant.findMany({
    where: { organisationId: access.organisationId, organisationMemberId: member.id }, select: { facilityId: true } });
  const networkView = member.role === "OWNER" || (Number(access.entitlements.planTierNumber) >= 4 &&
    grant?.organisationId === access.organisationId && grant.canView);
  if (!networkView && !facilityGrants.length) throw bad("No private syndication access.", 403);
  const offers = await prisma.correctionsSyndicationOffer.findMany({ where: { organisationId: access.organisationId,
    ...(networkView ? {} : { sourceFacilityId: { in: facilityGrants.map((item) => item.facilityId) } }) },
    select: { id: true, sourceFacilityId: true, programmeId: true, submissionId: true, status: true,
      offeredAt: true, acceptedAt: true, programme: { select: { title: true } },
      submission: { select: { revision: true } } }, orderBy: { offeredAt: "desc" }, take: 100 });
  return offers;
}
