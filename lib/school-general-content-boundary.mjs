// School editorial tools are not a path into supervised Corrections evidence.
// Check every historical link, not just the source that is currently selected
// in the UI. A previously approved row can become private after it was saved.
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE, lockGeneralStudioAudioProject } from "./studio-general-asset-boundary.mjs";
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

// Scheduling is a write of an approved School source, not merely a read of a
// previously visible rundown. Take the same project/media locks used by the
// Corrections submission path, then re-evaluate its complete source predicate
// in a fresh READ COMMITTED statement. This prevents a supervised attachment
// that wins the race from being scheduled using a stale School snapshot.
export async function lockGeneralSchoolRundown(tx, organisationId, rundownId) {
  const candidate = await tx.schoolRundown.findFirst({
    where: { id: rundownId, organisationId }, select: { episodeId: true }
  });
  if (!candidate) return false;
  await tx.$queryRaw`SELECT "id" FROM "SchoolEpisode" WHERE "id" = ${candidate.episodeId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  const rows = await tx.$queryRaw`SELECT "id" FROM "SchoolRundown" WHERE "id" = ${rundownId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  if (rows.length !== 1) return false;
  await tx.$queryRaw`SELECT "id" FROM "SchoolRundownItem" WHERE "rundownId" = ${rundownId} ORDER BY "id" FOR UPDATE`;
  const items = await tx.schoolRundownItem.findMany({
    where: { rundownId }, select: {
      sourceMediaAssetId: true,
      sourceTrack: { select: { mediaAssetId: true } },
      sourcePromoVersion: { select: { mediaAssetId: true } },
      sourceAnnouncement: { select: { promoVersion: { select: { mediaAssetId: true } } } },
      sourceTake: { select: { projectId: true, mediaAssetId: true } }
    }
  });
  const projectIds = [...new Set(items.map((item) => item.sourceTake?.projectId).filter(Boolean))].sort();
  for (const projectId of projectIds) {
    try {
      await lockGeneralStudioAudioProject(tx, organisationId, projectId);
    } catch (error) {
      if (error?.code !== "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") throw error;
      return false;
    }
  }
  const mediaIds = [...new Set(items.flatMap((item) => [
    item.sourceMediaAssetId, item.sourceTrack?.mediaAssetId,
    item.sourcePromoVersion?.mediaAssetId, item.sourceAnnouncement?.promoVersion?.mediaAssetId,
    item.sourceTake?.mediaAssetId
  ]).filter(Boolean))];
  // Global catalogue tracks are shared; only lock tenant-owned source rows.
  const ownedMedia = mediaIds.length ? await tx.mediaAsset.findMany({
    where: { id: { in: mediaIds }, organisationId }, select: { id: true }
  }) : [];
  for (const mediaAssetId of ownedMedia.map(({ id }) => id).sort()) {
    await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${mediaAssetId} FOR UPDATE`;
  }
  return Boolean(await tx.schoolRundown.findFirst({
    where: { id: rundownId, organisationId, ...generalSchoolRundownWhere(organisationId) }, select: { id: true }
  }));
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
