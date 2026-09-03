import {
  adminAnalyticsPeriod,
  analyticsChange,
  buildAdminDailySeries,
  classifyServiceFamily,
  normaliseAdminAnalyticsRange,
  sumAdminAnalyticsSeries
} from "@/lib/admin-analytics.mjs";

const OPEN_INCIDENTS = ["OPEN", "ACKNOWLEDGED"];
const OPEN_SUPPORT = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"];

function countGroup(rows, status) {
  return rows.find((row) => row.status === status)?._count?._all || 0;
}

function serviceMix(subscriptions) {
  const counts = new Map();
  for (const subscription of subscriptions) {
    const family = classifyServiceFamily(subscription);
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  return ["Retail / In-house Radio", "School Radio", "Complete Online Radio"].map((label) => ({ label, value: counts.get(label) || 0 }));
}

function serialiseOrganisationActivity(rows, organisations) {
  const names = new Map(organisations.map((item) => [item.id, item.name]));
  return rows
    .map((row) => ({
      id: row.organisationId,
      name: names.get(row.organisationId) || "Unknown organisation",
      completed: row._sum.playbackCompletedCount || 0,
      failed: (row._sum.playbackFailedCount || 0) + (row._sum.playbackInterruptedCount || 0)
    }))
    .sort((left, right) => right.completed - left.completed)
    .slice(0, 5);
}

function serialiseStationActivity(rows, channels) {
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
  const stations = new Map();
  for (const row of rows) {
    const channel = channelMap.get(row.channelId);
    if (!channel?.station) continue;
    const current = stations.get(channel.station.id) || {
      id: channel.station.id,
      name: channel.station.name,
      organisationName: channel.organisation.name,
      completed: 0
    };
    current.completed += row._count._all || 0;
    stations.set(current.id, current);
  }
  return [...stations.values()].sort((left, right) => right.completed - left.completed).slice(0, 5);
}

export async function getAdminAnalyticsSnapshot(prismaClient, { range = 14, now = new Date(), includeRestrictedOperations = true } = {}) {
  const days = normaliseAdminAnalyticsRange(range);
  const period = adminAnalyticsPeriod(days, now);
  const offlineCutoff = new Date(now.getTime() - 5 * 60 * 1000);
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const offlineWhere = {
    enrolledAt: { not: null },
    status: { not: "DISABLED" },
    OR: [{ status: "OFFLINE" }, { lastHeartbeatAt: { lt: offlineCutoff } }, { lastHeartbeatAt: null }]
  };
  const supportWhere = { status: { in: OPEN_SUPPORT } };

  const [
    organisationCount,
    subscriptions,
    stationStatusRows,
    configuredPlayerCount,
    onlinePlayerCount,
    liveStreamCount,
    openSupportCount,
    supportTickets,
    activityRows,
    leaseRows,
    organisationActivityRows,
    channelActivityRows,
    offlinePlayerCount,
    offlinePlayers,
    playerIncidentCount,
    streamIncidentCount,
    deadLetterJobCount,
    recentOrganisations,
    completedPlayback24h
  ] = await Promise.all([
    prismaClient.organisation.count(),
    prismaClient.subscription.findMany({
      where: { status: { in: ["ACTIVE", "TRIAL"] } },
      select: { schoolRadioEnabled: true, plan: { select: { name: true, code: true, schoolRadioEnabled: true } } }
    }),
    prismaClient.station.groupBy({ by: ["status"], _count: { _all: true } }),
    prismaClient.player.count({ where: { status: { not: "DISABLED" } } }),
    prismaClient.player.count({ where: { status: "ONLINE" } }),
    prismaClient.playerListenerLease.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    prismaClient.supportTicket.count({ where: supportWhere }),
    prismaClient.supportTicket.findMany({
      where: supportWhere,
      orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
      take: 5,
      select: { id: true, reference: true, subject: true, priority: true, status: true, updatedAt: true, organisation: { select: { name: true } } }
    }),
    prismaClient.analyticsHourlyAggregate.groupBy({
      by: ["bucketStart"],
      where: { bucketStart: { gte: period.previousStart, lte: now } },
      _sum: { playbackCompletedCount: true, playbackFailedCount: true, playbackInterruptedCount: true, heartbeatCount: true },
      orderBy: { bucketStart: "asc" }
    }),
    prismaClient.playerListenerLease.findMany({
      where: { createdAt: { gte: period.previousStart, lte: now } },
      select: { createdAt: true }
    }),
    prismaClient.analyticsHourlyAggregate.groupBy({
      by: ["organisationId"],
      where: { bucketStart: { gte: period.currentStart, lte: now } },
      _sum: { playbackCompletedCount: true, playbackFailedCount: true, playbackInterruptedCount: true }
    }),
    prismaClient.proofOfPlayEvent.groupBy({
      by: ["channelId"],
      where: { occurredAt: { gte: period.currentStart, lte: now }, eventType: "COMPLETED", channelId: { not: null } },
      _count: { _all: true }
    }),
    prismaClient.player.count({ where: offlineWhere }),
    prismaClient.player.findMany({
      where: offlineWhere,
      orderBy: { lastHeartbeatAt: "asc" },
      take: 5,
      select: { id: true, name: true, status: true, lastHeartbeatAt: true, organisation: { select: { name: true } }, zone: { select: { name: true, location: { select: { name: true } } } } }
    }),
    prismaClient.playerHealthIncident.count({ where: { status: { in: OPEN_INCIDENTS } } }),
    prismaClient.stationStreamHealthIncident.count({ where: { status: { in: OPEN_INCIDENTS } } }),
    includeRestrictedOperations ? prismaClient.job.count({ where: { status: "DEAD_LETTER" } }) : Promise.resolve(0),
    prismaClient.organisation.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { subscription: { include: { plan: true } }, _count: { select: { locations: true, stations: true, players: true } } }
    }),
    prismaClient.proofOfPlayEvent.count({ where: { eventType: "COMPLETED", occurredAt: { gte: last24Hours } } })
  ]);

  const currentActivityRows = activityRows.filter((row) => row.bucketStart >= period.currentStart);
  const previousActivityRows = activityRows.filter((row) => row.bucketStart < period.currentStart);
  const currentLeases = leaseRows.filter((row) => row.createdAt >= period.currentStart);
  const previousLeases = leaseRows.filter((row) => row.createdAt < period.currentStart);
  const series = buildAdminDailySeries({ aggregateRows: currentActivityRows, leaseRows: currentLeases, startDate: period.currentStart, days });
  const previousSeries = buildAdminDailySeries({ aggregateRows: previousActivityRows, leaseRows: previousLeases, startDate: period.previousStart, days });
  const periodTotals = sumAdminAnalyticsSeries(series);
  const previousTotals = sumAdminAnalyticsSeries(previousSeries);

  const organisationIds = organisationActivityRows.map((row) => row.organisationId);
  const channelIds = channelActivityRows.map((row) => row.channelId).filter(Boolean);
  const [activityOrganisations, activityChannels] = await Promise.all([
    organisationIds.length ? prismaClient.organisation.findMany({ where: { id: { in: organisationIds } }, select: { id: true, name: true } }) : [],
    channelIds.length ? prismaClient.channel.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, organisation: { select: { name: true } }, station: { select: { id: true, name: true } } }
    }) : []
  ]);

  const attention = {
    offlinePlayers: offlinePlayerCount,
    openSupportTickets: openSupportCount,
    playerIncidents: playerIncidentCount,
    streamIncidents: streamIncidentCount,
    deadLetterJobs: deadLetterJobCount
  };

  return {
    filters: { days, from: period.currentStart.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
    totals: {
      organisations: organisationCount,
      activeSubscriptions: subscriptions.length,
      activeStations: countGroup(stationStatusRows, "ACTIVE"),
      configuredPlayers: configuredPlayerCount,
      onlinePlayers: onlinePlayerCount,
      liveStreams: liveStreamCount,
      completedPlayback24h
    },
    periodTotals,
    previousTotals,
    changes: {
      completed: analyticsChange(periodTotals.completed, previousTotals.completed),
      sessions: analyticsChange(periodTotals.sessionStarts, previousTotals.sessionStarts)
    },
    series,
    serviceMix: serviceMix(subscriptions),
    stationStatus: stationStatusRows.map((row) => ({ label: row.status.replaceAll("_", " "), value: row._count._all })),
    topOrganisations: serialiseOrganisationActivity(organisationActivityRows, activityOrganisations),
    topStations: serialiseStationActivity(channelActivityRows, activityChannels),
    attention,
    offlinePlayers,
    supportTickets,
    recentOrganisations
  };
}
