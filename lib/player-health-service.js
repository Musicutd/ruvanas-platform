import { effectivePlayerStatus, PLAYER_OFFLINE_AFTER_SECONDS } from "./player-tokens.mjs";
import {
  heartbeatBucketStart,
  incidentSeverityForOfflineDuration,
  missedHeartbeatWindow,
  normalizeHeartbeatDiagnostics,
  playerHealthSummary
} from "./player-health.mjs";

const UNRESOLVED = ["OPEN", "ACKNOWLEDGED"];

export async function recordHeartbeatOperationalEvidence(tx, { player, now = new Date(), diagnostics = {} }) {
  const normalized = normalizeHeartbeatDiagnostics(diagnostics);
  const recovered = effectivePlayerStatus(player, now) === "OFFLINE";
  const bucketStart = heartbeatBucketStart(now);
  await tx.playerHeartbeatSample.upsert({
    where: { playerId_bucketStart: { playerId: player.id, bucketStart } },
    create: {
      organisationId: player.organisationId,
      playerId: player.id,
      locationId: player.zone.location.id,
      zoneId: player.zone.id,
      kind: recovered ? "RECOVERY" : "PERIODIC",
      bucketStart,
      observedAt: now,
      ...normalized
    },
    update: {
      kind: recovered ? "RECOVERY" : undefined,
      observedAt: now,
      ...normalized
    }
  });

  if (!recovered) return { recovered: false, resolvedIncidentId: null };
  const incident = await tx.playerHealthIncident.findFirst({
    where: { playerId: player.id, kind: "HEARTBEAT_MISSED", status: { in: UNRESOLVED } },
    orderBy: { firstObservedAt: "desc" }
  });
  if (!incident) return { recovered: true, resolvedIncidentId: null };
  const resolutionNote = "Automatically resolved when the enrolled player heartbeat resumed.";
  await tx.playerHealthIncident.update({
    where: { id: incident.id },
    data: { status: "RESOLVED", lastObservedAt: now, resolvedAt: now, resolutionNote, resolvedById: null }
  });
  await tx.auditLog.create({
    data: {
      organisationId: player.organisationId,
      action: "PLAYER_HEALTH_INCIDENT_AUTO_RESOLVED",
      entityType: "PlayerHealthIncident",
      entityId: incident.id,
      details: { playerId: player.id, recoveredAt: now.toISOString() }
    }
  });
  return { recovered: true, resolvedIncidentId: incident.id };
}

export async function scanPlayerHealth(prismaClient, { now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - PLAYER_OFFLINE_AFTER_SECONDS * 1000);
  const players = await prismaClient.player.findMany({
    where: {
      status: { not: "DISABLED" },
      enrolledAt: { not: null },
      lastHeartbeatAt: { not: null, lte: cutoff }
    },
    include: { zone: { include: { location: true } } }
  });
  const existing = players.length ? await prismaClient.playerHealthIncident.findMany({
    where: { playerId: { in: players.map((player) => player.id) }, kind: "HEARTBEAT_MISSED", status: { in: UNRESOLVED } }
  }) : [];
  const byPlayer = new Map(existing.map((incident) => [incident.playerId, incident]));
  let created = 0;
  let updated = 0;
  for (const player of players) {
    const window = missedHeartbeatWindow(player, now);
    if (!window) continue;
    const current = byPlayer.get(player.id);
    if (current) {
      const severity = incidentSeverityForOfflineDuration(window.durationMs);
      await prismaClient.playerHealthIncident.update({
        where: { id: current.id },
        data: { lastObservedAt: now, severity }
      });
      if (severity !== current.severity) {
        await prismaClient.auditLog.create({
          data: {
            organisationId: player.organisationId,
            action: "PLAYER_HEALTH_INCIDENT_ESCALATED",
            entityType: "PlayerHealthIncident",
            entityId: current.id,
            details: { playerId: player.id, fromSeverity: current.severity, toSeverity: severity }
          }
        });
      }
      updated += 1;
      continue;
    }
    try {
      await prismaClient.$transaction(async (tx) => {
        const incident = await tx.playerHealthIncident.create({
          data: {
            organisationId: player.organisationId,
            playerId: player.id,
            locationId: player.zone.location.id,
            zoneId: player.zone.id,
            kind: "HEARTBEAT_MISSED",
            severity: window.severity,
            status: "OPEN",
            firstObservedAt: window.firstObservedAt,
            lastObservedAt: now,
            summary: `${player.name} stopped reporting heartbeats.`,
            details: { offlineThresholdSeconds: PLAYER_OFFLINE_AFTER_SECONDS, lastHeartbeatAt: player.lastHeartbeatAt.toISOString() }
          }
        });
        await tx.auditLog.create({
          data: {
            organisationId: player.organisationId,
            action: "PLAYER_HEALTH_INCIDENT_OPENED",
            entityType: "PlayerHealthIncident",
            entityId: incident.id,
            details: { playerId: player.id, severity: incident.severity, locationId: player.zone.location.id, zoneId: player.zone.id }
          }
        });
      });
      created += 1;
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }
  }
  return { scanned: players.length, created, updated };
}

export async function getPlayerHealthOperations(prismaClient, { now = new Date() } = {}) {
  const [players, incidents] = await Promise.all([
    prismaClient.player.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        organisation: { select: { id: true, name: true } },
        zone: { include: { location: { select: { id: true, name: true } } } },
        heartbeatSamples: { orderBy: { observedAt: "desc" }, take: 6 }
      }
    }),
    prismaClient.playerHealthIncident.findMany({
      orderBy: [{ status: "asc" }, { severity: "desc" }, { lastObservedAt: "desc" }],
      take: 100,
      include: {
        organisation: { select: { id: true, name: true } },
        player: { select: { id: true, name: true } },
        acknowledgedBy: { select: { id: true, name: true, email: true } },
        resolvedBy: { select: { id: true, name: true, email: true } }
      }
    })
  ]);
  return { generatedAt: now, summary: playerHealthSummary(players, incidents, now), players, incidents };
}
