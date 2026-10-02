// School editorial tools are not a path into supervised Corrections evidence.
// Check every historical link, not just the source that is currently selected
// in the UI. A previously approved row can become private after it was saved.
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "./studio-general-asset-boundary.mjs";
import { GENERAL_STUDIO_CHANNEL_WHERE, GENERAL_STUDIO_STATION_WHERE } from "./studio-general-output-boundary.mjs";

export function generalSchoolRundownWhere(organisationId, instant = new Date()) {
  const rightsDate = new Date(instant); rightsDate.setUTCHours(0, 0, 0, 0);
  const ownedMedia = { organisationId, status: "READY", ...GENERAL_STUDIO_MEDIA_ASSET_WHERE };
  return { items: { every: { AND: [
    { OR: [{ sourceMediaAssetId: null }, { sourceMediaAsset: { is: ownedMedia } }] },
    { OR: [{ sourceTrackId: null }, { sourceTrack: { is: {
      status: "READY", isExplicit: false, permittedUses: { has: "SCHOOL_RADIO" },
      OR: [{ licenceExpiresAt: null }, { licenceExpiresAt: { gte: rightsDate } }],
      mediaAsset: { is: { organisationId: null, libraryType: "RUVANAS_CATALOGUE", status: "READY", ...GENERAL_STUDIO_MEDIA_ASSET_WHERE } }
    } } }] },
    { OR: [{ sourcePromoVersionId: null }, { sourcePromoVersion: { is: {
      status: { in: ["APPROVED", "SUPERSEDED"] }, promoAsset: { is: { organisationId, status: "ACTIVE" } },
      mediaAsset: { is: ownedMedia }
    } } }] },
    { OR: [{ sourceAnnouncementId: null }, { sourceAnnouncement: { is: {
      organisationId, status: "APPROVED", promoVersion: { is: { mediaAsset: { is: ownedMedia } } }
    } } }] },
    { OR: [{ sourceTakeId: null }, { sourceTake: { is: {
      organisationId, status: "READY", trashedAt: null,
      project: { is: { organisationId, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE } },
      mediaAsset: { is: ownedMedia }
    } } }] }
  ] } } };
}

export function generalSchoolNewsStoryWhere(organisationId) {
  const safeProject = { organisationId, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE };
  const safeMedia = { organisationId, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE };
  const safeLinks = [
    { OR: [{ audioProjectId: null }, { audioProject: { is: safeProject } }] },
    { OR: [{ interviewMediaAssetId: null }, { interviewMediaAsset: { is: safeMedia } }] }
  ];
  return { AND: [
    ...safeLinks,
    { OR: [{ stationId: null }, { station: { is: GENERAL_STUDIO_STATION_WHERE } }] },
    { OR: [{ channelId: null }, { channel: { is: GENERAL_STUDIO_CHANNEL_WHERE } }] },
    { OR: [{ episodeId: null }, { episode: { is: { OR: [
      { rundown: { is: null } }, { rundown: { is: generalSchoolRundownWhere(organisationId) } }
    ] } } }] },
    { revisions: { every: { AND: safeLinks } } }
  ] };
}
