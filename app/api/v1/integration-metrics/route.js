import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateServiceAccount } from "@/lib/service-account-auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  INTEGRATION_METRIC_TYPES,
  METRIC_CONNECTION_KINDS,
  metricImportNotice,
  normalizeMetricBatch
} from "@/lib/integration-metrics.mjs";

const API_LIMIT = 60;
const dimensionSchema = z.record(z.union([z.string(), z.number()])).optional().nullable();
const metricSchema = z.object({
  externalId: z.string().trim().min(1).max(160),
  locationId: z.string().cuid(),
  metricType: z.enum(INTEGRATION_METRIC_TYPES),
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(20),
  windowStartedAt: z.string().datetime(),
  windowEndedAt: z.string().datetime(),
  sourceTimestamp: z.string().datetime(),
  dimensions: dimensionSchema
});
const requestSchema = z.object({
  connectionId: z.string().cuid(),
  metrics: z.array(metricSchema).min(1).max(500)
});

function rateHeaders(rate) {
  return {
    "x-ratelimit-limit": String(API_LIMIT),
    "x-ratelimit-remaining": String(rate.remaining),
    ...(rate.allowed ? {} : { "retry-after": String(rate.retryAfterSeconds) })
  };
}

export async function POST(request) {
  try {
    const access = await authenticateServiceAccount(request, "metrics:write");
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const rate = await consumeRateLimit({ key: `integration-metrics:${access.key.id}`, limit: API_LIMIT, windowMs: 60_000 });
    if (!rate.allowed) {
      return NextResponse.json({ error: "Metric import rate limit exceeded." }, { status: 429, headers: rateHeaders(rate) });
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid summarized metric import." }, { status: 400, headers: rateHeaders(rate) });
    }

    const connection = await prisma.integrationConnection.findFirst({
      where: { id: parsed.data.connectionId, organisationId: access.organisation.id },
      select: { id: true, organisationId: true, kind: true, status: true }
    });
    if (!connection) return NextResponse.json({ error: "Metric integration connection not found." }, { status: 404, headers: rateHeaders(rate) });
    if (!METRIC_CONNECTION_KINDS.includes(connection.kind)) {
      return NextResponse.json({ error: "This connection does not accept summarized metrics." }, { status: 409, headers: rateHeaders(rate) });
    }
    if (!["CONNECTED", "DEGRADED"].includes(connection.status)) {
      return NextResponse.json({ error: "Reconnect this integration before importing metrics." }, { status: 409, headers: rateHeaders(rate) });
    }

    let metrics;
    try {
      metrics = normalizeMetricBatch(parsed.data.metrics, { connectionKind: connection.kind });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid summarized metrics." }, { status: 400, headers: rateHeaders(rate) });
    }

    const locationIds = [...new Set(metrics.map((item) => item.locationId))];
    const locationCount = await prisma.location.count({ where: { id: { in: locationIds }, organisationId: access.organisation.id } });
    if (locationCount !== locationIds.length) {
      return NextResponse.json({ error: "Every metric location must belong to the authenticated organisation." }, { status: 403, headers: rateHeaders(rate) });
    }

    const latestSourceTimestamp = new Date(Math.max(...metrics.map((item) => item.sourceTimestamp.getTime())));
    const metricTypes = [...new Set(metrics.map((item) => item.metricType))].sort();
    const result = await prisma.$transaction(async (tx) => {
      const syncRun = await tx.integrationSyncRun.create({
        data: {
          organisationId: access.organisation.id,
          connectionId: connection.id,
          status: "RUNNING",
          sourceTimestamp: latestSourceTimestamp,
          startedAt: new Date()
        }
      });
      const inserted = await tx.integrationMetricSummary.createMany({
        data: metrics.map((item) => ({
          organisationId: access.organisation.id,
          connectionId: connection.id,
          ...item
        })),
        skipDuplicates: true
      });
      const duplicateCount = metrics.length - inserted.count;
      const completedAt = new Date();
      const completedRun = await tx.integrationSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "SUCCEEDED",
          completedAt,
          summary: {
            receivedCount: metrics.length,
            acceptedCount: inserted.count,
            duplicateCount,
            metricTypes
          }
        }
      });
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: { status: "CONNECTED", lastSuccessfulSyncAt: completedAt, lastErrorAt: null, lastErrorMessage: null }
      });
      await tx.auditLog.create({
        data: {
          organisationId: access.organisation.id,
          actorServiceAccountId: access.serviceAccount.id,
          action: "INTEGRATION_METRICS_IMPORTED",
          entityType: "IntegrationConnection",
          entityId: connection.id,
          details: {
            connectionKind: connection.kind,
            receivedCount: metrics.length,
            acceptedCount: inserted.count,
            duplicateCount,
            metricTypes,
            locationCount: locationIds.length
          }
        }
      });
      return { syncRun: completedRun, acceptedCount: inserted.count, duplicateCount };
    });

    return NextResponse.json({
      syncRunId: result.syncRun.id,
      receivedCount: metrics.length,
      acceptedCount: result.acceptedCount,
      duplicateCount: result.duplicateCount,
      notice: metricImportNotice()
    }, { status: 201, headers: rateHeaders(rate) });
  } catch (error) {
    console.error("Integration metric import error:", error);
    return NextResponse.json({ error: "Unable to import summarized integration metrics." }, { status: 500 });
  }
}
