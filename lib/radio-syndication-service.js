import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import {
  canManageRadioSyndication,
  redactedRadioSyndicationAgreement,
  redactedRadioSyndicationOffer
} from "@/lib/radio-syndication.mjs";

export const radioSyndicationOfferInclude = {
  network: { select: { id: true, name: true, status: true } },
  sourceNetworkAgreement: { select: { id: true, status: true, stationId: true, stationOrganisationId: true } },
  sourceOrganisation: { select: { id: true, name: true } },
  sourceStation: {
    select: {
      id: true, name: true, slug: true, status: true,
      streamConfig: { select: { streamUrl: true } }
    }
  },
  sourceChannel: { select: { id: true, name: true, status: true } },
  sourcePodcastEpisode: {
    select: {
      id: true, title: true, status: true,
      mediaAsset: { select: { id: true, status: true } }
    }
  },
  agreements: {
    orderBy: { requestedAt: "desc" },
    include: {
      targetNetworkAgreement: { select: { id: true, status: true } },
      targetOrganisation: { select: { id: true, name: true } },
      targetStation: { select: { id: true, name: true, status: true } },
      targetChannel: { select: { id: true, name: true, status: true } }
    }
  }
};

export async function getRadioSyndicationContext() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  if (!context.membership) return { ok: false, status: 403, error: "Choose an organisation before opening syndication." };
  const organisation = context.membership.organisation;
  if (!resolveEntitlements(organisation.subscription).serviceEnabled) return { ok: false, status: 403, error: "Online Radio access is required to use syndication." };
  return { ok: true, context, organisation, membership: context.membership, user: context.user };
}

export async function activeRadioNetworkMemberships(organisationId) {
  return prisma.stationNetworkAgreement.findMany({
    where: { stationOrganisationId: organisationId, status: "ACTIVE", network: { status: "ACTIVE" }, station: { status: "ACTIVE" } },
    orderBy: [{ network: { name: "asc" } }, { station: { name: "asc" } }],
    include: {
      network: { select: { id: true, name: true, status: true } },
      station: { select: { id: true, name: true, slug: true, status: true, channels: { where: { status: "ACTIVE" }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } } } }
    }
  });
}

export async function loadRadioSyndicationWorkspace(access) {
  const organisationId = access.organisation.id;
  const memberships = await activeRadioNetworkMemberships(organisationId);
  const networkIds = [...new Set(memberships.map((membership) => membership.stationNetworkId))];
  const stationIds = [...new Set(memberships.map((membership) => membership.stationId))];
  const [offers, episodes] = await Promise.all([
    networkIds.length ? prisma.radioSyndicationOffer.findMany({
      where: {
        stationNetworkId: { in: networkIds },
        OR: [
          { sourceOrganisationId: organisationId },
          { status: "AVAILABLE" },
          { agreements: { some: { targetOrganisationId: organisationId } } }
        ]
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 250,
      include: radioSyndicationOfferInclude
    }) : [],
    stationIds.length ? prisma.schoolPodcastEpisode.findMany({
      where: {
        organisationId,
        status: "PUBLISHED",
        series: { product: "ONLINE_RADIO", stationId: { in: stationIds }, station: { status: "ACTIVE" } },
        mediaAsset: { organisationId, status: "READY" }
      },
      orderBy: { publishedAt: "desc" },
      take: 150,
      select: { id: true, title: true, publishedAt: true, mediaAsset: { select: { durationSeconds: true } }, series: { select: { stationId: true, title: true } } }
    }) : []
  ]);
  const myAgreements = offers.flatMap((offer) => offer.agreements.filter((agreement) => agreement.targetOrganisationId === organisationId).map((agreement) => ({
    ...redactedRadioSyndicationAgreement(agreement),
    offer: {
      id: offer.id, title: offer.title, kind: offer.kind, status: offer.status,
      sourceStation: { id: offer.sourceStation.id, name: offer.sourceStation.name },
      network: { id: offer.network.id, name: offer.network.name }
    },
    delivery: agreement.status === "APPROVED" && agreement.importedAt ? {
      recordedPath: offer.kind === "RECORDED_PROGRAMME" ? `/api/radio-syndication/agreements/${agreement.id}/media` : null,
      livePath: offer.kind === "LIVE_RELAY" ? `/api/radio-syndication/agreements/${agreement.id}/live` : null
    } : null
  })));
  return {
    organisation: { id: organisationId, name: access.organisation.name, role: access.membership.role },
    permissions: { canManage: canManageRadioSyndication(access.membership.role) },
    memberships: memberships.map((membership) => ({
      id: membership.id,
      network: membership.network,
      station: membership.station
    })),
    eligibleEpisodes: episodes.map((episode) => ({
      id: episode.id,
      title: episode.title,
      stationId: episode.series.stationId,
      seriesTitle: episode.series.title,
      durationSeconds: episode.mediaAsset?.durationSeconds || null,
      publishedAt: episode.publishedAt
    })),
    offers: offers.map((offer) => redactedRadioSyndicationOffer(offer, { activeOrganisationId: organisationId })),
    myAgreements,
    safety: {
      explicitAgreementRequired: true,
      rightsWindowEnforcedAtDelivery: true,
      territoryRequiredAtDelivery: true,
      sourceSecretsExposed: false,
      revocationImmediate: true
    }
  };
}

export async function findSourceOffer(offerId, access) {
  return prisma.radioSyndicationOffer.findFirst({ where: { id: offerId, sourceOrganisationId: access.organisation.id }, include: radioSyndicationOfferInclude });
}

export async function findAccessibleSyndicationAgreement(agreementId, access) {
  return prisma.radioSyndicationAgreement.findFirst({
    where: {
      id: agreementId,
      OR: [{ targetOrganisationId: access.organisation.id }, { offer: { sourceOrganisationId: access.organisation.id } }]
    },
    include: { offer: { include: radioSyndicationOfferInclude }, targetNetworkAgreement: true, targetOrganisation: { select: { id: true, name: true } }, targetStation: true, targetChannel: true }
  });
}
