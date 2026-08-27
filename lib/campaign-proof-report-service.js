import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  aggregateCampaignProof,
  campaignProofCsv,
  normaliseCampaignProofFilters,
  reportUtcQueryWindow
} from "@/lib/campaign-proof-report.mjs";

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const MAX_EXPORT_ROWS = 100_000;

export async function loadCampaignProofReport(organisationId, inputFilters = {}) {
  const filters = normaliseCampaignProofFilters(inputFilters);
  const window = reportUtcQueryWindow(filters);
  const intentWhere = {
    organisationId,
    campaignId: { not: null },
    plannedStart: { gte: window.from, lt: window.until }
  };
  if (filters.campaignId) intentWhere.campaignId = filters.campaignId;
  if (filters.promoVersionId) intentWhere.promoVersionId = filters.promoVersionId;
  if (filters.locationId) intentWhere.locationId = filters.locationId;

  const intents = await prisma.playoutIntent.findMany({
    where: intentWhere,
    orderBy: { plannedStart: "desc" },
    include: {
      campaign: { select: { id: true, name: true } },
      promoVersion: {
        select: {
          id: true,
          version: true,
          promoAsset: { select: { name: true } }
        }
      }
    }
  });
  const intentIds = intents.map((intent) => intent.id);
  const events = intentIds.length
    ? await prisma.proofOfPlayEvent.findMany({
        where: {
          organisationId,
          itemType: "PROMO",
          playoutIntentId: { in: intentIds }
        },
        select: {
          playoutIntentId: true,
          scheduleItemId: true,
          eventType: true
        }
      })
    : [];
  return aggregateCampaignProof({ intents, events, filters });
}

export async function loadCampaignProofDimensions(organisationId) {
  const [campaigns, locations, groups] = await Promise.all([
    prisma.campaign.findMany({
      where: { organisationId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        promoVersionId: true,
        promoVersion: { select: { version: true, promoAsset: { select: { name: true } } } }
      }
    }),
    prisma.location.findMany({
      where: { organisationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    }),
    prisma.locationGroup.findMany({
      where: { organisationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    })
  ]);
  return { campaigns, locations, locationGroups: groups };
}

export async function createCampaignProofExportJob({ organisationId, requestedByUserId, filters }) {
  const normalised = normaliseCampaignProofFilters(filters);
  return prisma.$transaction(async (tx) => {
    const job = await tx.reportExportJob.create({
      data: {
        organisationId,
        requestedByUserId,
        filters: normalised,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS)
      },
      select: { id: true, status: true, createdAt: true, expiresAt: true }
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId: requestedByUserId,
        action: "CAMPAIGN_PROOF_EXPORT_REQUESTED",
        entityType: "ReportExportJob",
        entityId: job.id,
        details: { reportType: "CAMPAIGN_PROOF_CSV", filters: normalised }
      }
    });
    return job;
  });
}

export async function processCampaignProofExportJob(jobId) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.reportExportJob.updateMany({
    where: {
      id: jobId,
      availableAt: { lte: now },
      OR: [
        { status: "QUEUED", leaseUntil: null },
        { status: "PROCESSING", leaseUntil: { lt: now } }
      ]
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      startedAt: now,
      leaseUntil,
      errorMessage: null
    }
  });
  if (claimed.count !== 1) return false;

  const job = await prisma.reportExportJob.findUnique({ where: { id: jobId } });
  if (!job) return false;
  try {
    const report = await loadCampaignProofReport(job.organisationId, job.filters);
    if (report.rows.length > MAX_EXPORT_ROWS) {
      throw new Error("ReportRowLimitExceeded");
    }
    const csv = campaignProofCsv(report);
    const contentSha256 = crypto.createHash("sha256").update(csv).digest("hex");
    await prisma.$transaction([
      prisma.reportExportJob.update({
        where: { id: job.id },
        data: {
          status: "READY",
          csvContent: csv,
          contentSha256,
          rowCount: report.rows.length,
          completedAt: new Date(),
          leaseUntil: null
        }
      }),
      prisma.auditLog.create({
        data: {
          organisationId: job.organisationId,
          actorUserId: job.requestedByUserId,
          action: "CAMPAIGN_PROOF_EXPORT_COMPLETED",
          entityType: "ReportExportJob",
          entityId: job.id,
          details: { rowCount: report.rows.length, contentSha256 }
        }
      })
    ]);
    return true;
  } catch (error) {
    await prisma.$transaction([
      prisma.reportExportJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorMessage: "The report could not be generated.",
          completedAt: new Date(),
          leaseUntil: null
        }
      }),
      prisma.auditLog.create({
        data: {
          organisationId: job.organisationId,
          actorUserId: job.requestedByUserId,
          action: "CAMPAIGN_PROOF_EXPORT_FAILED",
          entityType: "ReportExportJob",
          entityId: job.id,
          details: { safeError: error instanceof Error ? error.name : "UnknownError" }
        }
      })
    ]);
    return false;
  }
}

export async function getCampaignProofExportJob({ jobId, organisationId, requestedByUserId }) {
  const job = await prisma.reportExportJob.findFirst({
    where: { id: jobId, organisationId, requestedByUserId, reportType: "CAMPAIGN_PROOF_CSV" }
  });
  if (!job) return null;
  if (job.expiresAt <= new Date() && job.status !== "EXPIRED") {
    return prisma.reportExportJob.update({
      where: { id: job.id },
      data: { status: "EXPIRED", csvContent: null }
    });
  }
  return job;
}
