import { deploymentIdentity, heartbeatState, operationalReadiness, safeInstanceKey } from "./operational-observability.mjs";
import { PLAYER_OFFLINE_AFTER_SECONDS } from "./player-tokens.mjs";

const UNRESOLVED = ["OPEN", "ACKNOWLEDGED"];
const count = (groups, status) => groups.find((item) => item.status === status)?._count?._all || 0;

export async function recordServiceHeartbeat(prismaClient, { identity, now = new Date(), details = null }) {
  return prismaClient.operationalServiceHeartbeat.upsert({
    where: { service_environment_instanceId: { service: identity.service, environment: identity.environment, instanceId: identity.instanceId } },
    create: { ...identity, startedAt: identity.startedAt, lastSeenAt: now, details },
    update: { version: identity.version, commitSha: identity.commitSha, startedAt: identity.startedAt, lastSeenAt: now, details }
  });
}

export async function getOperationalHealth(prismaClient, { now = new Date(), env = process.env, webIdentity = deploymentIdentity({ service: "WEB", env, startedAt: now }) } = {}) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const playerCutoff = new Date(now.getTime() - PLAYER_OFFLINE_AFTER_SECONDS * 1000);
  const expectedServices = ["WEB", "OPERATIONS_WORKER"];
  if (["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"].every((key) => env[key]?.trim())) expectedServices.push("AUDIO_WORKER");

  const [heartbeats, jobs, webhooks, totalPlayers, onlinePlayers, playerIncidents, streamIncidents, streamConfigs, audioRenders, signageJobs, latestProof, oldestJob, oldestWebhook] = await Promise.all([
    prismaClient.operationalServiceHeartbeat.findMany({ where: { environment: webIdentity.environment, lastSeenAt: { gte: dayAgo } }, orderBy: { lastSeenAt: "desc" }, take: 50 }),
    prismaClient.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prismaClient.outgoingWebhookEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    prismaClient.player.count({ where: { status: { not: "DISABLED" }, enrolledAt: { not: null } } }),
    prismaClient.player.count({ where: { status: { not: "DISABLED" }, enrolledAt: { not: null }, lastHeartbeatAt: { gt: playerCutoff } } }),
    prismaClient.playerHealthIncident.groupBy({ by: ["severity"], where: { status: { in: UNRESOLVED } }, _count: { _all: true } }),
    prismaClient.stationStreamHealthIncident.groupBy({ by: ["severity"], where: { status: { in: UNRESOLVED } }, _count: { _all: true } }),
    prismaClient.stationStreamConfig.count({ where: { probeEnabled: true } }),
    prismaClient.audioRender.groupBy({ by: ["status"], where: { createdAt: { gte: dayAgo } }, _count: { _all: true } }),
    prismaClient.digitalSignageVideoJob.groupBy({ by: ["status"], where: { createdAt: { gte: dayAgo } }, _count: { _all: true } }),
    prismaClient.proofOfPlayEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    prismaClient.job.findFirst({ where: { status: { in: ["QUEUED", "RETRY_SCHEDULED"] } }, orderBy: { availableAt: "asc" }, select: { availableAt: true } }),
    prismaClient.outgoingWebhookEvent.findFirst({ where: { status: { in: ["PENDING", "FAILED"] } }, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } })
  ]);

  const currentHeartbeats = heartbeats.filter((item) => heartbeatState(item.lastSeenAt, now) === "CURRENT");
  const currentServices = new Set(currentHeartbeats.map((item) => item.service));
  currentServices.add("WEB");
  const missingServices = expectedServices.filter((service) => !currentServices.has(service));
  const activeVersions = new Set([webIdentity.version, ...currentHeartbeats.map((item) => item.version)]);
  const recentMediaFailures = count(audioRenders, "FAILED") + count(signageJobs, "FAILED");
  const offlinePlayers = Math.max(0, totalPlayers - onlinePlayers);
  const criticalPlayerIncidents = playerIncidents.find((item) => item.severity === "CRITICAL")?._count?._all || 0;
  const criticalStreamIncidents = streamIncidents.find((item) => item.severity === "CRITICAL")?._count?._all || 0;
  const readiness = operationalReadiness({
    missingServices,
    mixedVersions: activeVersions.size > 1,
    deadLetterJobs: count(jobs, "DEAD_LETTER"),
    abandonedWebhooks: count(webhooks, "ABANDONED"),
    criticalPlayerIncidents,
    criticalStreamIncidents,
    recentMediaFailures,
    offlinePlayers
  });

  const instances = [
    { ...webIdentity, lastSeenAt: now, state: "CURRENT" },
    ...heartbeats.filter((item) => !(item.service === "WEB" && item.instanceId === webIdentity.instanceId)).map((item) => ({ ...item, state: heartbeatState(item.lastSeenAt, now) }))
  ].map((item) => ({ service: item.service, environment: item.environment, version: item.version, commitSha: item.commitSha, instanceKey: safeInstanceKey(item.instanceId), startedAt: item.startedAt, lastSeenAt: item.lastSeenAt, state: item.state }));

  return {
    generatedAt: now,
    status: readiness.status,
    findings: readiness.findings,
    deployment: { environment: webIdentity.environment, webVersion: webIdentity.version, activeVersions: [...activeVersions].sort(), mixedVersions: activeVersions.size > 1, expectedServices, missingServices, instances },
    queues: {
      jobs: { queued: count(jobs, "QUEUED"), leased: count(jobs, "LEASED"), retryScheduled: count(jobs, "RETRY_SCHEDULED"), deadLetter: count(jobs, "DEAD_LETTER"), oldestPendingAt: oldestJob?.availableAt || null },
      webhooks: { pending: count(webhooks, "PENDING"), failed: count(webhooks, "FAILED"), abandoned: count(webhooks, "ABANDONED"), oldestPendingAt: oldestWebhook?.nextAttemptAt || null }
    },
    players: { total: totalPlayers, online: onlinePlayers, offline: offlinePlayers, unresolvedIncidents: playerIncidents.reduce((sum, item) => sum + item._count._all, 0), criticalIncidents: criticalPlayerIncidents },
    streams: { monitored: streamConfigs, unresolvedIncidents: streamIncidents.reduce((sum, item) => sum + item._count._all, 0), criticalIncidents: criticalStreamIncidents },
    media: { windowHours: 24, audioQueued: count(audioRenders, "QUEUED"), audioRunning: count(audioRenders, "RUNNING"), audioFailed: count(audioRenders, "FAILED"), signageQueued: count(signageJobs, "QUEUED"), signageRunning: count(signageJobs, "RUNNING"), signageFailed: count(signageJobs, "FAILED") },
    proof: { latestReceivedAt: latestProof?.receivedAt || null, ingestLagSeconds: latestProof ? Math.max(0, Math.floor((now.getTime() - latestProof.receivedAt.getTime()) / 1000)) : null }
  };
}
