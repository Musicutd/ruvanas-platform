import { NEWSROOM_PRODUCTS } from "./newsroom.mjs";
import { generalSchoolRundownWhere, lockGeneralSchoolRundown } from "./school-general-content-boundary.mjs";
import { lockGeneralStudioMediaAssets } from "./studio-general-asset-boundary.mjs";

// CREATE has no story row to lock yet. Lock its target rows before checking
// visibility so a concurrent Corrections reclassification cannot leave a
// newly created, already-private newsroom pitch behind.
export async function lockVisibleOnlineNewsroomCreateTargets(tx, {
  organisationId, stationId, channelId, stationWhere, channelWhere
}) {
  const rows = await tx.$queryRaw`SELECT "id" FROM "Station" WHERE "id" = ${stationId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  if (rows.length !== 1) return false;
  // The station predicate includes *every* channel, not only the selected
  // one. This also serializes a new child channel's foreign-key insertion.
  await tx.$queryRaw`SELECT "id" FROM "Channel" WHERE "stationId" = ${stationId} ORDER BY "id" FOR UPDATE`;
  const station = await tx.station.findFirst({
    where: { id: stationId, organisationId, status: { not: "CANCELLED" }, ...stationWhere },
    select: { id: true }
  });
  if (!station) return false;
  if (!channelId) return true;
  return Boolean(await tx.channel.findFirst({
    where: { id: channelId, stationId, organisationId, status: { not: "ARCHIVED" }, ...channelWhere },
    select: { id: true }
  }));
}

export async function lockVisibleSchoolNewsroomCreateTargets(tx, { organisationId, programmeId, episodeId }) {
  if (programmeId) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "SchoolProgramme" WHERE "id" = ${programmeId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (rows.length !== 1 || !await tx.schoolProgramme.findFirst({
      where: { id: programmeId, organisationId, status: "ACTIVE" }, select: { id: true }
    })) return false;
  }
  if (episodeId) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "SchoolEpisode" WHERE "id" = ${episodeId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (rows.length !== 1) return false;
    const rundown = await tx.schoolRundown.findFirst({ where: { episodeId, organisationId }, select: { id: true } });
    if (rundown && !await lockGeneralSchoolRundown(tx, organisationId, rundown.id)) return false;
    if (!await tx.schoolEpisode.findFirst({
      where: { id: episodeId, organisationId, OR: [
        { rundown: { is: null } }, { rundown: { is: generalSchoolRundownWhere(organisationId) } }
      ] }, select: { id: true }
    })) return false;
  }
  return true;
}

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
  try {
    // Media-only stories/revisions and episode items may be older outputs of
    // a different project entering Inside review. Lock all reverse projects
    // and promo intermediaries, not merely explicit story project IDs.
    await lockGeneralStudioMediaAssets(tx, organisationId, mediaIds);
  } catch (error) {
    if (error?.code !== "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") throw error;
    return null;
  }
  return tx.schoolNewsStory.findFirst({
    where: { id: storyId, organisationId, product, ...visibleWhere }, include
  });
}
