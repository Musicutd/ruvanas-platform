import { generalStudioMediaAssetIds } from "./studio-general-asset-boundary.mjs";
import { generalStudioChannelIds, generalStudioStationIds } from "./studio-general-output-boundary.mjs";

// Agreements can outlive a change to the source audio or either station.
// Recheck the current general-product boundary before delivering any bytes.
export async function generalRadioSyndicationDeliveryAllowed(database, agreement) {
  const offer = agreement?.offer;
  if (!offer?.sourceOrganisationId || !offer.sourceStationId ||
      !agreement?.targetOrganisationId || !agreement.targetStationId) return false;

  const sourceAssetId = offer.kind === "RECORDED_PROGRAMME"
    ? offer.sourcePodcastEpisode?.mediaAsset?.id
    : null;
  if (offer.kind === "RECORDED_PROGRAMME" &&
      (!sourceAssetId || offer.sourcePodcastEpisode.organisationId !== offer.sourceOrganisationId)) return false;

  const [sourceStations, targetStations, sourceChannels, targetChannels, sourceAssets] = await Promise.all([
    generalStudioStationIds(database, offer.sourceOrganisationId, [offer.sourceStationId]),
    generalStudioStationIds(database, agreement.targetOrganisationId, [agreement.targetStationId]),
    generalStudioChannelIds(database, offer.sourceOrganisationId, [offer.sourceChannelId]),
    generalStudioChannelIds(database, agreement.targetOrganisationId, [agreement.targetChannelId]),
    generalStudioMediaAssetIds(database, offer.sourceOrganisationId, [sourceAssetId])
  ]);
  return sourceStations.has(offer.sourceStationId) &&
    targetStations.has(agreement.targetStationId) &&
    (!offer.sourceChannelId || sourceChannels.has(offer.sourceChannelId)) &&
    (!agreement.targetChannelId || targetChannels.has(agreement.targetChannelId)) &&
    (offer.kind !== "RECORDED_PROGRAMME" || sourceAssets.has(sourceAssetId));
}
