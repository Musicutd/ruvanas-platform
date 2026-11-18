import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { upsertPromoOnlyMetadata } from "./promo-only-service.js";
import { assertPromoOnlyManualConnection, getPromoOnlyManualConnection } from "./promo-only-metadata-sample-service.js";
import { fetchPromoOnlyMetadataBatch, readPromoOnlyMetadataBatchConfig } from "./promo-only-metadata-batch.mjs";

const MAX_TRACKS = 25;
const OPTIONS = Object.freeze({ isolationLevel: "Serializable", maxWait: 5_000, timeout: 15_000 });
const PROTECTED_FIELDS = Object.freeze([
  { trackId: { not: null } }, { sourceUrlEncrypted: { not: null } },
  { audioStatus: { not: "NOT_REQUESTED" } }, { importState: { not: "METADATA_READY" } },
  { autoDjReady: true }, { downloadRetryCount: { gt: 0 } },
  { lastImportErrorCode: { not: null } }, { sourceChecksumSha256: { not: null } },
  { sourceMimeType: { not: null } }, { sourceSizeBytes: { not: null } }
]);
function error(code) { return Object.assign(new Error("Promo Only metadata batch is unavailable."), { code }); }
function requireValue(value, code) { if (!value) throw error(code); }
function supplierId(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
}
function protectedTrack(item) {
  return Boolean(item && (item.trackId != null || item.sourceUrlEncrypted != null ||
    item.audioStatus !== "NOT_REQUESTED" || item.importState !== "METADATA_READY" ||
    item.autoDjReady === true || Number(item.downloadRetryCount || 0) > 0 ||
    item.lastImportErrorCode != null || item.sourceChecksumSha256 != null ||
    item.sourceMimeType != null || item.sourceSizeBytes != null));
}
function assertConfig(config, actorUserId) {
  requireValue(typeof actorUserId === "string" && actorUserId.length > 0, "PROMOONLY_BATCH_ACTOR_REQUIRED");
  requireValue(config?.enabled === true && config.ready === true && config.manualOnly === true &&
    config.mode === "METADATA" && config.audioDownloadEnabled === false &&
    config.allowHttpMediaTest === false && config.autoCreateGenres === false &&
    config.genreReviewRequired === true && config.retryMax === 0 && !config.rssUrl,
  "PROMOONLY_BATCH_DISABLED");
}
function assertResponse(batch) {
  requireValue(Array.isArray(batch?.metadata) && batch.metadata.length > 0 && batch.metadata.length <= MAX_TRACKS &&
    supplierId(batch.selectedReleaseId) && batch.requestCount === batch.metadata.length + 3 &&
    Number.isSafeInteger(batch.releaseCount) && batch.releaseCount > 0 && batch.releaseCount <= 500 &&
    Number.isSafeInteger(batch.truncatedCount) && batch.truncatedCount >= 0 && batch.truncatedCount <= 500,
  "PROMOONLY_BATCH_RESPONSE_INVALID");
  const identities = new Set();
  for (const metadata of batch.metadata) {
    requireValue(supplierId(metadata?.externalTrackId) && metadata.externalReleaseId === batch.selectedReleaseId &&
      metadata.mediaType === "2" && !identities.has(metadata.externalTrackId), "PROMOONLY_BATCH_RESPONSE_INVALID");
    identities.add(metadata.externalTrackId);
  }
}
async function actorPreflight(db, actorUserId) {
  const actor = await db.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true } });
  requireValue(actor?.id === actorUserId && actor.role === "SUPER_ADMIN", "PROMOONLY_BATCH_ACTOR_REQUIRED");
}

/** One owner-triggered release batch. No RSS, media, queue, schedule or rights grant. */
export async function runPromoOnlyMetadataBatch(db, {
  actorUserId, config = readPromoOnlyMetadataBatchConfig(), fetchImpl = fetch,
  fetchBatch = fetchPromoOnlyMetadataBatch, encryptMarker = encryptSecret,
  decryptMarker = decryptSecret, now = new Date(), clock = Date.now
} = {}) {
  assertConfig(config, actorUserId);
  requireValue(now instanceof Date && Number.isFinite(now.getTime()) && typeof clock === "function", "PROMOONLY_BATCH_TIME_INVALID");
  await actorPreflight(db, actorUserId);
  const before = await db.musicDistributorConnection.findUnique({ where: { providerKey: "PROMO_ONLY" } });
  assertPromoOnlyManualConnection(before, actorUserId, decryptMarker);
  // Network work finishes before the bounded DB-only transaction begins.
  const batch = await fetchBatch(config, { fetchImpl, now: clock });
  assertResponse(batch);
  return db.$transaction(async tx => {
    await actorPreflight(tx, actorUserId);
    const connection = await getPromoOnlyManualConnection(tx, actorUserId, now, encryptMarker, decryptMarker);
    const releaseKey = { connectionId: connection.id, externalReleaseId: batch.selectedReleaseId };
    const existingRelease = await tx.musicDistributorRelease.findUnique({ where: { connectionId_externalReleaseId: releaseKey } });
    const protectedNeighbour = existingRelease ? await tx.musicDistributorTrack.findFirst({ where: {
      connectionId: connection.id, releaseId: existingRelease.id, OR: PROTECTED_FIELDS
    }, select: { id: true } }) : null;
    // Generic metadata upsert also updates the shared release row. Freeze that
    // row if a locked/imported recording references it, even outside this batch.
    const scopedDb = {
      musicDistributorTrack: tx.musicDistributorTrack,
      musicProviderGenreMapping: tx.musicProviderGenreMapping,
      mediaGenre: tx.mediaGenre,
      auditLog: tx.auditLog,
      track: { updateMany: async () => { throw error("PROMOONLY_BATCH_MEDIA_WRITE_FORBIDDEN"); } },
      musicDistributorRelease: { upsert: async args => {
        const key = args.where?.connectionId_externalReleaseId;
        requireValue(key?.connectionId === connection.id && key.externalReleaseId === batch.selectedReleaseId,
          "PROMOONLY_BATCH_RELEASE_IDENTITY");
        return protectedNeighbour ? existingRelease : tx.musicDistributorRelease.upsert(args);
      } }
    };
    let createdCount = 0, updatedCount = 0, unchangedCount = 0, skippedCount = 0;
    for (const metadata of batch.metadata) {
      const existing = await tx.musicDistributorTrack.findUnique({ where: {
        connectionId_externalTrackId: { connectionId: connection.id, externalTrackId: metadata.externalTrackId }
      } });
      if (protectedTrack(existing)) { skippedCount++; continue; }
      const result = await upsertPromoOnlyMetadata(scopedDb, connection, metadata, config);
      requireValue(result.track.connectionId === connection.id && result.track.externalTrackId === metadata.externalTrackId &&
        result.track.trackId == null && result.track.sourceUrlEncrypted == null &&
        result.track.audioStatus === "NOT_REQUESTED" && result.track.autoDjReady !== true,
      "PROMOONLY_BATCH_MEDIA_WRITE_FORBIDDEN");
      if (result.created) createdCount++;
      else if (result.changed) updatedCount++;
      else unchangedCount++;
    }
    const summary = { createdCount, updatedCount, unchangedCount, skippedCount,
      truncatedCount: batch.truncatedCount, requestCount: batch.requestCount,
      releaseCount: batch.releaseCount, selectedReleaseId: batch.selectedReleaseId,
      tracksReceived: batch.metadata.length, downloadedCount: 0,
      protectedReleasePreserved: Boolean(protectedNeighbour) };
    const run = await tx.musicDistributorSyncRun.create({ data: {
      connectionId: connection.id, kind: "DELTA", status: "SUCCEEDED",
      trigger: "MANUAL_API_BATCH", mode: "METADATA_BATCH", correlationId: crypto.randomUUID(),
      releasesReceived: 1, tracksReceived: batch.metadata.length, fetchedCount: batch.metadata.length,
      enrichedCount: createdCount + updatedCount + unchangedCount, createdCount,
      updatedCount, unchangedCount, rejectedCount: skippedCount, downloadedCount: 0,
      attempt: 1, startedAt: now, completedAt: new Date()
    } });
    await tx.auditLog.create({ data: {
      actorUserId, action: "PROMOONLY_METADATA_BATCH_IMPORTED", entityType: "MusicDistributorSyncRun",
      entityId: run.id, details: { providerKey: "PROMO_ONLY", ...summary,
        audioImported: false, queueMutated: false, rightsGranted: false }
    } });
    return summary;
  }, OPTIONS);
}
