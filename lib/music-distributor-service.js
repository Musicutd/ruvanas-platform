import { decryptSecret, encryptSecret } from "./crypto.js";
import {
  DISTRIBUTOR_CONTRACT_VERSION,
  buildDistributorUsageReport,
  distributorApiUrl,
  distributorDuplicateKey,
  distributorReconciliationAction,
  distributorRetryDelayMs,
  parseDistributorCataloguePage,
  safeDistributorErrorCode,
  validateDistributorEndpoint
} from "./music-distributor.mjs";

const MAX_CATALOGUE_PAGES = 25;
const MAX_USAGE_EVENTS = 25_000;
const REQUEST_TIMEOUT_MS = 30_000;

function credentials(connection) {
  let parsed;
  try { parsed = JSON.parse(decryptSecret(connection.clientCredentialsEncrypted)); }
  catch { throw Object.assign(new Error("The distributor credential cannot be opened."), { code: "DISTRIBUTOR_CREDENTIAL_INVALID" }); }
  if (!parsed?.clientId || !parsed?.clientSecret) throw Object.assign(new Error("The distributor credential is incomplete."), { code: "DISTRIBUTOR_CREDENTIAL_INVALID" });
  return parsed;
}

async function jsonResponse(response, label) {
  if (!response.ok) throw Object.assign(new Error(`${label} returned HTTP ${response.status}.`), { code: `DISTRIBUTOR_HTTP_${response.status}` });
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("json")) throw Object.assign(new Error(`${label} did not return JSON.`), { code: "DISTRIBUTOR_RESPONSE_NOT_JSON" });
  return response.json();
}

export function encryptDistributorCredentials({ clientId, clientSecret }) {
  return encryptSecret(JSON.stringify({ clientId: String(clientId), clientSecret: String(clientSecret) }));
}

export function safeDistributorConnection(connection) {
  if (!connection) return null;
  const { clientCredentialsEncrypted: _credentials, syncLeaseOwner: _leaseOwner, ...safe } = connection;
  return { ...safe, credentialStored: Boolean(connection.clientCredentialsEncrypted) };
}

export async function requestDistributorAccessToken(connection, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = credentials(connection);
  const tokenUrl = validateDistributorEndpoint(connection.tokenUrl, "OAuth token URL");
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (connection.oauthScopes?.length) body.set("scope", connection.oauthScopes.join(" "));
  let response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw Object.assign(new Error("The distributor OAuth service could not be reached."), { code: safeDistributorErrorCode(error, "DISTRIBUTOR_OAUTH_UNAVAILABLE") });
  }
  const result = await jsonResponse(response, "Distributor OAuth");
  if (!result?.access_token || String(result.token_type || "Bearer").toLowerCase() !== "bearer") {
    throw Object.assign(new Error("The distributor returned an invalid OAuth token response."), { code: "DISTRIBUTOR_OAUTH_INVALID" });
  }
  return { accessToken: String(result.access_token), expiresIn: Number(result.expires_in) || null };
}

export async function fetchDistributorCataloguePage(connection, { cursor = null, fetchImpl = fetch } = {}) {
  const { accessToken } = await requestDistributorAccessToken(connection, { fetchImpl });
  const url = distributorApiUrl(connection, connection.cataloguePath, { cursor, limit: 2000 });
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: `application/json; profile="${DISTRIBUTOR_CONTRACT_VERSION}"`,
        authorization: `Bearer ${accessToken}`
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw Object.assign(new Error("The distributor catalogue could not be reached."), { code: safeDistributorErrorCode(error, "DISTRIBUTOR_CATALOGUE_UNAVAILABLE") });
  }
  const payload = await jsonResponse(response, "Distributor catalogue");
  const parsed = parseDistributorCataloguePage(payload, connection);
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), { code: "DISTRIBUTOR_CATALOGUE_INVALID" });
  return parsed.data;
}

function releaseData(item, now) {
  return {
    title: item.title,
    label: item.label,
    releaseDate: item.releaseDate,
    status: item.status,
    metadataChecksum: item.metadataChecksum,
    lastSeenAt: now,
    takenDownAt: item.status === "TAKEN_DOWN" ? now : null
  };
}

function collectionData(item, now) {
  return {
    name: item.name,
    minimumCatalogueLevel: item.minimumCatalogueLevel,
    permittedTerritories: item.permittedTerritories,
    permittedUses: item.permittedUses,
    active: item.active,
    metadataChecksum: item.metadataChecksum,
    lastSeenAt: now
  };
}

function trackData(item, connectionId, releaseId, now) {
  return {
    releaseId,
    externalRecordingId: item.recordingId,
    isrc: item.isrc,
    title: item.title,
    artist: item.artist,
    album: item.album,
    label: item.label,
    genreCodes: item.genres,
    isExplicit: item.explicit,
    deliveryMode: item.delivery.mode,
    sourceUrlEncrypted: item.delivery.url ? encryptSecret(item.delivery.url) : null,
    sourceChecksumSha256: item.delivery.checksumSha256,
    sourceMimeType: item.delivery.mimeType,
    sourceSizeBytes: item.delivery.sizeBytes,
    minimumCatalogueLevel: item.minimumCatalogueLevel,
    permittedTerritories: item.permittedTerritories,
    permittedUses: item.permittedUses,
    licenceStartsAt: item.licenceStartsAt,
    licenceExpiresAt: item.licenceExpiresAt,
    rightsHolder: item.rightsHolder,
    rightsReference: item.rightsReference,
    status: item.status,
    takedownReason: item.status === "TAKEN_DOWN" ? item.takedownReason || "Distributor takedown" : null,
    takenDownAt: item.status === "TAKEN_DOWN" ? now : null,
    metadataChecksum: item.metadataChecksum,
    lastSeenAt: now
  };
}

async function reconcilePage(tx, connection, syncRun, page, now) {
  const counters = { releasesReceived: page.releases.length, tracksReceived: page.tracks.length, createdCount: 0, updatedCount: 0, unchangedCount: 0, takenDownCount: 0, rejectedCount: 0 };
  const releases = new Map();
  for (const item of page.releases) {
    const release = await tx.musicDistributorRelease.upsert({
      where: { connectionId_externalReleaseId: { connectionId: connection.id, externalReleaseId: item.id } },
      create: { connectionId: connection.id, externalReleaseId: item.id, ...releaseData(item, now) },
      update: releaseData(item, now)
    });
    releases.set(item.id, release.id);
  }
  const collections = new Map();
  for (const item of page.collections) {
    const collection = await tx.musicDistributorCollection.upsert({
      where: { connectionId_externalCollectionId: { connectionId: connection.id, externalCollectionId: item.id } },
      create: { connectionId: connection.id, externalCollectionId: item.id, ...collectionData(item, now) },
      update: collectionData(item, now)
    });
    collections.set(item.id, collection.id);
  }
  const missingReleaseIds = [...new Set(page.tracks.map((item) => item.releaseId).filter((id) => id && !releases.has(id)))];
  if (missingReleaseIds.length) {
    const existingReleases = await tx.musicDistributorRelease.findMany({
      where: { connectionId: connection.id, externalReleaseId: { in: missingReleaseIds } },
      select: { id: true, externalReleaseId: true }
    });
    for (const release of existingReleases) releases.set(release.externalReleaseId, release.id);
  }
  const referencedCollectionIds = [...new Set(page.tracks.flatMap((item) => item.collectionIds).filter((id) => !collections.has(id)))];
  if (referencedCollectionIds.length) {
    const existingCollections = await tx.musicDistributorCollection.findMany({
      where: { connectionId: connection.id, externalCollectionId: { in: referencedCollectionIds } },
      select: { id: true, externalCollectionId: true }
    });
    for (const collection of existingCollections) collections.set(collection.externalCollectionId, collection.id);
  }

  for (const item of page.tracks) {
    const existing = await tx.musicDistributorTrack.findUnique({
      where: { connectionId_externalTrackId: { connectionId: connection.id, externalTrackId: item.id } }
    });
    const duplicateKey = distributorDuplicateKey(item);
    const duplicate = duplicateKey ? await tx.musicDistributorTrack.findFirst({
      where: {
        connectionId: connection.id,
        externalTrackId: { not: item.id },
        ...(duplicateKey.startsWith("ISRC:")
          ? { isrc: duplicateKey.slice(5) }
          : { sourceChecksumSha256: duplicateKey.slice(7) })
      },
      select: { id: true, externalTrackId: true }
    }) : null;
    if (duplicate) {
      counters.rejectedCount += 1;
      if (existing) {
        await tx.musicDistributorTrack.update({ where: { id: existing.id }, data: { status: "UNAVAILABLE", takedownReason: "Duplicate supplier recording", takenDownAt: now, revision: { increment: 1 }, lastSeenAt: now } });
        if (existing.trackId) await tx.track.updateMany({ where: { id: existing.trackId }, data: { status: "ARCHIVED" } });
      }
      await tx.musicDistributorReconciliationEvent.create({ data: {
        connectionId: connection.id,
        syncRunId: syncRun.id,
        externalTrackId: item.id,
        action: "DUPLICATE",
        currentChecksum: item.metadataChecksum,
        details: { duplicateOfExternalTrackId: duplicate.externalTrackId, duplicateKey }
      } });
      continue;
    }

    const action = distributorReconciliationAction(existing, item);
    const data = trackData(item, connection.id, item.releaseId ? releases.get(item.releaseId) || null : null, now);
    const distributorTrack = await tx.musicDistributorTrack.upsert({
      where: { connectionId_externalTrackId: { connectionId: connection.id, externalTrackId: item.id } },
      create: { connectionId: connection.id, externalTrackId: item.id, ...data },
      update: { ...data, revision: existing && action !== "UNCHANGED" ? { increment: 1 } : undefined }
    });
    if (action === "CREATED") counters.createdCount += 1;
    else if (action === "UNCHANGED") counters.unchangedCount += 1;
    else counters.updatedCount += 1;
    if (action === "TAKEN_DOWN") counters.takenDownCount += 1;

    if (action === "TAKEN_DOWN" && distributorTrack.trackId) {
      await tx.track.updateMany({ where: { id: distributorTrack.trackId }, data: { status: "ARCHIVED" } });
    }
    await tx.musicDistributorCollectionTrack.deleteMany({ where: { trackId: distributorTrack.id } });
    const collectionIds = item.collectionIds.map((id) => collections.get(id)).filter(Boolean);
    if (collectionIds.length) await tx.musicDistributorCollectionTrack.createMany({ data: collectionIds.map((collectionId) => ({ collectionId, trackId: distributorTrack.id })), skipDuplicates: true });
    await tx.musicDistributorReconciliationEvent.create({ data: {
      connectionId: connection.id,
      syncRunId: syncRun.id,
      distributorTrackId: distributorTrack.id,
      externalTrackId: item.id,
      action,
      previousChecksum: existing?.metadataChecksum || null,
      currentChecksum: item.metadataChecksum,
      details: {
        isrc: item.isrc,
        releaseId: item.releaseId,
        minimumCatalogueLevel: item.minimumCatalogueLevel,
        status: item.status,
        rightsChanged: action === "RIGHTS_CHANGED"
      }
    } });
  }
  const takenDownReleaseIds = page.releases.filter((item) => item.status === "TAKEN_DOWN").map((item) => releases.get(item.id)).filter(Boolean);
  if (takenDownReleaseIds.length) {
    const affected = await tx.musicDistributorTrack.findMany({
      where: { connectionId: connection.id, releaseId: { in: takenDownReleaseIds }, status: "ACTIVE" },
      select: { id: true, trackId: true, externalTrackId: true, metadataChecksum: true }
    });
    if (affected.length) {
      await tx.musicDistributorTrack.updateMany({
        where: { id: { in: affected.map((item) => item.id) } },
        data: { status: "TAKEN_DOWN", takedownReason: "Distributor release takedown", takenDownAt: now, revision: { increment: 1 } }
      });
      const linkedTrackIds = affected.map((item) => item.trackId).filter(Boolean);
      if (linkedTrackIds.length) await tx.track.updateMany({ where: { id: { in: linkedTrackIds } }, data: { status: "ARCHIVED" } });
      await tx.musicDistributorReconciliationEvent.createMany({ data: affected.map((item) => ({
        connectionId: connection.id,
        syncRunId: syncRun.id,
        distributorTrackId: item.id,
        externalTrackId: item.externalTrackId,
        action: "TAKEN_DOWN",
        previousChecksum: item.metadataChecksum,
        currentChecksum: item.metadataChecksum,
        details: { source: "DISTRIBUTOR_RELEASE_TAKEDOWN" },
        occurredAt: now
      })) });
      counters.takenDownCount += affected.length;
      counters.updatedCount += affected.length;
    }
  }
  return counters;
}

export async function syncMusicDistributorConnection(prismaClient, connectionId, { fetchImpl = fetch, now = new Date(), kind = "DELTA" } = {}) {
  const connection = await prismaClient.musicDistributorConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status === "REVOKED") throw Object.assign(new Error("The distributor connection is unavailable."), { code: "DISTRIBUTOR_CONNECTION_UNAVAILABLE" });
  const syncRun = await prismaClient.musicDistributorSyncRun.create({ data: {
    connectionId,
    kind,
    status: "RUNNING",
    cursorBefore: kind === "FULL" ? null : connection.syncCursor,
    startedAt: now,
    attempt: connection.consecutiveFailures + 1
  } });
  const totals = { releasesReceived: 0, tracksReceived: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, takenDownCount: 0, rejectedCount: 0 };
  let cursor = kind === "FULL" ? null : connection.syncCursor;
  try {
    for (let pageNumber = 0; pageNumber < MAX_CATALOGUE_PAGES; pageNumber += 1) {
      const page = await fetchDistributorCataloguePage(connection, { cursor, fetchImpl });
      const result = await prismaClient.$transaction((tx) => reconcilePage(tx, connection, syncRun, page, now));
      for (const key of Object.keys(totals)) totals[key] += result[key];
      cursor = page.cursor || cursor;
      if (!page.hasMore) break;
      if (!page.cursor) throw Object.assign(new Error("The distributor indicated another page without supplying a cursor."), { code: "DISTRIBUTOR_CURSOR_MISSING" });
      if (pageNumber === MAX_CATALOGUE_PAGES - 1) throw Object.assign(new Error("The distributor catalogue exceeded the bounded page limit."), { code: "DISTRIBUTOR_PAGE_LIMIT" });
    }
    const nextSyncAt = new Date(now.getTime() + connection.syncIntervalMinutes * 60_000);
    await prismaClient.$transaction([
      prismaClient.musicDistributorSyncRun.update({ where: { id: syncRun.id }, data: { status: "SUCCEEDED", cursorAfter: cursor, ...totals, completedAt: now } }),
      prismaClient.musicDistributorConnection.update({ where: { id: connection.id }, data: { status: connection.status === "DRAFT" ? "DRAFT" : "ACTIVE", syncCursor: cursor, nextSyncAt, lastSuccessfulSyncAt: now, lastErrorAt: null, lastErrorCode: null, consecutiveFailures: 0 } }),
      prismaClient.auditLog.create({ data: { actorUserId: connection.createdByUserId, action: "MUSIC_DISTRIBUTOR_SYNC_SUCCEEDED", entityType: "MusicDistributorConnection", entityId: connection.id, details: { syncRunId: syncRun.id, kind, ...totals } } })
    ]);
    return { syncRunId: syncRun.id, cursor, ...totals };
  } catch (error) {
    const attempt = connection.consecutiveFailures + 1;
    const safeErrorCode = safeDistributorErrorCode(error);
    const nextRetryAt = new Date(now.getTime() + distributorRetryDelayMs(attempt));
    await prismaClient.$transaction([
      prismaClient.musicDistributorSyncRun.update({ where: { id: syncRun.id }, data: { status: "FAILED", ...totals, safeErrorCode, nextRetryAt, completedAt: now } }),
      prismaClient.musicDistributorConnection.update({ where: { id: connection.id }, data: { status: connection.status === "DRAFT" ? "DRAFT" : "DEGRADED", nextSyncAt: nextRetryAt, lastErrorAt: now, lastErrorCode: safeErrorCode, consecutiveFailures: { increment: 1 } } }),
      prismaClient.auditLog.create({ data: { actorUserId: connection.createdByUserId, action: "MUSIC_DISTRIBUTOR_SYNC_FAILED", entityType: "MusicDistributorConnection", entityId: connection.id, details: { syncRunId: syncRun.id, kind, safeErrorCode, nextRetryAt } } })
    ]);
    throw Object.assign(new Error("Distributor synchronisation failed safely."), { code: safeErrorCode });
  }
}

export async function processDueMusicDistributorSyncs(prismaClient, { workerId, fetchImpl = fetch, now = new Date(), limit = 2 } = {}) {
  const due = await prismaClient.musicDistributorConnection.findMany({
    where: {
      providerKey: { not: "PROMO_ONLY" },
      status: { in: ["ACTIVE", "DEGRADED"] },
      OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }],
      AND: [{ OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: now } }] }]
    },
    orderBy: [{ nextSyncAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(5, Number(limit) || 2))
  });
  const result = { claimed: 0, succeeded: 0, failed: 0 };
  for (const connection of due) {
    const leaseUntil = new Date(now.getTime() + 10 * 60_000);
    const claimed = await prismaClient.musicDistributorConnection.updateMany({
      where: { id: connection.id, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: now } }] },
      data: { syncLeaseOwner: workerId, syncLeaseUntil: leaseUntil }
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;
    try {
      await syncMusicDistributorConnection(prismaClient, connection.id, { fetchImpl, now, kind: connection.syncCursor ? "DELTA" : "FULL" });
      result.succeeded += 1;
    } catch { result.failed += 1; }
    finally { await prismaClient.musicDistributorConnection.updateMany({ where: { id: connection.id, syncLeaseOwner: workerId }, data: { syncLeaseOwner: null, syncLeaseUntil: null } }); }
  }
  return result;
}

export async function deliverMusicDistributorUsage(prismaClient, connectionId, { periodFrom, periodUntil, fetchImpl = fetch, now = new Date() } = {}) {
  const connection = await prismaClient.musicDistributorConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status === "REVOKED" || !connection.usageReportPath) throw Object.assign(new Error("Usage-report delivery is not configured."), { code: "DISTRIBUTOR_USAGE_NOT_CONFIGURED" });
  const from = new Date(periodFrom);
  const until = new Date(periodUntil);
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || from >= until) throw Object.assign(new Error("Choose a valid report period."), { code: "DISTRIBUTOR_USAGE_PERIOD_INVALID" });
  const existing = await prismaClient.musicDistributorUsageDelivery.findUnique({ where: { connectionId_periodFrom_periodUntil: { connectionId, periodFrom: from, periodUntil: until } } });
  let built;
  let eventCount;
  if (existing) {
    built = { report: existing.payload, payloadSha256: existing.payloadSha256, idempotencyKey: existing.idempotencyKey };
    eventCount = existing.eventCount;
  } else {
    const mapped = await prismaClient.musicDistributorTrack.findMany({ where: { connectionId, trackId: { not: null } }, select: { trackId: true, externalTrackId: true, isrc: true } });
    const mappings = new Map(mapped.map((item) => [item.trackId, item]));
    const events = mappings.size ? await prismaClient.rightsUsageLedgerEvent.findMany({
      where: { trackId: { in: [...mappings.keys()] }, occurredAt: { gte: from, lt: until } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: MAX_USAGE_EVENTS + 1,
      select: { id: true, trackId: true, occurredAt: true, durationSeconds: true, territoryCode: true, rightsUse: true }
    }) : [];
    if (events.length > MAX_USAGE_EVENTS) throw Object.assign(new Error("The usage report exceeds the bounded delivery size."), { code: "DISTRIBUTOR_USAGE_LIMIT" });
    built = buildDistributorUsageReport({ connection, periodFrom: from, periodUntil: until, events, mappings, generatedAt: now });
    eventCount = events.length;
  }
  const delivery = await prismaClient.musicDistributorUsageDelivery.upsert({
    where: { connectionId_periodFrom_periodUntil: { connectionId, periodFrom: from, periodUntil: until } },
    create: { connectionId, periodFrom: from, periodUntil: until, eventCount, payload: built.report, payloadSha256: built.payloadSha256, idempotencyKey: built.idempotencyKey },
    update: {}
  });
  if (delivery.status === "DELIVERED") return { deliveryId: delivery.id, delivered: true, eventCount: delivery.eventCount };
  try {
    const { accessToken } = await requestDistributorAccessToken(connection, { fetchImpl });
    const response = await fetchImpl(distributorApiUrl(connection, connection.usageReportPath), {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}`, "content-type": "application/json", "idempotency-key": delivery.idempotencyKey },
      body: JSON.stringify(built.report),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw Object.assign(new Error(`Usage delivery returned HTTP ${response.status}.`), { code: `DISTRIBUTOR_USAGE_HTTP_${response.status}` });
    await prismaClient.$transaction([
      prismaClient.musicDistributorUsageDelivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED", attemptCount: { increment: 1 }, deliveredAt: now, lastErrorCode: null } }),
      prismaClient.auditLog.create({ data: { actorUserId: connection.createdByUserId, action: "MUSIC_DISTRIBUTOR_USAGE_DELIVERED", entityType: "MusicDistributorUsageDelivery", entityId: delivery.id, details: { providerKey: connection.providerKey, periodFrom: from, periodUntil: until, eventCount, payloadSha256: built.payloadSha256 } } })
    ]);
    return { deliveryId: delivery.id, delivered: true, eventCount };
  } catch (error) {
    const attempt = delivery.attemptCount + 1;
    const abandoned = attempt >= 5;
    const lastErrorCode = safeDistributorErrorCode(error, "DISTRIBUTOR_USAGE_FAILED");
    await prismaClient.musicDistributorUsageDelivery.update({ where: { id: delivery.id }, data: { status: abandoned ? "ABANDONED" : "FAILED", attemptCount: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + distributorRetryDelayMs(attempt)), lastErrorCode } });
    throw Object.assign(new Error("Distributor usage delivery failed safely."), { code: lastErrorCode });
  }
}

export async function processDueMusicDistributorUsageDeliveries(prismaClient, { fetchImpl = fetch, now = new Date(), limit = 2 } = {}) {
  const due = await prismaClient.musicDistributorUsageDelivery.findMany({
    where: {
      status: { in: ["QUEUED", "FAILED"] },
      nextAttemptAt: { lte: now },
      connection: { status: { in: ["ACTIVE", "DEGRADED"] } }
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(5, Number(limit) || 2)),
    select: { id: true, connectionId: true, periodFrom: true, periodUntil: true }
  });
  const result = { claimed: 0, succeeded: 0, failed: 0 };
  for (const delivery of due) {
    const claimed = await prismaClient.musicDistributorUsageDelivery.updateMany({
      where: { id: delivery.id, status: { in: ["QUEUED", "FAILED"] }, nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + 10 * 60_000) }
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;
    try {
      await deliverMusicDistributorUsage(prismaClient, delivery.connectionId, {
        periodFrom: delivery.periodFrom,
        periodUntil: delivery.periodUntil,
        fetchImpl,
        now
      });
      result.succeeded += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export async function testMusicDistributorConnection(connection, { fetchImpl = fetch } = {}) {
  const token = await requestDistributorAccessToken(connection, { fetchImpl });
  return { authenticated: true, expiresIn: token.expiresIn };
}
