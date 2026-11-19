import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { catalogueTestTrackDecision, catalogueTestTrackFingerprint } from "./online-radio-catalogue-test.mjs";

// An explicit owner grant for this one station. It never changes subscription,
// public-player, ordinary AutoDJ or catalogue rights permissions.
export const TEST_RADIO_CONTINUOUS = Object.freeze({
  stationId: "cmvcnbwi20008hr23sd76psi8", origin: "https://www.ruvanas.com",
  listenerUrl: "https://ruvanastestradio-radio105network.radioca.st/stream",
  host: "pollux.shoutca.st", port: 8282, account: "ruvanastestradio", bitrateKbps: 128,
  kind: "OWNER_TEST_RADIO_CONTINUOUS_V1", territory: "MT", catalogueLevel: "FOCUSED",
  monthlyBudgetUsd: 15, monthlyComputeUsd: 7, monthlyOtherReserveUsd: 0.75,
  bandwidthUsdPerGB: 0.15, monthlyReservedBytes: 48_000_000_000,
  estimatedMonthlyUsd: 13.70, wireMultiplier: 1.05,
  maximumReservationBytes: 2 * 1024 * 1024, maximumCandidates: 2000,
  maximumTrackSeconds: 3600, leaseSeconds: 45, takeoverGraceSeconds: 20,
  observationFreshnessMs: 15_000, leasePrefix: "test-radio-continuous:",
});
const P = TEST_RADIO_CONTINUOUS;
const canonicalJson = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const continuousError = code => Object.assign(new Error(code), { code });
export function continuousSourceFingerprint(source) {
  return createHash("sha256").update(canonicalJson([source?.providerKey, source?.streamUrl, source?.serverHost,
    source?.serverPort, source?.sourcePort, source?.sourceUsername, source?.centovaUsername, source?.bitrateKbps,
    source?.sourcePasswordEncrypted, source?.outboundAutoDjEnabled])).digest("hex");
}
export function continuousSourceReady(source) {
  return Boolean(source && source.providerKey === "CENTOVA_CAST" && source.streamUrl === P.listenerUrl &&
    source.serverHost === P.host && source.serverPort === P.port && source.sourcePort === P.port &&
    !source.sourceUsername && source.centovaUsername === P.account && source.bitrateKbps === P.bitrateKbps &&
    source.outboundAutoDjEnabled === false && typeof source.sourcePasswordEncrypted === "string" && source.sourcePasswordEncrypted.length &&
    !["CATALOGUE_TEST_STOP_UNCONFIRMED", "CONTINUOUS_STOP_UNCONFIRMED"].includes(source.lastError));
}
function signingKey(env) {
  if (!/^[a-fA-F0-9]{64}$/.test(env?.SECRET_ENCRYPTION_KEY || "")) throw continuousError("CONTINUOUS_SIGNING_UNAVAILABLE");
  // Separate cryptographic domain; the encryption key itself is never stored.
  return createHmac("sha256", Buffer.from(env.SECRET_ENCRYPTION_KEY, "hex")).update("ruvanas/test-radio-continuous/v1").digest();
}
export function signContinuousCommand(command, env = process.env) {
  return createHmac("sha256", signingKey(env)).update(canonicalJson(command)).digest("hex");
}
export function verifyContinuousCommand(envelope, env = process.env) {
  try {
    if (!envelope?.command || !/^[a-f0-9]{64}$/.test(envelope.signature || "")) return false;
    return timingSafeEqual(Buffer.from(envelope.signature, "hex"), Buffer.from(signContinuousCommand(envelope.command, env), "hex"));
  } catch { return false; }
}
export function continuousStationDecision({ station, entitlements, serviceExpiresAt }, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return "CONTINUOUS_TIME_INVALID";
  if (station?.id !== P.stationId || !/^[a-zA-Z0-9_-]{8,80}$/.test(station.organisationId || "") ||
    station.productFamily !== "ONLINE" || !["DRAFT", "PENDING_SETUP", "ACTIVE"].includes(station.status)) return "CONTINUOUS_STATION_REQUIRED";
  if (station.publicPlayerEnabled !== false || station.stationWebsiteEnabled !== false) return "CONTINUOUS_SCOPE_CHANGED";
  if (entitlements?.serviceEnabled !== true || entitlements.onlineRadioEnabled !== true) return "CONTINUOUS_SERVICE_INACTIVE";
  if (entitlements.sandboxDraftOnly === true && !(serviceExpiresAt instanceof Date)) return "CONTINUOUS_SERVICE_INACTIVE";
  if (serviceExpiresAt != null && (!(serviceExpiresAt instanceof Date) || !Number.isFinite(serviceExpiresAt.getTime()) || serviceExpiresAt <= now)) return "CONTINUOUS_SERVICE_INACTIVE";
  if (!continuousSourceReady(station.streamConfig)) return "CONTINUOUS_SOURCE_NOT_READY";
  return null;
}
export function continuousTrackDecision(track, { organisationId, configuredGenres, now = new Date(), remainingSeconds } = {}) {
  const duration = remainingSeconds ?? track?.mediaAsset?.durationSeconds;
  if (!Number.isInteger(duration) || duration < 1 || duration > P.maximumTrackSeconds) return "CONTINUOUS_TRACK_DURATION_INVALID";
  return catalogueTestTrackDecision(track, { organisationId, configuredGenres, instant: now,
    stopAt: new Date(now.getTime() + duration * 1000), profileId: "ONE_HOUR" });
}
export function continuousEligibleTracks(tracks, options) {
  if (!Array.isArray(tracks) || tracks.length > P.maximumCandidates) throw continuousError("CONTINUOUS_CATALOGUE_TOO_LARGE");
  const seen = new Set(), assets = new Set(), storageKeys = new Set();
  return tracks.filter(track => {
    if (seen.has(track?.id)) throw continuousError("CONTINUOUS_CATALOGUE_IDENTITY_INVALID");
    seen.add(track?.id);
    if (continuousTrackDecision(track, options)) return false;
    // Duplicate catalogue rows must not turn one recording into the two-file
    // minimum needed for a useful continuous shuffle and bounded prefetch.
    if (assets.has(track.mediaAssetId) || storageKeys.has(track.mediaAsset.storageKey)) return false;
    assets.add(track.mediaAssetId); storageKeys.add(track.mediaAsset.storageKey);
    return true;
  }).map(track => ({ track, fingerprint: catalogueTestTrackFingerprint(track), durationSeconds: track.mediaAsset.durationSeconds }));
}
export function continuousBudgetMonth(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw continuousError("CONTINUOUS_TIME_INVALID");
  return now.toISOString().slice(0, 7);
}
export function continuousChargedBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > P.maximumReservationBytes) throw continuousError("CONTINUOUS_RESERVATION_INVALID");
  return Math.ceil(bytes * P.wireMultiplier);
}
