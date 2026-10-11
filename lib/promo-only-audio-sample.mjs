import { PromoOnlyApiClient, PromoOnlyTokenManager } from "./promo-only-client.mjs";
import { readPromoOnlyMetadataSampleConfig } from "./promo-only-metadata-sample.mjs";

const API = "https://api.promoonly.com";
const TRACK_ID = "713637";
const RELEASE_ID = "122500";
const R2_ACCOUNT = "8aac840009a163d4a099f06744cdf691";
const R2_BUCKET = "ruvanas-preview-audio-20261011";
const R2_ENDPOINT = `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`;
const TOTAL_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const AUDIO_TYPES = new Set(["mp3", "m4a", "wav"]);
const CANONICAL_CONTENT_TYPES = Object.freeze({
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav"
});
const CONTENT_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a",
  "audio/wav", "audio/x-wav", "audio/vnd.wave", "application/octet-stream"
]);
const CONTENT_TYPES_BY_FORMAT = Object.freeze({
  mp3: new Set(["audio/mpeg", "audio/mp3", "application/octet-stream"]),
  m4a: new Set(["audio/mp4", "audio/x-m4a", "audio/m4a", "application/octet-stream"]),
  wav: new Set(["audio/wav", "audio/x-wav", "audio/vnd.wave", "application/octet-stream"])
});
const issuedConfigs = new WeakSet();
const validConfigs = new WeakSet();

export class PromoOnlyAudioSampleError extends Error {
  constructor(code, supplierRequestCount = 0) {
    super(code);
    this.name = "PromoOnlyAudioSampleError";
    this.code = code;
    this.supplierRequestCount = supplierRequestCount;
  }
}

function fail(code, count = 0) { throw new PromoOnlyAudioSampleError(code, count); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function decimalId(value) {
  const text = String(value ?? "");
  return /^[1-9][0-9]*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}
function nonNegativeServerId(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) &&
      Number.isSafeInteger(Number(value))) return Number(value);
  return null;
}
function fixedHexCredential(value, length) {
  return typeof value === "string" && value.length === length
    && /^[0-9a-f]+$/i.test(value);
}

/** Default off; the existing metadata guard supplies exact preview/DB/normal-OFF checks. */
export function readPromoOnlyAudioSampleConfig(env = process.env) {
  const enabled = env?.PROMOONLY_AUDIO_SAMPLE_ENABLED === "true";
  const base = {
    enabled, ready: false, manualOnly: true, trackId: TRACK_ID, releaseId: RELEASE_ID,
    supplierCredentialsConfigured: false, storageCredentialsConfigured: false,
    audioDownloadEnabled: false, allowHttpMediaTest: false, retryMax: 0,
    maxAudioBytes: MAX_AUDIO_BYTES, requestTimeoutMs: REQUEST_TIMEOUT_MS,
    totalTimeoutMs: TOTAL_TIMEOUT_MS
  };
  if (!enabled) {
    const result = Object.freeze(base);
    issuedConfigs.add(result);
    return result;
  }
  // This is an internal guard adapter, not an override of the real environment.
  const guardEnv = Object.create(env);
  guardEnv.PROMOONLY_METADATA_SAMPLE_ENABLED = "true";
  const supplier = readPromoOnlyMetadataSampleConfig(guardEnv);
  const storageCredentialsConfigured = fixedHexCredential(env.R2_ACCESS_KEY_ID, 32)
    && fixedHexCredential(env.R2_SECRET_ACCESS_KEY, 64);
  const storageIdentityValid = env.R2_ACCOUNT_ID === R2_ACCOUNT
    && env.R2_BUCKET_NAME === R2_BUCKET && env.R2_ENDPOINT === R2_ENDPOINT;
  const safe = { ...base, supplierCredentialsConfigured: supplier.credentialsConfigured,
    storageCredentialsConfigured: Boolean(storageCredentialsConfigured),
    ready: Boolean(supplier.ready && storageCredentialsConfigured && storageIdentityValid) };
  if (safe.ready) {
    Object.defineProperties(safe, {
      userId: { value: supplier.userId }, apiKey: { value: supplier.apiKey },
      apiSecret: { value: supplier.apiSecret },
      r2AccessKeyId: { value: env.R2_ACCESS_KEY_ID },
      r2SecretAccessKey: { value: env.R2_SECRET_ACCESS_KEY }
    });
  }
  Object.freeze(safe);
  issuedConfigs.add(safe);
  if (safe.ready) validConfigs.add(safe);
  return safe;
}

export function getPromoOnlyAudioSampleReadiness(config) {
  if (!issuedConfigs.has(config)) return Object.freeze({
    enabled: false, ready: false, code: "PROMOONLY_AUDIO_SAMPLE_CONFIG_INVALID"
  });
  return Object.freeze({
    enabled: config.enabled, ready: config.ready, manualOnly: true,
    trackId: TRACK_ID, releaseId: RELEASE_ID,
    supplierCredentialsConfigured: config.supplierCredentialsConfigured,
    storageCredentialsConfigured: config.storageCredentialsConfigured,
    code: config.ready ? "PROMOONLY_AUDIO_SAMPLE_READY"
      : config.enabled ? "PROMOONLY_AUDIO_SAMPLE_NOT_READY" : "PROMOONLY_AUDIO_SAMPLE_DISABLED"
  });
}

function clockValue(now) {
  const value = typeof now === "function" ? now() : now;
  return value instanceof Date ? value.getTime() : Number(value);
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error("aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}
function cancelReaderBestEffort(reader, reason) {
  // Cancellation is cleanup, never part of the bounded result path. Some
  // stream implementations throw synchronously or never settle their cancel.
  void Promise.resolve().then(() => reader.cancel(reason)).catch(() => {});
}
function guardedResponse(response, signal, maxBytes, count, media) {
  if (!response || !response.headers?.get || !response.body?.getReader)
    fail("PROMOONLY_AUDIO_SAMPLE_RESPONSE_INVALID", count);
  if (response.redirected || (response.status >= 300 && response.status < 400))
    fail("PROMOONLY_AUDIO_SAMPLE_REDIRECT_BLOCKED", count);
  if (media && response.status !== 200)
    fail("PROMOONLY_AUDIO_SAMPLE_MEDIA_HTTP_STATUS_INVALID", count);
  const lengthHeader = response.headers.get("content-length");
  const advertised = lengthHeader === null ? null : Number(lengthHeader);
  if (advertised !== null && (!/^[0-9]+$/.test(lengthHeader) ||
      !Number.isSafeInteger(advertised) || advertised > maxBytes))
    fail("PROMOONLY_AUDIO_SAMPLE_RESPONSE_TOO_LARGE", count);
  if (media && response.ok) {
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!CONTENT_TYPES.has(contentType)) fail("PROMOONLY_AUDIO_SAMPLE_MEDIA_TYPE_INVALID", count);
  }
  return {
    ok: response.ok, status: response.status, headers: response.headers,
    body: { getReader() {
      const reader = response.body.getReader();
      let total = 0;
      const onAbort = () => cancelReaderBestEffort(reader);
      signal.addEventListener("abort", onAbort, { once: true });
      return {
        async read() {
          const result = await abortable(reader.read(), signal);
          if (result.done) {
            signal.removeEventListener("abort", onAbort);
            if (media && advertised !== null && total !== advertised)
              fail("PROMOONLY_AUDIO_SAMPLE_MEDIA_LENGTH_MISMATCH", count);
          }
          else {
            total += result.value?.byteLength ?? 0;
            if (total > maxBytes) {
              signal.removeEventListener("abort", onAbort);
              cancelReaderBestEffort(reader);
              fail("PROMOONLY_AUDIO_SAMPLE_RESPONSE_TOO_LARGE", count);
            }
          }
          return result;
        },
        async cancel(reason) {
          signal.removeEventListener("abort", onAbort);
          cancelReaderBestEffort(reader, reason);
        }
      };
    } }
  };
}

function validateTrack(track, count) {
  if (!object(track) || decimalId(track.id) !== TRACK_ID ||
      decimalId(track.releaseid) !== RELEASE_ID || track.media_type !== 2)
    fail("PROMOONLY_AUDIO_SAMPLE_TRACK_MISMATCH", count);
}
function validHost(host) {
  return typeof host === "string" && /^[a-z0-9-]+\.promoonly\.com$/i.test(host)
    && host.length <= 253;
}
function validateServers(value, count) {
  const servers = Array.isArray(value) ? value : value?.servers;
  if (!Array.isArray(servers) || !servers.length || servers.length > 32 ||
      servers.some((item) => !object(item) || nonNegativeServerId(item.id) === null || !validHost(item.host)))
    fail("PROMOONLY_AUDIO_SAMPLE_SERVERS_INVALID", count);
  return servers;
}
function validateGrant(grant, servers, count) {
  const status = String(grant?.Result ?? "").trim().toLowerCase();
  const format = typeof grant?.file_type === "string" ? grant.file_type.trim().toLowerCase() : "";
  if (!object(grant) || status !== "track successfully queued for download." ||
      decimalId(grant.trackid) !== TRACK_ID ||
      decimalId(grant.releaseid) !== RELEASE_ID || grant.media_type !== 2 ||
      !decimalId(grant.queueid) || !AUDIO_TYPES.has(format) ||
      typeof grant.dl_token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(grant.dl_token) ||
      !Array.isArray(grant.servers) || !grant.servers.length || grant.servers.length > 32 ||
      grant.servers.some((host) => !validHost(host)))
    fail("PROMOONLY_AUDIO_SAMPLE_GRANT_INVALID", count);
  const host = grant.servers[0].toLowerCase();
  const selected = servers.find((item) => item.host.toLowerCase() === host);
  if (!selected) fail("PROMOONLY_AUDIO_SAMPLE_SERVER_UNCONFIRMED", count);
  return { host, serverId: Number(selected.id), format };
}
function validateAudioBytes(audio, format, serverId, count) {
  if (!object(audio) || !Buffer.isBuffer(audio.buffer) || audio.buffer.length < 12 ||
      audio.buffer.length > MAX_AUDIO_BYTES || audio.serverId !== serverId ||
      typeof audio.fileName !== "string" || !audio.fileName ||
      typeof audio.contentType !== "string" || !CONTENT_TYPES_BY_FORMAT[format]?.has(audio.contentType))
    fail("PROMOONLY_AUDIO_SAMPLE_MEDIA_INVALID", count);
  const b = audio.buffer;
  const signature = format === "mp3"
    ? (b.length >= 3 && b.subarray(0, 3).toString("ascii") === "ID3") || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
    : format === "m4a" ? b.subarray(4, 8).toString("ascii") === "ftyp"
      : b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WAVE";
  if (!signature) fail("PROMOONLY_AUDIO_SAMPLE_MEDIA_SIGNATURE_INVALID", count);
}

/** One auth, exact read-only preflight, one queue, one HTTPS media fetch; no persistence. */
async function runPromoOnlyAudioSample(config, {
  fetchImpl = globalThis.fetch, now = () => Date.now(), abortSignal = null
} = {}, preflightOnly = false) {
  if (!validConfigs.has(config) || !config.enabled || !config.ready)
    fail("PROMOONLY_AUDIO_SAMPLE_NOT_READY");
  if (typeof fetchImpl !== "function") fail("PROMOONLY_AUDIO_SAMPLE_FETCH_UNAVAILABLE");
  if (abortSignal !== null && !(abortSignal instanceof AbortSignal))
    fail("PROMOONLY_AUDIO_SAMPLE_SIGNAL_INVALID");
  const clock = () => clockValue(now);
  const start = clock();
  if (!Number.isFinite(start)) fail("PROMOONLY_AUDIO_SAMPLE_CLOCK_INVALID");
  const deadline = AbortSignal.any([AbortSignal.timeout(TOTAL_TIMEOUT_MS), abortSignal].filter(Boolean));
  let supplierRequestCount = 0;
  let expectedMediaUrl = null;
  let tokenManager;
  let disposed = false;
  let ackAttempted = false;
  let boundaryError = null;
  const expected = [
    ["POST", `${API}/user/authenticate`],
    ["GET", `${API}/track/${TRACK_ID}`],
    ["GET", `${API}/download/server/${TRACK_ID}`],
    ["GET", `${API}/downloads/queue/${TRACK_ID}`],
    ["GET", () => expectedMediaUrl],
    ["POST", `${API}/download/success`]
  ];
  if (preflightOnly) expected.length = 3;
  const guardedFetch = async (input, options = {}) => {
    if (deadline.aborted) fail("PROMOONLY_AUDIO_SAMPLE_DEADLINE", supplierRequestCount);
    const next = expected[supplierRequestCount];
    if (!next) fail("PROMOONLY_AUDIO_SAMPLE_REQUEST_LIMIT", supplierRequestCount);
    const [method, expectedUrl] = next;
    const target = typeof expectedUrl === "function" ? expectedUrl() : expectedUrl;
    const actual = new URL(String(input));
    const actualMethod = String(options.method || "GET").toUpperCase();
    if (!target || actual.href !== target || actualMethod !== method || options.redirect !== "error" ||
        (method === "GET" && options.body))
      fail("PROMOONLY_AUDIO_SAMPLE_REQUEST_NOT_ALLOWED", supplierRequestCount);
    supplierRequestCount += 1;
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(REQUEST_TIMEOUT_MS), options.signal].filter(Boolean));
    try {
      const response = await abortable(fetchImpl(input, { ...options, signal, redirect: "error" }), signal);
      return guardedResponse(response, signal,
        supplierRequestCount === 5 ? MAX_AUDIO_BYTES : 2 * 1024 * 1024,
        supplierRequestCount, supplierRequestCount === 5);
    } catch (error) {
      if (error instanceof PromoOnlyAudioSampleError) {
        boundaryError = error;
        throw error;
      }
      fail(signal.aborted ? "PROMOONLY_AUDIO_SAMPLE_DEADLINE" : "PROMOONLY_AUDIO_SAMPLE_NETWORK", supplierRequestCount);
    }
  };
  const dispose = () => { disposed = true; tokenManager?.clear(); };
  try {
    tokenManager = new PromoOnlyTokenManager(config, { fetchImpl: guardedFetch, now: clock });
    const client = new PromoOnlyApiClient(config, { fetchImpl: guardedFetch, tokenManager, now: clock });
    await tokenManager.getToken();
    if (!Number.isFinite(tokenManager.cached?.expiresAt) ||
        tokenManager.cached.expiresAt - clock() < TOTAL_TIMEOUT_MS + 30_000)
      fail("PROMOONLY_AUDIO_SAMPLE_TOKEN_EXPIRY_TOO_SHORT", supplierRequestCount);
    const track = await client.request(`/track/${TRACK_ID}`, { retryAuth: false, retryTransient: false });
    validateTrack(track, supplierRequestCount);
    const servers = validateServers(await client.request(`/download/server/${TRACK_ID}`,
      { retryAuth: false, retryTransient: false }), supplierRequestCount);
    if (preflightOnly) {
      if (supplierRequestCount !== 3) fail("PROMOONLY_AUDIO_SAMPLE_REQUEST_LIMIT", supplierRequestCount);
      const result = { verified: true, hasZeroServerId: servers.some((item) => nonNegativeServerId(item.id) === 0),
        serverCount: servers.length, supplierRequestCount };
      dispose();
      return result;
    }
    if (deadline.aborted || tokenManager.cached.expiresAt - clock() < TOTAL_TIMEOUT_MS + 30_000)
      fail("PROMOONLY_AUDIO_SAMPLE_TOKEN_EXPIRY_TOO_SHORT", supplierRequestCount);
    const grant = await client.request(`/downloads/queue/${TRACK_ID}`,
      { retryAuth: false, retryTransient: false });
    const selected = validateGrant(grant, servers, supplierRequestCount);
    expectedMediaUrl = `https://${selected.host}/pool/v5/download/${encodeURIComponent(grant.dl_token)}`;
    // Use the client's existing host/SSRF protections, but the already-verified
    // server list is replayed locally, never fetched a second time after queue.
    client.availableServers = async (id) => {
      if (decimalId(id) !== TRACK_ID) fail("PROMOONLY_AUDIO_SAMPLE_REQUEST_NOT_ALLOWED", supplierRequestCount);
      return servers;
    };
    const downloaded = await client.downloadQueuedMedia(grant);
    validateAudioBytes(downloaded, selected.format, selected.serverId, supplierRequestCount);
    if (downloaded.downloadHost !== selected.host)
      fail("PROMOONLY_AUDIO_SAMPLE_SERVER_UNCONFIRMED", supplierRequestCount);
    if (supplierRequestCount !== 5) fail("PROMOONLY_AUDIO_SAMPLE_REQUEST_LIMIT", supplierRequestCount);
    // The response header may be application/octet-stream, while the shared
    // catalogue validator requires a format-matched MIME and extension. The
    // queued format plus inspected byte signature are the trusted handoff.
    const audio = { fileName: `promo-only-${TRACK_ID}.${selected.format}`,
      contentType: CANONICAL_CONTENT_TYPES[selected.format],
      serverId: downloaded.serverId };
    Object.defineProperties(audio, {
      buffer: { value: downloaded.buffer },
      downloadToken: { value: downloaded.downloadToken }
    });
    const acknowledge = async () => {
      if (ackAttempted) fail("PROMOONLY_AUDIO_SAMPLE_ACK_ALREADY_ATTEMPTED", supplierRequestCount);
      ackAttempted = true;
      try {
        if (disposed || deadline.aborted || tokenManager.cached?.expiresAt - clock() <= 30_000)
          fail("PROMOONLY_AUDIO_SAMPLE_ACK_UNAVAILABLE", supplierRequestCount);
        const result = await client.request("/download/success", {
          method: "POST", body: { trackid: TRACK_ID, serverid: selected.serverId,
            dl_token: grant.dl_token }, retryAuth: false, retryTransient: false
        });
        if (String(result?.result || "").trim().toLowerCase() !== "success" ||
            decimalId(result?.releaseid) !== RELEASE_ID ||
            String(result?.type || "").trim().toLowerCase() !== selected.format ||
            supplierRequestCount !== 6)
          fail("PROMOONLY_AUDIO_SAMPLE_ACK_REJECTED", supplierRequestCount);
        return { status: "ACKNOWLEDGED", supplierRequestCount };
      } catch (error) {
        if (error instanceof PromoOnlyAudioSampleError) throw error;
        fail("PROMOONLY_AUDIO_SAMPLE_ACK_FAILED", supplierRequestCount);
      } finally { dispose(); }
    };
    return { audio, supplierRequestCount, acknowledge, dispose };
  } catch (error) {
    dispose();
    if (boundaryError) throw boundaryError;
    if (error instanceof PromoOnlyAudioSampleError) throw error;
    const code = String(error?.code || "");
    if (code === "PROMOONLY_MEDIA_HTTPS_REQUIRED" || code === "PROMOONLY_DOWNLOAD_HOST_DENIED")
      fail("PROMOONLY_AUDIO_SAMPLE_HTTPS_OR_HOST_UNSUPPORTED", supplierRequestCount);
    if (code === "PROMOONLY_HTTP_403") fail("PROMOONLY_AUDIO_SAMPLE_ENTITLEMENT_DENIED", supplierRequestCount);
    fail(deadline.aborted ? "PROMOONLY_AUDIO_SAMPLE_DEADLINE" : "PROMOONLY_AUDIO_SAMPLE_REQUEST_FAILED", supplierRequestCount);
  }
}

/** Read-only hosted preflight: auth, exact track, servers, then stop before queue. */
export function checkPromoOnlyAudioSamplePreflight(config, options = {}) {
  return runPromoOnlyAudioSample(config, options, true);
}

export function fetchPromoOnlyAudioSample(config, options = {}) {
  return runPromoOnlyAudioSample(config, options, false);
}
