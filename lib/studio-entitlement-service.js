import { resolveEntitlements } from "./entitlements.mjs";

export async function reconcileStudioProEntitlements(database, { now = new Date() } = {}) {
  const [playoutSessions, broadcastSessions] = await Promise.all([
    database.studioPlayoutSession.findMany({ where: { OR: [{ status: "ACTIVE" }, { status: "FALLBACK", mode: { not: "AUTO" } }, { status: "FALLBACK", outputHealth: { not: "AUTODJ_FALLBACK" } }] }, select: { organisationId: true } }),
    database.studioBroadcastSession.findMany({ where: { status: "ACTIVE" }, select: { organisationId: true } })
  ]);
  const organisationIds = [...new Set([...playoutSessions, ...broadcastSessions].map((session) => session.organisationId))];
  const result = { scanned: organisationIds.length, playoutFallbacks: 0, broadcastsEnded: 0 };
  for (const organisationId of organisationIds) {
    const subscription = await database.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
    if (resolveEntitlements(subscription, now).studioProEnabled) continue;
    const [endedPlayouts, endedBroadcasts] = await Promise.all([
      database.studioPlayoutSession.findMany({ where: { organisationId, OR: [{ status: "ACTIVE" }, { status: "FALLBACK", mode: { not: "AUTO" } }, { status: "FALLBACK", outputHealth: { not: "AUTODJ_FALLBACK" } }] }, select: { id: true } }),
      database.studioBroadcastSession.findMany({ where: { organisationId, status: "ACTIVE" }, select: { id: true } })
    ]);
    const playoutIds = endedPlayouts.map((session) => session.id);
    const broadcastIds = endedBroadcasts.map((session) => session.id);
    const [playoutUpdate, _itemUpdate, broadcastUpdate] = await database.$transaction([
      database.studioPlayoutSession.updateMany({ where: { organisationId, OR: [{ status: "ACTIVE" }, { status: "FALLBACK", mode: { not: "AUTO" } }, { status: "FALLBACK", outputHealth: { not: "AUTODJ_FALLBACK" } }] }, data: { mode: "AUTO", status: "FALLBACK", outputHealth: "AUTODJ_FALLBACK", currentItemId: null, endedReason: "Studio Pro access ended; AutoDJ fallback resumed without deleting the manual queue.", revision: { increment: 1 } } }),
      database.studioPlayoutItem.updateMany({ where: { sessionId: { in: playoutIds }, status: "ON_AIR" }, data: { area: "PLAYED", status: "PLAYED", endedAt: now } }),
      database.studioBroadcastSession.updateMany({ where: { organisationId, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now, endedReason: "Studio Pro access ended; external distribution stopped safely.", revision: { increment: 1 } } }),
      database.studioBroadcastSessionDestination.updateMany({ where: { sessionId: { in: broadcastIds } }, data: { state: "STANDBY", nextReconnectAt: null, lastDisconnectedAt: now, lastSafeError: "Studio Pro access is not active." } }),
      database.studioBroadcastDestination.updateMany({ where: { organisationId, type: { in: ["ICECAST", "SHOUTCAST"] } }, data: { connectionState: "STANDBY", nextReconnectAt: null, lastDisconnectedAt: now, listenerCount: null, listenerTelemetryAt: null } }),
      database.auditLog.create({ data: { organisationId, action: "STUDIO_PRO_DOWNGRADE_RECONCILED", entityType: "Organisation", entityId: organisationId, details: { preservedProjects: true, preservedQueues: true, autoDjFallback: true, externalDistributionStopped: true } } })
    ]);
    result.playoutFallbacks += playoutUpdate.count;
    result.broadcastsEnded += broadcastUpdate.count;
  }
  return result;
}
