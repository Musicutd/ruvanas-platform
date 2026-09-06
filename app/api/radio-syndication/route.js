import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  RADIO_SYNDICATION_POLICY_VERSION,
  canManageRadioSyndication,
  normalizeRadioSyndicationOffer,
  normalizeRadioSyndicationRequest,
  radioSyndicationDeliveryDecision,
  transitionRadioSyndicationAgreement,
  transitionRadioSyndicationOffer
} from "@/lib/radio-syndication.mjs";
import {
  findAccessibleSyndicationAgreement,
  findSourceOffer,
  getRadioSyndicationContext,
  loadRadioSyndicationWorkspace
} from "@/lib/radio-syndication-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE_OFFER"), stationNetworkId: z.string().cuid(), sourceStationId: z.string().cuid(),
    kind: z.enum(["RECORDED_PROGRAMME", "LIVE_RELAY"]), sourcePodcastEpisodeId: z.string().cuid().optional().nullable(), sourceChannelId: z.string().cuid().optional().nullable(),
    title: z.string().trim().min(2).max(140), description: z.string().trim().max(1000).optional().nullable(),
    rightsHolder: z.string().trim().min(2).max(160), rightsReference: z.string().trim().min(2).max(200),
    rightsBasis: z.enum(["OWNED_MASTER", "DIRECT_LICENCE", "DISTRIBUTOR_LICENCE", "OTHER"]),
    permittedTerritories: z.union([z.string(), z.array(z.string())]), availableFrom: z.string(), availableUntil: z.string().optional().nullable()
  }),
  z.object({ action: z.literal("CHANGE_OFFER"), offerId: z.string().cuid(), offerAction: z.enum(["PUBLISH", "PAUSE", "WITHDRAW"]), reason: z.string().trim().max(1000).optional().nullable() }),
  z.object({
    action: z.literal("REQUEST_ACCESS"), offerId: z.string().cuid(), targetStationId: z.string().cuid(), targetChannelId: z.string().cuid().optional().nullable(),
    requestedTerritories: z.union([z.string(), z.array(z.string())]), requestedFrom: z.string(), requestedUntil: z.string().optional().nullable(), intendedUse: z.string().trim().min(20).max(500)
  }),
  z.object({ action: z.literal("DECIDE_REQUEST"), agreementId: z.string().cuid(), decision: z.enum(["APPROVE", "DECLINE"]), notes: z.string().trim().max(1000).optional().nullable() }),
  z.object({ action: z.literal("CANCEL_REQUEST"), agreementId: z.string().cuid() }),
  z.object({ action: z.literal("ACTIVATE_REQUEST"), agreementId: z.string().cuid() }),
  z.object({ action: z.literal("REVOKE_REQUEST"), agreementId: z.string().cuid(), reason: z.string().trim().min(3).max(1000) })
]);

function failure(access) {
  return NextResponse.json({ error: access.error }, { status: access.status });
}

function managerRequired(access) {
  return canManageRadioSyndication(access.membership.role)
    ? null
    : NextResponse.json({ error: "An organisation owner or manager must control syndication agreements." }, { status: 403 });
}

async function audit(tx, { access, networkId, action, entityType, entityId, details = {} }) {
  await tx.auditLog.create({ data: {
    organisationId: access.organisation.id,
    stationNetworkId: networkId,
    actorUserId: access.user.id,
    action,
    entityType,
    entityId,
    details: { policyVersion: RADIO_SYNDICATION_POLICY_VERSION, ...details }
  } });
}

async function eligibleSource(input, organisationId) {
  const membership = await prisma.stationNetworkAgreement.findFirst({
    where: { stationNetworkId: input.stationNetworkId, stationId: input.sourceStationId, stationOrganisationId: organisationId, status: "ACTIVE", network: { status: "ACTIVE" }, station: { status: "ACTIVE" } },
    include: { station: { include: { streamConfig: true } } }
  });
  if (!membership) throw new Error("Choose one of your active stations in an active network.");
  if (input.kind === "RECORDED_PROGRAMME") {
    const episode = await prisma.schoolPodcastEpisode.findFirst({
      where: { id: input.sourcePodcastEpisodeId, organisationId, status: "PUBLISHED", series: { product: "ONLINE_RADIO", stationId: input.sourceStationId }, mediaAsset: { organisationId, status: "READY" } },
      include: { mediaAsset: true }
    });
    if (!episode) throw new Error("Choose a published Online Radio programme with ready protected audio.");
    return { membership, episode, channel: null };
  }
  const channel = await prisma.channel.findFirst({ where: { id: input.sourceChannelId, organisationId, stationId: input.sourceStationId, status: "ACTIVE" } });
  if (!channel || !membership.station.streamConfig?.streamUrl) throw new Error("Choose an active channel whose station has a configured live output.");
  return { membership, episode: null, channel };
}

async function currentOfferSource(offer) {
  return eligibleSource({
    stationNetworkId: offer.stationNetworkId,
    sourceStationId: offer.sourceStationId,
    kind: offer.kind,
    sourcePodcastEpisodeId: offer.sourcePodcastEpisodeId,
    sourceChannelId: offer.sourceChannelId
  }, offer.sourceOrganisationId);
}

export async function GET() {
  const access = await getRadioSyndicationContext();
  if (!access.ok) return failure(access);
  return NextResponse.json(await loadRadioSyndicationWorkspace(access));
}

export async function POST(request) {
  const access = await getRadioSyndicationContext();
  if (!access.ok) return failure(access);
  const denied = managerRequired(access);
  if (denied) return denied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the syndication details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;

  try {
    if (data.action === "CREATE_OFFER") {
      const input = normalizeRadioSyndicationOffer(data);
      const source = await eligibleSource(input, organisationId);
      const existingOffer = await prisma.radioSyndicationOffer.findFirst({ where: {
        stationNetworkId: input.stationNetworkId,
        status: { not: "WITHDRAWN" },
        ...(input.kind === "RECORDED_PROGRAMME" ? { sourcePodcastEpisodeId: input.sourcePodcastEpisodeId } : { sourceChannelId: input.sourceChannelId })
      }, select: { id: true } });
      if (existingOffer) throw new Error("This source already has a current offer in the selected network. Withdraw it before creating a new rights window.");
      const result = await prisma.$transaction(async (tx) => {
        const offer = await tx.radioSyndicationOffer.create({ data: {
          ...input,
          sourceNetworkAgreementId: source.membership.id,
          sourceOrganisationId: organisationId,
          termsVersion: RADIO_SYNDICATION_POLICY_VERSION,
          createdByUserId: access.user.id
        } });
        await audit(tx, { access, networkId: input.stationNetworkId, action: "RADIO_SYNDICATION_OFFER_CREATED", entityType: "RadioSyndicationOffer", entityId: offer.id, details: { kind: input.kind, sourceStationId: input.sourceStationId, rightsBasis: input.rightsBasis, territories: input.permittedTerritories, secretsExposed: false } });
        return offer;
      });
      return NextResponse.json({ result }, { status: 201 });
    }

    if (data.action === "CHANGE_OFFER") {
      const offer = await findSourceOffer(data.offerId, access);
      if (!offer) return NextResponse.json({ error: "The source offer was not found for this organisation." }, { status: 404 });
      if (data.offerAction === "PUBLISH") {
        if (offer.availableUntil && offer.availableUntil <= new Date()) throw new Error("The rights window has already ended.");
        await currentOfferSource(offer);
      }
      const transition = transitionRadioSyndicationOffer({ currentStatus: offer.status, action: data.offerAction, reason: data.reason });
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.radioSyndicationOffer.update({ where: { id: offer.id }, data: { ...transition, notes: undefined, publishedByUserId: data.offerAction === "PUBLISH" ? access.user.id : undefined, changedByUserId: access.user.id } });
        await audit(tx, { access, networkId: offer.stationNetworkId, action: `RADIO_SYNDICATION_OFFER_${data.offerAction}`, entityType: "RadioSyndicationOffer", entityId: offer.id, details: { reason: transition.notes, deliveryRevoked: data.offerAction === "WITHDRAW" } });
        return updated;
      });
      return NextResponse.json({ result });
    }

    if (data.action === "REQUEST_ACCESS") {
      const offer = await prisma.radioSyndicationOffer.findFirst({ where: { id: data.offerId, status: "AVAILABLE", sourceOrganisationId: { not: organisationId }, network: { status: "ACTIVE" } } });
      if (!offer) return NextResponse.json({ error: "Choose an available offer from another network station." }, { status: 404 });
      const input = normalizeRadioSyndicationRequest(data, offer);
      const targetMembership = await prisma.stationNetworkAgreement.findFirst({ where: { stationNetworkId: offer.stationNetworkId, stationId: input.targetStationId, stationOrganisationId: organisationId, status: "ACTIVE", station: { status: "ACTIVE" } } });
      if (!targetMembership) throw new Error("Choose your active receiving station in the same network.");
      if (input.targetChannelId) {
        const channel = await prisma.channel.findFirst({ where: { id: input.targetChannelId, organisationId, stationId: input.targetStationId, status: "ACTIVE" }, select: { id: true } });
        if (!channel) throw new Error("Choose an active receiving channel owned by the receiving station.");
      }
      const currentRequest = await prisma.radioSyndicationAgreement.findFirst({ where: { offerId: offer.id, targetStationId: input.targetStationId, status: { in: ["PENDING", "APPROVED"] } }, select: { id: true, status: true } });
      if (currentRequest) throw new Error(currentRequest.status === "APPROVED" ? "This receiving station already has approved access." : "This receiving station already has a pending request.");
      const result = await prisma.$transaction(async (tx) => {
        const agreement = await tx.radioSyndicationAgreement.create({ data: { offerId: offer.id, targetNetworkAgreementId: targetMembership.id, targetOrganisationId: organisationId, ...input, policyVersion: RADIO_SYNDICATION_POLICY_VERSION, requestedByUserId: access.user.id } });
        await audit(tx, { access, networkId: offer.stationNetworkId, action: "RADIO_SYNDICATION_ACCESS_REQUESTED", entityType: "RadioSyndicationAgreement", entityId: agreement.id, details: { offerId: offer.id, targetStationId: input.targetStationId, territories: input.requestedTerritories } });
        return agreement;
      });
      return NextResponse.json({ result }, { status: 201 });
    }

    const agreement = await findAccessibleSyndicationAgreement(data.agreementId, access);
    if (!agreement) return NextResponse.json({ error: "The syndication agreement was not found." }, { status: 404 });

    if (data.action === "DECIDE_REQUEST" || data.action === "REVOKE_REQUEST") {
      if (agreement.offer.sourceOrganisationId !== organisationId) return NextResponse.json({ error: "Only the source organisation may decide or revoke this request." }, { status: 403 });
      const action = data.action === "REVOKE_REQUEST" ? "REVOKE" : data.decision;
      if (action === "APPROVE") {
        if (agreement.offer.status !== "AVAILABLE") throw new Error("Publish the offer before approving access.");
        if (agreement.targetNetworkAgreement.status !== "ACTIVE" || agreement.targetStation.status !== "ACTIVE") throw new Error("The receiving station must retain active network membership.");
        await currentOfferSource(agreement.offer);
      }
      const transition = transitionRadioSyndicationAgreement({ currentStatus: agreement.status, action, notes: data.action === "REVOKE_REQUEST" ? data.reason : data.notes });
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.radioSyndicationAgreement.update({ where: { id: agreement.id }, data: { status: transition.status, decisionNotes: transition.decisionNotes, decidedByUserId: access.user.id, decidedAt: transition.decidedAt, revokedByUserId: action === "REVOKE" ? access.user.id : null, revokedAt: transition.revokedAt } });
        await audit(tx, { access, networkId: agreement.offer.stationNetworkId, action: `RADIO_SYNDICATION_AGREEMENT_${action}`, entityType: "RadioSyndicationAgreement", entityId: agreement.id, details: { targetOrganisationId: agreement.targetOrganisationId, reason: transition.decisionNotes, deliveryRevoked: action === "REVOKE" } });
        return updated;
      });
      return NextResponse.json({ result });
    }

    if (agreement.targetOrganisationId !== organisationId) return NextResponse.json({ error: "Only the receiving organisation may change this request." }, { status: 403 });
    if (data.action === "CANCEL_REQUEST") {
      const transition = transitionRadioSyndicationAgreement({ currentStatus: agreement.status, action: "CANCEL" });
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.radioSyndicationAgreement.update({ where: { id: agreement.id }, data: { status: transition.status, decidedByUserId: access.user.id, decidedAt: transition.decidedAt } });
        await audit(tx, { access, networkId: agreement.offer.stationNetworkId, action: "RADIO_SYNDICATION_AGREEMENT_CANCELLED", entityType: "RadioSyndicationAgreement", entityId: agreement.id });
        return updated;
      });
      return NextResponse.json({ result });
    }

    const activationTerritory = String(agreement.requestedTerritories).split(",")[0] === "WORLDWIDE" ? "MT" : String(agreement.requestedTerritories).split(",")[0];
    const activation = radioSyndicationDeliveryDecision({ offer: agreement.offer, agreement, territory: activationTerritory });
    if (!activation.allowed) throw new Error(`This syndication delivery cannot be activated (${activation.reason.toLowerCase().replaceAll("_", " ")}).`);
    await currentOfferSource(agreement.offer);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.radioSyndicationAgreement.update({ where: { id: agreement.id }, data: { importedByUserId: access.user.id, importedAt: new Date() } });
      await audit(tx, { access, networkId: agreement.offer.stationNetworkId, action: "RADIO_SYNDICATION_DELIVERY_ACTIVATED", entityType: "RadioSyndicationAgreement", entityId: agreement.id, details: { offerId: agreement.offerId, kind: agreement.offer.kind, targetChannelId: agreement.targetChannelId, sourceSecretsExposed: false } });
      return updated;
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "An offer or request for this source already exists in the network." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The syndication action could not be completed." }, { status: 409 });
  }
}
