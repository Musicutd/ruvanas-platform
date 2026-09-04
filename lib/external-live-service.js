import { prisma } from "./prisma.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { enqueueNotificationEvent } from "./job-notification-service.js";
import { externalLiveAuthorizationHeaders, safeExternalLiveSource } from "./external-live.mjs";
import { probeStreamEndpoint, validatePublicStreamEndpoint } from "./stream-source-health.mjs";

export const externalLiveInclude = {
  channel: { select: { id: true, name: true, status: true, station: { select: { name: true } } } }
};

export async function listExternalLiveSources(organisationId) {
  const sources = await prisma.externalLiveSource.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, include: externalLiveInclude, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 100 });
  return sources.map(safeExternalLiveSource);
}

export async function createExternalLiveSource({ organisationId, actorUserId, input }) {
  await validatePublicStreamEndpoint(input.streamUrl);
  return prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findFirst({ where: { id: input.channelId, organisationId, status: "ACTIVE" }, select: { id: true } });
    if (!channel) throw new Error("Choose an active channel owned by this organisation.");
    const source = await tx.externalLiveSource.create({ data: {
      organisationId,
      channelId: channel.id,
      name: input.name,
      providerKey: input.providerKey,
      streamUrl: input.streamUrl,
      credentialType: input.credentialType,
      credentialUsername: input.credentialUsername,
      credentialEncrypted: input.credentialType === "NONE" ? null : encryptSecret(input.credentialSecret),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdByUserId: actorUserId
    }, include: externalLiveInclude });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "EXTERNAL_LIVE_SOURCE_CREATED", entityType: "ExternalLiveSource", entityId: source.id, details: { channelId: channel.id, providerKey: input.providerKey, credentialType: input.credentialType, hasWindow: Boolean(input.startsAt || input.endsAt) } } });
    return safeExternalLiveSource(source);
  });
}

export async function probeExternalLiveSource(database, source, { now = new Date(), fetchImpl, lookupImpl } = {}) {
  if (!source?.id || !source.streamUrl) throw new Error("A configured external live source is required.");
  let headers = {};
  try { headers = externalLiveAuthorizationHeaders(source, decryptSecret); } catch {
    const result = { status: "SKIPPED", latencyMs: 0, httpStatus: null, contentType: null, errorCode: "CREDENTIAL_UNAVAILABLE" };
    return recordExternalLiveProbe(database, source, result, now);
  }
  const result = await probeStreamEndpoint(source.streamUrl, {
    timeoutMs: 8_000,
    headers,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(lookupImpl ? { lookupImpl } : {})
  });
  return recordExternalLiveProbe(database, source, result, now);
}

async function recordExternalLiveProbe(database, source, result, now) {
  const healthy = result.status === "HEALTHY";
  return database.$transaction(async (tx) => {
    const updated = await tx.externalLiveSource.update({ where: { id: source.id }, data: {
      healthStatus: result.status,
      lastHealthCheckedAt: now,
      lastHealthyAt: healthy ? now : undefined,
      consecutiveFailures: healthy ? 0 : { increment: 1 },
      lastLatencyMs: result.latencyMs,
      lastHttpStatus: result.httpStatus,
      lastContentType: result.contentType,
      lastErrorCode: result.errorCode,
      ...(healthy && source.status === "DRAFT" ? { status: "READY" } : {})
    }, include: externalLiveInclude });
    if (!healthy && updated.consecutiveFailures === 3) {
      await enqueueNotificationEvent(tx, {
        organisationId: source.organisationId,
        type: "STREAM_ERROR",
        severity: "WARNING",
        title: "External live source unavailable",
        message: `${source.name} failed three consecutive protected health checks. Scheduled programming remains available as fallback.`,
        entityType: "ExternalLiveSource",
        entityId: source.id,
        metadata: { channelId: source.channelId, providerKey: source.providerKey, errorCode: result.errorCode },
        dedupeKey: `external-live:${source.id}:${now.toISOString().slice(0, 10)}`,
        correlationId: `external-live:${source.id}`,
        occurredAt: now
      });
    }
    return { source: safeExternalLiveSource(updated), probe: result };
  });
}

export async function probeOwnedExternalLiveSource({ organisationId, sourceId, fetchImpl, lookupImpl }) {
  const source = await prisma.externalLiveSource.findFirst({ where: { id: sourceId, organisationId, status: { not: "ARCHIVED" } }, include: externalLiveInclude });
  if (!source) return null;
  return probeExternalLiveSource(prisma, source, { fetchImpl, lookupImpl });
}

export async function activateExternalLiveSource({ organisationId, sourceId, actorUserId, now = new Date() }) {
  const checked = await probeOwnedExternalLiveSource({ organisationId, sourceId });
  if (!checked) return null;
  if (checked.probe.status !== "HEALTHY") throw new Error("The source must return healthy audio before it can go live.");
  return prisma.$transaction(async (tx) => {
    const source = await tx.externalLiveSource.findFirst({ where: { id: sourceId, organisationId, status: { in: ["READY", "SUSPENDED", "ACTIVE"] } } });
    if (!source) return null;
    if (source.startsAt && source.endsAt && source.endsAt <= now) throw new Error("This live window has already ended.");
    await tx.externalLiveSource.updateMany({ where: { organisationId, channelId: source.channelId, status: "ACTIVE", id: { not: source.id } }, data: { status: "READY", suspendedAt: now } });
    const updated = await tx.externalLiveSource.update({ where: { id: source.id }, data: { status: "ACTIVE", activatedAt: now, activatedByUserId: actorUserId, suspendedAt: null }, include: externalLiveInclude });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "EXTERNAL_LIVE_SOURCE_ACTIVATED", entityType: "ExternalLiveSource", entityId: source.id, details: { channelId: source.channelId, providerKey: source.providerKey, healthCheckedAt: checked.source.lastHealthCheckedAt } } });
    return safeExternalLiveSource(updated);
  });
}

export async function changeExternalLiveSourceStatus({ organisationId, sourceId, actorUserId, action, now = new Date() }) {
  const source = await prisma.externalLiveSource.findFirst({ where: { id: sourceId, organisationId, status: { not: "ARCHIVED" } }, select: { id: true, channelId: true, status: true } });
  if (!source) return null;
  const status = action === "ARCHIVE" ? "ARCHIVED" : "SUSPENDED";
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.externalLiveSource.update({ where: { id: source.id }, data: { status, suspendedAt: now }, include: externalLiveInclude });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: `EXTERNAL_LIVE_SOURCE_${action === "ARCHIVE" ? "ARCHIVED" : "SUSPENDED"}`, entityType: "ExternalLiveSource", entityId: source.id, details: { channelId: source.channelId, previousStatus: source.status } } });
    return changed;
  });
  return safeExternalLiveSource(updated);
}

export async function scanExternalLiveHealth(database, { now = new Date(), fetchImpl, lookupImpl } = {}) {
  const dueBefore = new Date(now.getTime() - 30_000);
  const sources = await database.externalLiveSource.findMany({ where: { status: "ACTIVE", OR: [{ lastHealthCheckedAt: null }, { lastHealthCheckedAt: { lte: dueBefore } }] }, include: externalLiveInclude, orderBy: { lastHealthCheckedAt: "asc" }, take: 50 });
  const results = [];
  for (const source of sources) results.push(await probeExternalLiveSource(database, source, { now, fetchImpl, lookupImpl }));
  return { scanned: results.length, healthy: results.filter((item) => item.probe.status === "HEALTHY").length, failing: results.filter((item) => item.probe.status !== "HEALTHY").length };
}
