import { loadStudioOnlineAuthority } from "./studio-online-authority.mjs";
import { planStudioOnlineOutput } from "./studio-online-output-plan.mjs";

function result(ready, reason) {
  // This is diagnostic eligibility only, never an encoder command or proof of play.
  return { ready, reason };
}

export async function inspectStudioOnlineHandoff(database, {
  rotation, entitlements, configuredGenres = [], workerOwner, instant = new Date(),
  authorityLoader = loadStudioOnlineAuthority
}) {
  const station = rotation?.station;
  const channel = rotation?.channel;
  if (!rotation?.ready || !station?.id || !station.organisationId || !channel?.id ||
      channel.stationId !== station.id || channel.organisationId !== station.organisationId) {
    return result(false, "SHADOW_CHANNEL_UNAVAILABLE");
  }
  try {
    // Re-read the actual lease after the worker's renewal. A pre-renewal copy
    // from the rotation cannot prove that this process still owns the station.
    const lease = await database.stationStreamConfig.findUnique({
      where: { stationId: station.id },
      select: { outboundAutoDjEnabled: true, encoderLeaseOwner: true, encoderLeaseUntil: true }
    });
    if (!lease?.outboundAutoDjEnabled || lease.encoderLeaseOwner !== workerOwner ||
        !lease.encoderLeaseUntil || new Date(lease.encoderLeaseUntil) <= instant) {
      return result(false, "SHADOW_LEASE_UNAVAILABLE");
    }
    const sessions = await database.studioPlayoutSession.findMany({
      where: { organisationId: station.organisationId, channelId: channel.id, productFamily: "ONLINE", status: "ACTIVE", mode: "MANUAL" },
      take: 2
    });
    if (sessions.length !== 1) return result(false, sessions.length ? "SHADOW_SESSIONS_AMBIGUOUS" : "SHADOW_NO_MANUAL_SESSION");
    const session = sessions[0];
    const items = await database.studioPlayoutItem.findMany({
      where: { sessionId: session.id, organisationId: station.organisationId, area: "LIVE", status: "READY" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 1
    });
    const item = items[0];
    if (!item) return result(false, "SHADOW_QUEUE_EMPTY");
    const asset = await database.mediaAsset.findFirst({
      where: { id: item.mediaAssetId, OR: [
        { organisationId: station.organisationId },
        { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }
      ] },
      include: { track: true, genres: { include: { mediaGenre: true } } }
    });
    if (!asset) return result(false, "SHADOW_ASSET_UNAVAILABLE");
    const durationMs = Math.max(Number(item.durationMs || 0), Number(asset.durationSeconds) * 1000);
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 12 * 60 * 60 * 1000) {
      return result(false, "SHADOW_INVALID_DURATION");
    }
    const authority = await authorityLoader(database, {
      organisationId: station.organisationId, stationId: station.id, channelId: channel.id, durationMs, instant
    });
    const plan = planStudioOnlineOutput({
      rotation: { ...rotation, station: { ...station, streamConfig: { ...station.streamConfig, ...lease } } },
      entitlements, session, item, asset, authority, workerOwner, configuredGenres, instant
    });
    return result(plan.ready, plan.ready ? "SHADOW_ELIGIBLE_NOT_ON_AIR" : plan.reason);
  } catch {
    return result(false, "SHADOW_CHECK_FAILED");
  }
}
