import crypto from "node:crypto";
import { validateWebhookEndpoint } from "./outgoing-webhooks.mjs";

export function notificationEmailConfig(env = process.env) {
  const endpoint = String(env.NOTIFICATION_EMAIL_ENDPOINT || "").trim();
  const token = String(env.NOTIFICATION_EMAIL_TOKEN || "").trim();
  const from = String(env.NOTIFICATION_EMAIL_FROM || "").trim().toLowerCase();
  const failoverEndpoint = String(env.NOTIFICATION_EMAIL_FAILOVER_ENDPOINT || "").trim();
  const failoverToken = String(env.NOTIFICATION_EMAIL_FAILOVER_TOKEN || "").trim();
  const failoverFrom = String(env.NOTIFICATION_EMAIL_FAILOVER_FROM || "").trim().toLowerCase();
  if (!endpoint && !token && !from) return { configured: false, endpoint: null, token: null, from: null, failover: null };
  if (!endpoint || !token || token.length < 24 || !isEmailAddress(from)) {
    return { configured: false, invalid: true, endpoint: null, token: null, from: null, failover: null };
  }
  try {
    const primary = { configured: true, endpoint: validateWebhookEndpoint(endpoint), token, from, failover: null };
    if (!failoverEndpoint && !failoverToken && !failoverFrom) return primary;
    if (!failoverEndpoint || !failoverToken || failoverToken.length < 24 || !isEmailAddress(failoverFrom)) return { ...primary, failoverInvalid: true };
    try {
      return { ...primary, failover: { endpoint: validateWebhookEndpoint(failoverEndpoint), token: failoverToken, from: failoverFrom } };
    } catch {
      return { ...primary, failoverInvalid: true };
    }
  } catch {
    return { configured: false, invalid: true, endpoint: null, token: null, from: null, failover: null };
  }
}

export function isEmailAddress(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

export function buildNotificationEmail({ event, recipientEmail, from }) {
  if (!isEmailAddress(recipientEmail) || !isEmailAddress(from)) throw new Error("A valid notification email address is required.");
  const subject = `[Ruvanas ${event.severity}] ${String(event.title || "Operational notification").slice(0, 140)}`;
  const text = [
    String(event.title || "Operational notification"),
    "",
    String(event.message || "").slice(0, 500),
    "",
    `Type: ${event.type}`,
    `Occurred: ${new Date(event.occurredAt).toISOString()}`,
    `Reference: ${event.correlationId}`,
    "",
    "Sign in to Ruvanas to review the full operational record. Do not reply to this automated message."
  ].join("\n");
  const idempotencyKey = crypto.createHash("sha256").update(`notification-email:${event.id}:${recipientEmail.toLowerCase()}`).digest("hex");
  return { from, to: recipientEmail.toLowerCase(), subject, text, idempotencyKey };
}
