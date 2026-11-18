import { PromoOnlyApiClient, PromoOnlyTokenManager } from "./promo-only-client.mjs";
import { readPromoOnlyMetadataSampleConfig } from "./promo-only-metadata-sample.mjs";
import { mapPromoOnlyTrack } from "./promo-only.mjs";

const ORIGIN = "https://api.promoonly.com";
const MAX_ITEMS = 500;
const MAX_TRACKS = 25;
const MAX_REQUESTS = MAX_TRACKS + 3;
const TOTAL_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUIRED_UNSUPPORTED = ["rights", "territories", "licenceWindow", "supplierTierEntitlement", "offlineCachingPermission"];
const RIGHTS_FIELDS = [...REQUIRED_UNSUPPORTED, "permittedTerritories", "permittedUses", "minimumCatalogueLevel", "licenceStartsAt", "licenceExpiresAt"];
const validConfigs = new WeakSet();

export class PromoOnlyMetadataBatchError extends Error {
  constructor(code, requestCount = 0) {
    super(code);
    this.name = "PromoOnlyMetadataBatchError";
    this.code = code;
    this.requestCount = requestCount;
  }
}

function fail(code, requestCount = 0) { throw new PromoOnlyMetadataBatchError(code, requestCount); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function decimalId(value) {
  const text = String(value ?? "");
  return /^[1-9][0-9]*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}
function mediaType(value) { return value === 1 || value === 2 ? value : null; }
function dateOnly(value, nowMs) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  const year = new Date(time).getUTCFullYear();
  return year >= 1877 && year <= new Date(nowMs).getUTCFullYear() + 2 ? time : null;
}
function sourceTimestamp(value, nowMs) {
  const seconds = Number(value);
  const date = Number.isSafeInteger(seconds) && seconds > 946_684_800 ? new Date(seconds * 1000) : null;
  return date && Number.isFinite(date.getTime()) && date.getUTCFullYear() <= new Date(nowMs).getUTCFullYear() + 2 ? date : null;
}
function rejectRights(value, requestCount) {
  if (RIGHTS_FIELDS.some((field) => Object.hasOwn(value, field))) fail("PROMOONLY_BATCH_RIGHTS_UNSAFE", requestCount);
}

/** Reuses the existing manual-only sample gate; this batch also requires both audio switches off. */
export function readPromoOnlyMetadataBatchConfig(env = process.env) {
  const sample = readPromoOnlyMetadataSampleConfig(env);
  const base = {
    enabled: sample.enabled, ready: false, manualOnly: true, mode: "METADATA",
    credentialsConfigured: sample.credentialsConfigured, audioDownloadEnabled: false,
    allowHttpMediaTest: false, autoCreateGenres: false, genreReviewRequired: true,
    maxTracks: MAX_TRACKS, maxRequests: MAX_REQUESTS, totalTimeoutMs: TOTAL_TIMEOUT_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS, retryMax: 0
  };
  if (!sample.ready || env.PROMOONLY_AUDIO_SAMPLE_ENABLED !== "false") return Object.freeze(base);
  const config = { ...base, ready: true };
  Object.defineProperties(config, {
    userId: { value: sample.userId }, apiKey: { value: sample.apiKey }, apiSecret: { value: sample.apiSecret }
  });
  Object.freeze(config);
  validConfigs.add(config);
  return config;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error("aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

function releasesFromFirstPage(payload, nowMs, requestCount) {
  if (!Array.isArray(payload) || payload.length > MAX_ITEMS) fail("PROMOONLY_BATCH_LIST_SCHEMA", requestCount);
  const releases = [];
  const ids = new Set();
  for (const bucket of payload) {
    const day = dateOnly(bucket?.date, nowMs);
    const timestamp = Number(bucket?.ts);
    if (!object(bucket) || day === null || !Number.isSafeInteger(timestamp)
      || timestamp * 1000 < day || timestamp * 1000 >= day + 86_400_000
      || !Array.isArray(bucket.releases) || bucket.releases.length > MAX_ITEMS
      || releases.length + bucket.releases.length > MAX_ITEMS) fail("PROMOONLY_BATCH_LIST_SCHEMA", requestCount);
    for (const release of bucket.releases) {
      const id = decimalId(release?.id);
      if (!object(release) || !id || mediaType(release.type) === null
        || (release.media_type !== undefined && release.media_type !== release.type)) fail("PROMOONLY_BATCH_LIST_SCHEMA", requestCount);
      rejectRights(release, requestCount);
      if (ids.has(id)) fail("PROMOONLY_BATCH_DUPLICATE_RELEASE", requestCount);
      ids.add(id);
      releases.push({ ...release, date: bucket.date });
    }
  }
  return releases;
}

function safeClientCode(error, requestCount) {
  if (error instanceof PromoOnlyMetadataBatchError) return error;
  const code = String(error?.code || "");
  const permitted = new Set([
    "PROMOONLY_HTTP_401", "PROMOONLY_HTTP_429", "PROMOONLY_RESPONSE_TOO_LARGE",
    "PROMOONLY_RESPONSE_NOT_JSON", "PROMOONLY_RESPONSE_INVALID_JSON", "PROMOONLY_RESPONSE_READ_FAILED",
    "PROMOONLY_AUTH_EXPIRY_INVALID", "PROMOONLY_AUTH_TOKEN_MISSING", "PROMOONLY_METADATA_INCOMPLETE"
  ]);
  return new PromoOnlyMetadataBatchError(permitted.has(code)
    ? `PROMOONLY_BATCH_${code.slice("PROMOONLY_".length)}` : "PROMOONLY_BATCH_REQUEST_FAILED", requestCount);
}

/** One first-page/audio-release chain, capped at 25 tracks. No pagination, refresh, retry, queue or media call. */
export async function fetchPromoOnlyMetadataBatch(config, { fetchImpl = globalThis.fetch, now = () => Date.now(), abortSignal = null } = {}) {
  if (!validConfigs.has(config) || !config.enabled || !config.ready) fail("PROMOONLY_BATCH_NOT_READY");
  if (typeof fetchImpl !== "function") fail("PROMOONLY_BATCH_FETCH_UNAVAILABLE");
  if (abortSignal !== null && !(abortSignal instanceof AbortSignal)) fail("PROMOONLY_BATCH_SIGNAL_INVALID");
  let requestCount = 0;
  const clock = () => {
    const value = typeof now === "function" ? now() : now;
    const ms = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(ms)) fail("PROMOONLY_BATCH_CLOCK_INVALID", requestCount);
    return ms;
  };
  const startMs = clock();
  const totalSignal = AbortSignal.any([AbortSignal.timeout(TOTAL_TIMEOUT_MS), abortSignal].filter(Boolean));
  const assertDeadline = () => {
    const elapsed = clock() - startMs;
    if (elapsed < 0) fail("PROMOONLY_BATCH_CLOCK_INVALID", requestCount);
    if (totalSignal.aborted || elapsed >= TOTAL_TIMEOUT_MS) fail("PROMOONLY_BATCH_DEADLINE", requestCount);
  };
  let selectedReleaseId = null;
  let selectedTrackIds = [];
  let guardFailure = null;
  const guardedFetch = async (input, options = {}) => {
    let requestSignal = null;
    try {
      assertDeadline();
      let expected;
      if (requestCount === 0) expected = { method: "POST", path: "/user/authenticate" };
      else if (requestCount === 1) expected = { method: "GET", path: "/releases/date/1" };
      else if (requestCount === 2 && selectedReleaseId) expected = { method: "GET", path: `/release/${selectedReleaseId}` };
      else if (selectedTrackIds[requestCount - 3]) expected = { method: "GET", path: `/track/${selectedTrackIds[requestCount - 3]}` };
      if (!expected || requestCount >= MAX_REQUESTS) fail("PROMOONLY_BATCH_REQUEST_LIMIT", requestCount);
      const url = new URL(String(input));
      const method = String(options.method || "GET").toUpperCase();
      if (url.href !== `${ORIGIN}${expected.path}` || method !== expected.method || options.redirect !== "error"
        || (method === "GET" && options.body)) fail("PROMOONLY_BATCH_REQUEST_NOT_ALLOWED", requestCount);
      requestCount += 1;
      const signal = AbortSignal.any([totalSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS), options.signal].filter(Boolean));
      requestSignal = signal;
      const response = await abortable(fetchImpl(input, { ...options, signal, redirect: "error" }), signal);
      assertDeadline();
      if (!response || !response.headers?.get || !response.body?.getReader) fail("PROMOONLY_BATCH_RESPONSE_INVALID", requestCount);
      if (response.redirected || (response.status >= 300 && response.status < 400)) fail("PROMOONLY_BATCH_REDIRECT_BLOCKED", requestCount);
      // Every body remains under the existing client's 2 MiB cap and the live deadline.
      return { ok: response.ok, status: response.status, headers: response.headers, body: { getReader() {
        const reader = response.body.getReader();
        return {
          read: async () => {
            try {
              assertDeadline();
              const result = await abortable(reader.read(), signal);
              assertDeadline();
              return result;
            } catch (error) {
              void reader.cancel().catch(() => {});
              if (error instanceof PromoOnlyMetadataBatchError) guardFailure = error;
              else if (signal.aborted) guardFailure = new PromoOnlyMetadataBatchError("PROMOONLY_BATCH_DEADLINE", requestCount);
              throw error;
            }
          },
          cancel: (reason) => reader.cancel(reason)
        };
      } } };
    } catch (error) {
      guardFailure = error instanceof PromoOnlyMetadataBatchError ? error
        : new PromoOnlyMetadataBatchError(requestSignal?.aborted || totalSignal.aborted ? "PROMOONLY_BATCH_DEADLINE" : "PROMOONLY_BATCH_NETWORK", requestCount);
      throw guardFailure;
    }
  };
  let tokenManager;
  try {
    tokenManager = new PromoOnlyTokenManager(config, { fetchImpl: guardedFetch, now: clock });
    const client = new PromoOnlyApiClient(config, { fetchImpl: guardedFetch, tokenManager, now: clock });
    const request = async (path) => {
      assertDeadline();
      if (!Number.isFinite(tokenManager.cached?.expiresAt) || tokenManager.cached.expiresAt - clock() <= 30_000) {
        fail("PROMOONLY_BATCH_TOKEN_EXPIRY_TOO_SHORT", requestCount);
      }
      const result = await client.request(path, { retryAuth: false, retryTransient: false });
      assertDeadline();
      return result;
    };
    assertDeadline();
    await tokenManager.getToken();
    assertDeadline();
    if (!Number.isFinite(tokenManager.cached?.expiresAt) || tokenManager.cached.expiresAt - clock() <= TOTAL_TIMEOUT_MS + 30_000) {
      fail("PROMOONLY_BATCH_TOKEN_EXPIRY_TOO_SHORT", requestCount);
    }
    const releases = releasesFromFirstPage(await request("/releases/date/1"), startMs, requestCount);
    if (!releases.length) fail("PROMOONLY_BATCH_EMPTY_RELEASE_LIST", requestCount);
    const selected = releases.find((release) => release.type === 2);
    if (!selected) fail("PROMOONLY_BATCH_NO_AUDIO_RELEASE", requestCount);
    selectedReleaseId = decimalId(selected.id);
    const release = await request(`/release/${selectedReleaseId}`);
    if (!object(release) || !decimalId(release.id) || !Array.isArray(release.tracks) || release.tracks.length > MAX_ITEMS) {
      fail("PROMOONLY_BATCH_RELEASE_SCHEMA", requestCount);
    }
    if (decimalId(release.id) !== selectedReleaseId) fail("PROMOONLY_BATCH_RELEASE_ID_MISMATCH", requestCount);
    if (!release.tracks.length) fail("PROMOONLY_BATCH_EMPTY_RELEASE_TRACKS", requestCount);
    rejectRights(release, requestCount);
    const ids = new Set();
    for (const track of release.tracks) {
      const id = decimalId(track?.trackid);
      if (!object(track) || !id || mediaType(track.media_type) === null
        || (track.releaseid !== undefined && decimalId(track.releaseid) !== selectedReleaseId)) fail("PROMOONLY_BATCH_RELEASE_SCHEMA", requestCount);
      if (track.media_type !== 2) fail("PROMOONLY_BATCH_TRACK_NOT_AUDIO", requestCount);
      if (ids.has(id)) fail("PROMOONLY_BATCH_DUPLICATE_TRACK", requestCount);
      rejectRights(track, requestCount);
      ids.add(id);
    }
    selectedTrackIds = [...ids].slice(0, MAX_TRACKS);
    const metadata = [];
    for (const selectedTrackId of selectedTrackIds) {
      const track = await request(`/track/${selectedTrackId}`);
      if (!object(track) || !decimalId(track.id) || mediaType(track.media_type) === null) fail("PROMOONLY_BATCH_TRACK_SCHEMA", requestCount);
      if (decimalId(track.id) !== selectedTrackId) fail("PROMOONLY_BATCH_TRACK_ID_MISMATCH", requestCount);
      if (track.media_type !== 2) fail("PROMOONLY_BATCH_TRACK_NOT_AUDIO", requestCount);
      if (decimalId(track.releaseid) !== selectedReleaseId) fail("PROMOONLY_BATCH_TRACK_RELEASE_ID_MISMATCH", requestCount);
      rejectRights(track, requestCount);
      if (dateOnly(track.release_date, startMs) === null) fail("PROMOONLY_BATCH_METADATA_INVALID", requestCount);
      const first = mapPromoOnlyTrack(track, release);
      const second = mapPromoOnlyTrack(track, release);
      if (first.externalTrackId !== selectedTrackId || first.externalReleaseId !== selectedReleaseId
        || JSON.stringify(first) !== JSON.stringify(second)) fail("PROMOONLY_BATCH_NORMALIZATION_UNSTABLE", requestCount);
      if (dateOnly(first.releaseDate?.toISOString().slice(0, 10), startMs) === null || !sourceTimestamp(track.modified, startMs)
        || !first.sourceModifiedAt || first.mediaType !== "2" || !first.audioFormats.length || first.audioFormats.length > 16
        || first.audioFormats.some((format) => !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(format))) fail("PROMOONLY_BATCH_METADATA_INVALID", requestCount);
      if (!REQUIRED_UNSUPPORTED.every((field) => first.unsupportedFields.includes(field))
        || RIGHTS_FIELDS.some((field) => Object.hasOwn(first, field))) fail("PROMOONLY_BATCH_RIGHTS_UNSAFE", requestCount);
      metadata.push(first);
    }
    assertDeadline();
    if (requestCount !== metadata.length + 3 || requestCount > MAX_REQUESTS) fail("PROMOONLY_BATCH_REQUEST_LIMIT", requestCount);
    return { metadata, requestCount, releaseCount: releases.length, selectedReleaseId, truncatedCount: release.tracks.length - metadata.length };
  } catch (error) {
    if (guardFailure) throw guardFailure;
    assertDeadline();
    throw safeClientCode(error, requestCount);
  } finally { tokenManager?.clear(); }
}
