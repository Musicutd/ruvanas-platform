import { decryptSecret } from "./crypto.js";
import { catalogueStorageKey } from "./catalogue-upload.mjs";
import { checkPromoOnlyAudioSamplePreflight, fetchPromoOnlyAudioSample,
  readPromoOnlyAudioSampleConfig } from "./promo-only-audio-sample.mjs";

const TRACK_ID = "713637";
const RELEASE_ID = "122500";
const MANUAL_MARKER = "PROMOONLY_MANUAL_METADATA_SAMPLE_V1";
const API_BASE_URL = "https://api.promoonly.com/";
const TOKEN_URL = "https://api.promoonly.com/user/authenticate";
const CATALOGUE_PATH = "/releases/date/1";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const AUDIO_MIME_BY_EXT = Object.freeze({ mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" });
const TRANSACTION_OPTIONS = Object.freeze({ isolationLevel: "Serializable", maxWait: 5_000, timeout: 15_000 });
const SAFE_CODES = new Set([
  "PROMOONLY_AUDIO_SAMPLE_NOT_READY", "PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE",
  "PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED", "PROMOONLY_AUDIO_SAMPLE_RESPONSE_INVALID",
  "PROMOONLY_AUDIO_SAMPLE_MEDIA_INVALID", "PROMOONLY_AUDIO_SAMPLE_STORAGE_FAILED",
  "PROMOONLY_AUDIO_SAMPLE_STORAGE_TIMEOUT",
  "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_ALLOWED",
  "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_VERIFIED",
  "PROMOONLY_AUDIO_SAMPLE_LINK_FAILED", "PROMOONLY_AUDIO_SAMPLE_ACK_UNCONFIRMED",
  "PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED",
  "PROMOONLY_AUDIO_SAMPLE_DEADLINE", "PROMOONLY_AUDIO_SAMPLE_ENTITLEMENT_DENIED",
  "PROMOONLY_AUDIO_SAMPLE_CLOCK_INVALID", "PROMOONLY_AUDIO_SAMPLE_FETCH_UNAVAILABLE",
  "PROMOONLY_AUDIO_SAMPLE_SIGNAL_INVALID",
  "PROMOONLY_AUDIO_SAMPLE_GRANT_INVALID", "PROMOONLY_AUDIO_SAMPLE_HTTPS_OR_HOST_UNSUPPORTED",
  "PROMOONLY_AUDIO_SAMPLE_MEDIA_SIGNATURE_INVALID", "PROMOONLY_AUDIO_SAMPLE_MEDIA_TYPE_INVALID",
  "PROMOONLY_AUDIO_SAMPLE_MEDIA_HTTP_STATUS_INVALID", "PROMOONLY_AUDIO_SAMPLE_MEDIA_LENGTH_MISMATCH",
  "PROMOONLY_AUDIO_SAMPLE_NETWORK", "PROMOONLY_AUDIO_SAMPLE_REDIRECT_BLOCKED",
  "PROMOONLY_AUDIO_SAMPLE_REQUEST_FAILED", "PROMOONLY_AUDIO_SAMPLE_REQUEST_LIMIT",
  "PROMOONLY_AUDIO_SAMPLE_REQUEST_NOT_ALLOWED", "PROMOONLY_AUDIO_SAMPLE_RESPONSE_TOO_LARGE",
  "PROMOONLY_AUDIO_SAMPLE_SERVER_UNCONFIRMED", "PROMOONLY_AUDIO_SAMPLE_SERVERS_INVALID",
  "PROMOONLY_AUDIO_SAMPLE_TOKEN_EXPIRY_TOO_SHORT", "PROMOONLY_AUDIO_SAMPLE_TRACK_MISMATCH"
]);

function fail(code) {
  throw Object.assign(new Error("The private audio sample is unavailable."), { code });
}

export function safePromoOnlyAudioSampleCode(error) {
  return SAFE_CODES.has(error?.code) ? error.code : "PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED";
}

function configReady(config) {
  return config?.enabled === true && config.ready === true && config.manualOnly === true &&
    config.trackId === TRACK_ID && config.releaseId === RELEASE_ID &&
    config.audioDownloadEnabled === false && config.allowHttpMediaTest === false &&
    config.supplierCredentialsConfigured === true && config.storageCredentialsConfigured === true;
}

function encryptedMarkerValid(connection, decryptMarker) {
  try {
    const marker = JSON.parse(decryptMarker(connection.clientCredentialsEncrypted));
    return marker && !Array.isArray(marker) && Object.keys(marker).length === 1 &&
      marker.managedBy === MANUAL_MARKER;
  } catch { return false; }
}

function assertConnection(connection, actorUserId, decryptMarker) {
  const state = connection?.configuration;
  if (!connection || connection.providerKey !== "PROMO_ONLY" || connection.name !== "Promo Only" ||
      connection.createdByUserId !== actorUserId || connection.status !== "PAUSED" ||
      connection.nextSyncAt != null || connection.syncLeaseOwner != null ||
      connection.syncLeaseUntil != null || connection.revokedAt != null ||
      connection.apiBaseUrl !== API_BASE_URL || connection.tokenUrl !== TOKEN_URL ||
      connection.cataloguePath !== CATALOGUE_PATH ||
      !Array.isArray(connection.oauthScopes) || connection.oauthScopes.length !== 1 ||
      connection.oauthScopes[0] !== "catalogue.read" ||
      !Array.isArray(connection.defaultPermittedTerritories) || connection.defaultPermittedTerritories.length !== 0 ||
      !Array.isArray(connection.defaultPermittedUses) || connection.defaultPermittedUses.length !== 0 ||
      !state || typeof state !== "object" || Array.isArray(state) ||
      state.managedBy !== MANUAL_MARKER || state.manualOnly !== true ||
      state.rssConfigured !== false || state.productionLocked !== true ||
      !encryptedMarkerValid(connection, decryptMarker)) {
    fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");
  }
}

function assertNamedItem(item, connectionId) {
  if (!item || item.connectionId !== connectionId || item.externalTrackId !== TRACK_ID ||
      item.release?.connectionId !== connectionId || item.release.externalReleaseId !== RELEASE_ID ||
      item.release.status !== "ACTIVE" || item.status !== "ACTIVE" ||
      item.mediaType !== "2" || item.deliveryMode !== "DOWNLOAD" ||
      item.sourceUrlEncrypted != null || item.autoDjReady !== false ||
      !Array.isArray(item.permittedUses) || item.permittedUses.length !== 0 ||
      !Array.isArray(item.permittedTerritories) || item.permittedTerritories.length !== 0 ||
      item.licenceStartsAt != null || item.licenceExpiresAt != null) {
    fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");
  }
}

function unclaimed(item) {
  return item.trackId == null && item.importState === "METADATA_READY" &&
    item.audioStatus === "NOT_REQUESTED" && item.downloadRetryCount === 0 &&
    item.sourceChecksumSha256 == null && item.sourceMimeType == null && item.sourceSizeBytes == null;
}

async function namedContext(db, actorUserId, decryptMarker) {
  if (!actorUserId || typeof actorUserId !== "string") fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");
  const connection = await db.musicDistributorConnection.findUnique({ where: { providerKey: "PROMO_ONLY" } });
  assertConnection(connection, actorUserId, decryptMarker);
  const item = await db.musicDistributorTrack.findUnique({
    where: { connectionId_externalTrackId: { connectionId: connection.id, externalTrackId: TRACK_ID } },
    include: { release: true }
  });
  assertNamedItem(item, connection.id);
  return { connection, item };
}

function safeStoredAsset(item, track) {
  const asset = track?.mediaAsset;
  const checksum = item?.sourceChecksumSha256;
  const extension = asset?.storageKey?.match(/^catalogue\/music\/[0-9a-f]{64}\.([a-z0-9]+)$/)?.[1];
  if (!track || !asset || track.id !== item.trackId || track.mediaAssetId !== asset.id ||
      track.catalogueProvider !== "PROMO_ONLY" || track.status !== "DRAFT" ||
      track.rightsReviewStatus !== "DRAFT" || track.rightsConfirmedAt != null ||
      track.rightsConfirmedById != null || track.rightsReviewedAt != null ||
      track.rightsReviewedById != null || track.minimumCatalogueLevel !== "NONE" ||
      (track.permittedTerritories != null && track.permittedTerritories !== "") ||
      !Array.isArray(track.permittedUses) || track.permittedUses.length !== 0 ||
      asset.organisationId !== null || asset.libraryType !== "RUVANAS_CATALOGUE" ||
      asset.mediaType !== "MUSIC" || asset.status !== "READY" ||
      asset.licensedCatalogue !== false ||
      !/^[0-9a-f]{64}$/.test(checksum || "") || !extension ||
      !Object.hasOwn(AUDIO_MIME_BY_EXT, extension) ||
      asset.mimeType !== AUDIO_MIME_BY_EXT[extension] ||
      catalogueStorageKey(checksum, extension) !== asset.storageKey ||
      !Number.isSafeInteger(Number(asset.sizeBytes)) || Number(asset.sizeBytes) <= 0 ||
      Number(asset.sizeBytes) > MAX_AUDIO_BYTES ||
      item.sourceMimeType !== asset.mimeType ||
      item.sourceSizeBytes == null || BigInt(item.sourceSizeBytes) !== BigInt(asset.sizeBytes)) {
    return null;
  }
  return asset;
}

async function storedAsset(db, item) {
  if (!item?.trackId) return null;
  const track = await db.track.findUnique({ where: { id: item.trackId }, include: { mediaAsset: true } });
  return safeStoredAsset(item, track);
}

function completed(item) {
  return item.importState === "CATALOGUED" && item.audioStatus === "STORED_PENDING_RIGHTS" &&
    item.autoDjReady === false && item.lastImportErrorCode == null && item.trackId != null;
}

const PREFLIGHT_REPAIR_CODE = "PROMOONLY_AUDIO_SAMPLE_SERVERS_INVALID";
const PREFLIGHT_REPAIR_ACTION = "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIRED";

function exactPreflightLock(item) {
  return item?.importState === "RECONCILIATION_REQUIRED" &&
    item.audioStatus === "SAMPLE_CLAIMED" &&
    item.lastImportErrorCode === PREFLIGHT_REPAIR_CODE &&
    item.trackId == null && item.autoDjReady === false &&
    item.downloadRetryCount === 0 && item.sourceChecksumSha256 == null &&
    item.sourceMimeType == null && item.sourceSizeBytes == null &&
    item.sourceUrlEncrypted == null;
}

async function exactClaimOnlyAudit(db, itemId, actorUserId) {
  const rows = await db.auditLog.findMany({
    where: { entityType: "MusicDistributorTrack", entityId: itemId,
      action: { startsWith: "PROMOONLY_AUDIO_SAMPLE_" } },
    select: { action: true, actorUserId: true }
  });
  return Array.isArray(rows) && rows.length === 1 &&
    rows[0].action === "PROMOONLY_AUDIO_SAMPLE_CLAIMED" &&
    rows[0].actorUserId === actorUserId;
}

/** One historical false-positive pre-queue lock, repaired only by a fresh hosted read-only preflight. */
export async function repairPromoOnlyAudioSamplePreflight(db, {
  actorUserId,
  config = readPromoOnlyAudioSampleConfig(),
  decryptMarker = decryptSecret,
  checkPreflight = checkPromoOnlyAudioSamplePreflight
} = {}) {
  if (!configReady(config) || !actorUserId || typeof actorUserId !== "string") {
    fail("PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_ALLOWED");
  }
  const before = await namedContext(db, actorUserId, decryptMarker);
  if (!exactPreflightLock(before.item) ||
      !(await exactClaimOnlyAudit(db, before.item.id, actorUserId))) {
    fail("PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_ALLOWED");
  }
  // No queued media request occurs here. The supplier is checked again over
  // HTTPS, using its current track and server list, before changing any row.
  const proof = await checkPreflight(config);
  if (proof?.verified !== true || proof.hasZeroServerId !== true ||
      !Number.isInteger(proof.serverCount) || proof.serverCount < 1 ||
      proof.serverCount > 32 || proof.supplierRequestCount !== 3) {
    fail("PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_VERIFIED");
  }
  await db.$transaction(async (tx) => {
    const current = await namedContext(tx, actorUserId, decryptMarker);
    if (current.item.id !== before.item.id ||
        current.item.metadataChecksum !== before.item.metadataChecksum ||
        current.item.revision !== before.item.revision ||
        !exactPreflightLock(current.item) ||
        !(await exactClaimOnlyAudit(tx, current.item.id, actorUserId))) {
      fail("PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_ALLOWED");
    }
    const restored = await tx.musicDistributorTrack.updateMany({
      where: { id: current.item.id, connectionId: current.connection.id,
        releaseId: current.item.releaseId, externalTrackId: TRACK_ID,
        revision: current.item.revision,
        metadataChecksum: current.item.metadataChecksum,
        status: "ACTIVE", trackId: null, autoDjReady: false,
        importState: "RECONCILIATION_REQUIRED", audioStatus: "SAMPLE_CLAIMED",
        lastImportErrorCode: PREFLIGHT_REPAIR_CODE, downloadRetryCount: 0,
        sourceUrlEncrypted: null, sourceChecksumSha256: null,
        sourceMimeType: null, sourceSizeBytes: null },
      data: { importState: "METADATA_READY", audioStatus: "NOT_REQUESTED",
        lastImportErrorCode: null }
    });
    if (restored.count !== 1) fail("PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_ALLOWED");
    await tx.auditLog.create({ data: { actorUserId, action: PREFLIGHT_REPAIR_ACTION,
      entityType: "MusicDistributorTrack", entityId: current.item.id,
      details: { originalFailureCode: PREFLIGHT_REPAIR_CODE,
        supplierRequestCount: 3, serverCount: proof.serverCount,
        hasZeroServerId: true, mediaRequested: false, rightsGranted: false } } });
  }, TRANSACTION_OPTIONS);
  return { repaired: true, canImport: true, playbackAvailable: false,
    reconciliationRequired: false, safeErrorCode: null };
}

/** Only safe booleans and a fixed code cross into the private owner UI. */
export async function getPromoOnlyAudioSampleState(db, {
  actorUserId, config = readPromoOnlyAudioSampleConfig(), decryptMarker = decryptSecret
} = {}) {
  const base = { enabled: config?.enabled === true, ready: configReady(config), canImport: false,
    playbackAvailable: false, reconciliationRequired: false, safeErrorCode: null };
  if (!base.ready) return base;
  try {
    const { item } = await namedContext(db, actorUserId, decryptMarker);
    if (unclaimed(item)) return { ...base, canImport: true };
    if (completed(item) && await storedAsset(db, item)) {
      return { ...base, playbackAvailable: true };
    }
    return { ...base, reconciliationRequired: true,
      safeErrorCode: SAFE_CODES.has(item.lastImportErrorCode)
        ? item.lastImportErrorCode : "PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED" };
  } catch (error) {
    return { ...base, safeErrorCode: safePromoOnlyAudioSampleCode(error) };
  }
}

/** Static URL, but every request rechecks the private owner and exact stored identity. */
export async function resolvePromoOnlyAudioSampleAsset(db, {
  actorUserId, config = readPromoOnlyAudioSampleConfig(), decryptMarker = decryptSecret
} = {}) {
  if (!configReady(config)) return null;
  try {
    const { item } = await namedContext(db, actorUserId, decryptMarker);
    return completed(item) ? await storedAsset(db, item) : null;
  } catch { return null; }
}

async function inspectDefault(input) {
  const { inspectCatalogueAudio } = await import("./catalogue-track-storage.js");
  return inspectCatalogueAudio(input);
}

async function storeDefault(input) {
  const { storeCatalogueTrack } = await import("./catalogue-track-storage.js");
  return storeCatalogueTrack(input);
}

async function markReconciliation(db, itemId, trackId, code, checksum = null) {
  // The first claim remains permanent even if this best-effort write fails.
  try {
    if (trackId) {
      // Never overwrite a concurrent link to some other catalogue record.
      await db.musicDistributorTrack.updateMany({
        where: { id: itemId, trackId: null,
          importState: { in: ["SAMPLE_CLAIMED", "RECONCILIATION_REQUIRED"] },
          ...(checksum ? { sourceChecksumSha256: checksum } : {}) },
        data: { trackId, importState: "RECONCILIATION_REQUIRED",
          audioStatus: "STORED_PENDING_RIGHTS", autoDjReady: false,
          lastImportErrorCode: code }
      });
      await db.musicDistributorTrack.updateMany({
        where: { id: itemId, trackId, importState: "RECONCILIATION_REQUIRED" },
        data: { lastImportErrorCode: code, autoDjReady: false }
      });
    } else {
      await db.musicDistributorTrack.updateMany({
        where: { id: itemId, trackId: null, importState: "SAMPLE_CLAIMED" },
        data: { importState: "RECONCILIATION_REQUIRED", audioStatus: "SAMPLE_CLAIMED",
          autoDjReady: false, lastImportErrorCode: code }
      });
    }
  } catch { /* Claim cannot be retried; operator inspects the database and storage. */ }
}

/** One exact, manually claimed sample. Any ambiguous step is never re-downloaded. */
export async function importPromoOnlyAudioSample(db, {
  actorUserId,
  config = readPromoOnlyAudioSampleConfig(),
  decryptMarker = decryptSecret,
  fetchSample = fetchPromoOnlyAudioSample,
  inspectAudio = inspectDefault,
  storeTrack = storeDefault,
  storageAbortSignal = null,
  now = new Date()
} = {}) {
  if (!configReady(config)) fail("PROMOONLY_AUDIO_SAMPLE_NOT_READY");
  if (!actorUserId || typeof actorUserId !== "string" ||
      !(now instanceof Date) || Number.isNaN(now.getTime())) fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");
  if (storageAbortSignal !== null && !(storageAbortSignal instanceof AbortSignal)) {
    fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");
  }
  // Query the exact source before any supplier or storage call.
  const before = await namedContext(db, actorUserId, decryptMarker);
  if (!unclaimed(before.item)) fail("PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED");
  const item = await db.$transaction(async (tx) => {
    const current = await namedContext(tx, actorUserId, decryptMarker);
    if (!unclaimed(current.item)) fail("PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED");
    const claimed = await tx.musicDistributorTrack.updateMany({
      where: { id: current.item.id, connectionId: current.connection.id,
        releaseId: current.item.releaseId, externalTrackId: TRACK_ID,
        revision: current.item.revision, metadataChecksum: current.item.metadataChecksum,
        status: "ACTIVE", trackId: null, importState: "METADATA_READY",
        audioStatus: "NOT_REQUESTED", downloadRetryCount: 0,
        sourceUrlEncrypted: null, sourceChecksumSha256: null,
        sourceMimeType: null, sourceSizeBytes: null, autoDjReady: false },
      data: { importState: "SAMPLE_CLAIMED", audioStatus: "SAMPLE_CLAIMED",
        lastImportErrorCode: null }
    });
    if (claimed.count !== 1) fail("PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED");
    await tx.auditLog.create({ data: { actorUserId, action: "PROMOONLY_AUDIO_SAMPLE_CLAIMED",
      entityType: "MusicDistributorTrack", entityId: current.item.id,
      details: { externalTrackId: TRACK_ID, externalReleaseId: RELEASE_ID, rightsGranted: false } } });
    return current.item;
  }, TRANSACTION_OPTIONS);

  let sample;
  let storedTrackId = null;
  let storageStarted = false;
  try {
    // A supplier request must not start if the paused, owned source changed after the claim.
    const live = await namedContext(db, actorUserId, decryptMarker);
    if (live.item.id !== item.id || live.item.importState !== "SAMPLE_CLAIMED" ||
        live.item.audioStatus !== "SAMPLE_CLAIMED" || live.item.trackId != null) {
      fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");
    }
    // The supplier's 90-second/token deadlines must use its moving real clock.
    // `now` above is only for deterministic local database evidence.
    sample = await fetchSample(config);
    if (!sample || !sample.audio || !Buffer.isBuffer(sample.audio.buffer) ||
        sample.supplierRequestCount !== 5 ||
        typeof sample.acknowledge !== "function" || typeof sample.dispose !== "function") {
      fail("PROMOONLY_AUDIO_SAMPLE_RESPONSE_INVALID");
    }
    const inspected = await inspectAudio({ buffer: sample.audio.buffer,
      fileName: sample.audio.fileName, claimedType: sample.audio.contentType });
    if (!/^[0-9a-f]{64}$/.test(inspected?.checksum || "") ||
        !inspected?.contentType || !inspected?.storageKey) {
      fail("PROMOONLY_AUDIO_SAMPLE_MEDIA_INVALID");
    }
    const latest = await namedContext(db, actorUserId, decryptMarker);
    if (latest.item.id !== item.id || latest.item.importState !== "SAMPLE_CLAIMED" ||
        latest.item.trackId != null || latest.item.metadataChecksum !== item.metadataChecksum ||
        latest.item.revision !== item.revision) fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");

    // Preserve the exact downloaded bytes' identity before an R2 write. A copy
    // that succeeds but loses its response is otherwise impossible to reconcile
    // safely without requesting the supplier audio a second time.
    await db.$transaction(async (tx) => {
      const current = await namedContext(tx, actorUserId, decryptMarker);
      if (current.item.id !== item.id || current.item.importState !== "SAMPLE_CLAIMED" ||
          current.item.audioStatus !== "SAMPLE_CLAIMED" || current.item.trackId != null ||
          current.item.metadataChecksum !== item.metadataChecksum ||
          current.item.revision !== item.revision ||
          current.item.sourceChecksumSha256 != null || current.item.sourceMimeType != null ||
          current.item.sourceSizeBytes != null) fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");
      const recorded = await tx.musicDistributorTrack.updateMany({
        where: { id: item.id, connectionId: current.connection.id,
          importState: "SAMPLE_CLAIMED", audioStatus: "SAMPLE_CLAIMED", trackId: null,
          revision: item.revision, metadataChecksum: item.metadataChecksum,
          sourceChecksumSha256: null, sourceMimeType: null, sourceSizeBytes: null },
        data: { sourceChecksumSha256: inspected.checksum,
          sourceMimeType: inspected.contentType,
          sourceSizeBytes: BigInt(sample.audio.buffer.length) }
      });
      if (recorded.count !== 1) fail("PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE");
      await tx.auditLog.create({ data: { actorUserId, action: "PROMOONLY_AUDIO_SAMPLE_BYTES_IDENTIFIED",
        entityType: "MusicDistributorTrack", entityId: item.id,
        details: { checksum: inspected.checksum, storageKey: inspected.storageKey,
          rightsGranted: false, supplierAcknowledged: false } } });
    }, TRANSACTION_OPTIONS);

    const boundedSignal = storageAbortSignal || AbortSignal.timeout(30_000);
    let storageExpired = boundedSignal.aborted;
    const onStorageAbort = () => { storageExpired = true; };
    boundedSignal.addEventListener("abort", onStorageAbort, { once: true });
    const storageInput = { buffer: sample.audio.buffer,
      fileName: sample.audio.fileName, claimedType: sample.audio.contentType, inspected,
      metadata: { title: item.title, artist: item.artist, album: item.album,
        mixName: item.mixName, bpm: item.bpm, releaseYear: item.releaseDate?.getUTCFullYear() || null,
        releaseDate: item.releaseDate, recordLabel: item.label,
        contentWarning: item.contentWarning, catalogueProvider: "PROMO_ONLY",
        durationSeconds: item.durationSeconds, isExplicit: item.isExplicit,
        rightsHolder: item.rightsHolder, rightsReference: item.rightsReference,
        permittedTerritories: "", permittedUses: [], licenceExpiresAt: null,
        licensedCatalogue: false, minimumCatalogueLevel: "NONE", genreIds: [], status: "DRAFT" },
      actorUserId, reviewApproved: false,
      auditContext: { provider: "PROMO_ONLY", externalTrackId: TRACK_ID,
        externalReleaseId: RELEASE_ID, sourceGenre: item.sourceGenre,
        manualAudioSample: true, rightsGranted: false },
      privateSampleStorage: { abortSignal: boundedSignal, cleanupTimeoutMs: 10_000,
        recordKeys: async ({ checksum, quarantineKey, finalStorageKey,
          needsStorageWrite, preexistingReadyAsset }) => {
          if (checksum !== inspected.checksum || finalStorageKey !== inspected.storageKey ||
              !/^quarantine\/catalogue\/[0-9a-f-]{36}\.(mp3|m4a|wav)$/.test(quarantineKey || "")) {
            fail("PROMOONLY_AUDIO_SAMPLE_STORAGE_FAILED");
          }
          await db.auditLog.create({ data: { actorUserId,
            action: "PROMOONLY_AUDIO_SAMPLE_STORAGE_KEYS_IDENTIFIED",
            entityType: "MusicDistributorTrack", entityId: item.id,
            details: { checksum, quarantineKey, finalStorageKey,
              needsStorageWrite, preexistingReadyAsset,
              rightsGranted: false, supplierAcknowledged: false } } });
        } }
    };
    storageStarted = true;
    const pendingStore = Promise.resolve().then(() => storeTrack(storageInput));
    // Do not zero a buffer still in use by an SDK call that ignored abort.
    // Its promise is observed and the bytes are cleared once it settles.
    void pendingStore.then(
      () => { try { sample.audio.buffer.fill(0); } catch {} },
      () => { try { sample.audio.buffer.fill(0); } catch {} }
    );
    const observedStore = pendingStore.then(async (value) => {
      if (storageExpired && value?.track?.id) {
        // The HTTP request may have returned after its deadline; preserve any
        // late draft track as reconciliation evidence, never acknowledge it.
        await markReconciliation(db, item.id, value.track.id,
          "PROMOONLY_AUDIO_SAMPLE_STORAGE_TIMEOUT", inspected.checksum);
        try { await db.auditLog.create({ data: { actorUserId,
          action: "PROMOONLY_AUDIO_SAMPLE_LATE_STORAGE_RESULT",
          entityType: "MusicDistributorTrack", entityId: item.id,
          details: { catalogTrackId: value.track.id, checksum: inspected.checksum,
            rightsGranted: false, supplierAcknowledged: false } } }); } catch {}
      }
      return value;
    });
    let stored;
    let onDeadline;
    try {
      const deadline = new Promise((_, reject) => {
        if (boundedSignal.aborted) {
          storageExpired = true;
          reject(Object.assign(new Error("Private sample storage timed out."),
            { code: "PROMOONLY_AUDIO_SAMPLE_STORAGE_TIMEOUT" }));
          return;
        }
        onDeadline = () => {
          storageExpired = true;
          reject(Object.assign(new Error("Private sample storage timed out."),
            { code: "PROMOONLY_AUDIO_SAMPLE_STORAGE_TIMEOUT" }));
        };
        boundedSignal.addEventListener("abort", onDeadline, { once: true });
      });
      stored = await Promise.race([observedStore, deadline]);
    } finally {
      boundedSignal.removeEventListener("abort", onStorageAbort);
      if (onDeadline) boundedSignal.removeEventListener("abort", onDeadline);
    }
    storedTrackId = stored?.track?.id;
    if (!storedTrackId) fail("PROMOONLY_AUDIO_SAMPLE_STORAGE_FAILED");
    const verifiedTrack = await db.track.findUnique({ where: { id: storedTrackId }, include: { mediaAsset: true } });
    const proofItem = { ...item, trackId: storedTrackId, sourceChecksumSha256: inspected.checksum,
      sourceMimeType: inspected.contentType, sourceSizeBytes: BigInt(sample.audio.buffer.length) };
    if (!safeStoredAsset(proofItem, verifiedTrack)) fail("PROMOONLY_AUDIO_SAMPLE_STORAGE_FAILED");

    await db.$transaction(async (tx) => {
      const current = await namedContext(tx, actorUserId, decryptMarker);
      if (current.item.id !== item.id || current.item.importState !== "SAMPLE_CLAIMED" ||
          current.item.audioStatus !== "SAMPLE_CLAIMED" || current.item.trackId != null ||
          current.item.metadataChecksum !== item.metadataChecksum || current.item.revision !== item.revision) {
        fail("PROMOONLY_AUDIO_SAMPLE_LINK_FAILED");
      }
      const linked = await tx.musicDistributorTrack.updateMany({
        where: { id: item.id, connectionId: current.connection.id, trackId: null,
          importState: "SAMPLE_CLAIMED", audioStatus: "SAMPLE_CLAIMED",
          revision: item.revision, metadataChecksum: item.metadataChecksum },
        data: { trackId: storedTrackId, sourceChecksumSha256: inspected.checksum,
          sourceMimeType: inspected.contentType, sourceSizeBytes: BigInt(sample.audio.buffer.length),
          importState: "RECONCILIATION_REQUIRED", audioStatus: "STORED_PENDING_RIGHTS",
          autoDjReady: false, lastImportErrorCode: "PROMOONLY_AUDIO_SAMPLE_ACK_UNCONFIRMED" }
      });
      if (linked.count !== 1) fail("PROMOONLY_AUDIO_SAMPLE_LINK_FAILED");
      await tx.auditLog.create({ data: { actorUserId, action: "PROMOONLY_AUDIO_SAMPLE_STORED",
        entityType: "MusicDistributorTrack", entityId: item.id,
        details: { catalogTrackId: storedTrackId, checksum: inspected.checksum,
          rightsGranted: false, supplierAcknowledged: false } } });
    }, TRANSACTION_OPTIONS);

    // The acknowledgement is one-shot. A lost response is ambiguous, not retryable.
    try {
      const receipt = await sample.acknowledge();
      if (receipt?.status !== "ACKNOWLEDGED" || receipt.supplierRequestCount !== 6) {
        fail("PROMOONLY_AUDIO_SAMPLE_ACK_UNCONFIRMED");
      }
    }
    catch {
      return { imported: true, playbackAvailable: false, reconciliationRequired: true,
        safeErrorCode: "PROMOONLY_AUDIO_SAMPLE_ACK_UNCONFIRMED" };
    }

    const finalTrack = await db.track.findUnique({ where: { id: storedTrackId }, include: { mediaAsset: true } });
    if (!safeStoredAsset(proofItem, finalTrack)) {
      return { imported: true, playbackAvailable: false, reconciliationRequired: true,
        safeErrorCode: "PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED" };
    }
    await db.$transaction(async (tx) => {
      const current = await namedContext(tx, actorUserId, decryptMarker);
      if (current.item.id !== item.id || current.item.trackId !== storedTrackId ||
          current.item.importState !== "RECONCILIATION_REQUIRED" ||
          current.item.audioStatus !== "STORED_PENDING_RIGHTS" ||
          current.item.lastImportErrorCode !== "PROMOONLY_AUDIO_SAMPLE_ACK_UNCONFIRMED") {
        fail("PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED");
      }
      const completed = await tx.musicDistributorTrack.updateMany({
        where: { id: item.id, trackId: storedTrackId,
          importState: "RECONCILIATION_REQUIRED", audioStatus: "STORED_PENDING_RIGHTS",
          lastImportErrorCode: "PROMOONLY_AUDIO_SAMPLE_ACK_UNCONFIRMED" },
        data: { importState: "CATALOGUED", lastImportErrorCode: null, autoDjReady: false }
      });
      if (completed.count !== 1) fail("PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED");
      await tx.auditLog.create({ data: { actorUserId, action: "PROMOONLY_AUDIO_SAMPLE_IMPORTED",
        entityType: "MusicDistributorTrack", entityId: item.id,
        details: { catalogTrackId: storedTrackId, rightsGranted: false,
          supplierAcknowledged: true, autoDjReady: false } } });
    }, TRANSACTION_OPTIONS);
    return { imported: true, playbackAvailable: true, reconciliationRequired: false, safeErrorCode: null };
  } catch (error) {
    const code = storedTrackId ? "PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED" :
      error?.code === "CATALOGUE_STORAGE_TIMEOUT"
        ? "PROMOONLY_AUDIO_SAMPLE_STORAGE_TIMEOUT" : safePromoOnlyAudioSampleCode(error);
    await markReconciliation(db, item.id, storedTrackId, code);
    fail(code);
  } finally {
    if (!storageStarted) {
      try { sample?.audio?.buffer?.fill(0); } catch { /* No storage operation owns these bytes. */ }
    }
    try { sample?.dispose?.(); } catch { /* Disposal cannot alter the one-shot claim. */ }
  }
}
