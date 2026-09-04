export const EXTERNAL_LIVE_PROVIDERS = Object.freeze([
  ["GENERIC_HTTP", "Generic HTTP audio"],
  ["ICECAST", "Icecast"],
  ["SHOUTCAST", "SHOUTcast"]
]);

export const EXTERNAL_LIVE_HEALTH_FRESH_SECONDS = 150;

const PROVIDERS = new Set(EXTERNAL_LIVE_PROVIDERS.map(([value]) => value));
const CREDENTIAL_TYPES = new Set(["NONE", "BASIC", "BEARER"]);

function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function optionalDate(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be a valid date and time.`);
  return date;
}

export function parseExternalLiveSourceInput(input = {}, { secretRequired = true } = {}) {
  const name = text(input.name, 120);
  const channelId = text(input.channelId, 120);
  const streamUrl = text(input.streamUrl, 2_048);
  const providerValue = text(input.providerKey, 40).toUpperCase();
  const providerKey = PROVIDERS.has(providerValue) ? providerValue : "GENERIC_HTTP";
  const credentialValue = text(input.credentialType, 20).toUpperCase();
  const credentialType = CREDENTIAL_TYPES.has(credentialValue) ? credentialValue : "NONE";
  const credentialUsername = text(input.credentialUsername, 160) || null;
  const credentialSecret = text(input.credentialSecret, 2_000) || null;
  const startsAt = optionalDate(input.startsAt, "The live window start");
  const endsAt = optionalDate(input.endsAt, "The live window end");
  if (name.length < 2) throw new Error("Add a clear live-source name.");
  if (!channelId) throw new Error("Choose an active channel.");
  if (!streamUrl) throw new Error("Add the public stream endpoint.");
  if (credentialType === "BASIC" && !credentialUsername) throw new Error("Basic authentication needs a username.");
  if (credentialType !== "NONE" && secretRequired && !credentialSecret) throw new Error("Add the protected source credential.");
  if (endsAt && startsAt && endsAt <= startsAt) throw new Error("The live window must end after it starts.");
  return { name, channelId, streamUrl, providerKey, credentialType, credentialUsername, credentialSecret, startsAt, endsAt };
}

export function externalLiveAuthorizationHeaders(source, decrypt = () => "") {
  if (!source || source.credentialType === "NONE") return {};
  if (!source.credentialEncrypted) throw new Error("The live source credential is unavailable.");
  const secret = decrypt(source.credentialEncrypted);
  if (!secret) throw new Error("The live source credential is empty.");
  if (source.credentialType === "BEARER") return { Authorization: `Bearer ${secret}` };
  if (source.credentialType === "BASIC" && source.credentialUsername) {
    return { Authorization: `Basic ${Buffer.from(`${source.credentialUsername}:${secret}`).toString("base64")}` };
  }
  throw new Error("The live source credential configuration is invalid.");
}

export function externalLiveAvailability(source, instant = new Date(), { freshSeconds = EXTERNAL_LIVE_HEALTH_FRESH_SECONDS } = {}) {
  const now = new Date(instant);
  if (source?.status !== "ACTIVE") return { available: false, reason: "LIVE_SOURCE_NOT_ACTIVE" };
  if (source.startsAt && now < new Date(source.startsAt)) return { available: false, reason: "LIVE_WINDOW_NOT_STARTED" };
  if (source.endsAt && now >= new Date(source.endsAt)) return { available: false, reason: "LIVE_WINDOW_ENDED" };
  if (source.healthStatus !== "HEALTHY") return { available: false, reason: `LIVE_SOURCE_${source.healthStatus || "UNVERIFIED"}` };
  const checkedAt = source.lastHealthCheckedAt ? new Date(source.lastHealthCheckedAt) : null;
  if (!checkedAt || now.getTime() - checkedAt.getTime() > freshSeconds * 1_000) return { available: false, reason: "LIVE_HEALTH_STALE" };
  return { available: true, reason: null };
}

export function externalLiveCandidate(source, { organisationId, channelId, instant = new Date() }) {
  if (!source) return null;
  const availability = externalLiveAvailability(source, instant);
  const now = new Date(instant);
  const configuredStart = source.startsAt ? new Date(source.startsAt) : null;
  const configuredEnd = source.endsAt ? new Date(source.endsAt) : null;
  const validFrom = configuredStart || (configuredEnd ? new Date(configuredEnd.getTime() - 60 * 60 * 1_000) : now);
  const validUntil = configuredEnd || new Date(Math.max(now.getTime(), validFrom.getTime()) + 24 * 60 * 60 * 1_000);
  return {
    organisationId,
    channelId,
    sourceType: "LIVE_SESSION",
    sourceId: source.id,
    sourceRevision: `${source.id}:${new Date(source.updatedAt || source.createdAt || instant).toISOString()}:${source.lastHealthCheckedAt ? new Date(source.lastHealthCheckedAt).toISOString() : "unverified"}`,
    label: source.name,
    available: availability.available,
    unavailableReason: availability.reason,
    validFrom,
    validUntil,
    proofClassification: "LIVE",
    payload: availability.available ? { resolution: {
      musicMode: null,
      reason: "EXTERNAL_LIVE",
      sourceLabel: source.name,
      fallbackCause: null,
      liveSource: { id: source.id, providerKey: source.providerKey }
    } } : null
  };
}

export function safeExternalLiveSource(source) {
  let endpointHost = "Configured endpoint";
  try { endpointHost = new URL(source.streamUrl).host; } catch {}
  return {
    id: source.id,
    name: source.name,
    providerKey: source.providerKey,
    channel: source.channel,
    endpointHost,
    credentialType: source.credentialType,
    credentialUsername: source.credentialUsername,
    hasCredential: Boolean(source.credentialEncrypted),
    status: source.status,
    startsAt: source.startsAt?.toISOString?.() || source.startsAt || null,
    endsAt: source.endsAt?.toISOString?.() || source.endsAt || null,
    healthStatus: source.healthStatus || "UNKNOWN",
    lastHealthCheckedAt: source.lastHealthCheckedAt?.toISOString?.() || source.lastHealthCheckedAt || null,
    lastHealthyAt: source.lastHealthyAt?.toISOString?.() || source.lastHealthyAt || null,
    consecutiveFailures: source.consecutiveFailures,
    lastLatencyMs: source.lastLatencyMs,
    lastHttpStatus: source.lastHttpStatus,
    lastContentType: source.lastContentType,
    lastErrorCode: source.lastErrorCode,
    activatedAt: source.activatedAt?.toISOString?.() || source.activatedAt || null,
    createdAt: source.createdAt?.toISOString?.() || source.createdAt,
    updatedAt: source.updatedAt?.toISOString?.() || source.updatedAt
  };
}
