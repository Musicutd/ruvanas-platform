import { GENERAL_STUDIO_CHANNEL_WHERE } from "./studio-general-output-boundary.mjs";

const CHANNEL_TARGET_TYPES = new Set([
  "SCHOOL", "CHANNEL", "HEALTH_CHANNEL", "FAITH_CHANNEL", "ORGANISATIONS_CHANNEL"
]);

// GeneratedPlaylist stores polymorphic target IDs without Prisma relations.
// Resolve them in batches before exposing or changing historical drafts so a
// mislabeled private target does not enter the ordinary subscriber workspace.
export async function generalGeneratedPlaylistIds(database, organisationId, playlists) {
  const candidates = playlists.filter((playlist) => playlist.rightsUse !== "CORRECTIONS_RADIO");
  const locationIds = [...new Set(candidates.filter((playlist) => playlist.targetType === "LOCATION").map((playlist) => playlist.targetId))];
  const zoneIds = [...new Set(candidates.filter((playlist) => playlist.targetType === "ZONE").map((playlist) => playlist.targetId))];
  const channelIds = [...new Set(candidates.filter((playlist) => CHANNEL_TARGET_TYPES.has(playlist.targetType)).map((playlist) => playlist.targetId))];
  const [locations, zones, channels] = await Promise.all([
    locationIds.length ? database.location.findMany({
      where: { id: { in: locationIds }, organisationId, correctionsFacility: { is: null } }, select: { id: true }
    }) : [],
    zoneIds.length ? database.zone.findMany({
      where: { id: { in: zoneIds }, location: { organisationId, correctionsFacility: { is: null } } }, select: { id: true }
    }) : [],
    channelIds.length ? database.channel.findMany({
      where: { id: { in: channelIds }, organisationId, ...GENERAL_STUDIO_CHANNEL_WHERE }, select: { id: true }
    }) : []
  ]);
  const allowedLocations = new Set(locations.map(({ id }) => id));
  const allowedZones = new Set(zones.map(({ id }) => id));
  const allowedChannels = new Set(channels.map(({ id }) => id));
  return new Set(candidates.filter((playlist) =>
    (playlist.targetType === "LOCATION" && allowedLocations.has(playlist.targetId)) ||
    (playlist.targetType === "ZONE" && allowedZones.has(playlist.targetId)) ||
    (CHANNEL_TARGET_TYPES.has(playlist.targetType) && allowedChannels.has(playlist.targetId))
  ).map(({ id }) => id));
}

// Filter each bounded metadata page before applying the public result limit.
// Limiting first would let newer historical private drafts crowd ordinary
// playlists out of the workspace even though those private rows are hidden.
export async function listGeneralGeneratedPlaylistIds(database, organisationId, { limit = 100, pageSize = 200 } = {}) {
  const ids = [];
  let cursor;
  while (ids.length < limit) {
    const page = await database.generatedPlaylist.findMany({
      where: { organisationId, status: { not: "ARCHIVED" }, rightsUse: { not: "CORRECTIONS_RADIO" } },
      select: { id: true, targetType: true, targetId: true, rightsUse: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (!page.length) break;
    const allowed = await generalGeneratedPlaylistIds(database, organisationId, page);
    for (const playlist of page) {
      if (allowed.has(playlist.id)) ids.push(playlist.id);
      if (ids.length === limit) break;
    }
    if (page.length < pageSize) break;
    cursor = page.at(-1).id;
  }
  return ids;
}
