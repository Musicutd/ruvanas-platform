import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import {
  SCHOOL_NETWORK_EXCHANGE_POLICY_VERSION,
  normaliseSchoolExchangeIntendedUse,
  redactedSchoolExchangeOffer,
  transitionSchoolExchangeOffer,
  transitionSchoolExchangeRequest,
  validateSchoolEpisodeExchangeEligibility
} from "@/lib/school-network-exchange.mjs";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PUBLISH_OFFER"), episodeId: z.string().cuid(), consentConfirmed: z.literal(true) }),
  z.object({ action: z.literal("CHANGE_OFFER"), offerId: z.string().cuid(), offerAction: z.enum(["PAUSE", "RESUME", "WITHDRAW"]), reason: z.string().trim().max(1000).optional().nullable() }),
  z.object({ action: z.literal("REQUEST_ACCESS"), offerId: z.string().cuid(), intendedUse: z.string().trim().min(20).max(500) }),
  z.object({ action: z.literal("DECIDE_REQUEST"), requestId: z.string().cuid(), decision: z.enum(["APPROVE", "DECLINE"]), notes: z.string().trim().max(1000).optional().nullable() }),
  z.object({ action: z.literal("CANCEL_REQUEST"), requestId: z.string().cuid() }),
  z.object({ action: z.literal("IMPORT_REQUEST"), requestId: z.string().cuid() }),
  z.object({ action: z.literal("REVOKE_REQUEST"), requestId: z.string().cuid(), reason: z.string().trim().min(3).max(1000) })
]);

const offerInclude = {
  sourceOrganisation: { select: { id: true, name: true } },
  requests: {
    orderBy: { requestedAt: "desc" },
    include: {
      targetOrganisation: { select: { id: true, name: true } },
      importedAnnouncement: { select: { id: true, status: true } }
    }
  }
};

function managerRequired(access) {
  return isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)
    ? null
    : NextResponse.json({ error: "An organisation owner or manager must control cross-school sharing." }, { status: 403 });
}

async function activeNetworkSchool(organisationId) {
  return prisma.schoolNetworkSchool.findUnique({
    where: { organisationId },
    include: {
      schoolNetwork: {
        include: {
          schools: {
            where: { active: true },
            orderBy: { joinedAt: "asc" },
            include: { organisation: { select: { id: true, name: true } } }
          }
        }
      }
    }
  });
}

async function audit(tx, { access, networkId, organisationId = access.organisation.id, action, entityType, entityId, details = {} }) {
  await tx.auditLog.create({
    data: {
      organisationId,
      schoolNetworkId: networkId,
      actorUserId: access.user.id,
      action,
      entityType,
      entityId,
      details: { policyVersion: SCHOOL_NETWORK_EXCHANGE_POLICY_VERSION, ...details }
    }
  });
}

async function eligibleEpisode(episodeId, organisationId) {
  return prisma.schoolEpisode.findFirst({
    where: { id: episodeId, organisationId, status: "APPROVED" },
    include: {
      contributors: { select: { contributorId: true } },
      submissions: {
        where: {
          status: "SUBMITTED",
          promoVersion: { status: { in: ["APPROVED", "SUPERSEDED"] }, promoAsset: { status: "ACTIVE" } }
        },
        orderBy: { revision: "desc" },
        take: 1,
        include: { promoVersion: { include: { promoAsset: { select: { status: true } } } } }
      }
    }
  });
}

async function confirmOfferEligibility(offer, consentConfirmed = true) {
  const episode = await prisma.schoolEpisode.findFirst({
    where: { id: offer.episodeId, organisationId: offer.sourceOrganisationId, status: "APPROVED" },
    include: {
      contributors: { select: { contributorId: true } },
      submissions: {
        where: {
          status: "SUBMITTED",
          promoVersionId: offer.approvedPromoVersionId,
          promoVersion: { status: { in: ["APPROVED", "SUPERSEDED"] }, promoAsset: { status: "ACTIVE" } }
        },
        take: 1,
        include: { promoVersion: { include: { promoAsset: { select: { status: true } } } } }
      }
    }
  });
  if (!episode?.submissions[0]) throw new Error("The source episode is no longer eligible for cross-school sharing.");
  const contributorIds = episode.contributors.map((entry) => entry.contributorId);
  const consentRecords = contributorIds.length
    ? await prisma.consentRecord.findMany({
        where: {
          organisationId: offer.sourceOrganisationId,
          contributorId: { in: contributorIds },
          OR: [{ episodeId: episode.id }, { episodeId: null }],
          status: "GRANTED"
        },
        orderBy: { createdAt: "desc" }
      })
    : [];
  validateSchoolEpisodeExchangeEligibility({
    episodeStatus: episode.status,
    promoVersionStatus: episode.submissions[0].promoVersion.status,
    promoAssetStatus: episode.submissions[0].promoVersion.promoAsset.status,
    contributorIds,
    consentRecords,
    consentConfirmed
  });
  return { episode, submission: episode.submissions[0] };
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const networkSchool = await activeNetworkSchool(organisationId);
  if (!networkSchool?.active) {
    return NextResponse.json({ network: null, eligibleEpisodes: [], offers: [], myRequests: [], permissions: { canManage: false }, safety: { verifiedSchoolsOnly: true, studentIdentitiesShared: false, directStudentAccess: false } });
  }
  const networkId = networkSchool.schoolNetworkId;
  const [offers, myRequests, episodes] = await Promise.all([
    prisma.schoolEpisodeExchangeOffer.findMany({
      where: { schoolNetworkId: networkId, OR: [{ status: "AVAILABLE" }, { sourceOrganisationId: organisationId }, { requests: { some: { targetOrganisationId: organisationId } } }] },
      orderBy: [{ status: "asc" }, { availableAt: "desc" }],
      include: offerInclude
    }),
    prisma.schoolEpisodeExchangeRequest.findMany({
      where: { targetOrganisationId: organisationId },
      orderBy: { requestedAt: "desc" },
      include: {
        offer: { include: { sourceOrganisation: { select: { id: true, name: true } } } },
        importedAnnouncement: { select: { id: true, title: true, status: true } }
      }
    }),
    prisma.schoolEpisode.findMany({
      where: {
        organisationId,
        status: "APPROVED",
        networkExchangeOffers: { none: { schoolNetworkId: networkId } },
        submissions: { some: { status: "SUBMITTED", promoVersion: { status: { in: ["APPROVED", "SUPERSEDED"] }, promoAsset: { status: "ACTIVE" } } } }
      },
      orderBy: { approvedAt: "desc" },
      include: {
        contributors: { select: { contributorId: true } },
        submissions: {
          where: { status: "SUBMITTED", promoVersion: { status: { in: ["APPROVED", "SUPERSEDED"] }, promoAsset: { status: "ACTIVE" } } },
          orderBy: { revision: "desc" }, take: 1,
          include: { promoVersion: { select: { languageCode: true, durationSeconds: true } } }
        }
      }
    })
  ]);
  return NextResponse.json({
    network: {
      id: networkSchool.schoolNetwork.id,
      name: networkSchool.schoolNetwork.name,
      schools: networkSchool.schoolNetwork.schools.map((school) => ({ id: school.organisation.id, name: school.organisation.name }))
    },
    eligibleEpisodes: episodes.map((episode) => ({
      id: episode.id,
      title: episode.title,
      summary: episode.summary,
      approvedAt: episode.approvedAt,
      contributorCount: episode.contributors.length,
      languageCode: episode.submissions[0]?.promoVersion.languageCode || "und",
      durationSeconds: episode.submissions[0]?.promoVersion.durationSeconds || null
    })),
    offers: offers.map((offer) => redactedSchoolExchangeOffer(offer, { activeOrganisationId: organisationId })),
    myRequests: myRequests.map((request) => ({
      id: request.id,
      offerId: request.offerId,
      sourceSchool: { id: request.offer.sourceOrganisation.id, name: request.offer.sourceOrganisation.name },
      title: request.offer.sourceTitle,
      status: request.status,
      intendedUse: request.intendedUse,
      decisionNotes: request.decisionNotes,
      requestedAt: request.requestedAt,
      importedAnnouncement: request.importedAnnouncement
    })),
    permissions: { canManage: isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES) },
    safety: { verifiedSchoolsOnly: true, studentIdentitiesShared: false, consentDetailsShared: false, localReviewRequiredBeforePlayback: true, directStudentAccess: false }
  });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const denied = managerRequired(access);
  if (denied) return denied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the exchange details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;
  const networkSchool = await activeNetworkSchool(organisationId);
  if (!networkSchool?.active) return NextResponse.json({ error: "This school is not active in a verified academy network." }, { status: 403 });
  const networkId = networkSchool.schoolNetworkId;

  try {
    if (data.action === "PUBLISH_OFFER") {
      const episode = await eligibleEpisode(data.episodeId, organisationId);
      if (!episode?.submissions[0]) return NextResponse.json({ error: "Choose an approved episode with an approved audio master." }, { status: 404 });
      const contributorIds = episode.contributors.map((entry) => entry.contributorId);
      const consentRecords = contributorIds.length
        ? await prisma.consentRecord.findMany({ where: { organisationId, contributorId: { in: contributorIds }, OR: [{ episodeId: episode.id }, { episodeId: null }], status: "GRANTED" }, orderBy: { createdAt: "desc" } })
        : [];
      validateSchoolEpisodeExchangeEligibility({ episodeStatus: episode.status, promoVersionStatus: episode.submissions[0].promoVersion.status, promoAssetStatus: episode.submissions[0].promoVersion.promoAsset.status, contributorIds, consentRecords, consentConfirmed: data.consentConfirmed });
      const audio = episode.submissions[0].promoVersion;
      const offer = await prisma.$transaction(async (tx) => {
        const created = await tx.schoolEpisodeExchangeOffer.create({
          data: {
            schoolNetworkId: networkId,
            sourceOrganisationId: organisationId,
            episodeId: episode.id,
            approvedPromoVersionId: audio.id,
            sourceTitle: episode.title,
            sourceSummary: episode.summary,
            languageCode: audio.languageCode,
            durationSeconds: audio.durationSeconds,
            consentConfirmed: true,
            policyVersion: SCHOOL_NETWORK_EXCHANGE_POLICY_VERSION,
            createdByUserId: access.user.id
          }
        });
        await audit(tx, { access, networkId, action: "SCHOOL_EPISODE_EXCHANGE_OFFER_PUBLISHED", entityType: "SchoolEpisodeExchangeOffer", entityId: created.id, details: { episodeId: episode.id, studentIdentityExposed: false, consentDetailsExposed: false } });
        return created;
      });
      return NextResponse.json({ result: offer }, { status: 201 });
    }

    if (data.action === "CHANGE_OFFER") {
      const offer = await prisma.schoolEpisodeExchangeOffer.findFirst({ where: { id: data.offerId, schoolNetworkId: networkId, sourceOrganisationId: organisationId } });
      if (!offer) return NextResponse.json({ error: "The episode offer was not found for this school." }, { status: 404 });
      if (data.offerAction === "RESUME") await confirmOfferEligibility(offer);
      const transition = transitionSchoolExchangeOffer({ currentStatus: offer.status, action: data.offerAction, reason: data.reason });
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.schoolEpisodeExchangeOffer.update({ where: { id: offer.id }, data: { status: transition.status, availableAt: transition.availableAt, withdrawnAt: transition.withdrawnAt } });
        await audit(tx, { access, networkId, action: `SCHOOL_EPISODE_EXCHANGE_OFFER_${data.offerAction}`, entityType: "SchoolEpisodeExchangeOffer", entityId: offer.id, details: { reason: transition.reason } });
        return updated;
      });
      return NextResponse.json({ result });
    }

    if (data.action === "REQUEST_ACCESS") {
      const intendedUse = normaliseSchoolExchangeIntendedUse(data.intendedUse);
      const offer = await prisma.schoolEpisodeExchangeOffer.findFirst({ where: { id: data.offerId, schoolNetworkId: networkId, status: "AVAILABLE", sourceOrganisationId: { not: organisationId } } });
      if (!offer) return NextResponse.json({ error: "Choose an available episode offered by another verified school in this network." }, { status: 404 });
      const requestResult = await prisma.$transaction(async (tx) => {
        const saved = await tx.schoolEpisodeExchangeRequest.upsert({
          where: { offerId_targetOrganisationId: { offerId: offer.id, targetOrganisationId: organisationId } },
          create: { offerId: offer.id, targetOrganisationId: organisationId, intendedUse, policyVersion: SCHOOL_NETWORK_EXCHANGE_POLICY_VERSION, requestedByUserId: access.user.id },
          update: { status: "PENDING", intendedUse, decisionNotes: null, requestedByUserId: access.user.id, requestedAt: new Date(), decidedByUserId: null, decidedAt: null, revokedAt: null }
        });
        await audit(tx, { access, networkId, action: "SCHOOL_EPISODE_EXCHANGE_ACCESS_REQUESTED", entityType: "SchoolEpisodeExchangeRequest", entityId: saved.id, details: { offerId: offer.id, sourceOrganisationId: offer.sourceOrganisationId, studentIdentityExposed: false } });
        return saved;
      });
      return NextResponse.json({ result: requestResult }, { status: 201 });
    }

    if (data.action === "DECIDE_REQUEST" || data.action === "REVOKE_REQUEST") {
      const requestRecord = await prisma.schoolEpisodeExchangeRequest.findFirst({
        where: { id: data.requestId, offer: { schoolNetworkId: networkId, sourceOrganisationId: organisationId } },
        include: { offer: true, importedAnnouncement: true }
      });
      if (!requestRecord) return NextResponse.json({ error: "The incoming exchange request was not found." }, { status: 404 });
      const action = data.action === "REVOKE_REQUEST" ? "REVOKE" : data.decision;
      if (action === "APPROVE") {
        if (requestRecord.offer.status !== "AVAILABLE") throw new Error("Resume the episode offer before approving access.");
        await confirmOfferEligibility(requestRecord.offer);
      }
      const transition = transitionSchoolExchangeRequest({ currentStatus: requestRecord.status, action, notes: data.action === "REVOKE_REQUEST" ? data.reason : data.notes });
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.schoolEpisodeExchangeRequest.update({ where: { id: requestRecord.id }, data: { status: transition.status, decisionNotes: transition.decisionNotes, decidedByUserId: access.user.id, decidedAt: transition.decidedAt, revokedAt: transition.revokedAt } });
        if (action === "REVOKE" && requestRecord.importedAnnouncement) {
          await tx.schoolAnnouncement.update({ where: { id: requestRecord.importedAnnouncement.id }, data: { status: "ARCHIVED", reviewedAt: new Date(), reviewNotes: transition.decisionNotes } });
          await tx.schoolBroadcastSlot.updateMany({ where: { announcementId: requestRecord.importedAnnouncement.id, status: "APPROVED", endsAt: { gt: new Date() } }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: `Network sharing revoked: ${transition.decisionNotes}` } });
        }
        await audit(tx, { access, networkId, action: `SCHOOL_EPISODE_EXCHANGE_REQUEST_${action}`, entityType: "SchoolEpisodeExchangeRequest", entityId: requestRecord.id, details: { targetOrganisationId: requestRecord.targetOrganisationId, reason: transition.decisionNotes, localPlaybackRevoked: action === "REVOKE" } });
        return updated;
      });
      return NextResponse.json({ result });
    }

    if (data.action === "CANCEL_REQUEST") {
      const requestRecord = await prisma.schoolEpisodeExchangeRequest.findFirst({ where: { id: data.requestId, targetOrganisationId: organisationId, offer: { schoolNetworkId: networkId } } });
      if (!requestRecord) return NextResponse.json({ error: "The outgoing exchange request was not found." }, { status: 404 });
      const transition = transitionSchoolExchangeRequest({ currentStatus: requestRecord.status, action: "CANCEL" });
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.schoolEpisodeExchangeRequest.update({ where: { id: requestRecord.id }, data: { status: transition.status, decidedByUserId: access.user.id, decidedAt: transition.decidedAt } });
        await audit(tx, { access, networkId, action: "SCHOOL_EPISODE_EXCHANGE_REQUEST_CANCELLED", entityType: "SchoolEpisodeExchangeRequest", entityId: requestRecord.id });
        return updated;
      });
      return NextResponse.json({ result });
    }

    const requestRecord = await prisma.schoolEpisodeExchangeRequest.findFirst({
      where: { id: data.requestId, targetOrganisationId: organisationId, status: "APPROVED", offer: { schoolNetworkId: networkId, status: "AVAILABLE" } },
      include: { offer: { include: { sourceOrganisation: { select: { name: true } } } }, importedAnnouncement: true }
    });
    if (!requestRecord) return NextResponse.json({ error: "Approved access to this episode is not available." }, { status: 404 });
    const announcement = await prisma.$transaction(async (tx) => {
      const announcementData = {
        promoVersionId: requestRecord.offer.approvedPromoVersionId,
        title: requestRecord.offer.sourceTitle,
        summary: `Shared by ${requestRecord.offer.sourceOrganisation.name}. Intended use: ${requestRecord.intendedUse}`,
        status: "IN_REVIEW",
        policyVersion: SCHOOL_NETWORK_EXCHANGE_POLICY_VERSION,
        createdByUserId: access.user.id,
        reviewedByUserId: null,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewNotes: null
      };
      const created = requestRecord.importedAnnouncement
        ? await tx.schoolAnnouncement.update({ where: { id: requestRecord.importedAnnouncement.id }, data: announcementData })
        : await tx.schoolAnnouncement.create({ data: { organisationId, sourceExchangeRequestId: requestRecord.id, ...announcementData } });
      await tx.schoolEpisodeExchangeRequest.update({ where: { id: requestRecord.id }, data: { importedByUserId: access.user.id, importedAt: new Date() } });
      await audit(tx, { access, networkId, action: "SCHOOL_EPISODE_EXCHANGE_IMPORTED_FOR_LOCAL_REVIEW", entityType: "SchoolAnnouncement", entityId: created.id, details: { requestId: requestRecord.id, sourceOrganisationId: requestRecord.offer.sourceOrganisationId, crossSchoolContentExposed: true, studentIdentityExposed: false, localReviewRequired: true, reopenedAfterRevocation: Boolean(requestRecord.importedAnnouncement) } });
      return created;
    });
    return NextResponse.json({ result: announcement }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This episode or exchange request already exists." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The school exchange action could not be completed." }, { status: 409 });
  }
}
