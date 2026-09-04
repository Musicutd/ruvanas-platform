import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const STREAM_HEALTH_SCAN_SECONDS = 30;
export const STREAM_HEALTH_SAMPLE_SECONDS = 300;
export const STREAM_INCIDENT_FAILURE_THRESHOLD = 3;

const PROVIDERS = new Set(["CENTOVA_CAST", "GENERIC_HTTP"]);
const ACTIONS = new Set(["ACKNOWLEDGE", "RESOLVE"]);

function cleanText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function normalizeStreamProviderKey(value) {
  const providerKey = cleanText(value, 80).toUpperCase();
  return PROVIDERS.has(providerKey) ? providerKey : "CENTOVA_CAST";
}

export function normalizeStreamHealthSettings(input = {}) {
  const probeIntervalSeconds = Number(input.probeIntervalSeconds ?? 60);
  const probeTimeoutMs = Number(input.probeTimeoutMs ?? 8_000);
  if (!Number.isInteger(probeIntervalSeconds) || probeIntervalSeconds < 30 || probeIntervalSeconds > 3_600) {
    throw new Error("Probe interval must be between 30 and 3600 seconds.");
  }
  if (!Number.isInteger(probeTimeoutMs) || probeTimeoutMs < 1_000 || probeTimeoutMs > 30_000) {
    throw new Error("Probe timeout must be between 1000 and 30000 milliseconds.");
  }
  return {
    providerKey: normalizeStreamProviderKey(input.providerKey),
    backupStreamUrl: cleanText(input.backupStreamUrl, 2_048) || null,
    probeEnabled: input.probeEnabled !== false,
    probeIntervalSeconds,
    probeTimeoutMs
  };
}

export function streamHealthBucketStart(instant, bucketSeconds = STREAM_HEALTH_SAMPLE_SECONDS) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error("A valid probe time is required.");
  const bucketMs = bucketSeconds * 1_000;
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
}

export function streamIncidentSeverity(consecutiveFailures) {
  const failures = Math.max(0, Number(consecutiveFailures) || 0);
  if (failures >= 30) return "CRITICAL";
  if (failures >= 10) return "HIGH";
  if (failures >= STREAM_INCIDENT_FAILURE_THRESHOLD) return "MEDIUM";
  return "LOW";
}

export function streamIncidentTransition(currentStatus, action, note, now = new Date()) {
  const status = cleanText(currentStatus, 40).toUpperCase();
  const requestedAction = cleanText(action, 40).toUpperCase();
  const cleanNote = cleanText(note, 2_000);
  if (!ACTIONS.has(requestedAction)) throw new Error("Choose ACKNOWLEDGE or RESOLVE.");
  if (status === "RESOLVED") throw new Error("This stream incident is already resolved.");
  if (requestedAction === "ACKNOWLEDGE" && status !== "OPEN") throw new Error("Only an open stream incident can be acknowledged.");
  if (cleanNote.length < 3) throw new Error("Add a short operational note.");
  const changedAt = new Date(now);
  return requestedAction === "ACKNOWLEDGE"
    ? { status: "ACKNOWLEDGED", acknowledgedAt: changedAt, acknowledgementNote: cleanNote }
    : { status: "RESOLVED", resolvedAt: changedAt, resolutionNote: cleanNote };
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split("%")[0];
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

export function isPrivateNetworkAddress(address) {
  const family = isIP(address);
  return family === 4 ? isPrivateIpv4(address) : family === 6 ? isPrivateIpv6(address) : true;
}

export async function validatePublicStreamEndpoint(value, { lookupImpl = dnsLookup } = {}) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("The stream URL is invalid.");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || !url.hostname || url.href.length > 2_048) {
    throw new Error("The stream URL must be a public HTTP or HTTPS endpoint without embedded credentials.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Local and private stream endpoints cannot be probed.");
  }
  const directFamily = isIP(hostname);
  const addresses = directFamily ? [{ address: hostname }] : await lookupImpl(hostname, { all: true, verbatim: true });
  if (!addresses?.length || addresses.some((entry) => isPrivateNetworkAddress(entry.address))) {
    throw new Error("The stream endpoint resolves to a private or unavailable address.");
  }
  return url;
}

function contentTypeStatus(value) {
  const contentType = cleanText(value, 160).toLowerCase();
  if (!contentType) return { acceptable: false, contentType: null };
  const acceptable = contentType.startsWith("audio/") || contentType.startsWith("application/ogg") || contentType.startsWith("application/octet-stream");
  return { acceptable, contentType };
}

export async function probeStreamEndpoint(value, { timeoutMs = 8_000, headers = {}, fetchImpl = fetch, lookupImpl = dnsLookup, now = () => Date.now() } = {}) {
  const startedAt = now();
  let url;
  try {
    url = await validatePublicStreamEndpoint(value, { lookupImpl });
  } catch (error) {
    return { status: "SKIPPED", latencyMs: Math.max(0, now() - startedAt), httpStatus: null, contentType: null, errorCode: cleanText(error?.message, 240) || "ENDPOINT_REJECTED" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "audio/*,*/*;q=0.1", Range: "bytes=0-0", "User-Agent": "Ruvanas-Stream-Probe/1.0", ...headers },
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });
    const latencyMs = Math.max(0, now() - startedAt);
    const type = contentTypeStatus(response.headers?.get?.("content-type"));
    if (response.body?.cancel) await response.body.cancel().catch(() => undefined);
    if (response.status >= 300 && response.status < 400) {
      return { status: "DEGRADED", latencyMs, httpStatus: response.status, contentType: type.contentType, errorCode: "REDIRECT_NOT_FOLLOWED" };
    }
    if (!response.ok) return { status: "UNREACHABLE", latencyMs, httpStatus: response.status, contentType: type.contentType, errorCode: `HTTP_${response.status}` };
    return { status: type.acceptable ? "HEALTHY" : "DEGRADED", latencyMs, httpStatus: response.status, contentType: type.contentType, errorCode: type.acceptable ? null : "UNEXPECTED_CONTENT_TYPE" };
  } catch (error) {
    const errorCode = error?.name === "AbortError" ? "TIMEOUT" : cleanText(error?.code || error?.name || "FETCH_FAILED", 120).toUpperCase();
    return { status: "UNREACHABLE", latencyMs: Math.max(0, now() - startedAt), httpStatus: null, contentType: null, errorCode };
  } finally {
    clearTimeout(timeout);
  }
}

export function streamHealthSummary(stations = [], incidents = []) {
  const unresolved = incidents.filter((incident) => incident.status !== "RESOLVED");
  return {
    configuredStations: stations.filter((station) => station.streamConfig?.streamUrl).length,
    healthyStations: stations.filter((station) => station.streamConfig?.sourceConnectionStatus === "CONNECTED").length,
    failingStations: stations.filter((station) => (station.streamConfig?.consecutiveFailures || 0) > 0).length,
    openIncidents: unresolved.length,
    criticalIncidents: unresolved.filter((incident) => incident.severity === "CRITICAL").length
  };
}
