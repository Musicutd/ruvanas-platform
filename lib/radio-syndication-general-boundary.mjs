import { GENERAL_STUDIO_MEDIA_ASSET_WHERE, generalStudioMediaAssetIds } from "./studio-general-asset-boundary.mjs";
import {
  GENERAL_STUDIO_CHANNEL_WHERE,
  GENERAL_STUDIO_STATION_WHERE,
  generalStudioChannelIds,
  generalStudioStationIds
} from "./studio-general-output-boundary.mjs";

// Filter before pagination and serialization. An offer can remain AVAILABLE
// after its station, channel, series or media becomes Corrections-private.
export const GENERAL_RADIO_SYNDICATION_SOURCE_WHERE = {
  network: { is: { status: "ACTIVE" } },
  sourceNetworkAgreement: { is: { status: "ACTIVE" } },
  sourceStation: { is: { status: "ACTIVE", ...GENERAL_STUDIO_STATION_WHERE } },
  OR: [
    {
      kind: "LIVE_RELAY",
      sourceChannel: { is: { status: "ACTIVE", ...GENERAL_STUDIO_CHANNEL_WHERE } }
    },
    {
      kind: "RECORDED_PROGRAMME",
      sourcePodcastEpisode: { is: {
        status: "PUBLISHED",
        series: { is: {
          product: "ONLINE_RADIO",
          station: { is: { status: "ACTIVE", ...GENERAL_STUDIO_STATION_WHERE } },
          OR: [{ channelId: null }, { channel: { is: GENERAL_STUDIO_CHANNEL_WHERE } }]
        } },
        mediaAsset: { is: { status: "READY", ...GENERAL_STUDIO_MEDIA_ASSET_WHERE } }
      } }
    }
  ]
};

// Historical rows are also checked for organisation and station consistency;
// those relationships are not all composite foreign keys on the offer table.
export function generalRadioSyndicationSourceMatchesOffer(offer) {
  if (!offer?.sourceOrganisationId || !offer.sourceStationId) return false;
  if (offer.sourceNetworkAgreement?.stationNetworkId !== offer.stationNetworkId ||
      offer.sourceNetworkAgreement?.stationId !== offer.sourceStationId ||
      offer.sourceNetworkAgreement?.stationOrganisationId !== offer.sourceOrganisationId) return false;
  if (offer.kind === "LIVE_RELAY") {
    return Boolean(offer.sourceChannelId &&
      offer.sourceChannel?.id === offer.sourceChannelId &&
      offer.sourceChannel?.stationId === offer.sourceStationId &&
      !offer.sourcePodcastEpisodeId);
  }
  if (offer.kind === "RECORDED_PROGRAMME") {
    return Boolean(offer.sourcePodcastEpisodeId &&
      offer.sourcePodcastEpisode?.id === offer.sourcePodcastEpisodeId &&
      offer.sourcePodcastEpisode?.organisationId === offer.sourceOrganisationId &&
      offer.sourcePodcastEpisode?.series?.stationId === offer.sourceStationId &&
      offer.sourcePodcastEpisode?.mediaAsset?.organisationId === offer.sourceOrganisationId &&
      !offer.sourceChannelId);
  }
  return false;
}

// Agreements can outlive a change to the source audio or either station.
// Recheck the current general-product boundary before delivering any bytes.
export async function generalRadioSyndicationDeliveryAllowed(database, agreement) {
  const offer = agreement?.offer;
  if (!offer?.sourceOrganisationId || !offer.sourceStationId ||
      !agreement?.targetOrganisationId || !agreement.targetStationId) return false;
  if (!generalRadioSyndicationSourceMatchesOffer(offer)) return false;

  const sourceAssetId = offer.kind === "RECORDED_PROGRAMME"
    ? offer.sourcePodcastEpisode?.mediaAsset?.id
    : null;
  if (offer.kind === "RECORDED_PROGRAMME" &&
      (!sourceAssetId || offer.sourcePodcastEpisode.organisationId !== offer.sourceOrganisationId ||
       offer.sourcePodcastEpisode.series?.stationId !== offer.sourceStationId ||
       offer.sourcePodcastEpisode.series?.product !== "ONLINE_RADIO")) return false;

  const seriesChannelId = offer.kind === "RECORDED_PROGRAMME"
    ? offer.sourcePodcastEpisode.series?.channelId
    : null;

  const [sourceStations, targetStations, sourceChannels, targetChannels, seriesChannels, sourceAssets] = await Promise.all([
    generalStudioStationIds(database, offer.sourceOrganisationId, [offer.sourceStationId]),
    generalStudioStationIds(database, agreement.targetOrganisationId, [agreement.targetStationId]),
    generalStudioChannelIds(database, offer.sourceOrganisationId, [offer.sourceChannelId]),
    generalStudioChannelIds(database, agreement.targetOrganisationId, [agreement.targetChannelId]),
    generalStudioChannelIds(database, offer.sourceOrganisationId, [seriesChannelId]),
    generalStudioMediaAssetIds(database, offer.sourceOrganisationId, [sourceAssetId])
  ]);
  return sourceStations.has(offer.sourceStationId) &&
    targetStations.has(agreement.targetStationId) &&
    (!offer.sourceChannelId || sourceChannels.has(offer.sourceChannelId)) &&
    (!agreement.targetChannelId || targetChannels.has(agreement.targetChannelId)) &&
    (!seriesChannelId || seriesChannels.has(seriesChannelId)) &&
    (offer.kind !== "RECORDED_PROGRAMME" || sourceAssets.has(sourceAssetId));
}
