import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "@/lib/studio-general-asset-boundary.mjs";
import { GENERAL_STUDIO_CHANNEL_WHERE, GENERAL_STUDIO_STATION_WHERE } from "@/lib/studio-general-output-boundary.mjs";
import {
  GENERAL_RADIO_SYNDICATION_SOURCE_WHERE,
  generalRadioSyndicationSourceMatchesOffer
} from "@/lib/radio-syndication-general-boundary.mjs";
import {
  canManageRadioSyndication,
  redactedRadioSyndicationAgreement,
  redactedRadioSyndicationOffer
} from "@/lib/radio-syndication.mjs";

export const radioSyndicationOfferInclude = {
  network: { select: { id: true, name: true, status: true } },
  sourceNetworkAgreement: { select: { id: true, status: true, stationNetworkId: true, stationId: true, stationOrganisationId: true } },
  sourceOrganisation: { select: { id: true, name: true } },
  sourceStation: {
    select: {
      id: true, name: true, slug: true, status: true,
      streamConfig: { select: { streamUrl: true } }
    }
  },
  sourceChannel: { select: { id: true, name: true, status: true, stationId: true } },
  sourcePodcastEpisode: {
    select: {
      id: true, organisationId: true, title: true, status: true,
      series: { select: { stationId: true, product: true } },
      mediaAsset: { select: { id: true, organisationId: true, status: true } }
    }
  },
  agreements: {
    // A receiving station can become a private facility after the agreement
    // was signed. Never serialize its station/channel or free-text details in
    // the general syndication workspace after that transition.
    where: {
      targetStation: { is: GENERAL_STUDIO_STATION_WHERE },
      OR: [{ targetChannelId: null }, { targetChannel: { is: GENERAL_STUDIO_CHANNEL_WHERE } }]
    },
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
  if (!resolveEntitlements(organisation.subscription).onlineRadioEnabled) return { ok: false, status: 403, error: "Online Radio access is required to use syndication." };
  return { ok: true, context, organisation, membership: context.membership, user: context.user };
}

export async function activeRadioNetworkMemberships(organisationId) {
  return prisma.stationNetworkAgreement.findMany({
    where: {
      stationOrganisationId: organisationId, status: "ACTIVE", network: { status: "ACTIVE" },
      station: { is: { status: "ACTIVE", ...GENERAL_STUDIO_STATION_WHERE } }
    },
    orderBy: [{ network: { name: "asc" } }, { station: { name: "asc" } }],
    include: {
      network: { select: { id: true, name: true, status: true } },
      station: { select: { id: true, name: true, slug: true, status: true, channels: { where: { status: "ACTIVE", ...GENERAL_STUDIO_CHANNEL_WHERE }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } } } }
    }
  });
}

export async function loadRadioSyndicationWorkspace(access) {
  const organisationId = access.organisation.id;
  const memberships = await activeRadioNetworkMemberships(organisationId);
  const networkIds = [...new Set(memberships.map((membership) => membership.stationNetworkId))];
  const stationIds = [...new Set(memberships.map((membership) => membership.stationId))];
  const [offers, episodes, ownedOfferStubs] = await Promise.all([
    networkIds.length ? prisma.radioSyndicationOffer.findMany({
      where: {
        stationNetworkId: { in: networkIds },
        AND: [
          GENERAL_RADIO_SYNDICATION_SOURCE_WHERE,
          { OR: [
            { sourceOrganisationId: organisationId },
            { status: "AVAILABLE" },
            { agreements: { some: { targetOrganisationId: organisationId } } }
          ] }
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
        series: { is: {
          product: "ONLINE_RADIO", stationId: { in: stationIds },
          station: { is: { status: "ACTIVE", ...GENERAL_STUDIO_STATION_WHERE } },
          OR: [{ channelId: null }, { channel: { is: GENERAL_STUDIO_CHANNEL_WHERE } }]
        } },
        mediaAsset: { is: { organisationId, status: "READY", ...GENERAL_STUDIO_MEDIA_ASSET_WHERE } }
      },
      orderBy: { publishedAt: "desc" },
      take: 150,
      select: { id: true, title: true, publishedAt: true, mediaAsset: { select: { durationSeconds: true } }, series: { select: { stationId: true, title: true } } }
    }) : [],
    // Keep a metadata-free withdrawal control for old offers whose source has
    // since become private or otherwise unavailable, even if the original
    // network station no longer appears in the general-product membership list.
    prisma.radioSyndicationOffer.findMany({
      where: { sourceOrganisationId: organisationId, status: { not: "WITHDRAWN" } },
      select: { id: true, kind: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 250
    })
  ]);
  const safeOffers = offers.filter(generalRadioSyndicationSourceMatchesOffer);
  // Check owner rows independently of the catalogue's page limit. Otherwise a
  // perfectly valid owner offer beyond that page could be mislabelled private.
  const eligibleOwnedRows = ownedOfferStubs.length ? await prisma.radioSyndicationOffer.findMany({
    where: { id: { in: ownedOfferStubs.map(({ id }) => id) }, AND: [GENERAL_RADIO_SYNDICATION_SOURCE_WHERE] },
    select: {
      id: true, stationNetworkId: true, sourceOrganisationId: true, sourceStationId: true,
      kind: true, sourcePodcastEpisodeId: true, sourceChannelId: true,
      sourceNetworkAgreement: { select: { stationNetworkId: true, stationId: true, stationOrganisationId: true } },
      sourceChannel: { select: { id: true, stationId: true } },
      sourcePodcastEpisode: { select: {
        id: true, organisationId: true, series: { select: { stationId: true } },
        mediaAsset: { select: { organisationId: true } }
      } }
    }
  }) : [];
  const eligibleOwnedIds = new Set(eligibleOwnedRows.filter(generalRadioSyndicationSourceMatchesOffer).map(({ id }) => id));
  const unavailableOwnOffers = ownedOfferStubs.filter(({ id }) => !eligibleOwnedIds.has(id)).map((offer) => ({
    id: offer.id, kind: offer.kind, status: offer.status,
    title: "Source unavailable in general syndication", ownOffer: true,
    unavailableSource: true, agreements: []
  }));
  const myAgreements = safeOffers.flatMap((offer) => offer.agreements.filter((agreement) => agreement.targetOrganisationId === organisationId).map((agreement) => ({
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
    offers: [
      ...safeOffers.map((offer) => redactedRadioSyndicationOffer(offer, { activeOrganisationId: organisationId })),
      ...unavailableOwnOffers
    ],
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
