import { NEWSROOM_PRODUCTS } from "./newsroom.mjs";

// A Corrections submission locks its source project and media before making
// either private. Hold those same rows until the newsroom write commits, then
// evaluate the full story predicate against the committed state after the lock.
export async function lockVisibleNewsroomStory(tx, {
  organisationId, storyId, product, visibleWhere, include,
  additionalProjectId = null, additionalMediaAssetId = null
}) {
  const rows = await tx.$queryRaw`SELECT "id" FROM "SchoolNewsStory" WHERE "id" = ${storyId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  if (rows.length !== 1) return null;
  const source = await tx.schoolNewsStory.findFirst({
    where: { id: storyId, organisationId, product },
    select: {
      stationId: true, episodeId: true, audioProjectId: true, interviewMediaAssetId: true,
      revisions: { select: { audioProjectId: true, interviewMediaAssetId: true } }
    }
  });
  if (!source) return null;

  const projectIds = [source.audioProjectId, additionalProjectId, ...source.revisions.map((revision) => revision.audioProjectId)];
  const mediaIds = [source.interviewMediaAssetId, additionalMediaAssetId, ...source.revisions.map((revision) => revision.interviewMediaAssetId)];

  if (product === NEWSROOM_PRODUCTS.ONLINE_RADIO && source.stationId) {
    await tx.$queryRaw`SELECT "id" FROM "Station" WHERE "id" = ${source.stationId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    // Station lock prevents new channels; channel locks prevent rights or
    // facility assignments from changing during the visibility recheck.
    await tx.$queryRaw`SELECT "id" FROM "Channel" WHERE "stationId" = ${source.stationId} ORDER BY "id" FOR UPDATE`;
  }

  if (product === NEWSROOM_PRODUCTS.SCHOOL_RADIO && source.episodeId) {
    await tx.$queryRaw`SELECT "id" FROM "SchoolEpisode" WHERE "id" = ${source.episodeId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    const rundown = await tx.schoolRundown.findFirst({
      where: { episodeId: source.episodeId, organisationId }, select: { id: true }
    });
    if (rundown) {
      await tx.$queryRaw`SELECT "id" FROM "SchoolRundown" WHERE "id" = ${rundown.id} AND "organisationId" = ${organisationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "SchoolRundownItem" WHERE "rundownId" = ${rundown.id} ORDER BY "id" FOR UPDATE`;
      const items = await tx.schoolRundownItem.findMany({
        where: { rundownId: rundown.id }, select: {
          sourceMediaAssetId: true,
          sourceTrack: { select: { mediaAssetId: true } },
          sourcePromoVersion: { select: { mediaAssetId: true } },
          sourceAnnouncement: { select: { promoVersion: { select: { mediaAssetId: true } } } },
          sourceTake: { select: { projectId: true, mediaAssetId: true } }
        }
      });
      for (const item of items) {
        projectIds.push(item.sourceTake?.projectId);
        mediaIds.push(item.sourceMediaAssetId, item.sourceTrack?.mediaAssetId,
          item.sourcePromoVersion?.mediaAssetId, item.sourceAnnouncement?.promoVersion?.mediaAssetId,
          item.sourceTake?.mediaAssetId);
      }
    }
  }

  for (const projectId of [...new Set(projectIds.filter(Boolean))].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${projectId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  }
  for (const mediaAssetId of [...new Set(mediaIds.filter(Boolean))].sort()) {
    // Global catalogue audio is shared and stays available in School rundowns.
    await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${mediaAssetId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  }
  return tx.schoolNewsStory.findFirst({
    where: { id: storyId, organisationId, product, ...visibleWhere }, include
  });
}
