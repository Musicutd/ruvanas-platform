import crypto from "node:crypto";
import { validateWebhookEndpoint } from "./outgoing-webhooks.mjs";

export const RADIO_DISTRIBUTION_POLICY_VERSION = "radio-distribution-v1";
export const RADIO_DISTRIBUTION_EVENT = "distribution.destination.sync";

export const RADIO_DISTRIBUTION_KINDS = Object.freeze({
  DIRECTORY: { label: "Radio directory", channelRequired: false },
  STREAM_CDN: { label: "Streaming/CDN partner", channelRequired: true },
  APP_PLATFORM: { label: "App platform", channelRequired: false },
  VOICE_ASSISTANT: { label: "Voice assistant", channelRequired: false }
});

const ACTIONS = new Set(["ACTIVATE", "PAUSE", "SYNC", "REVOKE"]);
const MANAGER_ROLES = new Set(["OWNER", "MANAGER"]);

function boundedText(value, { label, min = 1, max }) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length < min || text.length > max) throw new Error(`${label} must contain between ${min} and ${max} characters.`);
  return text;
}

function uniqueCodes(value, pattern, { label, max, transform }) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const result = [...new Set(source.map((item) => transform(String(item || "").trim())).filter(Boolean))];
  if (!result.length || result.length > max || result.some((item) => !pattern.test(item))) {
    throw new Error(`Enter between 1 and ${max} valid ${label}.`);
  }
  return result.sort();
}

export function canManageRadioDistribution(role) {
  return MANAGER_ROLES.has(role);
}

export function normalizeRadioDistributionInput(value = {}) {
  const kind = String(value.kind || "").trim().toUpperCase();
  if (!RADIO_DISTRIBUTION_KINDS[kind]) throw new Error("Choose a supported distribution destination.");
  const providerKey = String(value.providerKey || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,79}$/.test(providerKey)) throw new Error("Provider keys must contain 2-80 letters, numbers, dots, dashes or underscores.");
  const channelId = value.channelId ? String(value.channelId).trim() : null;
  if (RADIO_DISTRIBUTION_KINDS[kind].channelRequired && !channelId) throw new Error("Streaming/CDN distribution requires one active station channel.");
  if (!RADIO_DISTRIBUTION_KINDS[kind].channelRequired && channelId) throw new Error("This destination publishes the station profile and must not select a private channel.");
  return {
    stationId: boundedText(value.stationId, { label: "Station", max: 64 }),
    channelId,
    kind,
    providerKey,
    listingName: boundedText(value.listingName, { label: "Listing name", min: 2, max: 140 }),
    endpointUrl: validateWebhookEndpoint(value.endpointUrl),
    territoryCodes: uniqueCodes(value.territoryCodes, /^(?:[A-Z]{2}|WORLDWIDE)$/, { label: "territories", max: 250, transform: (item) => item.toUpperCase() }),
    languageCodes: uniqueCodes(value.languageCodes, /^[a-z]{2,3}(?:-[A-Z]{2})?$/, { label: "language codes", max: 20, transform: (item) => item.toLowerCase().replace(/-([a-z]{2})$/, (_, region) => `-${region.toUpperCase()}`) }),
    categories: uniqueCodes(value.categories, /^[\p{L}\p{N}][\p{L}\p{N} &+./'-]{1,49}$/u, { label: "categories", max: 20, transform: (item) => item.replace(/\s+/g, " ") })
  };
}

export function radioDistributionReadiness({ destination, station, channel }) {
  const findings = [];
  if (!station || station.status !== "ACTIVE") findings.push("STATION_NOT_ACTIVE");
  if (!station?.publicPlayerEnabled) findings.push("PUBLIC_PLAYER_NOT_PUBLISHED");
  if (destination?.kind !== "STREAM_CDN" && !station?.stationWebsiteEnabled) findings.push("STATION_WEBSITE_NOT_PUBLISHED");
  if (destination?.kind === "STREAM_CDN") {
    if (!channel || channel.status !== "ACTIVE" || channel.stationId !== station?.id) findings.push("CHANNEL_NOT_ACTIVE");
    if (!station?.streamConfig?.streamUrl) findings.push("STREAM_OUTPUT_NOT_CONFIGURED");
  }
  if (!destination?.connection?.endpointUrl) findings.push("ADAPTER_ENDPOINT_NOT_CONFIGURED");
  return Object.freeze({ ready: findings.length === 0, findings });
}

export function radioDistributionConfigurationHash(value) {
  const stable = {
    stationId: value.stationId,
    channelId: value.channelId || null,
    kind: value.kind,
    providerKey: value.providerKey,
    listingName: value.listingName,
    territoryCodes: [...(value.territoryCodes || [])].sort(),
    languageCodes: [...(value.languageCodes || [])].sort(),
    categories: [...(value.categories || [])].sort(),
    revision: Number(value.revision) || 0,
    policyVersion: RADIO_DISTRIBUTION_POLICY_VERSION
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function transitionRadioDistributionDestination(destination, action, now = new Date()) {
  const current = String(destination?.status || "").toUpperCase();
  const nextAction = String(action || "").toUpperCase();
  if (!ACTIONS.has(nextAction)) throw new Error("Choose a supported distribution action.");
  if (current === "REVOKED") throw new Error("A revoked distribution destination cannot be changed.");
  if (nextAction === "ACTIVATE") {
    if (!new Set(["DRAFT", "PAUSED"]).has(current)) throw new Error("Only a draft or paused destination can be activated.");
    const revision = (Number(destination.revision) || 0) + 1;
    return { status: "ACTIVE", revision, configurationHash: radioDistributionConfigurationHash({ ...destination, revision }), activatedAt: now, pausedAt: null, revokedAt: null };
  }
  if (nextAction === "PAUSE") {
    if (current !== "ACTIVE") throw new Error("Only an active destination can be paused.");
    const revision = (Number(destination.revision) || 0) + 1;
    return { status: "PAUSED", revision, configurationHash: radioDistributionConfigurationHash({ ...destination, revision }), pausedAt: now };
  }
  if (nextAction === "SYNC") {
    if (current !== "ACTIVE") throw new Error("Only an active destination can be synchronized.");
    const revision = (Number(destination.revision) || 0) + 1;
    return { status: "ACTIVE", revision, configurationHash: radioDistributionConfigurationHash({ ...destination, revision }) };
  }
  const revision = (Number(destination.revision) || 0) + 1;
  return { status: "REVOKED", revision, configurationHash: radioDistributionConfigurationHash({ ...destination, revision }), revokedAt: now };
}

export function radioDistributionPayload({ destination, station, channel, origin, action }) {
  const publicOrigin = new URL(origin).origin;
  const operation = action === "REVOKE" ? "DELETE" : action === "PAUSE" ? "PAUSE" : "UPSERT";
  return Object.freeze({
    operation,
    destinationId: destination.id,
    destinationKind: destination.kind,
    providerKey: destination.providerKey,
    revision: destination.revision,
    stationName: destination.listingName,
    stationSlug: station.slug,
    stationUrl: `${publicOrigin}/radio/${encodeURIComponent(station.slug)}`,
    playerUrl: `${publicOrigin}/listen/${encodeURIComponent(station.slug)}`,
    channelName: channel?.name || null,
    territoryCodes: destination.territoryCodes,
    languageCodes: destination.languageCodes,
    categories: destination.categories,
    policyVersion: RADIO_DISTRIBUTION_POLICY_VERSION
  });
}

export function planRadioDistributionFanOut(destinations, stationId) {
  return destinations
    .filter((item) => item.stationId === stationId && item.status === "ACTIVE")
    .map((item) => ({ destinationId: item.id, connectionId: item.connectionId, revision: item.revision }))
    .sort((left, right) => left.destinationId.localeCompare(right.destinationId));
}

export function redactedRadioDistributionDestination(destination) {
  const { connection, ...safe } = destination;
  const health = connection ? {
    status: connection.status,
    endpointOrigin: connection.endpointUrl ? new URL(connection.endpointUrl).origin : null,
    lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
    lastErrorAt: connection.lastErrorAt,
    lastErrorMessage: connection.lastErrorMessage,
    deliveries: connection.events || []
  } : null;
  return { ...safe, connection: health };
}
