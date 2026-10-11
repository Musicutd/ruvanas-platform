import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { PROMO_ONLY_PROVIDER } from "./promo-only.mjs";
import { fetchPromoOnlyMetadataSample, readPromoOnlyMetadataSampleConfig } from "./promo-only-metadata-sample.mjs";
import { upsertPromoOnlyMetadata } from "./promo-only-service.js";

const MANUAL_MARKER = "PROMOONLY_MANUAL_METADATA_SAMPLE_V1";
const API_BASE_URL = "https://api.promoonly.com/";
const TOKEN_URL = "https://api.promoonly.com/user/authenticate";
const CATALOGUE_PATH = "/releases/date/1";
const TRANSACTION_OPTIONS = Object.freeze({ isolationLevel: "Serializable", maxWait: 5_000, timeout: 15_000 });

function sampleError(code) {
  return Object.assign(new Error("Promo Only metadata sample is unavailable."), { code });
}

/** Native no-body POSTs may still arrive with an empty stream in a web adapter. */
export async function sampleRequestBodyIsEmpty(request, { timeoutMs = 5_000 } = {}) {
  const advertised = request?.headers?.get?.("content-length");
  if (advertised !== null && advertised !== "0") return false;
  if (request?.body === null) return true;
  if (!request?.body?.getReader) return false;
  let reader;
  let timer;
  try {
    reader = request.body.getReader();
    const first = await Promise.race([
      reader.read(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })
    ]);
    if (first?.done === true && !first.value?.byteLength) return true;
    void reader.cancel().catch(() => {});
    return false;
  } catch {
    if (reader) void reader.cancel().catch(() => {});
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isPositiveSupplierId(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
}

function assertSampleConfig(config, actorUserId) {
  if (!actorUserId || typeof actorUserId !== "string") throw sampleError("PROMOONLY_SAMPLE_ACTOR_REQUIRED");
  if (config?.enabled !== true || config?.ready !== true || config?.manualOnly !== true ||
    config?.mode !== "METADATA" || config?.audioDownloadEnabled !== false ||
    config?.allowHttpMediaTest !== false || config?.autoCreateGenres !== false ||
    config?.genreReviewRequired !== true || config?.retryMax !== 0 || config?.rssUrl) {
    throw sampleError("PROMOONLY_SAMPLE_DISABLED");
  }
}

function hasEncryptedManualMarker(connection, decryptMarker) {
  try {
    const marker = JSON.parse(decryptMarker(connection.clientCredentialsEncrypted));
    return marker && !Array.isArray(marker) && Object.keys(marker).length === 1 &&
      marker.managedBy === MANUAL_MARKER;
  } catch {
    return false;
  }
}

function assertManualConnection(connection, actorUserId, decryptMarker) {
  if (!connection) return;
  const state = connection.configuration;
  if (connection.providerKey !== PROMO_ONLY_PROVIDER || connection.name !== "Promo Only" ||
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
    !hasEncryptedManualMarker(connection, decryptMarker)) {
    throw sampleError("PROMOONLY_SAMPLE_CONNECTION_CONFLICT");
  }
}

async function manualConnection(tx, actorUserId, now, encryptMarker, decryptMarker) {
  const existing = await tx.musicDistributorConnection.findUnique({ where: { providerKey: PROMO_ONLY_PROVIDER } });
  assertManualConnection(existing, actorUserId, decryptMarker);
  if (existing) return existing;
  return tx.musicDistributorConnection.create({ data: {
    createdByUserId: actorUserId,
    name: "Promo Only",
    providerKey: PROMO_ONLY_PROVIDER,
    status: "PAUSED",
    apiBaseUrl: API_BASE_URL,
    tokenUrl: TOKEN_URL,
    cataloguePath: CATALOGUE_PATH,
    clientCredentialsEncrypted: encryptMarker(JSON.stringify({ managedBy: MANUAL_MARKER })),
    oauthScopes: ["catalogue.read"],
    defaultMinimumCatalogueLevel: "FOCUSED",
    defaultPermittedTerritories: [],
    defaultPermittedUses: [],
    nextSyncAt: null,
    pausedAt: now,
    configuration: { managedBy: MANUAL_MARKER, manualOnly: true, rssConfigured: false, productionLocked: true }
  } });
}

/** One explicit, metadata-only supplier sample. No RSS, schedule, media or rights grant. */
export async function runPromoOnlyMetadataSample(db, {
  actorUserId,
  config = readPromoOnlyMetadataSampleConfig(),
  fetchImpl = fetch,
  fetchSample = fetchPromoOnlyMetadataSample,
  encryptMarker = encryptSecret,
  decryptMarker = decryptSecret,
  now = new Date()
} = {}) {
  assertSampleConfig(config, actorUserId);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw sampleError("PROMOONLY_SAMPLE_TIME_INVALID");

  // A read-only preflight avoids supplier requests against a legacy or scheduled connection.
  const before = await db.musicDistributorConnection.findUnique({ where: { providerKey: PROMO_ONLY_PROVIDER } });
  assertManualConnection(before, actorUserId, decryptMarker);

  const sample = await fetchSample(config, { fetchImpl, now: () => now.getTime() });
  const metadata = sample?.metadata;
  if (sample?.requestCount !== 4 || !Number.isSafeInteger(sample?.releaseCount) || sample.releaseCount < 1 ||
    !isPositiveSupplierId(metadata?.externalTrackId) ||
    !isPositiveSupplierId(metadata?.externalReleaseId) || metadata?.mediaType !== "2") {
    throw sampleError("PROMOONLY_SAMPLE_RESPONSE_INVALID");
  }

  return db.$transaction(async (tx) => {
    const connection = await manualConnection(tx, actorUserId, now, encryptMarker, decryptMarker);
    const existing = await tx.musicDistributorTrack.findUnique({
      where: { connectionId_externalTrackId: { connectionId: connection.id, externalTrackId: metadata.externalTrackId } }
    });
    if (existing && (existing.trackId != null || existing.sourceUrlEncrypted != null ||
      existing.audioStatus !== "NOT_REQUESTED" || existing.autoDjReady === true)) {
      throw sampleError("PROMOONLY_SAMPLE_MEDIA_EXISTS");
    }

    const result = await upsertPromoOnlyMetadata(tx, connection, metadata, config);
    if (result.track.connectionId !== connection.id ||
      result.track.externalTrackId !== metadata.externalTrackId ||
      result.track.trackId != null || result.track.sourceUrlEncrypted != null ||
      result.track.audioStatus !== "NOT_REQUESTED" || result.track.autoDjReady === true) {
      throw sampleError("PROMOONLY_SAMPLE_MEDIA_EXISTS");
    }
    const createdCount = result.created ? 1 : 0;
    const updatedCount = !result.created && result.changed ? 1 : 0;
    const unchangedCount = !result.changed ? 1 : 0;
    const run = await tx.musicDistributorSyncRun.create({ data: {
      connectionId: connection.id,
      kind: "DELTA",
      status: "SUCCEEDED",
      trigger: "MANUAL_API_SAMPLE",
      mode: "METADATA_SAMPLE",
      correlationId: crypto.randomUUID(),
      releasesReceived: 1,
      tracksReceived: 1,
      fetchedCount: 1,
      enrichedCount: 1,
      createdCount,
      updatedCount,
      unchangedCount,
      downloadedCount: 0,
      attempt: 1,
      startedAt: now,
      completedAt: new Date()
    } });
    await tx.auditLog.create({ data: {
      actorUserId,
      action: "PROMOONLY_METADATA_SAMPLE_IMPORTED",
      entityType: "MusicDistributorSyncRun",
      entityId: run.id,
      details: {
        providerKey: PROMO_ONLY_PROVIDER,
        trigger: "MANUAL_API_SAMPLE",
        externalReleaseId: metadata.externalReleaseId,
        externalTrackId: metadata.externalTrackId,
        createdCount, updatedCount, unchangedCount,
        requestCount: sample.requestCount,
        audioImported: false,
        rightsGranted: false
      }
    } });
    return { createdCount, updatedCount, unchangedCount, requestCount: sample.requestCount,
      releaseCount: sample.releaseCount, tracksReceived: 1, downloadedCount: 0 };
  }, TRANSACTION_OPTIONS);
}
