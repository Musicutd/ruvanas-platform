import { prisma } from "@/lib/prisma";
import { radioSyndicationDeliveryDecision } from "@/lib/radio-syndication.mjs";

export async function loadRadioSyndicationDelivery({ agreementId, targetOrganisationId, territory }) {
  const agreement = await prisma.radioSyndicationAgreement.findFirst({
    where: { id: agreementId, targetOrganisationId, importedAt: { not: null } },
    include: {
      targetNetworkAgreement: { select: { id: true, status: true } },
      targetStation: { select: { id: true, status: true } },
      offer: {
        include: {
          network: { select: { id: true, status: true } },
          sourceNetworkAgreement: { select: { id: true, status: true } },
          sourceStation: { select: { id: true, status: true, streamConfig: true } },
          sourceChannel: { select: { id: true, status: true } },
          sourcePodcastEpisode: { include: { mediaAsset: true } }
        }
      }
    }
  });
  if (!agreement) return { ok: false, status: 404, error: "This activated syndication delivery was not found." };
  const decision = radioSyndicationDeliveryDecision({ offer: agreement.offer, agreement, territory });
  if (!decision.allowed) return { ok: false, status: 409, error: "This syndication delivery is not currently available.", reason: decision.reason };
  return { ok: true, agreement };
}

export async function recordRadioSyndicationDelivery({ agreement, actorUserId, deliveryType, territory, details = {} }) {
  await prisma.auditLog.create({ data: {
    organisationId: agreement.targetOrganisationId,
    stationNetworkId: agreement.offer.stationNetworkId,
    actorUserId,
    action: `RADIO_SYNDICATION_${deliveryType}_DELIVERED`,
    entityType: "RadioSyndicationAgreement",
    entityId: agreement.id,
    details: {
      policyVersion: agreement.policyVersion,
      offerId: agreement.offerId,
      sourceOrganisationId: agreement.offer.sourceOrganisationId,
      targetStationId: agreement.targetStationId,
      territory: String(territory).toUpperCase(),
      ...details
    }
  } });
}
