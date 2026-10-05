// School editorial tools are not a path into supervised Corrections evidence.
// Check every historical link, not just the source that is currently selected
// in the UI. A previously approved row can become private after it was saved.
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE, assertGeneralStudioAudioProject, lockGeneralStudioMediaAssets } from "./studio-general-asset-boundary.mjs";
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
  const mediaIds = [...new Set(items.flatMap((item) => [
    item.sourceMediaAssetId, item.sourceTrack?.mediaAssetId,
    item.sourcePromoVersion?.mediaAssetId, item.sourceAnnouncement?.promoVersion?.mediaAssetId,
    item.sourceTake?.mediaAssetId
  ]).filter(Boolean))];
  try {
    // A media-only item can still be an older render/take/clip of a project
    // that C3 is making private. Voice-project IDs alone are not sufficient.
    await lockGeneralStudioMediaAssets(tx, organisationId, mediaIds);
  } catch (error) {
    if (error?.code !== "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") throw error;
    return false;
  }
  return Boolean(await tx.schoolRundown.findFirst({
    where: { id: rundownId, organisationId, ...generalSchoolRundownWhere(organisationId) }, select: { id: true }
  }));
}

// An item added to a rundown is not covered by the rundown's existing-source
// locks yet. Lock its proposed project/media in the same order as Corrections
// Guard, then verify that its source still points at those locked rows. The
// caller must re-run the ordinary School source predicate after this check.
export async function lockGeneralSchoolItemSource(tx, organisationId, item) {
  const unavailable = () => Object.assign(new Error("The selected School source is unavailable. Refresh and try again."), { status: 404 });
  let projectId = null;
  let mediaAssetId = null;
  let takeId = null;
  let versionId = null;
  let announcementId = null;

  if (item.type === "VOICE_TRACK") {
    const take = await tx.audioTake.findFirst({ where: { id: item.sourceTakeId, organisationId }, select: { projectId: true, mediaAssetId: true } });
    if (!take) throw unavailable();
    takeId = item.sourceTakeId;
    projectId = take.projectId;
    mediaAssetId = take.mediaAssetId;
  } else if (item.type === "INTERVIEW") {
    mediaAssetId = item.sourceMediaAssetId;
  } else if (item.type === "JINGLE") {
    const version = await tx.promoVersion.findFirst({ where: { id: item.sourcePromoVersionId, promoAsset: { organisationId } }, select: { mediaAssetId: true } });
    if (!version) throw unavailable();
    versionId = item.sourcePromoVersionId;
    mediaAssetId = version.mediaAssetId;
  } else if (item.type === "ANNOUNCEMENT") {
    const announcement = await tx.schoolAnnouncement.findFirst({ where: { id: item.sourceAnnouncementId, organisationId }, select: { promoVersionId: true, promoVersion: { select: { mediaAssetId: true } } } });
    if (!announcement) throw unavailable();
    announcementId = item.sourceAnnouncementId;
    versionId = announcement.promoVersionId;
    mediaAssetId = announcement.promoVersion.mediaAssetId;
  } else {
    // Licensed catalogue tracks are global. Notes and markers have no source.
    return;
  }

  if (!mediaAssetId) throw unavailable();
  await lockGeneralStudioMediaAssets(tx, organisationId, [mediaAssetId]);
  // The source helper already holds every associated project lock. Retain the
  // exact voice-project tenant/privacy check before accepting its take.
  if (projectId) await assertGeneralStudioAudioProject(tx, organisationId, projectId);
  if (takeId) {
    const takeRows = await tx.$queryRaw`SELECT "id" FROM "AudioTake" WHERE "id" = ${takeId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (takeRows.length !== 1 || !await tx.audioTake.findFirst({ where: { id: takeId, organisationId, projectId, mediaAssetId }, select: { id: true } })) throw unavailable();
  }
  if (versionId) {
    const versionRows = await tx.$queryRaw`SELECT "id" FROM "PromoVersion" WHERE "id" = ${versionId} AND "mediaAssetId" = ${mediaAssetId} FOR UPDATE`;
    if (versionRows.length !== 1) throw unavailable();
  }
  if (announcementId) {
    const announcementRows = await tx.$queryRaw`SELECT "id" FROM "SchoolAnnouncement" WHERE "id" = ${announcementId} AND "organisationId" = ${organisationId} AND "promoVersionId" = ${versionId} FOR UPDATE`;
    if (announcementRows.length !== 1) throw unavailable();
  }
  if (announcementId && !await tx.schoolAnnouncement.findFirst({ where: { id: announcementId, organisationId, promoVersionId: versionId }, select: { id: true } })) throw unavailable();
  if (versionId && !await tx.promoVersion.findFirst({ where: { id: versionId, mediaAssetId }, select: { id: true } })) throw unavailable();
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
