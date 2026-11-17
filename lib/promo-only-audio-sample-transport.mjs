import { PromoOnlyApiClient, PromoOnlyTokenManager } from "./promo-only-client.mjs";
import { getPromoOnlyAudioSampleReadiness } from "./promo-only-audio-sample.mjs";

const API = "https://api.promoonly.com";
const AUTH = `${API}/user/authenticate`;
const SERVERS = `${API}/download/server/713637`;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const API_TIMEOUT_MS = 15_000;
const HEAD_TIMEOUT_MS = 10_000;
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.promoonly\.com$/i;

export class PromoOnlyAudioTransportError extends Error {
  constructor(code, apiRequestCount = 0, headRequestCount = 0) {
    super(code);
    this.name = "PromoOnlyAudioTransportError";
    this.code = code;
    this.apiRequestCount = apiRequestCount;
    this.headRequestCount = headRequestCount;
  }
}

function fail(code, apiCount, headCount = 0) {
  throw new PromoOnlyAudioTransportError(code, apiCount, headCount);
}

function withAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error("ABORTED"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("ABORTED"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function boundedResponse(response, signal) {
  if (!response || response.status !== 200 || response.redirected || !response.headers?.get ||
      !response.body?.getReader) throw new Error("INVALID_RESPONSE");
  const header = response.headers.get("content-length");
  if (header !== null && (!/^(0|[1-9][0-9]*)$/.test(header) ||
      Number(header) > MAX_JSON_BYTES)) throw new Error("RESPONSE_TOO_LARGE");
  return {
    ok: true, status: 200, headers: response.headers,
    body: { getReader() {
      const reader = response.body.getReader();
      let read = 0;
      return {
        async read() {
          const result = await withAbort(reader.read(), signal);
          if (!result.done) {
            read += result.value?.byteLength ?? 0;
            if (read > MAX_JSON_BYTES) {
              void Promise.resolve().then(() => reader.cancel()).catch(() => {});
              throw new Error("RESPONSE_TOO_LARGE");
            }
          }
          return result;
        },
        cancel(reason) {
          void Promise.resolve().then(() => reader.cancel(reason)).catch(() => {});
          return Promise.resolve();
        }
      };
    } }
  };
}

function serverHost(value) {
  const servers = Array.isArray(value) ? value : value?.servers;
  if (!Array.isArray(servers) || servers.length !== 1) return null;
  const server = servers[0];
  const id = server?.id;
  const validId = typeof id === "number" ? Number.isSafeInteger(id) && id >= 0
    : typeof id === "string" && /^(0|[1-9][0-9]*)$/.test(id) &&
      Number.isSafeInteger(Number(id));
  if (!validId || typeof server?.host !== "string" || !HOST.test(server.host) ||
      server.host.length > 253) return null;
  return server.host.toLowerCase();
}

function causeCode(error, timedOut = false) {
  if (timedOut) return "CONNECT_TIMEOUT";
  const pending = [{ value: error, depth: 0 }];
  const seen = new Set();
  for (let i = 0; pending.length && i < 12; i += 1) {
    const { value, depth } = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const code = typeof value.code === "string" ? value.code.toUpperCase() : "";
    if (["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(code))
      return "TLS_LEAF_UNVERIFIED";
    if (["UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_UNTRUSTED"].includes(code))
      return "TLS_ISSUER";
    if (["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID"].includes(code)) return "TLS_EXPIRED";
    if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return "TLS_NAME";
    if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "DNS";
    if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return "CONNECT_TIMEOUT";
    if (["ECONNRESET", "UND_ERR_SOCKET"].includes(code)) return "RESET";
    if (["ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "EPIPE", "UND_ERR_CONNECT"].includes(code))
      return "NETWORK";
    if (depth < 3) {
      pending.push({ value: value.cause, depth: depth + 1 });
      if (Array.isArray(value.errors)) {
        for (const nested of value.errors.slice(0, 6)) pending.push({ value: nested, depth: depth + 1 });
      }
    }
  }
  return "OTHER";
}

/** Read-only supplier API + unauthenticated TLS root check; no queue or media access. */
export async function checkPromoOnlyAudioSampleTransport(config, {
  fetchImpl = globalThis.fetch, now = () => Date.now()
} = {}) {
  const readiness = getPromoOnlyAudioSampleReadiness(config);
  if (!readiness.ready || config?.retryMax !== 0 || config?.allowHttpMediaTest !== false ||
      config?.audioDownloadEnabled !== false || typeof fetchImpl !== "function")
    fail("PROMOONLY_AUDIO_TRANSPORT_NOT_READY", 0);

  let apiRequestCount = 0;
  let headRequestCount = 0;
  const deadline = new AbortController();
  const apiTimer = setTimeout(() => deadline.abort(), API_TIMEOUT_MS);
  const apiFetch = async (input, options = {}) => {
    const target = String(input);
    const expected = apiRequestCount === 0 ? AUTH : apiRequestCount === 1 ? SERVERS : null;
    const method = String(options.method || "GET").toUpperCase();
    if (target !== expected || method !== (apiRequestCount === 0 ? "POST" : "GET") ||
        (apiRequestCount === 1 && options.body !== undefined) ||
        options.redirect !== "error" || deadline.signal.aborted)
      fail("PROMOONLY_AUDIO_TRANSPORT_REQUEST_LIMIT", apiRequestCount);
    apiRequestCount += 1;
    const signals = [deadline.signal, options.signal].filter(Boolean);
    const signal = AbortSignal.any(signals);
    const response = await withAbort(fetchImpl(input, { ...options, signal }), signal);
    return boundedResponse(response, signal);
  };
  const clientConfig = {
    userId: config.userId, apiKey: config.apiKey, apiSecret: config.apiSecret,
    requestTimeoutMs: API_TIMEOUT_MS, retryMax: 0
  };
  const tokenManager = new PromoOnlyTokenManager(clientConfig, { fetchImpl: apiFetch, now });
  const client = new PromoOnlyApiClient(clientConfig, { fetchImpl: apiFetch, tokenManager, now });
  let host;
  try {
    await tokenManager.getToken();
    const servers = await client.request("/download/server/713637", {
      retryAuth: false, retryTransient: false
    });
    host = serverHost(servers);
    if (!host) fail("PROMOONLY_AUDIO_TRANSPORT_SERVERS_INVALID", apiRequestCount);
  } catch (error) {
    if (error instanceof PromoOnlyAudioTransportError) throw error;
    fail("PROMOONLY_AUDIO_TRANSPORT_API_FAILED", apiRequestCount);
  } finally {
    clearTimeout(apiTimer);
    deadline.abort();
    tokenManager.clear();
    clientConfig.userId = clientConfig.apiKey = clientConfig.apiSecret = "";
  }

  headRequestCount = 1;
  const headDeadline = new AbortController();
  const headTimer = setTimeout(() => headDeadline.abort(), HEAD_TIMEOUT_MS);
  try {
    const response = await withAbort(fetchImpl(`https://${host}/`, {
      method: "HEAD", headers: { accept: "*/*" }, credentials: "omit",
      redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
      signal: headDeadline.signal
    }), headDeadline.signal);
    const status = response?.status;
    if (!Number.isInteger(status) || status < 100 || status > 599 || response?.redirected ||
        status >= 300 && status < 400)
      return Object.freeze({ ready: true, reachable: false, httpStatus: null, causeCode: "OTHER",
        apiRequestCount, headRequestCount });
    return Object.freeze({ ready: true, reachable: true, httpStatus: status, causeCode: null,
      apiRequestCount, headRequestCount });
  } catch (error) {
    return Object.freeze({ ready: true, reachable: false, httpStatus: null,
      causeCode: causeCode(error, headDeadline.signal.aborted), apiRequestCount, headRequestCount });
  } finally {
    clearTimeout(headTimer);
    headDeadline.abort();
  }
}
