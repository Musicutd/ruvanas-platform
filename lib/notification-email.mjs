import crypto from "node:crypto";
import { validateWebhookEndpoint } from "./outgoing-webhooks.mjs";

export function notificationEmailConfig(env = process.env) {
  const endpoint = String(env.NOTIFICATION_EMAIL_ENDPOINT || "").trim();
  const token = String(env.NOTIFICATION_EMAIL_TOKEN || "").trim();
  const from = String(env.NOTIFICATION_EMAIL_FROM || "").trim().toLowerCase();
  if (!endpoint && !token && !from) return { configured: false, endpoint: null, token: null, from: null };
  if (!endpoint || !token || token.length < 24 || !isEmailAddress(from)) {
    return { configured: false, invalid: true, endpoint: null, token: null, from: null };
  }
  try {
    return { configured: true, endpoint: validateWebhookEndpoint(endpoint), token, from };
  } catch {
    return { configured: false, invalid: true, endpoint: null, token: null, from: null };
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
