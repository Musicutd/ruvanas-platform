import {
  probeStreamEndpoint,
  STREAM_INCIDENT_FAILURE_THRESHOLD,
  streamHealthBucketStart,
  streamHealthSummary,
  streamIncidentSeverity
} from "./stream-source-health.mjs";

const UNRESOLVED = ["OPEN", "ACKNOWLEDGED"];

function dueForProbe(config, now) {
  if (!config.probeEnabled || !config.streamUrl) return false;
  if (!config.lastProbeAt) return true;
  return now.getTime() - new Date(config.lastProbeAt).getTime() >= config.probeIntervalSeconds * 1_000;
}

export async function probeStationStream(prismaClient, config, { now = new Date(), fetchImpl, lookupImpl } = {}) {
  if (!config?.station?.id || !config.streamUrl) throw new Error("A configured station stream is required.");
  const result = await probeStreamEndpoint(config.streamUrl, {
    timeoutMs: config.probeTimeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(lookupImpl ? { lookupImpl } : {})
  });
  const healthy = result.status === "HEALTHY";
  const bucketStart = streamHealthBucketStart(now);

  return prismaClient.$transaction(async (tx) => {
    const changedConfig = await tx.stationStreamConfig.update({
      where: { id: config.id },
      data: {
        sourceConnectionStatus: healthy ? "CONNECTED" : "ERROR",
        lastProbeAt: now,
        lastSuccessfulProbeAt: healthy ? now : undefined,
        lastConnectedAt: healthy ? now : undefined,
        lastHeartbeatAt: healthy ? now : undefined,
        consecutiveFailures: healthy ? 0 : { increment: 1 },
        lastProbeHttpStatus: result.httpStatus,
        lastProbeLatencyMs: result.latencyMs,
        lastProbeContentType: result.contentType,
        lastError: healthy ? null : result.errorCode
      }
    });

    await tx.stationStreamHealthSample.upsert({
      where: { streamConfigId_bucketStart: { streamConfigId: config.id, bucketStart } },
      create: {
        organisationId: config.station.organisationId,
        stationId: config.station.id,
        streamConfigId: config.id,
        bucketStart,
        observedAt: now,
        status: result.status,
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus,
        contentType: result.contentType,
        errorCode: result.errorCode
      },
      update: {
        observedAt: now,
        status: result.status,
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus,
        contentType: result.contentType,
        errorCode: result.errorCode
      }
    });

    const incident = await tx.stationStreamHealthIncident.findFirst({
      where: { stationId: config.station.id, status: { in: UNRESOLVED } },
      orderBy: { firstObservedAt: "desc" }
    });

    if (healthy) {
      if (incident) {
        const resolutionNote = "Automatically resolved after the public stream source returned healthy audio headers.";
        await tx.stationStreamHealthIncident.update({
          where: { id: incident.id },
          data: { status: "RESOLVED", lastObservedAt: now, resolvedAt: now, resolutionNote, resolvedById: null }
        });
        await tx.auditLog.create({
          data: {
            organisationId: config.station.organisationId,
            action: "STATION_STREAM_INCIDENT_AUTO_RESOLVED",
            entityType: "StationStreamHealthIncident",
            entityId: incident.id,
            details: { stationId: config.station.id, recoveredAt: now.toISOString() }
          }
        });
      }
      return { stationId: config.station.id, status: result.status, consecutiveFailures: 0, incident: incident ? "RESOLVED" : null, probe: result };
    }

    const severity = streamIncidentSeverity(changedConfig.consecutiveFailures);
    if (incident) {
      await tx.stationStreamHealthIncident.update({
        where: { id: incident.id },
        data: {
          lastObservedAt: now,
          severity,
          details: { providerKey: config.providerKey, consecutiveFailures: changedConfig.consecutiveFailures, errorCode: result.errorCode, httpStatus: result.httpStatus }
        }
      });
      if (severity !== incident.severity) {
        await tx.auditLog.create({
          data: {
            organisationId: config.station.organisationId,
            action: "STATION_STREAM_INCIDENT_ESCALATED",
            entityType: "StationStreamHealthIncident",
            entityId: incident.id,
            details: { stationId: config.station.id, fromSeverity: incident.severity, toSeverity: severity, consecutiveFailures: changedConfig.consecutiveFailures }
          }
        });
      }
      return { stationId: config.station.id, status: result.status, consecutiveFailures: changedConfig.consecutiveFailures, incident: "UPDATED", probe: result };
    }

    if (changedConfig.consecutiveFailures < STREAM_INCIDENT_FAILURE_THRESHOLD) {
      return { stationId: config.station.id, status: result.status, consecutiveFailures: changedConfig.consecutiveFailures, incident: null, probe: result };
    }

    const opened = await tx.stationStreamHealthIncident.create({
      data: {
        organisationId: config.station.organisationId,
        stationId: config.station.id,
        severity,
        firstObservedAt: now,
        lastObservedAt: now,
        summary: `${config.station.name} stream source failed repeated public health probes.`,
        details: { providerKey: config.providerKey, consecutiveFailures: changedConfig.consecutiveFailures, errorCode: result.errorCode, httpStatus: result.httpStatus }
      }
    });
    await tx.auditLog.create({
      data: {
        organisationId: config.station.organisationId,
        action: "STATION_STREAM_INCIDENT_OPENED",
        entityType: "StationStreamHealthIncident",
        entityId: opened.id,
        details: { stationId: config.station.id, severity, consecutiveFailures: changedConfig.consecutiveFailures }
      }
    });
    return { stationId: config.station.id, status: result.status, consecutiveFailures: changedConfig.consecutiveFailures, incident: "OPENED", probe: result };
  });
}

export async function scanStationStreamHealth(prismaClient, { now = new Date(), fetchImpl, lookupImpl } = {}) {
  const configs = await prismaClient.stationStreamConfig.findMany({
    where: { probeEnabled: true, streamUrl: { not: null } },
    include: { station: { select: { id: true, organisationId: true, name: true } } },
    orderBy: [{ lastProbeAt: "asc" }, { createdAt: "asc" }],
    take: 100
  });
  const due = configs.filter((config) => dueForProbe(config, now));
  const results = [];
  const queue = [...due];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const config = queue.shift();
      if (config) results.push(await probeStationStream(prismaClient, config, { now, fetchImpl, lookupImpl }));
    }
  });
  await Promise.all(workers);
  return {
    scanned: results.length,
    healthy: results.filter((result) => result.status === "HEALTHY").length,
    failing: results.filter((result) => result.status !== "HEALTHY").length,
    opened: results.filter((result) => result.incident === "OPENED").length,
    resolved: results.filter((result) => result.incident === "RESOLVED").length
  };
}

export async function getStreamHealthOperations(prismaClient, { now = new Date() } = {}) {
  const [stations, incidents] = await Promise.all([
    prismaClient.station.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        organisation: { select: { id: true, name: true } },
        streamConfig: {
          select: {
            id: true,
            providerKey: true,
            streamUrl: true,
            backupStreamUrl: true,
            probeEnabled: true,
            probeIntervalSeconds: true,
            probeTimeoutMs: true,
            sourceConnectionStatus: true,
            lastProbeAt: true,
            lastSuccessfulProbeAt: true,
            consecutiveFailures: true,
            lastProbeHttpStatus: true,
            lastProbeLatencyMs: true,
            lastProbeContentType: true,
            lastError: true,
            healthSamples: { orderBy: { observedAt: "desc" }, take: 6 }
          }
        }
      }
    }),
    prismaClient.stationStreamHealthIncident.findMany({
      orderBy: [{ status: "asc" }, { severity: "desc" }, { lastObservedAt: "desc" }],
      take: 100,
      include: {
        organisation: { select: { id: true, name: true } },
        station: { select: { id: true, name: true } },
        acknowledgedBy: { select: { id: true, name: true, email: true } },
        resolvedBy: { select: { id: true, name: true, email: true } }
      }
    })
  ]);
  return { generatedAt: now, summary: streamHealthSummary(stations, incidents), stations, incidents };
}
