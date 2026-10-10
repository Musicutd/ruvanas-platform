import { promoOnlyRetryableStatus, promoOnlyRetryDelayMs } from "./promo-only.mjs";
import { isIP } from "node:net";

const API_ORIGIN = "https://api.promoonly.com";
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 5 * 60_000;
const ENDPOINTS = Object.freeze({
  authenticate: "/user/authenticate",
  track: (id) => `/track/${encodeURIComponent(id)}`,
  release: (id) => `/release/${encodeURIComponent(id)}`,
  recent: (page = 1) => `/tracks/date/${encodeURIComponent(page)}`,
  queue: (id) => `/downloads/queue/${encodeURIComponent(id)}`,
  servers: (id) => `/download/server/${encodeURIComponent(id)}`,
  success: "/download/success"
});

function safeCode(value, fallback = "PROMOONLY_REQUEST_FAILED") {
  return String(value || fallback).replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 80);
}

function providerError(message, code, status = 502) {
  const error = new Error(message);
  error.code = safeCode(code);
  error.status = status;
  return error;
}

function tokenFromPayload(payload) {
  return payload?.access_token || payload?.accessToken || payload?.token || payload?.data?.token || null;
}

function expiresInFromPayload(payload, now = Date.now()) {
  const value = payload?.expires !== undefined && payload?.expires !== null
    ? Number(payload.expires) - Math.floor(now / 1000)
    : Number(payload?.expires_in ?? payload?.expiresIn ?? payload?.data?.expires_in);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 3600) : null;
}

function retryAfterMs(value, now) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const delay = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  if (Number.isNaN(delay)) return null;
  return Math.max(0, Math.ceil(delay));
}

async function readJsonResponse(response, label) {
  if (!response.ok) throw providerError(`${label} returned HTTP ${response.status}.`, `PROMOONLY_HTTP_${response.status}`, response.status);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("json")) throw providerError(`${label} did not return JSON.`, "PROMOONLY_RESPONSE_NOT_JSON");
  const advertised = Number(response.headers.get("content-length") || 0);
  if (advertised > MAX_JSON_RESPONSE_BYTES) throw providerError(`${label} exceeded the JSON response limit.`, "PROMOONLY_RESPONSE_TOO_LARGE");
  const reader = response.body?.getReader?.();
  if (!reader) throw providerError(`${label} returned invalid JSON.`, "PROMOONLY_RESPONSE_INVALID_JSON");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw providerError(`${label} exceeded the JSON response limit.`, "PROMOONLY_RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error?.code === "PROMOONLY_RESPONSE_TOO_LARGE") throw error;
    throw providerError(`${label} could not be read.`, "PROMOONLY_RESPONSE_READ_FAILED");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw providerError(`${label} returned invalid JSON.`, "PROMOONLY_RESPONSE_INVALID_JSON");
  }
}

export class PromoOnlyTokenManager {
  constructor(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cached = null;
    this.inflight = null;
  }

  clear() { this.cached = null; }

  async getToken({ force = false } = {}) {
    if (!force && this.cached && this.cached.expiresAt - 30_000 > this.now()) return this.cached.token;
    if (this.inflight) return this.inflight;
    this.inflight = this.authenticate().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async authenticate() {
    const body = new URLSearchParams({ userid: this.config.userId });
    const basic = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`, "utf8").toString("base64");
    let response;
    try {
      response = await this.fetchImpl(`${API_ORIGIN}${ENDPOINTS.authenticate}`, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "Ruvanas-PromoOnly-Testing/1.1" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.requestTimeoutMs)
      });
    } catch {
      throw providerError("Promo Only authentication could not be reached.", "PROMOONLY_AUTH_NETWORK");
    }
    const payload = await readJsonResponse(response, "Promo Only authentication");
    const token = tokenFromPayload(payload);
    if (!token) throw providerError("Promo Only authentication did not return an access token.", "PROMOONLY_AUTH_TOKEN_MISSING");
    const expiresIn = expiresInFromPayload(payload, this.now());
    if (expiresIn === null) throw providerError("Promo Only authentication returned an invalid token expiration.", "PROMOONLY_AUTH_EXPIRY_INVALID");
    this.cached = { token: String(token), expiresAt: this.now() + expiresIn * 1000 };
    return this.cached.token;
  }
}

export class PromoOnlyApiClient {
  constructor(config, { fetchImpl = fetch, tokenManager = null, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.tokenManager = tokenManager || new PromoOnlyTokenManager(config, { fetchImpl });
    this.sleep = sleep;
    this.now = now;
  }

  async request(path, { method = "GET", body = null, retryAuth = true, retryTransient = true } = {}) {
    const url = new URL(path, API_ORIGIN);
    if (url.origin !== API_ORIGIN) throw providerError("Promo Only API path changed the official origin.", "PROMOONLY_API_ORIGIN_INVALID", 400);
    let attempt = 0;
    let authRetried = false;
    let refreshAuth = false;
    while (true) {
      attempt += 1;
      const token = await this.tokenManager.getToken({ force: refreshAuth });
      refreshAuth = false;
      const encoded = Buffer.from(`${this.config.userId}:${token}`, "utf8").toString("base64");
      let response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${encoded}`,
            ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
            "user-agent": "Ruvanas-PromoOnly-Testing/1.1"
          },
          ...(body ? { body: new URLSearchParams(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });
      } catch {
        if (retryTransient && attempt <= this.config.retryMax) {
          await this.sleep(promoOnlyRetryDelayMs(attempt));
          continue;
        }
        throw providerError("Promo Only API could not be reached.", "PROMOONLY_API_NETWORK");
      }
      if (response.status === 401 && retryAuth && !authRetried) {
        authRetried = true;
        refreshAuth = true;
        this.tokenManager.clear?.();
        continue;
      }
      if (promoOnlyRetryableStatus(response.status)) {
        const retryAfter = retryAfterMs(response.headers.get("retry-after"), this.now());
        if (retryAfter !== null && retryAfter > MAX_RETRY_AFTER_MS) {
          throw providerError("Promo Only requested a delay beyond the bounded retry window.", "PROMOONLY_RATE_LIMITED", 429);
        }
        if (retryTransient && attempt <= this.config.retryMax) {
          await this.sleep(retryAfter ?? promoOnlyRetryDelayMs(attempt));
          continue;
        }
      }
      return readJsonResponse(response, "Promo Only API");
    }
  }

  track(trackId) { return this.request(ENDPOINTS.track(trackId)); }
  release(releaseId) { return this.request(ENDPOINTS.release(releaseId)); }
  recent(page = 1) { return this.request(ENDPOINTS.recent(page)); }
  queueDownload(trackId) { return this.request(ENDPOINTS.queue(trackId), { retryTransient: false }); }
  availableServers(trackId) { return this.request(ENDPOINTS.servers(trackId)); }
  async confirmDownload(payload) {
    const response = await this.request(ENDPOINTS.success, { method: "POST", body: payload, retryTransient: false });
    if (String(response?.result || "").trim().toLowerCase() !== "success") {
      throw providerError("Promo Only did not confirm the download.", "PROMOONLY_DOWNLOAD_ACK_REJECTED");
    }
    return response;
  }

  async downloadQueuedMedia(queuePayload) {
    const token = queuePayload?.dl_token || queuePayload?.download_token || queuePayload?.downloadToken || queuePayload?.token || queuePayload?.data?.token;
    const queuedHosts = Array.isArray(queuePayload?.servers) ? queuePayload.servers : queuePayload?.data?.servers;
    const trackId = queuePayload?.trackid ?? queuePayload?.trackId ?? queuePayload?.data?.trackid;
    if (!token || !trackId || !Array.isArray(queuedHosts) || !queuedHosts.length) throw providerError("Promo Only did not return an authorised download token and server.", "PROMOONLY_DOWNLOAD_GRANT_INVALID");
    const server = queuedHosts[0];
    let base;
    try { base = new URL(String(server).includes("://") ? String(server) : `${this.config.allowHttpMediaTest ? "http" : "https"}://${server}`); }
    catch { throw providerError("Promo Only returned an invalid download server.", "PROMOONLY_DOWNLOAD_SERVER_INVALID"); }
    if (!new Set(["http:", "https:"]).has(base.protocol) || base.username || base.password || base.port || base.pathname !== "/" || base.search || base.hash) throw providerError("Promo Only returned an unsafe download server.", "PROMOONLY_DOWNLOAD_SERVER_INVALID");
    if (base.protocol === "http:" && !this.config.allowHttpMediaTest) throw providerError("Promo Only's media host requires a secure connection. HTTP test transport is disabled.", "PROMOONLY_MEDIA_HTTPS_REQUIRED", 409);
    const hostname = base.hostname.toLowerCase();
    if (isIP(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw providerError("Promo Only returned a private or local download target.", "PROMOONLY_DOWNLOAD_HOST_DENIED");
    const allowed = hostname === "api.promoonly.com" || hostname.endsWith(".promoonly.com") || this.config.downloadHosts.includes(hostname);
    if (!allowed) throw providerError("Promo Only returned a download host that is not on the server allow-list.", "PROMOONLY_DOWNLOAD_HOST_DENIED");
    const serverResponse = await this.availableServers(trackId);
    const available = Array.isArray(serverResponse) ? serverResponse : serverResponse?.servers;
    const selected = available?.find((entry) => Number.isInteger(Number(entry?.id)) && Number(entry.id) > 0 && String(entry.host || "").toLowerCase() === hostname);
    if (!selected) throw providerError("Promo Only did not confirm a server ID for this queued download.", "PROMOONLY_DOWNLOAD_SERVER_UNCONFIRMED");
    const url = new URL(`/pool/v5/download/${encodeURIComponent(token)}`, base.origin);
    const accessToken = await this.tokenManager.getToken();
    const encoded = Buffer.from(`${this.config.userId}:${accessToken}`, "utf8").toString("base64");
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: { authorization: `Bearer ${encoded}`, accept: "audio/*,application/octet-stream", "user-agent": "Ruvanas-PromoOnly-Testing/1.1" },
        redirect: "error",
        signal: AbortSignal.timeout(this.config.requestTimeoutMs)
      });
    } catch {
      throw providerError("Promo Only audio download could not be reached.", "PROMOONLY_DOWNLOAD_NETWORK");
    }
    if (!response.ok) throw providerError(`Promo Only audio download returned HTTP ${response.status}.`, `PROMOONLY_DOWNLOAD_HTTP_${response.status}`, response.status);
    const advertised = Number(response.headers.get("content-length") || 0);
    if (advertised > this.config.maxAudioBytes) throw providerError("Promo Only audio exceeds the configured size limit.", "PROMOONLY_DOWNLOAD_TOO_LARGE", 413);
    const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
    const reader = response.body?.getReader?.();
    const chunks = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.config.maxAudioBytes) {
          await reader.cancel().catch(() => {});
          throw providerError("Promo Only audio exceeds the configured size limit.", "PROMOONLY_DOWNLOAD_TOO_LARGE", 413);
        }
        chunks.push(Buffer.from(value));
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      total = buffer.length;
      if (total > this.config.maxAudioBytes) throw providerError("Promo Only audio exceeds the configured size limit.", "PROMOONLY_DOWNLOAD_TOO_LARGE", 413);
      chunks.push(buffer);
    }
    if (!total) throw providerError("Promo Only audio download was empty.", "PROMOONLY_DOWNLOAD_EMPTY");
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
    let fileName = match?.[1]?.replace(/^\"|\"$/g, "") || `promo-only-${Date.now()}.mp3`;
    try { fileName = decodeURIComponent(fileName); } catch {}
    fileName = fileName.split(/[\\/]/).pop().replace(/[^\w. -]/g, "_").slice(0, 160);
    return { buffer: Buffer.concat(chunks), fileName, contentType, downloadToken: String(token), downloadHost: hostname, serverId: Number(selected.id) };
  }
}

export function safePromoOnlyClientError(error) {
  return safeCode(error?.code, "PROMOONLY_REQUEST_FAILED");
}

export { API_ORIGIN as PROMO_ONLY_API_ORIGIN, ENDPOINTS as PROMO_ONLY_API_ENDPOINTS };
