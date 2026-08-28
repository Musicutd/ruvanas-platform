import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  ANALYTICS_EXPORT_TTL_MS,
  buildOperationalAnalyticsDeltas,
  normaliseOperationalAnalyticsFilters,
  operationalAnalyticsCsv,
  operationalAnalyticsSummary,
  operationalAnalyticsUtcWindow,
  signAnalyticsExport
} from "@/lib/operational-analytics.mjs";

const REPORT_TYPE = "OPERATIONAL_ANALYTICS_CSV";
const LEASE_MS = 5 * 60 * 1000;
const COUNT_FIELDS = [
  "plannedCount", "campaignPlannedCount", "schoolPlannedCount", "playbackStartedCount",
  "playbackCompletedCount", "playbackFailedCount", "playbackInterruptedCount",
  "musicCompletedCount", "promoCompletedCount", "schoolCompletedCount", "heartbeatCount"
];

function cursorFilter(timestampField, idField, timestamp, id) {
  if (!timestamp) return {};
  return {
    OR: [
      { [timestampField]: { gt: timestamp } },
      { [timestampField]: timestamp, id: { gt: id || "" } }
    ]
  };
}

async function applyDeltas(tx, deltas) {
  for (const delta of deltas) {
    const increments = Object.fromEntries(COUNT_FIELDS.map((field) => [field, { increment: delta[field] || 0 }]));
    await tx.analyticsHourlyAggregate.upsert({
      where: {
        organisationId_playerId_bucketStart: {
          organisationId: delta.organisationId,
          playerId: delta.playerId,
          bucketStart: delta.bucketStart
        }
      },
      create: delta,
      update: {
        playerName: delta.playerName,
        locationId: delta.locationId,
        locationName: delta.locationName,
        zoneId: delta.zoneId,
        zoneName: delta.zoneName,
        ...increments
      }
    });
  }
}

async function aggregateOneBatch(organisationId, batchSize) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operational-analytics:${organisationId}`}))`;
    const cursor = await tx.analyticsAggregationCursor.upsert({
      where: { organisationId },
      create: { organisationId },
      update: {}
    });
    const [intents, events] = await Promise.all([
      tx.playoutIntent.findMany({
        where: {
          organisationId,
          ...cursorFilter("createdAt", "id", cursor.lastIntentCreatedAt, cursor.lastIntentId)
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: {
          id: true,
          organisationId: true,
          playerId: true,
          locationId: true,
          locationName: true,
          zoneId: true,
          campaignId: true,
          schoolBroadcastSlotId: true,
          plannedStart: true,
          createdAt: true,
          player: { select: { name: true } },
          zone: { select: { name: true } }
        }
      }),
      tx.proofOfPlayEvent.findMany({
        where: {
          organisationId,
          ...cursorFilter("receivedAt", "id", cursor.lastProofReceivedAt, cursor.lastProofEventId)
        },
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: {
          id: true,
          organisationId: true,
          playerId: true,
          zoneId: true,
          itemType: true,
          eventType: true,
          occurredAt: true,
          receivedAt: true,
          playerName: true,
          locationName: true,
          zoneName: true,
          zone: { select: { locationId: true } }
        }
      })
    ]);
    await applyDeltas(tx, buildOperationalAnalyticsDeltas({ intents, events }));
    const lastIntent = intents.at(-1);
    const lastEvent = events.at(-1);
    await tx.analyticsAggregationCursor.update({
      where: { organisationId },
      data: {
        ...(lastIntent ? { lastIntentCreatedAt: lastIntent.createdAt, lastIntentId: lastIntent.id } : {}),
        ...(lastEvent ? { lastProofReceivedAt: lastEvent.receivedAt, lastProofEventId: lastEvent.id } : {})
      }
    });
    return {
      processedIntents: intents.length,
      processedEvents: events.length,
      pending: intents.length === batchSize || events.length === batchSize
    };
  });
}

export async function refreshOperationalAnalytics(organisationId, { batchSize = 1_000, maxBatches = 3 } = {}) {
  let processedIntents = 0;
  let processedEvents = 0;
  let pending = false;
  for (let index = 0; index < maxBatches; index += 1) {
    const result = await aggregateOneBatch(organisationId, batchSize);
    processedIntents += result.processedIntents;
    processedEvents += result.processedEvents;
    pending = result.pending;
    if (!pending) break;
  }
  return { processedIntents, processedEvents, pending };
}

function dayRows(hourRows) {
  const days = new Map();
  for (const row of hourRows) {
    const date = row.bucketStart.toISOString().slice(0, 10);
    const current = days.get(date) || { date, ...Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0])) };
    for (const field of COUNT_FIELDS) current[field] += Number(row._sum[field] || 0);
    days.set(date, current);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function loadSchoolAggregate(organisationId) {
  const expiryCutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);
  const [profile, programmes, episodes, assignments, submissions, assessments, portfolios, pendingReviews, consentActions] = await Promise.all([
    prisma.schoolProfile.findUnique({ where: { organisationId }, select: { id: true } }),
    prisma.schoolProgramme.count({ where: { organisationId } }),
    prisma.schoolEpisode.count({ where: { organisationId } }),
    prisma.assignment.count({ where: { organisationId } }),
    prisma.assignmentSubmission.count({ where: { organisationId } }),
    prisma.assessment.count({ where: { organisationId } }),
    prisma.portfolioEntry.count({ where: { organisationId } }),
    prisma.schoolEpisode.count({ where: { organisationId, status: "IN_REVIEW" } }),
    prisma.consentRecord.count({
      where: {
        organisationId,
        OR: [
          { status: { in: ["PENDING", "REVOKED", "EXPIRED"] } },
          { status: "GRANTED", expiresAt: { lte: expiryCutoff } }
        ]
      }
    })
  ]);
  if (!profile && [programmes, episodes, assignments, submissions, assessments, portfolios, pendingReviews, consentActions].every((count) => count === 0)) {
    return null;
  }
  return {
    programmes, episodes, assignments, submissions, assessments, portfolios, pendingReviews, consentActions,
    aggregateOnly: true,
    studentIdentitiesIncluded: false,
    rankingsIncluded: false
  };
}

export async function loadOperationalAnalyticsReport(organisationId, inputFilters = {}, aggregation = null) {
  const filters = normaliseOperationalAnalyticsFilters(inputFilters);
  const window = operationalAnalyticsUtcWindow(filters);
  const [hourRows, players, storage, content, school] = await Promise.all([
    prisma.analyticsHourlyAggregate.groupBy({
      by: ["bucketStart"],
      where: { organisationId, bucketStart: { gte: window.from, lt: window.until } },
      orderBy: { bucketStart: "asc" },
      _sum: Object.fromEntries(COUNT_FIELDS.map((field) => [field, true]))
    }),
    prisma.player.findMany({
      where: { organisationId },
      select: { status: true, lastHeartbeatAt: true }
    }),
    prisma.mediaAsset.aggregate({
      where: { organisationId, status: { in: ["UPLOADING", "PROCESSING", "READY"] } },
      _sum: { sizeBytes: true },
      _count: { id: true }
    }),
    Promise.all([
      prisma.campaign.count({ where: { organisationId } }),
      prisma.promoAsset.count({ where: { organisationId } }),
      prisma.productionOrder.count({ where: { organisationId } })
    ]),
    loadSchoolAggregate(organisationId)
  ]);
  const days = dayRows(hourRows);
  const summary = operationalAnalyticsSummary(days);
  const onlineCutoff = Date.now() - 90_000;
  const enabledPlayers = players.filter((player) => player.status !== "DISABLED" && player.status !== "PENDING_ENROLMENT");
  const onlinePlayers = enabledPlayers.filter((player) => player.lastHeartbeatAt && player.lastHeartbeatAt.getTime() >= onlineCutoff).length;
  const expectedHeartbeats = enabledPlayers.length * filters.days * 24 * 120;
  return {
    filters,
    summary,
    days,
    players: {
      enrolled: enabledPlayers.length,
      onlineNow: onlinePlayers,
      offlineNow: Math.max(0, enabledPlayers.length - onlinePlayers),
      observedHeartbeatCoverage: expectedHeartbeats > 0 ? Math.min(1, summary.heartbeatCount / expectedHeartbeats) : 0,
      coverageStartsWithStage5C: true
    },
    storage: {
      assetCount: storage._count.id,
      bytes: String(storage._sum.sizeBytes || 0)
    },
    content: { campaigns: content[0], promotions: content[1], productionOrders: content[2] },
    school,
    aggregation,
    evidenceNotice: "Playback totals are device-confirmed operational events. They are not listener, audience, impression, or reach measurements.",
    retentionNotice: "Hourly aggregate evidence is retained without automatic deletion until a jurisdiction and contract-specific retention policy is approved."
  };
}

export async function createOperationalAnalyticsExportJob({ organisationId, requestedByUserId, filters }) {
  const normalised = normaliseOperationalAnalyticsFilters(filters);
  return prisma.$transaction(async (tx) => {
    const job = await tx.reportExportJob.create({
      data: {
        organisationId,
        requestedByUserId,
        reportType: REPORT_TYPE,
        filters: normalised,
        expiresAt: new Date(Date.now() + ANALYTICS_EXPORT_TTL_MS)
      },
      select: { id: true, status: true, createdAt: true, expiresAt: true }
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId: requestedByUserId,
        action: "OPERATIONAL_ANALYTICS_EXPORT_REQUESTED",
        entityType: "ReportExportJob",
        entityId: job.id,
        details: { reportType: REPORT_TYPE, filters: normalised }
      }
    });
    return job;
  });
}

export async function processOperationalAnalyticsExportJob(jobId) {
  const now = new Date();
  const claimed = await prisma.reportExportJob.updateMany({
    where: {
      id: jobId,
      reportType: REPORT_TYPE,
      availableAt: { lte: now },
      OR: [{ status: "QUEUED", leaseUntil: null }, { status: "PROCESSING", leaseUntil: { lt: now } }]
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      startedAt: now,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      errorMessage: null
    }
  });
  if (claimed.count !== 1) return false;
  const job = await prisma.reportExportJob.findUnique({ where: { id: jobId } });
  if (!job) return false;
  try {
    const aggregation = await refreshOperationalAnalytics(job.organisationId, { maxBatches: 100 });
    if (aggregation.pending) throw new Error("AnalyticsBacklogExceeded");
    const report = await loadOperationalAnalyticsReport(job.organisationId, job.filters, aggregation);
    const csv = operationalAnalyticsCsv(report);
    const contentSha256 = crypto.createHash("sha256").update(csv).digest("hex");
    await prisma.$transaction([
      prisma.reportExportJob.update({
        where: { id: job.id },
        data: { status: "READY", csvContent: csv, contentSha256, rowCount: report.days.length, completedAt: new Date(), leaseUntil: null }
      }),
      prisma.auditLog.create({
        data: {
          organisationId: job.organisationId,
          actorUserId: job.requestedByUserId,
          action: "OPERATIONAL_ANALYTICS_EXPORT_COMPLETED",
          entityType: "ReportExportJob",
          entityId: job.id,
          details: { rowCount: report.days.length, contentSha256 }
        }
      })
    ]);
    return true;
  } catch (error) {
    await prisma.$transaction([
      prisma.reportExportJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: "The analytics export could not be generated.", completedAt: new Date(), leaseUntil: null }
      }),
      prisma.auditLog.create({
        data: {
          organisationId: job.organisationId,
          actorUserId: job.requestedByUserId,
          action: "OPERATIONAL_ANALYTICS_EXPORT_FAILED",
          entityType: "ReportExportJob",
          entityId: job.id,
          details: { safeError: error instanceof Error ? error.name : "UnknownError" }
        }
      })
    ]);
    return false;
  }
}

export async function getOperationalAnalyticsExportJob({ jobId, organisationId, requestedByUserId }) {
  const job = await prisma.reportExportJob.findFirst({
    where: { id: jobId, organisationId, requestedByUserId, reportType: REPORT_TYPE }
  });
  if (!job) return null;
  if (job.expiresAt <= new Date() && job.status !== "EXPIRED") {
    return prisma.reportExportJob.update({ where: { id: job.id }, data: { status: "EXPIRED", csvContent: null } });
  }
  return job;
}

export function operationalAnalyticsDownloadUrl(job) {
  const input = {
    jobId: job.id,
    organisationId: job.organisationId,
    requestedByUserId: job.requestedByUserId,
    expiresAt: job.expiresAt
  };
  const token = signAnalyticsExport(input, process.env.SESSION_SECRET);
  return `/api/reports/operational/exports/${job.id}/download?token=${token}`;
}

