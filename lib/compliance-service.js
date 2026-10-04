import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  auditExportSealHash,
  auditLogCsv,
  normalizeRetentionPolicy,
  retentionCutoffs
} from "@/lib/compliance-operations.mjs";
import { signAnalyticsExport } from "@/lib/operational-analytics.mjs";
import { hasCorrectionsEvidence } from "@/lib/trial-organisation-deletion.mjs";

const AUDIT_REPORT_TYPE = "AUDIT_LOG_CSV";
const EXPORT_TTL_MS = 24 * 60 * 60 * 1_000;

function validDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date.`);
  return date;
}

export function normalizeAuditWindow(input = {}, now = new Date()) {
  const untilAt = input.untilAt ? validDate(input.untilAt, "Until") : now;
  const fromAt = input.fromAt ? validDate(input.fromAt, "From") : new Date(untilAt.getTime() - 30 * 86_400_000);
  if (fromAt >= untilAt) throw new Error("From must be earlier than until.");
  if (untilAt.getTime() - fromAt.getTime() > 366 * 86_400_000) throw new Error("Audit exports are limited to 366 days.");
  return { fromAt, untilAt };
}

export async function createAuditExport({ organisationId, requestedByUserId, window, requestId }) {
  const { fromAt, untilAt } = normalizeAuditWindow(window);
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.reportExportJob.create({
      data: {
        organisationId,
        requestedByUserId,
        reportType: AUDIT_REPORT_TYPE,
        filters: { fromAt: fromAt.toISOString(), untilAt: untilAt.toISOString() },
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS)
      }
    });
    await tx.auditLog.create({
      data: { organisationId, actorUserId: requestedByUserId, action: "AUDIT_EXPORT_REQUESTED", entityType: "ReportExportJob", entityId: created.id, details: { fromAt, untilAt, requestId } }
    });
    return created;
  });
  await processAuditExport(job.id);
  return getAuditExport(job.id, organisationId, requestedByUserId);
}

export async function processAuditExport(jobId) {
  const claimed = await prisma.reportExportJob.updateMany({
    where: { id: jobId, reportType: AUDIT_REPORT_TYPE, status: "QUEUED" },
    data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: new Date(), leaseUntil: new Date(Date.now() + 5 * 60 * 1_000) }
  });
  if (claimed.count !== 1) return false;
  const job = await prisma.reportExportJob.findUnique({ where: { id: jobId } });
  if (!job) return false;
  try {
    const { fromAt, untilAt } = normalizeAuditWindow(job.filters);
    const rows = await prisma.auditLog.findMany({
      where: { organisationId: job.organisationId, createdAt: { gte: fromAt, lt: untilAt } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true, action: true, entityType: true, entityId: true, actorUserId: true, actorServiceAccountId: true, details: true }
    });
    const csv = auditLogCsv(rows);
    const contentSha256 = crypto.createHash("sha256").update(csv).digest("hex");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit-export-seal:${job.organisationId}`}))`;
      const previous = await tx.auditExportSeal.findFirst({ where: { organisationId: job.organisationId }, orderBy: { sequence: "desc" }, select: { sealHash: true } });
      const sealHash = auditExportSealHash({ previousSealHash: previous?.sealHash, organisationId: job.organisationId, exportJobId: job.id, contentSha256, rowCount: rows.length, fromAt, untilAt });
      await tx.reportExportJob.update({ where: { id: job.id }, data: { status: "READY", csvContent: csv, contentSha256, rowCount: rows.length, completedAt: new Date(), leaseUntil: null } });
      await tx.auditExportSeal.create({ data: { organisationId: job.organisationId, exportJobId: job.id, previousSealHash: previous?.sealHash || null, contentSha256, sealHash, rowCount: rows.length, fromAt, untilAt } });
      await tx.auditLog.create({ data: { organisationId: job.organisationId, actorUserId: job.requestedByUserId, action: "AUDIT_EXPORT_COMPLETED", entityType: "ReportExportJob", entityId: job.id, details: { rowCount: rows.length, contentSha256, sealHash } } });
    });
    return true;
  } catch (error) {
    await prisma.$transaction([
      prisma.reportExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage: "The audit export could not be generated.", completedAt: new Date(), leaseUntil: null } }),
      prisma.auditLog.create({ data: { organisationId: job.organisationId, actorUserId: job.requestedByUserId, action: "AUDIT_EXPORT_FAILED", entityType: "ReportExportJob", entityId: job.id, details: { safeError: error instanceof Error ? error.name : "UnknownError" } } })
    ]);
    return false;
  }
}

export async function getAuditExport(jobId, organisationId, requestedByUserId) {
  const job = await prisma.reportExportJob.findFirst({
    where: { id: jobId, organisationId, requestedByUserId, reportType: AUDIT_REPORT_TYPE },
    include: { auditSeal: true }
  });
  if (!job) return null;
  if (job.expiresAt <= new Date() && job.status !== "EXPIRED") {
    return prisma.reportExportJob.update({ where: { id: job.id }, data: { status: "EXPIRED", csvContent: null }, include: { auditSeal: true } });
  }
  return job;
}

export function auditExportDownloadUrl(job) {
  const token = signAnalyticsExport({ jobId: job.id, organisationId: job.organisationId, requestedByUserId: job.requestedByUserId, expiresAt: job.expiresAt }, process.env.SESSION_SECRET);
  return `/api/admin/compliance/audit-exports/${job.id}/download?organisationId=${encodeURIComponent(job.organisationId)}&token=${token}`;
}

export class CorrectionsRetentionPreviewError extends Error {
  constructor() {
    super("This organisation has Ruvanas Inside access or evidence. Its generic age-based retention preview is unavailable until an approved Corrections policy and legal-hold review exist.");
    this.name = "CorrectionsRetentionPreviewError";
    this.code = "CORRECTIONS_RETENTION_PREVIEW_BLOCKED";
  }
}

export async function createRetentionPreview({ organisationId, requestedByUserId, policy: policyInput, requestId, database = prisma }) {
  const policy = normalizeRetentionPolicy(policyInput);
  const cutoffs = retentionCutoffs(policy);
  // The preview writes only a job, but its `candidateCounts` must never be
  // mistaken for an approved Inside deletion set. Match trial deletion's
  // parent/subscription lock order. Use ReadCommitted so an evidence row
  // committed while waiting for the Organisation lock is visible afterwards;
  // Serializable would keep the older snapshot taken before the wait.
  return database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "organisationId" = ${organisationId} FOR UPDATE`;
    const organisation = await tx.organisation.findUnique({
      where: { id: organisationId },
      select: { id: true, subscription: { select: {
        correctionsRadioEnabled: true,
        complimentaryCorrectionsRadioEnabled: true,
        complimentaryPlanProductFamily: true,
        plan: { select: { productFamily: true, correctionsRadioEnabled: true } }
      } } }
    });
    if (!organisation) throw Object.assign(new Error("Organisation not found."), { code: "RETENTION_PREVIEW_ORGANISATION_NOT_FOUND" });
    if (await hasCorrectionsEvidence(tx, organisation)) throw new CorrectionsRetentionPreviewError();

    const [proofOfPlayEvents, inactivePlayers, audioProjects, supportTickets, auditLogs] = await Promise.all([
      tx.proofOfPlayEvent.count({ where: { organisationId, occurredAt: { lt: new Date(cutoffs.rawPlaybackDays) } } }),
      tx.player.count({ where: { organisationId, lastHeartbeatAt: { lt: new Date(cutoffs.playerHeartbeatDays) } } }),
      tx.audioProject.count({ where: { organisationId, updatedAt: { lt: new Date(cutoffs.audioProjectDays) } } }),
      tx.supportTicket.count({ where: { organisationId, updatedAt: { lt: new Date(cutoffs.supportTicketDays) } } }),
      tx.auditLog.count({ where: { organisationId, createdAt: { lt: new Date(cutoffs.auditDays) } } })
    ]);
    const candidateCounts = { proofOfPlayEvents, inactivePlayers, audioProjects, supportTickets, auditLogs };
    // Recheck after age counting to catch an existing row reclassified during
    // those reads. New child rows need an FK lock on the parent and wait for
    // this transaction. This is still a non-executable preview, not an
    // authority-approved retention/deletion decision.
    if (await hasCorrectionsEvidence(tx, organisation)) throw new CorrectionsRetentionPreviewError();
    const job = await tx.retentionJob.create({ data: { organisationId, requestedByUserId, status: "DRY_RUN_READY", dryRun: true, policySnapshot: policy, cutoffs, candidateCounts, completedAt: new Date() } });
    await tx.auditLog.create({ data: { organisationId, actorUserId: requestedByUserId, action: "RETENTION_DRY_RUN_COMPLETED", entityType: "RetentionJob", entityId: job.id, details: { candidateCounts, requestId, destructiveActionPerformed: false } } });
    return job;
  }, { isolationLevel: "ReadCommitted", timeout: 30000 });
}

