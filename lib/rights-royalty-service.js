import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  RIGHTS_REPORT_ATTESTATION,
  aggregateRightsUsage,
  normaliseRightsAuthority,
  normaliseRightsReportFilters,
  normaliseRightsWorkMapping,
  rightsEvidenceHash,
  rightsReportWindow,
  rightsUsageCsv
} from "@/lib/rights-royalty.mjs";

const REPORT_TYPE = "RIGHTS_ROYALTY_USAGE_CSV";
const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const MAX_EXPORT_EVENTS = 250_000;

export async function appendRightsUsageLedger(tx, { player, channel, events, tracksById, receivedAt }) {
  const completed = events.filter((event) => event.itemType === "MUSIC" && event.eventType === "COMPLETED");
  if (!completed.length) return 0;
  const proofRows = await tx.proofOfPlayEvent.findMany({
    where: { organisationId: player.organisationId, clientEventId: { in: completed.map((event) => event.eventId) }, eventType: "COMPLETED", itemType: "MUSIC" },
    select: { id: true, clientEventId: true, occurredAt: true, receivedAt: true, trackId: true, mediaAssetId: true, positionSeconds: true }
  });
  const inputById = new Map(completed.map((event) => [event.eventId, event]));
  const territoryCode = String(player.zone.location.countryCode || "ZZ").trim().toUpperCase();
  const stationId = channel?.stationId || null;
  const data = proofRows.flatMap((proof) => {
    const track = tracksById.get(proof.trackId);
    if (!track) return [];
    const input = inputById.get(proof.clientEventId);
    const entry = {
      sourceProofEventId: proof.id,
      sourceClientEventId: proof.clientEventId,
      organisationId: player.organisationId,
      playerId: player.id,
      stationId,
      channelId: channel?.id || null,
      trackId: track.id,
      mediaAssetId: track.mediaAssetId,
      occurredAt: proof.occurredAt,
      receivedAt: proof.receivedAt || receivedAt,
      durationSeconds: Math.max(0, Math.min(86_400, input?.positionSeconds ?? proof.positionSeconds ?? track.mediaAsset?.durationSeconds ?? 0)),
      territoryCode: /^[A-Z]{2}$/.test(territoryCode) ? territoryCode : "ZZ",
      rightsUse: "ONLINE_RADIO",
      trackTitle: track.title,
      trackArtist: track.artist,
      rightsHolder: track.rightsHolder || null,
      rightsReference: track.rightsReference || null,
      rightsBasis: track.rightsBasis || null
    };
    return [{ ...entry, evidenceSha256: rightsEvidenceHash(entry) }];
  });
  if (!data.length) return 0;
  const result = await tx.rightsUsageLedgerEvent.createMany({ data, skipDuplicates: true });
  return result.count;
}

export async function loadRightsRoyaltyWorkspace(organisationId) {
  const [authorities, tracks, usageSummary, recentAttestations] = await Promise.all([
    prisma.rightsReportingAuthority.findMany({ where: { organisationId }, orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, code: true, name: true, territoryCode: true, reportFormat: true, active: true, updatedAt: true, _count: { select: { workMappings: true, attestations: true } } } }),
    prisma.track.findMany({ where: { mediaAsset: { organisationId }, status: { not: "ARCHIVED" } }, orderBy: [{ artist: "asc" }, { title: "asc" }], select: { id: true, title: true, artist: true, rightsHolder: true, rightsReference: true, rightsReviewStatus: true, mediaAsset: { select: { durationSeconds: true } }, rightsWorkMappings: { where: { organisationId }, orderBy: { updatedAt: "desc" }, select: { id: true, authorityId: true, trackId: true, recordingCode: true, workCode: true, title: true, primaryArtist: true, composers: true, publishers: true, authorityReference: true, revision: true, verifiedAt: true, updatedAt: true } } } }),
    prisma.rightsUsageLedgerEvent.aggregate({ where: { organisationId }, _count: { _all: true }, _sum: { durationSeconds: true } }),
    prisma.rightsReportAttestation.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, reportExportJobId: true, statement: true, periodFrom: true, periodTo: true, rowCount: true, contentSha256: true, createdAt: true, authority: { select: { code: true, name: true } } } })
  ]);
  const mappedTrackIds = new Set(tracks.flatMap((track) => track.rightsWorkMappings.map((mapping) => mapping.trackId)));
  return {
    authorities,
    tracks,
    attestations: recentAttestations,
    summary: { ledgerEvents: usageSummary._count._all, playedSeconds: usageSummary._sum.durationSeconds || 0, catalogueTracks: tracks.length, mappedTracks: mappedTrackIds.size }
  };
}

export async function saveRightsAuthority({ organisationId, actorUserId, authorityId, input }) {
  const values = normaliseRightsAuthority(input);
  return prisma.$transaction(async (tx) => {
    const existing = authorityId ? await tx.rightsReportingAuthority.findFirst({ where: { id: authorityId, organisationId } }) : null;
    if (authorityId && !existing) throw new Error("The reporting authority could not be found in this organisation.");
    const authority = existing
      ? await tx.rightsReportingAuthority.update({ where: { id: existing.id }, data: values })
      : await tx.rightsReportingAuthority.create({ data: { ...values, organisationId, createdByUserId: actorUserId } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: existing ? "RIGHTS_AUTHORITY_UPDATED" : "RIGHTS_AUTHORITY_CREATED", entityType: "RightsReportingAuthority", entityId: authority.id, details: { code: authority.code, territoryCode: authority.territoryCode, reportFormat: authority.reportFormat, active: authority.active } } });
    return authority;
  });
}

export async function saveRightsWorkMapping({ organisationId, actorUserId, authorityId, trackId, input }) {
  return prisma.$transaction(async (tx) => {
    const [authority, track] = await Promise.all([
      tx.rightsReportingAuthority.findFirst({ where: { id: authorityId, organisationId, active: true } }),
      tx.track.findFirst({ where: { id: trackId, mediaAsset: { organisationId } } })
    ]);
    if (!authority) throw new Error("Choose an active reporting authority owned by this organisation.");
    if (!track) throw new Error("Choose a music track owned by this organisation.");
    const values = normaliseRightsWorkMapping(input, track);
    const existing = await tx.rightsWorkMapping.findUnique({ where: { authorityId_trackId: { authorityId, trackId } } });
    const mapping = existing
      ? await tx.rightsWorkMapping.update({ where: { id: existing.id }, data: { ...values, revision: { increment: 1 }, verifiedAt: values.verified ? new Date() : null, verifiedByUserId: values.verified ? actorUserId : null } })
      : await tx.rightsWorkMapping.create({ data: { ...values, organisationId, authorityId, trackId, createdByUserId: actorUserId, verifiedAt: values.verified ? new Date() : null, verifiedByUserId: values.verified ? actorUserId : null } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "RIGHTS_WORK_MAPPING_SAVED", entityType: "RightsWorkMapping", entityId: mapping.id, details: { authorityId, trackId, revision: mapping.revision, verified: Boolean(mapping.verifiedAt) } } });
    return mapping;
  });
}

export async function loadRightsRoyaltyReport(organisationId, inputFilters) {
  const filters = normaliseRightsReportFilters(inputFilters);
  const authority = await prisma.rightsReportingAuthority.findFirst({ where: { id: filters.authorityId, organisationId, active: true } });
  if (!authority) throw new Error("The selected reporting authority is unavailable.");
  const window = rightsReportWindow(filters);
  const events = await prisma.rightsUsageLedgerEvent.findMany({ where: { organisationId, territoryCode: authority.territoryCode, occurredAt: { gte: window.from, lt: window.until } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: MAX_EXPORT_EVENTS + 1 });
  if (events.length > MAX_EXPORT_EVENTS) throw new Error("This report is too large. Choose a shorter period.");
  const mappings = events.length ? await prisma.rightsWorkMapping.findMany({ where: { organisationId, authorityId: authority.id, trackId: { in: [...new Set(events.map((event) => event.trackId))] } } }) : [];
  return { filters, ...aggregateRightsUsage({ authority, events, mappings }) };
}

export async function createRightsRoyaltyExportJob({ organisationId, requestedByUserId, filters }) {
  const normalised = normaliseRightsReportFilters(filters);
  const authority = await prisma.rightsReportingAuthority.findFirst({ where: { id: normalised.authorityId, organisationId, active: true } });
  if (!authority) throw new Error("The selected reporting authority is unavailable.");
  return prisma.$transaction(async (tx) => {
    const job = await tx.reportExportJob.create({ data: { organisationId, requestedByUserId, reportType: REPORT_TYPE, filters: normalised, expiresAt: new Date(Date.now() + EXPORT_TTL_MS) } });
    await tx.auditLog.create({ data: { organisationId, actorUserId: requestedByUserId, action: "RIGHTS_REPORT_EXPORT_REQUESTED", entityType: "ReportExportJob", entityId: job.id, details: { authorityId: authority.id, from: normalised.from, to: normalised.to, attestation: RIGHTS_REPORT_ATTESTATION } } });
    return job;
  });
}

export async function processRightsRoyaltyExportJob(jobId) {
  const now = new Date();
  const claimed = await prisma.reportExportJob.updateMany({ where: { id: jobId, reportType: REPORT_TYPE, availableAt: { lte: now }, OR: [{ status: "QUEUED", leaseUntil: null }, { status: "PROCESSING", leaseUntil: { lt: now } }] }, data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: now, leaseUntil: new Date(now.getTime() + LEASE_MS), errorMessage: null } });
  if (claimed.count !== 1) return false;
  const job = await prisma.reportExportJob.findUnique({ where: { id: jobId } });
  if (!job) return false;
  try {
    const report = await loadRightsRoyaltyReport(job.organisationId, job.filters);
    const csv = rightsUsageCsv(report);
    const contentSha256 = crypto.createHash("sha256").update(csv).digest("hex");
    await prisma.$transaction(async (tx) => {
      await tx.reportExportJob.update({ where: { id: job.id }, data: { status: "READY", csvContent: csv, contentSha256, rowCount: report.rows.length, completedAt: new Date(), leaseUntil: null } });
      await tx.rightsReportAttestation.create({ data: { organisationId: job.organisationId, authorityId: report.authority.id, reportExportJobId: job.id, attestedByUserId: job.requestedByUserId, statement: RIGHTS_REPORT_ATTESTATION, periodFrom: new Date(`${report.filters.from}T00:00:00.000Z`), periodTo: new Date(`${report.filters.to}T00:00:00.000Z`), rowCount: report.rows.length, contentSha256 } });
      await tx.auditLog.create({ data: { organisationId: job.organisationId, actorUserId: job.requestedByUserId, action: "RIGHTS_REPORT_EXPORT_ATTESTED", entityType: "RightsReportAttestation", entityId: job.id, details: { authorityId: report.authority.id, rowCount: report.rows.length, contentSha256 } } });
    });
    return true;
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.reportExportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage: "The rights report could not be generated.", completedAt: new Date(), leaseUntil: null } });
      await tx.auditLog.create({ data: { organisationId: job.organisationId, actorUserId: job.requestedByUserId, action: "RIGHTS_REPORT_EXPORT_FAILED", entityType: "ReportExportJob", entityId: job.id, details: { reason: error instanceof Error ? error.message.slice(0, 300) : "Unknown report processing error" } } });
    });
    return false;
  }
}

export async function getRightsRoyaltyExportJob({ jobId, organisationId, requestedByUserId }) {
  const job = await prisma.reportExportJob.findFirst({ where: { id: jobId, organisationId, requestedByUserId, reportType: REPORT_TYPE }, include: { rightsAttestation: true } });
  if (!job || job.status === "EXPIRED" || job.expiresAt > new Date()) return job;
  return prisma.reportExportJob.update({ where: { id: job.id }, data: { status: "EXPIRED", csvContent: null }, include: { rightsAttestation: true } });
}
