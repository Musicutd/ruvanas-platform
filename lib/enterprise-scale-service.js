import { enterpriseScaleReadiness } from "./enterprise-scale.mjs";
import { deploymentIdentity } from "./operational-observability.mjs";
import { getOperationalHealth, recordServiceHeartbeat } from "./operational-observability-service.js";

const WEB_STARTED_AT = new Date();
const WEB_IDENTITY = deploymentIdentity({ service: "WEB", startedAt: WEB_STARTED_AT });
export const ENTERPRISE_SCALE_ENTITY_TYPE = "EnterpriseScaleReadiness";
export const ENTERPRISE_SCALE_EVIDENCE_ACTION = "ENTERPRISE_SCALE_EVIDENCE_RECORDED";

export function enterpriseScaleEntityId(environment = WEB_IDENTITY.environment) {
  return `enterprise-scale:${environment}`;
}

export async function getEnterpriseScaleReport(prismaClient, { now = new Date(), identity = WEB_IDENTITY } = {}) {
  await recordServiceHeartbeat(prismaClient, { identity, now, details: { runtime: "nextjs" } });
  const entityId = enterpriseScaleEntityId(identity.environment);
  const [operational, organisations, stations, channels, players, activePlayerSessions, activePublicSessions, mediaAssets, events] = await Promise.all([
    getOperationalHealth(prismaClient, { now, webIdentity: identity }),
    prismaClient.organisation.count(),
    prismaClient.station.count(),
    prismaClient.channel.count(),
    prismaClient.player.count({ where: { status: { not: "DISABLED" }, enrolledAt: { not: null } } }),
    prismaClient.playerListenerLease.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    prismaClient.publicListenerLease.count({ where: { expiresAt: { gt: now } } }),
    prismaClient.mediaAsset.count(),
    prismaClient.auditLog.findMany({
      where: { entityType: ENTERPRISE_SCALE_ENTITY_TYPE, entityId, action: ENTERPRISE_SCALE_EVIDENCE_ACTION },
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    })
  ]);
  return enterpriseScaleReadiness({
    environment: identity.environment,
    operational,
    inventory: { organisations, stations, channels, players, activeListenerSessions: activePlayerSessions + activePublicSessions, mediaAssets },
    events,
    now
  });
}
