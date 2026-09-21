import { PromoOnlyApiClient, safePromoOnlyClientError } from "./promo-only-client.mjs";
import { assertPromoOnlyDownloadAuthority, readPromoOnlyConfig } from "./promo-only.mjs";
import { inspectCatalogueAudio, storeCatalogueTrack } from "./catalogue-track-storage.js";

function safeErrorCode(error) { return safePromoOnlyClientError(error); }

function queueAccepted(queue, externalTrackId) {
  const id = String(queue?.trackid ?? queue?.trackId ?? queue?.data?.trackid ?? "");
  const token = queue?.dl_token || queue?.download_token || queue?.data?.dl_token;
  const servers = queue?.servers || queue?.data?.servers;
  const isAudio = Number(queue?.media_type ?? queue?.data?.media_type) === 2;
  const fileType = String(queue?.file_type || queue?.data?.file_type || "").toLowerCase();
  if (id !== String(externalTrackId) || !token || !Array.isArray(servers) || !servers.length || !isAudio || (fileType && !/^(mp3|m4a|wav)$/i.test(fileType))) {
    throw Object.assign(new Error("Promo Only did not grant an authorised audio download for this track."), { code: "PROMOONLY_ENTITLEMENT_REJECTED" });
  }
  return true;
}

export async function importPromoOnlyAudio(db, {
  distributorTrackId,
  actorUserId = null,
  actorRole = null,
  privilegedWorker = false,
  config = readPromoOnlyConfig(),
  client = new PromoOnlyApiClient(config),
  storeTrack = storeCatalogueTrack,
  inspectAudio = inspectCatalogueAudio
} = {}) {
  // Check role and environment before the first database/provider request.
  assertPromoOnlyDownloadAuthority({ config, actorRole, privilegedWorker, entitlementAccepted: true });
  const item = await db.musicDistributorTrack.findUnique({
    where: { id: distributorTrackId },
    include: { connection: { select: { providerKey: true, createdByUserId: true, status: true } }, canonicalGenre: true }
  });
  if (!item || item.connection?.providerKey !== "PROMO_ONLY" || item.connection.status === "REVOKED") {
    throw Object.assign(new Error("The Promo Only catalogue track was not found."), { code: "PROMOONLY_TRACK_NOT_FOUND", status: 404 });
  }
  if (item.status !== "ACTIVE" || !item.externalTrackId || item.trackId) {
    throw Object.assign(new Error("This track is unavailable or already imported."), { code: "PROMOONLY_TRACK_NOT_IMPORTABLE", status: 409 });
  }
  if (!item.canonicalGenre?.active || item.canonicalGenre.providerReviewStatus !== "APPROVED") {
    throw Object.assign(new Error("Approve a canonical genre before importing this track."), { code: "PROMOONLY_GENRE_REVIEW_REQUIRED", status: 409 });
  }
  const claimed = await db.musicDistributorTrack.updateMany({
    where: { id: item.id, trackId: null, status: "ACTIVE", audioStatus: { in: ["NOT_REQUESTED", "FAILED_RETRYABLE", "FAILED_PERMANENT"] } },
    data: { importState: "DOWNLOAD_QUEUED", audioStatus: "QUEUED", lastImportErrorCode: null }
  });
  if (claimed.count !== 1) throw Object.assign(new Error("An import is already running for this track."), { code: "PROMOONLY_DOWNLOAD_ALREADY_RUNNING", status: 409 });
  let storedTrackId = null;
  try {
    // Track info alone is not a download entitlement. Promo Only must accept the queue request.
    const queue = await client.queueDownload(item.externalTrackId);
    queueAccepted(queue, item.externalTrackId);
    assertPromoOnlyDownloadAuthority({ config, actorRole, privilegedWorker, entitlementAccepted: true, alreadyImported: false });
    await db.musicDistributorTrack.update({ where: { id: item.id }, data: { importState: "DOWNLOADING", audioStatus: "DOWNLOADING" } });
    const audio = await client.downloadQueuedMedia(queue);
    const inspected = inspectAudio({ buffer: audio.buffer, fileName: audio.fileName, claimedType: audio.contentType });
    await db.musicDistributorTrack.update({ where: { id: item.id }, data: { importState: "MEDIA_VALIDATED", audioStatus: "VALIDATED" } });
    const approvedActor = actorUserId || item.connection.createdByUserId;
    const stored = await storeTrack({
      buffer: audio.buffer,
      fileName: audio.fileName,
      claimedType: audio.contentType,
      inspected,
      metadata: {
        title: item.title,
        artist: item.artist,
        album: item.album,
        mixName: item.mixName,
        bpm: item.bpm,
        releaseYear: item.releaseDate?.getUTCFullYear() || null,
        releaseDate: item.releaseDate,
        recordLabel: item.label,
        contentWarning: item.contentWarning,
        catalogueProvider: "PROMO_ONLY",
        durationSeconds: item.durationSeconds,
        isExplicit: item.isExplicit,
        rightsHolder: item.rightsHolder,
        rightsReference: item.rightsReference,
        permittedTerritories: item.permittedTerritories.join(", "),
        permittedUses: item.permittedUses,
        licenceExpiresAt: item.licenceExpiresAt,
        licensedCatalogue: true,
        minimumCatalogueLevel: item.minimumCatalogueLevel,
        genreIds: [item.canonicalGenreId],
        status: "DRAFT"
      },
      actorUserId: approvedActor,
      auditContext: { provider: "PROMO_ONLY", externalTrackId: item.externalTrackId, sourceGenre: item.sourceGenre, testMode: true },
      reviewApproved: false
    });
    storedTrackId = stored.track.id;
    const linked = await db.$transaction(async (tx) => {
      const updated = await tx.musicDistributorTrack.update({ where: { id: item.id }, data: {
        trackId: stored.track.id,
        sourceChecksumSha256: inspected.checksum,
        sourceMimeType: inspected.contentType,
        sourceSizeBytes: BigInt(audio.buffer.length),
        importState: "CATALOGUED",
        audioStatus: "STORED_PENDING_RIGHTS",
        autoDjReady: false,
        lastImportErrorCode: null
      } });
      await tx.auditLog.create({ data: {
        actorUserId: approvedActor,
        action: "PROMOONLY_AUDIO_TEST_IMPORTED",
        entityType: "MusicDistributorTrack",
        entityId: item.id,
        details: { externalTrackId: item.externalTrackId, catalogTrackId: stored.track.id, checksum: inspected.checksum, audioStatus: "STORED_PENDING_RIGHTS" }
      } });
      return updated;
    });
    try {
      await client.confirmDownload({ trackid: item.externalTrackId, serverid: audio.serverId, dl_token: audio.downloadToken });
    } catch (error) {
      await db.musicDistributorTrack.update({ where: { id: item.id }, data: { importState: "RECONCILIATION_REQUIRED", lastImportErrorCode: safeErrorCode(error) } });
      return { imported: true, trackId: stored.track.id, distributorTrackId: linked.id, reconciliationRequired: true };
    }
    return { imported: true, trackId: stored.track.id, distributorTrackId: linked.id, reconciliationRequired: false };
  } catch (error) {
    const code = safeErrorCode(error);
    if (storedTrackId) {
      // The protected file already exists. Preserve its identity for manual
      // reconciliation; retrying the queue would duplicate or orphan media.
      await db.musicDistributorTrack.updateMany({ where: { id: item.id, trackId: null }, data: {
        trackId: storedTrackId, importState: "RECONCILIATION_REQUIRED", audioStatus: "STORED_PENDING_RIGHTS", autoDjReady: false, lastImportErrorCode: code
      } });
      await db.auditLog.create({ data: { actorUserId: actorUserId || item.connection.createdByUserId, action: "PROMOONLY_AUDIO_RECONCILIATION_REQUIRED", entityType: "MusicDistributorTrack", entityId: item.id, details: { externalTrackId: item.externalTrackId, catalogTrackId: storedTrackId, errorCode: code } } });
      throw Object.assign(new Error("Promo Only audio was stored but requires manual reconciliation."), { code: "PROMOONLY_RECONCILIATION_REQUIRED", status: 409 });
    }
    await db.musicDistributorTrack.updateMany({ where: { id: item.id, trackId: null }, data: {
      importState: code.includes("HTTP_4") || code.includes("ENTITLEMENT") ? "FAILED_PERMANENT" : "FAILED_RETRYABLE",
      audioStatus: code.includes("HTTP_4") || code.includes("ENTITLEMENT") ? "FAILED_PERMANENT" : "FAILED_RETRYABLE",
      lastImportErrorCode: code,
      downloadRetryCount: { increment: 1 }
    } });
    await db.auditLog.create({ data: {
      actorUserId: actorUserId || item.connection.createdByUserId,
      action: "PROMOONLY_AUDIO_TEST_FAILED",
      entityType: "MusicDistributorTrack",
      entityId: item.id,
      details: { externalTrackId: item.externalTrackId, errorCode: code }
    } });
    throw Object.assign(new Error("Promo Only audio could not be imported safely."), { code, status: error.status || 502 });
  }
}
