import crypto from "node:crypto";

export const WEBHOOK_EVENT_TYPES = Object.freeze([
  "campaign.published",
  "notification.created",
  "player.health_changed",
  "proof.accepted",
  "production.status_changed"
]);

const RETRY_DELAYS_MS = Object.freeze([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);

export function normalizeWebhookEventTypes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || "").trim().toLowerCase()))]
    .filter((value) => WEBHOOK_EVENT_TYPES.includes(value))
    .sort();
}

export function webhookIdempotencyKey(eventType, sourceId, version = "1") {
  return crypto.createHash("sha256").update(`${eventType}:${sourceId}:${version}`).digest("hex");
}

export function createWebhookSignature({ secret, timestamp, rawBody }) {
  if (!secret || String(secret).length < 32) throw new Error("Webhook secrets must contain at least 32 characters.");
  return `v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function buildWebhookRequest(event, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const rawBody = JSON.stringify({
    id: event.id,
    type: event.eventType,
    createdAt: new Date(event.createdAt).toISOString(),
    data: event.payload
  });
  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      "user-agent": "Ruvanas-Webhooks/1.0",
      "x-ruvanas-event-id": event.id,
      "x-ruvanas-idempotency-key": event.idempotencyKey,
      "x-ruvanas-timestamp": String(timestamp),
      "x-ruvanas-signature": createWebhookSignature({ secret, timestamp, rawBody })
    },
    requestSha256: crypto.createHash("sha256").update(rawBody).digest("hex")
  };
}

export function retryDelayMs(attemptNumber) {
  return RETRY_DELAYS_MS[Math.min(Math.max(Number(attemptNumber) - 1, 0), RETRY_DELAYS_MS.length - 1)];
}

export function isPrivateNetworkAddress(address) {
  const value = String(address || "").trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!value) return true;
  if (value === "::1" || value === "::" || /^fe[89ab]/.test(value) || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("ff")) return true;
  const mappedDotted = value.match(/^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedDotted) return isPrivateNetworkAddress(mappedDotted);
  if (value.startsWith("::ffff:")) {
    const words = value.slice(7).split(":");
    if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return true;
    const high = Number.parseInt(words[0], 16);
    const low = Number.parseInt(words[1], 16);
    return isPrivateNetworkAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || (parts[1] === 51 && parts[2] === 100))) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    parts[0] >= 224;
}

export function validateWebhookEndpoint(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { throw new Error("Enter a valid HTTPS webhook URL."); }
  if (url.protocol !== "https:") throw new Error("Webhook endpoints must use HTTPS.");
  if (url.username || url.password) throw new Error("Webhook URLs cannot contain credentials.");
  if (url.port && url.port !== "443") throw new Error("Webhook endpoints must use the standard HTTPS port.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Webhook endpoints cannot use local or internal hostnames.");
  }
  if (isPrivateNetworkAddress(hostname.replace(/^\[|\]$/g, ""))) throw new Error("Webhook endpoints cannot use private network addresses.");
  return url.toString();
}

export function publicWebhookPayload(eventType, input) {
  const allowed = {
    "campaign.published": ["campaignId", "publicationRevision", "publishedAt"],
    "notification.created": ["notificationId", "type", "severity", "title", "message", "entityType", "entityId", "occurredAt", "correlationId"],
    "player.health_changed": ["playerId", "locationId", "zoneId", "status", "changedAt"],
    "proof.accepted": ["playerId", "acceptedCount", "receivedAt"],
    "production.status_changed": ["orderId", "fromStatus", "toStatus", "changedAt"]
  }[eventType];
  if (!allowed) throw new Error("Unsupported webhook event type.");
  return Object.fromEntries(allowed.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

