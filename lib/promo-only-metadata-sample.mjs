import { PromoOnlyApiClient, PromoOnlyTokenManager } from "./promo-only-client.mjs";
import { mapPromoOnlyTrack } from "./promo-only.mjs";
import { readPrivatePreviewPolicy } from "./private-preview-policy.mjs";

const ORIGIN = "https://api.promoonly.com";
const PREVIEW_URL = "https://ruvanas-private-preview-20261011.onrender.com";
const PAID_PREVIEW_URL = "https://ruvanas-platform.onrender.com";
const PUBLIC_PREVIEW_URL = "https://www.ruvanas.com";
const PREVIEW_DB_HOST = "dpg-db5kurijnfac73arripg-a";
const PREVIEW_DB_NAME = "ruvanas_private_preview_20261011";
const PREVIEW_SERVICE_ID = "srv-db5l9d7lk1mc73ad8v7g";
const PAID_PREVIEW_SERVICE_ID = "srv-da03b5lbedkc739q74k0";
const MAX_ITEMS = 500;
const TOTAL_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUIRED_UNSUPPORTED = ["rights", "territories", "licenceWindow", "supplierTierEntitlement", "offlineCachingPermission"];
const validConfigs = new WeakSet();

export class PromoOnlyMetadataSampleError extends Error {
  constructor(code, requestCount = 0) {
    super(code);
    this.name = "PromoOnlyMetadataSampleError";
    this.code = code;
    this.requestCount = requestCount;
  }
}

function fail(code, requestCount = 0) {
  throw new PromoOnlyMetadataSampleError(code, requestCount);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decimalId(value) {
  const text = String(value ?? "");
  return /^[1-9][0-9]*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}

function mediaType(value) {
  return value === 1 || value === 2 ? value : null;
}

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

function isPreviewDatabase(value) {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && url.hostname === PREVIEW_DB_HOST
      && url.pathname === `/${PREVIEW_DB_NAME}`
      && Boolean(url.username && url.password)
      && (!url.port || url.port === "5432")
      && (url.search === "" || url.search === "?connection_limit=3")
      && !String(value).includes("#") && !url.hash;
  } catch { return false; }
}

function credential(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1024
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Manual metadata sample only; credentials are deliberately non-enumerable. */
export function readPromoOnlyMetadataSampleConfig(env = process.env) {
  const enabled = env?.PROMOONLY_METADATA_SAMPLE_ENABLED === "true";
  const base = {
    enabled, ready: false, manualOnly: true, mode: "METADATA",
    credentialsConfigured: false, audioDownloadEnabled: false,
    allowHttpMediaTest: false, autoCreateGenres: false,
    genreReviewRequired: true, retryMax: 0, requestTimeoutMs: REQUEST_TIMEOUT_MS
  };
  if (!enabled) return Object.freeze(base);
  const publicSiteMode = env.RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE;
  const legacyMode = publicSiteMode === undefined || publicSiteMode === "0";
  const publicPolicy = publicSiteMode === "1" ? readPrivatePreviewPolicy(env) : null;
  const pinnedPreviewService =
    (legacyMode && env.RENDER_SERVICE_ID === PREVIEW_SERVICE_ID && env.RUVANAS_PUBLIC_URL === PREVIEW_URL)
    || (legacyMode && env.RENDER_SERVICE_ID === PAID_PREVIEW_SERVICE_ID && env.RUVANAS_PUBLIC_URL === PAID_PREVIEW_URL)
    || (publicSiteMode === "1" && env.RENDER_SERVICE_ID === PAID_PREVIEW_SERVICE_ID
      && env.RUVANAS_PUBLIC_URL === PUBLIC_PREVIEW_URL && publicPolicy?.enabled && publicPolicy.valid
      && publicPolicy.publicSite === true && publicPolicy.previewOrigin === PUBLIC_PREVIEW_URL);
  const gate = env.RUVANAS_ENVIRONMENT === "PRIVATE_PREVIEW"
    && env.RUVANAS_PRIVATE_PREVIEW_ENABLED === "1"
    && pinnedPreviewService
    && isPreviewDatabase(env.DATABASE_URL)
    && env.PROMOONLY_ENABLED === "false" && env.PROMOONLY_MODE === "OFF"
    && env.PROMOONLY_AUDIO_DOWNLOAD_ENABLED === "false"
    && env.PROMOONLY_ALLOW_HTTP_MEDIA_TEST === "false";
  const userId = decimalId(env.PROMOONLY_USER_ID);
  const credentialsConfigured = Boolean(userId && credential(env.PROMOONLY_API_KEY) && credential(env.PROMOONLY_API_SECRET)
    && !env.PROMOONLY_API_KEY.includes(":"));
  if (!gate || !credentialsConfigured) return Object.freeze({ ...base, credentialsConfigured });
  const config = { ...base, ready: true, credentialsConfigured: true };
  Object.defineProperties(config, {
    userId: { value: userId },
    apiKey: { value: env.PROMOONLY_API_KEY },
    apiSecret: { value: env.PROMOONLY_API_SECRET }
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

function boundedResponse(response, signal, requestCount) {
  if (!response || !response.headers?.get || !response.body?.getReader) fail("PROMOONLY_SAMPLE_RESPONSE_INVALID", requestCount);
  if (response.redirected || (response.status >= 300 && response.status < 400)) fail("PROMOONLY_SAMPLE_REDIRECT_BLOCKED", requestCount);
  // The existing client enforces the 2 MiB JSON cap while reading every body.
  return {
    ok: response.ok, status: response.status, headers: response.headers,
    body: { getReader() {
      const reader = response.body.getReader();
      return {
        read: () => abortable(reader.read(), signal),
        cancel: (reason) => reader.cancel(reason)
      };
    } }
  };
}

function releasesFromFirstPage(payload, nowMs, requestCount) {
  if (!Array.isArray(payload) || payload.length > MAX_ITEMS) fail("PROMOONLY_SAMPLE_LIST_SCHEMA", requestCount);
  const releases = [];
  for (const bucket of payload) {
    const day = dateOnly(bucket?.date, nowMs);
    const timestamp = Number(bucket?.ts);
    if (!object(bucket) || day === null || !Number.isSafeInteger(timestamp)
      || timestamp * 1000 < day || timestamp * 1000 >= day + 86_400_000
      || !Array.isArray(bucket.releases) || bucket.releases.length > MAX_ITEMS
      || releases.length + bucket.releases.length > MAX_ITEMS) {
      fail("PROMOONLY_SAMPLE_LIST_SCHEMA", requestCount);
    }
    for (const release of bucket.releases) {
      if (!object(release) || !decimalId(release.id) || mediaType(release.type) === null
        || (release.media_type !== undefined && release.media_type !== release.type)) {
        fail("PROMOONLY_SAMPLE_LIST_SCHEMA", requestCount);
      }
      releases.push({ ...release, date: bucket.date });
    }
  }
  return releases;
}

function safeClientCode(error, requestCount) {
  if (error instanceof PromoOnlyMetadataSampleError) return error;
  const code = String(error?.code || "");
  const permitted = new Set([
    "PROMOONLY_HTTP_401", "PROMOONLY_HTTP_429", "PROMOONLY_RESPONSE_TOO_LARGE",
    "PROMOONLY_RESPONSE_NOT_JSON", "PROMOONLY_RESPONSE_INVALID_JSON", "PROMOONLY_RESPONSE_READ_FAILED",
    "PROMOONLY_AUTH_EXPIRY_INVALID", "PROMOONLY_AUTH_TOKEN_MISSING"
  ]);
  return new PromoOnlyMetadataSampleError(
    permitted.has(code) ? `PROMOONLY_SAMPLE_${code.slice("PROMOONLY_".length)}` : "PROMOONLY_SAMPLE_REQUEST_FAILED",
    requestCount
  );
}

/** One ordered auth/list/release/track chain. Never retries, refreshes, downloads or paginates. */
export async function fetchPromoOnlyMetadataSample(config, { fetchImpl = globalThis.fetch, now = () => Date.now(), abortSignal = null } = {}) {
  if (!validConfigs.has(config) || !config.enabled || !config.ready) fail("PROMOONLY_SAMPLE_NOT_READY");
  if (typeof fetchImpl !== "function") fail("PROMOONLY_SAMPLE_FETCH_UNAVAILABLE");
  if (abortSignal !== null && !(abortSignal instanceof AbortSignal)) fail("PROMOONLY_SAMPLE_SIGNAL_INVALID");
  const clock = () => {
    const value = typeof now === "function" ? now() : now;
    return value instanceof Date ? value.getTime() : Number(value);
  };
  const startMs = clock();
  if (!Number.isFinite(startMs)) fail("PROMOONLY_SAMPLE_CLOCK_INVALID");
  const totalSignal = AbortSignal.any([AbortSignal.timeout(TOTAL_TIMEOUT_MS), abortSignal].filter(Boolean));
  let requestCount = 0;
  let selectedReleaseId = null;
  let selectedTrackId = null;
  const allowed = [
    { method: "POST", path: "/user/authenticate" },
    { method: "GET", path: "/releases/date/1" },
    () => ({ method: "GET", path: `/release/${selectedReleaseId}` }),
    () => ({ method: "GET", path: `/track/${selectedTrackId}` })
  ];
  const guardedFetch = async (input, options = {}) => {
    if (totalSignal.aborted) fail("PROMOONLY_SAMPLE_DEADLINE", requestCount);
    const next = allowed[requestCount];
    if (!next || requestCount >= 4) fail("PROMOONLY_SAMPLE_REQUEST_LIMIT", requestCount);
    const expected = typeof next === "function" ? next() : next;
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    if (url.href !== `${ORIGIN}${expected.path}` || method !== expected.method || options.redirect !== "error"
      || (method === "GET" && options.body)) fail("PROMOONLY_SAMPLE_REQUEST_NOT_ALLOWED", requestCount);
    requestCount += 1;
    const signal = AbortSignal.any([totalSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS), options.signal].filter(Boolean));
    try {
      const response = await abortable(fetchImpl(input, { ...options, signal, redirect: "error" }), signal);
      return boundedResponse(response, signal, requestCount);
    } catch (error) {
      if (error instanceof PromoOnlyMetadataSampleError) throw error;
      fail(signal.aborted ? "PROMOONLY_SAMPLE_DEADLINE" : "PROMOONLY_SAMPLE_NETWORK", requestCount);
    }
  };
  let tokenManager;
  try {
    tokenManager = new PromoOnlyTokenManager(config, { fetchImpl: guardedFetch, now: clock });
    const client = new PromoOnlyApiClient(config, { fetchImpl: guardedFetch, tokenManager, now: clock });
    const request = (path) => {
      if (tokenManager.cached?.expiresAt - clock() <= 30_000) {
        fail("PROMOONLY_SAMPLE_TOKEN_EXPIRY_TOO_SHORT", requestCount);
      }
      return client.request(path, { retryAuth: false, retryTransient: false });
    };
    await tokenManager.getToken();
    // The client refreshes tokens below 30 seconds. Reject a short token now,
    // with room for the entire 45-second sample, before any refresh is possible.
    if (!Number.isFinite(tokenManager.cached?.expiresAt)
      || tokenManager.cached.expiresAt - clock() <= TOTAL_TIMEOUT_MS + 30_000) {
      fail("PROMOONLY_SAMPLE_TOKEN_EXPIRY_TOO_SHORT", requestCount);
    }
    const releases = releasesFromFirstPage(await request("/releases/date/1"), startMs, requestCount);
    if (!releases.length) fail("PROMOONLY_SAMPLE_EMPTY_RELEASE_LIST", requestCount);
    const selected = releases.find((release) => release.type === 2);
    if (!selected) fail("PROMOONLY_SAMPLE_NO_AUDIO_RELEASE", requestCount);
    selectedReleaseId = decimalId(selected.id);
    const release = await request(`/release/${selectedReleaseId}`);
    if (!object(release) || !decimalId(release.id) || !Array.isArray(release.tracks)
      || release.tracks.length > MAX_ITEMS) fail("PROMOONLY_SAMPLE_RELEASE_SCHEMA", requestCount);
    if (decimalId(release.id) !== selectedReleaseId) fail("PROMOONLY_SAMPLE_RELEASE_ID_MISMATCH", requestCount);
    if (!release.tracks.length) fail("PROMOONLY_SAMPLE_EMPTY_RELEASE_TRACKS", requestCount);
    for (const track of release.tracks) {
      if (!object(track) || !decimalId(track.trackid) || mediaType(track.media_type) === null
        || (track.releaseid !== undefined && decimalId(track.releaseid) !== selectedReleaseId)) {
        fail("PROMOONLY_SAMPLE_RELEASE_SCHEMA", requestCount);
      }
    }
    const listedTrack = release.tracks.find((track) => track.media_type === 2);
    if (!listedTrack) fail("PROMOONLY_SAMPLE_NO_AUDIO_TRACK", requestCount);
    selectedTrackId = decimalId(listedTrack.trackid);
    const track = await request(`/track/${selectedTrackId}`);
    if (!object(track) || !decimalId(track.id) || mediaType(track.media_type) === null) {
      fail("PROMOONLY_SAMPLE_TRACK_SCHEMA", requestCount);
    }
    if (decimalId(track.id) !== selectedTrackId) fail("PROMOONLY_SAMPLE_TRACK_ID_MISMATCH", requestCount);
    if (track.media_type !== 2) fail("PROMOONLY_SAMPLE_TRACK_NOT_AUDIO", requestCount);
    if (decimalId(track.releaseid) !== selectedReleaseId) fail("PROMOONLY_SAMPLE_TRACK_RELEASE_ID_MISMATCH", requestCount);
    const first = mapPromoOnlyTrack(track, release);
    const second = mapPromoOnlyTrack(track, release);
    const stable = first.externalTrackId === selectedTrackId && first.externalReleaseId === selectedReleaseId
      && first.externalTrackId === second.externalTrackId && first.externalReleaseId === second.externalReleaseId
      && first.externalRecordingId === second.externalRecordingId && first.externalTitleId === second.externalTitleId
      && JSON.stringify(first.audioFormats) === JSON.stringify(second.audioFormats)
      && first.releaseDate?.getTime() === second.releaseDate?.getTime()
      && first.sourceModifiedAt?.getTime() === second.sourceModifiedAt?.getTime();
    if (!stable) fail("PROMOONLY_SAMPLE_NORMALIZATION_UNSTABLE", requestCount);
    if (dateOnly(first.releaseDate?.toISOString().slice(0, 10), startMs) === null
      || !sourceTimestamp(track.modified, startMs)
      || !first.sourceModifiedAt || first.mediaType !== "2"
      || !first.audioFormats.length || first.audioFormats.length > 16
      || first.audioFormats.some((format) => !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(format))) {
      fail("PROMOONLY_SAMPLE_METADATA_INVALID", requestCount);
    }
    if (!REQUIRED_UNSUPPORTED.every((field) => first.unsupportedFields.includes(field))
      || ["permittedTerritories", "permittedUses", "minimumCatalogueLevel", "licenceStartsAt", "licenceExpiresAt"].some((field) => Object.hasOwn(first, field))) {
      fail("PROMOONLY_SAMPLE_RIGHTS_UNSAFE", requestCount);
    }
    if (requestCount !== 4) fail("PROMOONLY_SAMPLE_REQUEST_LIMIT", requestCount);
    return { metadata: first, requestCount, releaseCount: releases.length };
  } catch (error) {
    if (totalSignal.aborted) fail("PROMOONLY_SAMPLE_DEADLINE", requestCount);
    throw safeClientCode(error, requestCount);
  } finally {
    tokenManager?.clear();
  }
}
