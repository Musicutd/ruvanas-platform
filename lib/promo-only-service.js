import crypto from "node:crypto";
import { encryptSecret } from "./crypto.js";
import { PromoOnlyApiClient, safePromoOnlyClientError } from "./promo-only-client.mjs";
import {
  PROMO_ONLY_PROVIDER,
  mapPromoOnlyTrack,
  parsePromoOnlyRss,
  promoOnlyPayloadHash,
  readPromoOnlyConfig
} from "./promo-only.mjs";
import { syncPromoOnlyGenre } from "./provider-genre-service.js";

const MAX_ITEMS_PER_RUN = 250;
const MAX_METADATA_ITEMS_PER_RUN = 25;

function jsonObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function safeError(error, fallback = "PROMOONLY_SYNC_FAILED") { return safePromoOnlyClientError(error || { code: fallback }); }
function sourceDate(value) { return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null; }
function addMinutes(value, minutes) { return new Date(value.getTime() + minutes * 60_000); }

export async function ensurePromoOnlyConnection(db, { actorUserId, config = readPromoOnlyConfig() } = {}) {
  let connection = await db.musicDistributorConnection.findUnique({ where: { providerKey: PROMO_ONLY_PROVIDER } });
  if (connection) return connection;
  if (!actorUserId) throw Object.assign(new Error("A Super Admin must initialise Promo Only before scheduled sync can run."), { code: "PROMOONLY_SETUP_REQUIRED" });
  connection = await db.musicDistributorConnection.create({ data: {
    createdByUserId: actorUserId,
    name: "Promo Only",
    providerKey: PROMO_ONLY_PROVIDER,
    status: config.enabled ? "ACTIVE" : "DRAFT",
    apiBaseUrl: "https://api.promoonly.com/",
    tokenUrl: "https://api.promoonly.com/user/authenticate",
    cataloguePath: "/provider/promo-only/rss",
    clientCredentialsEncrypted: encryptSecret(JSON.stringify({ managedBy: "PROMOONLY_ENVIRONMENT" })),
    oauthScopes: ["catalogue.read", "download.test"],
    defaultMinimumCatalogueLevel: "FOCUSED",
    defaultPermittedTerritories: [],
    defaultPermittedUses: [],
    syncIntervalMinutes: config.pollMinutes,
    nextSyncAt: new Date(),
    configuration: { managedBy: "PROMOONLY_ENVIRONMENT", rssConfigured: Boolean(config.rssUrl), productionLocked: true }
  } });
  await db.auditLog.create({ data: {
    actorUserId,
    action: "PROMOONLY_INTEGRATION_INITIALISED",
    entityType: "MusicDistributorConnection",
    entityId: connection.id,
    details: { providerKey: PROMO_ONLY_PROVIDER, mode: config.mode, productionLocked: true }
  } });
  return connection;
}

export async function fetchPromoOnlyRss(connection, config, { fetchImpl = fetch } = {}) {
  const state = jsonObject(connection.configuration);
  const headers = { accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8", "user-agent": "Ruvanas-PromoOnly-Testing/1.1" };
  if (state.rssEtag) headers["if-none-match"] = state.rssEtag;
  if (state.rssLastModified) headers["if-modified-since"] = state.rssLastModified;
  let response;
  try {
    response = await fetchImpl(config.rssUrl, { headers, redirect: "error", signal: AbortSignal.timeout(config.requestTimeoutMs) });
  } catch {
    throw Object.assign(new Error("Promo Only RSS could not be reached."), { code: "PROMOONLY_RSS_NETWORK" });
  }
  if (response.status === 304) return { notModified: true, items: [], etag: state.rssEtag || null, lastModified: state.rssLastModified || null };
  if (!response.ok) throw Object.assign(new Error(`Promo Only RSS returned HTTP ${response.status}.`), { code: `PROMOONLY_RSS_HTTP_${response.status}` });
  const advertised = Number(response.headers.get("content-length") || 0);
  if (advertised > config.maxRssBytes) throw Object.assign(new Error("Promo Only RSS exceeded the configured response limit."), { code: "PROMOONLY_RSS_TOO_LARGE" });
  const reader = response.body?.getReader?.();
  let text;
  if (reader) {
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > config.maxRssBytes) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error("Promo Only RSS exceeded the configured response limit."), { code: "PROMOONLY_RSS_TOO_LARGE" });
      }
      chunks.push(Buffer.from(value));
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    text = await response.text();
  }
  return {
    notModified: false,
    items: parsePromoOnlyRss(text, { maxBytes: config.maxRssBytes }),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified")
  };
}

function trackArray(payload) {
  if (Array.isArray(payload)) return payload.flatMap((entry) => Array.isArray(entry?.tracks) ? entry.tracks : entry);
  const candidates = [payload?.tracks, payload?.data?.tracks, payload?.release?.tracks, payload?.data, payload?.track];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.flatMap((entry) => Array.isArray(entry?.tracks) ? entry.tracks : entry);
    if (candidate && typeof candidate === "object" && (candidate.trackid || candidate.trackId || candidate.id)) return [candidate];
  }
  if (payload && typeof payload === "object" && (payload.trackid || payload.trackId || payload.id)) return [payload];
  return [];
}

async function resolveFeedItem(client, item) {
  if (item.externalTrackId) return { release: null, tracks: trackArray(await client.track(item.externalTrackId)) };
  if (item.externalReleaseId) {
    const releasePayload = await client.release(item.externalReleaseId);
    const release = releasePayload?.release || releasePayload?.data || releasePayload;
    const tracks = trackArray(releasePayload).map((track) => ({ ...track, releaseid: track.releaseid || item.externalReleaseId }));
    return { release, tracks };
  }
  const recentPayload = await client.recent(1);
  const wanted = String(item.normalizedPayload?.title || "").trim().toLowerCase();
  const matches = trackArray(recentPayload).filter((track) => String(track.title || track.track_title || "").trim().toLowerCase() === wanted);
  return { release: null, tracks: matches.slice(0, 20) };
}

async function upsertRelease(db, connection, metadata) {
  if (!metadata.externalReleaseId) return null;
  return db.musicDistributorRelease.upsert({
    where: { connectionId_externalReleaseId: { connectionId: connection.id, externalReleaseId: metadata.externalReleaseId } },
    create: {
      connectionId: connection.id,
      externalReleaseId: metadata.externalReleaseId,
      title: metadata.album || metadata.title,
      label: metadata.label,
      releaseDate: metadata.releaseDate,
      metadataChecksum: promoOnlyPayloadHash({ title: metadata.album || metadata.title, label: metadata.label, releaseDate: metadata.releaseDate })
    },
    update: {
      title: metadata.album || metadata.title,
      label: metadata.label,
      releaseDate: metadata.releaseDate,
      metadataChecksum: promoOnlyPayloadHash({ title: metadata.album || metadata.title, label: metadata.label, releaseDate: metadata.releaseDate }),
      lastSeenAt: new Date(),
      status: "ACTIVE",
      takenDownAt: null
    }
  });
}

async function upsertPromoOnlyMetadata(db, connection, metadata, config) {
  const genreResult = await syncPromoOnlyGenre(db, metadata.sourceGenre, config);
  const release = await upsertRelease(db, connection, metadata);
  const existing = await db.musicDistributorTrack.findUnique({
    where: { connectionId_externalTrackId: { connectionId: connection.id, externalTrackId: metadata.externalTrackId } }
  });
  const checksum = promoOnlyPayloadHash(metadata.providerMetadata);
  const providerChanged = Boolean(existing && existing.metadataChecksum !== checksum);
  const importedChanged = Boolean(existing?.trackId && providerChanged);
  const data = {
    releaseId: release?.id || null,
    externalRecordingId: metadata.externalRecordingId,
    externalTitleId: metadata.externalTitleId,
    isrc: metadata.isrc ? metadata.isrc.toUpperCase().replace(/[^A-Z0-9]/g, "") : null,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    label: metadata.label,
    mixName: metadata.mixName,
    bpm: metadata.bpm,
    durationSeconds: metadata.durationSeconds,
    releaseDate: metadata.releaseDate,
    genreCodes: genreResult.genre ? [genreResult.genre.slug] : [],
    sourceGenre: metadata.sourceGenre,
    canonicalGenreId: genreResult.genre?.id || null,
    isExplicit: metadata.isExplicit,
    contentWarning: metadata.contentWarning,
    endType: metadata.endType,
    mediaType: metadata.mediaType,
    providerMetadata: metadata.providerMetadata,
    deliveryMode: "DOWNLOAD",
    minimumCatalogueLevel: connection.defaultMinimumCatalogueLevel,
    permittedTerritories: connection.defaultPermittedTerritories,
    permittedUses: connection.defaultPermittedUses,
    rightsHolder: "Promo Only",
    rightsReference: `promo-only:${metadata.externalTrackId}`,
    status: "ACTIVE",
    metadataChecksum: checksum,
    importState: importedChanged ? "RECONCILIATION_REQUIRED" : existing?.trackId ? existing.importState : "METADATA_READY",
    audioStatus: existing?.trackId ? existing.audioStatus : "NOT_REQUESTED",
    ...(importedChanged ? { autoDjReady: false } : {}),
    sourceModifiedAt: metadata.sourceModifiedAt,
    lastSeenAt: new Date(),
    ...(providerChanged ? { revision: { increment: 1 } } : {})
  };
  const track = await db.musicDistributorTrack.upsert({
    where: { connectionId_externalTrackId: { connectionId: connection.id, externalTrackId: metadata.externalTrackId } },
    create: { connectionId: connection.id, externalTrackId: metadata.externalTrackId, ...data },
    update: data
  });
  if (importedChanged) {
    await db.track.update({ where: { id: existing.trackId }, data: { status: "DRAFT", rightsReviewStatus: "DRAFT" } });
    await db.auditLog.create({ data: { actorUserId: connection.createdByUserId, action: "PROMOONLY_METADATA_RECONCILIATION_REQUIRED", entityType: "MusicDistributorTrack", entityId: track.id, details: { externalTrackId: track.externalTrackId, previousChecksum: existing.metadataChecksum, currentChecksum: checksum } } });
  }
  return { track, created: !existing, changed: !existing || providerChanged, genreResult };
}

export async function runPromoOnlySync(db, {
  actorUserId = null,
  trigger = "MANUAL",
  config = readPromoOnlyConfig(),
  fetchImpl = fetch,
  clientFactory = (currentConfig) => new PromoOnlyApiClient(currentConfig, { fetchImpl }),
  now = new Date()
} = {}) {
  if (!config.enabled || config.mode === "OFF") throw Object.assign(new Error("Promo Only sync is disabled."), { code: "PROMOONLY_DISABLED" });
  const connection = await ensurePromoOnlyConnection(db, { actorUserId, config });
  const correlationId = crypto.randomUUID();
  const run = await db.musicDistributorSyncRun.create({ data: {
    connectionId: connection.id,
    kind: connection.syncCursor ? "DELTA" : "FULL",
    status: "RUNNING",
    trigger,
    mode: config.mode,
    correlationId,
    attempt: 1,
    startedAt: now
  } });
  let fetchedCount = 0;
  let newCount = 0;
  let enrichedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let rejectedCount = 0;
  try {
    const rss = await fetchPromoOnlyRss(connection, config, { fetchImpl });
    fetchedCount = rss.items.length;
    if (fetchedCount > MAX_ITEMS_PER_RUN) throw Object.assign(new Error("The Promo Only feed exceeds the testing-run limit; no truncated feed was accepted."), { code: "PROMOONLY_RSS_RUN_LIMIT" });
    for (const item of rss.items.slice(0, MAX_ITEMS_PER_RUN)) {
      const existing = await db.musicProviderFeedItem.findUnique({ where: { connectionId_idempotencyKey: { connectionId: connection.id, idempotencyKey: item.idempotencyKey } } });
      const changed = !existing || existing.rawHash !== item.rawHash;
      await db.musicProviderFeedItem.upsert({
        where: { connectionId_idempotencyKey: { connectionId: connection.id, idempotencyKey: item.idempotencyKey } },
        create: {
          connectionId: connection.id,
          idempotencyKey: item.idempotencyKey,
          externalGuid: item.guid,
          sourceUrl: item.link,
          publishedAt: item.publishedAt,
          rawHash: item.rawHash,
          normalizedPayload: { title: item.title, description: item.description, category: item.category, raw: item.raw },
          externalReleaseId: item.releaseId,
          externalTrackId: item.trackId,
          status: "DISCOVERED"
        },
        update: {
          externalGuid: item.guid,
          sourceUrl: item.link,
          publishedAt: item.publishedAt,
          rawHash: item.rawHash,
          normalizedPayload: { title: item.title, description: item.description, category: item.category, raw: item.raw },
          externalReleaseId: item.releaseId || existing?.externalReleaseId,
          externalTrackId: item.trackId || existing?.externalTrackId,
          lastSeenAt: now,
          ...(changed ? { status: "DISCOVERED", lastErrorCode: null } : {})
        }
      });
      if (!existing) newCount += 1;
    }
    const existingConfiguration = jsonObject(connection.configuration);
    await db.musicDistributorConnection.update({ where: { id: connection.id }, data: {
      configuration: { ...existingConfiguration, rssEtag: rss.etag || null, rssLastModified: rss.lastModified || null, productionLocked: true },
      syncIntervalMinutes: config.pollMinutes,
      nextSyncAt: addMinutes(now, config.pollMinutes)
    } });

    if (["METADATA", "AUDIO_TEST"].includes(config.mode)) {
      // DISCOVERY rows also enter this queue when the mode is later raised to METADATA.
      // Bounded batches avoid a long provider call holding a lease indefinitely.
      const changedItems = await db.musicProviderFeedItem.findMany({ where: { connectionId: connection.id, status: { in: ["DISCOVERED", "FAILED_RETRYABLE"] } }, orderBy: { lastSeenAt: "asc" }, take: MAX_METADATA_ITEMS_PER_RUN });
      const client = clientFactory(config);
      for (const feedItem of changedItems) {
        try {
          await db.musicProviderFeedItem.update({ where: { id: feedItem.id }, data: { status: "RESOLVING", lastErrorCode: null } });
          const resolved = await resolveFeedItem(client, feedItem);
          if (!resolved.tracks.length) throw Object.assign(new Error("Promo Only metadata could not be resolved from this feed item."), { code: "PROMOONLY_IDENTITY_UNRESOLVED" });
          let primaryTrackId = null;
          for (const rawTrack of resolved.tracks) {
            const metadata = mapPromoOnlyTrack(rawTrack, resolved.release || {});
            const result = await upsertPromoOnlyMetadata(db, connection, metadata, config);
            primaryTrackId ||= result.track.externalTrackId;
            enrichedCount += 1;
            if (result.created) newCount += 1;
            else if (result.changed) updatedCount += 1;
            else unchangedCount += 1;
          }
          await db.musicProviderFeedItem.update({ where: { id: feedItem.id }, data: { status: "METADATA_READY", externalTrackId: primaryTrackId, lastErrorCode: null } });
        } catch (error) {
          rejectedCount += 1;
          await db.musicProviderFeedItem.update({ where: { id: feedItem.id }, data: { status: "FAILED_RETRYABLE", lastErrorCode: safeError(error) } });
        }
      }
    }

    const completedAt = new Date();
    await db.$transaction([
      db.musicDistributorSyncRun.update({ where: { id: run.id }, data: {
        status: "SUCCEEDED",
        releasesReceived: 0,
        tracksReceived: enrichedCount,
        fetchedCount,
        enrichedCount,
        createdCount: newCount,
        updatedCount,
        unchangedCount,
        rejectedCount,
        completedAt
      } }),
      db.musicDistributorConnection.update({ where: { id: connection.id }, data: {
        status: "ACTIVE",
        lastSuccessfulSyncAt: completedAt,
        lastErrorAt: null,
        lastErrorCode: null,
        consecutiveFailures: 0,
        syncCursor: completedAt.toISOString()
      } }),
      db.auditLog.create({ data: {
        actorUserId: actorUserId || connection.createdByUserId,
        action: "PROMOONLY_SYNC_COMPLETED",
        entityType: "MusicDistributorSyncRun",
        entityId: run.id,
        details: { correlationId, mode: config.mode, trigger, fetchedCount, newCount, enrichedCount, updatedCount, rejectedCount }
      } })
    ]);
    return { runId: run.id, correlationId, mode: config.mode, fetchedCount, newCount, enrichedCount, updatedCount, unchangedCount, rejectedCount };
  } catch (error) {
    const errorCode = safeError(error);
    const failedAt = new Date();
    await db.$transaction([
      db.musicDistributorSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", fetchedCount, enrichedCount, createdCount: newCount, updatedCount, unchangedCount, rejectedCount, safeErrorCode: errorCode, completedAt: failedAt, nextRetryAt: addMinutes(failedAt, Math.max(15, config.pollMinutes)) } }),
      db.musicDistributorConnection.update({ where: { id: connection.id }, data: { status: "DEGRADED", lastErrorAt: failedAt, lastErrorCode: errorCode, consecutiveFailures: { increment: 1 }, nextSyncAt: addMinutes(failedAt, Math.max(15, config.pollMinutes)) } }),
      db.auditLog.create({ data: { actorUserId: actorUserId || connection.createdByUserId, action: "PROMOONLY_SYNC_FAILED", entityType: "MusicDistributorSyncRun", entityId: run.id, details: { correlationId, mode: config.mode, trigger, errorCode } } })
    ]);
    throw Object.assign(new Error("Promo Only synchronisation failed safely."), { code: errorCode });
  }
}

export async function processDuePromoOnlySync(db, { workerId, fetchImpl = fetch, now = new Date() } = {}) {
  let config;
  try { config = readPromoOnlyConfig(); } catch (error) { return { claimed: 0, succeeded: 0, failed: 1, errorCode: safeError(error) }; }
  if (!config.enabled || config.mode === "OFF") return { claimed: 0, succeeded: 0, failed: 0 };
  const connection = await db.musicDistributorConnection.findUnique({ where: { providerKey: PROMO_ONLY_PROVIDER } });
  if (!connection || !["ACTIVE", "DEGRADED"].includes(connection.status) || (connection.nextSyncAt && connection.nextSyncAt > now)) return { claimed: 0, succeeded: 0, failed: 0 };
  const leaseUntil = new Date(now.getTime() + 60 * 60_000);
  const claimed = await db.musicDistributorConnection.updateMany({
    where: { id: connection.id, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: now } }] },
    data: { syncLeaseOwner: workerId, syncLeaseUntil: leaseUntil }
  });
  if (claimed.count !== 1) return { claimed: 0, succeeded: 0, failed: 0 };
  try {
    await runPromoOnlySync(db, { actorUserId: null, trigger: "SCHEDULED", config, fetchImpl, now });
    return { claimed: 1, succeeded: 1, failed: 0 };
  } catch {
    return { claimed: 1, succeeded: 0, failed: 1 };
  } finally {
    await db.musicDistributorConnection.updateMany({ where: { id: connection.id, syncLeaseOwner: workerId }, data: { syncLeaseOwner: null, syncLeaseUntil: null } });
  }
}
