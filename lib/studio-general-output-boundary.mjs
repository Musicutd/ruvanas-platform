// General Studio live output is not a Corrections Guard review or scheduling
// path. Include historical rows whose family was never labelled, and treat a
// channel assigned to a private facility as private even if its rights are not.
import { GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "./studio-general-asset-boundary.mjs";
const privateFacilityAssignment = {
  zone: { location: { correctionsFacility: { isNot: null } } }
};

export const GENERAL_STUDIO_STATION_WHERE = {
  OR: [{ productFamily: null }, { productFamily: { not: "CORRECTIONS" } }],
  channels: {
    none: {
      OR: [
        { musicRightsUse: "CORRECTIONS_RADIO" },
        { zoneAssignments: { some: privateFacilityAssignment } }
      ]
    }
  }
};

export const GENERAL_STUDIO_CHANNEL_WHERE = {
  AND: [
    { OR: [{ musicRightsUse: null }, { musicRightsUse: { not: "CORRECTIONS_RADIO" } }] },
    { OR: [{ stationId: null }, { station: { is: GENERAL_STUDIO_STATION_WHERE } }] },
    { zoneAssignments: { none: privateFacilityAssignment } }
  ]
};

function unavailable() {
  return Object.assign(new Error("Private Ruvanas Inside output is not available in general Studio."), {
    status: 403,
    code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED"
  });
}

export async function generalStudioChannelIds(database, organisationId, channelIds) {
  const ids = [...new Set(channelIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const channels = await database.channel.findMany({
    where: { id: { in: ids }, organisationId, ...GENERAL_STUDIO_CHANNEL_WHERE },
    select: { id: true }
  });
  return new Set(channels.map(({ id }) => id));
}

export async function generalStudioStationIds(database, organisationId, stationIds) {
  const ids = [...new Set(stationIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const stations = await database.station.findMany({
    where: { id: { in: ids }, organisationId, ...GENERAL_STUDIO_STATION_WHERE },
    select: { id: true }
  });
  return new Set(stations.map(({ id }) => id));
}

export async function assertGeneralStudioChannel(database, organisationId, channelId) {
  if (!channelId || !(await generalStudioChannelIds(database, organisationId, [channelId])).has(channelId)) throw unavailable();
}

export async function assertGeneralStudioStation(database, organisationId, stationId) {
  if (!stationId || !(await generalStudioStationIds(database, organisationId, [stationId])).has(stationId)) throw unavailable();
}

export function generalStudioDestinationAllowed(destination, safeStationIds) {
  if (destination.organisationId == null) return false;
  if (destination.stationId) return safeStationIds.has(destination.stationId);
  return destination.type !== "RUVANAS_MANAGED";
}

export async function assertGeneralStudioDestination(database, organisationId, destination) {
  if (!destination || destination.organisationId !== organisationId) throw unavailable();
  const safeStationIds = await generalStudioStationIds(database, organisationId, [destination.stationId]);
  if (!generalStudioDestinationAllowed(destination, safeStationIds)) throw unavailable();
}

export async function assertGeneralStudioPlayoutSession(database, organisationId, sessionId) {
  const session = sessionId && await database.studioPlayoutSession.findFirst({
    where: { id: sessionId, organisationId }, select: { id: true, channelId: true, productFamily: true }
  });
  if (!session || session.productFamily === "CORRECTIONS") throw unavailable();
  await assertGeneralStudioChannel(database, organisationId, session.channelId);
  // Historical playout rows can predate the Corrections boundary. A previously
  // queued private take/render must not become public merely because its
  // channel still looks ordinary.
  const items = await database.studioPlayoutItem.findMany({
    where: { sessionId: session.id }, select: { mediaAssetId: true }
  });
  const assetIds = [...new Set(items.map(({ mediaAssetId }) => mediaAssetId).filter(Boolean))];
  if (assetIds.length) {
    const allowed = await database.mediaAsset.findMany({
      where: {
        id: { in: assetIds },
        OR: [{ organisationId }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }],
        ...GENERAL_STUDIO_MEDIA_ASSET_WHERE
      },
      select: { id: true }
    });
    if (allowed.length !== assetIds.length) throw unavailable();
  }
  return session;
}

export async function assertGeneralStudioBroadcastSession(database, organisationId, sessionId) {
  const session = sessionId && await database.studioBroadcastSession.findFirst({
    where: { id: sessionId, organisationId },
    include: { destinations: { include: { destination: true } } }
  });
  if (!session) throw unavailable();
  await assertGeneralStudioPlayoutSession(database, organisationId, session.playoutSessionId);
  for (const link of session.destinations) {
    await assertGeneralStudioDestination(database, organisationId, link.destination);
  }
  return session;
}
