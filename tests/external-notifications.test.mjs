import assert from "node:assert/strict";
import test from "node:test";
import { buildNotificationEmail, notificationEmailConfig } from "../lib/notification-email.mjs";
import { processOutgoingWebhookBatch } from "../lib/outgoing-webhook-service.js";

test("email notifications are disabled unless every provider setting is valid", () => {
  assert.deepEqual(notificationEmailConfig({}), { configured: false, endpoint: null, token: null, from: null });
  assert.equal(notificationEmailConfig({ NOTIFICATION_EMAIL_ENDPOINT: "https://mail.example/send" }).configured, false);
  assert.equal(notificationEmailConfig({ NOTIFICATION_EMAIL_ENDPOINT: "http://localhost/send", NOTIFICATION_EMAIL_TOKEN: "provider-token-longer-than-twenty-four-characters", NOTIFICATION_EMAIL_FROM: "alerts@ruvanas.example" }).configured, false);
  const config = notificationEmailConfig({
    NOTIFICATION_EMAIL_ENDPOINT: "https://mail.example/send",
    NOTIFICATION_EMAIL_TOKEN: "provider-token-longer-than-twenty-four-characters",
    NOTIFICATION_EMAIL_FROM: "alerts@ruvanas.example"
  });
  assert.equal(config.configured, true);
  assert.equal(config.endpoint, "https://mail.example/send");
});

test("email bodies contain bounded operational information and deterministic idempotency", () => {
  const input = {
    event: { id: "notice-1", type: "PLAYER_OFFLINE", severity: "CRITICAL", title: "Player offline", message: "A monitored player missed its heartbeat window.", occurredAt: "2026-09-27T10:00:00.000Z", correlationId: "incident-1" },
    recipientEmail: "OWNER@EXAMPLE.TEST",
    from: "alerts@ruvanas.example"
  };
  const first = buildNotificationEmail(input);
  const second = buildNotificationEmail(input);
  assert.equal(first.to, "owner@example.test");
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.match(first.text, /Sign in to Ruvanas/);
  assert.equal(first.text.includes("password"), false);
});

test("webhook worker batches due external deliveries and records safe totals", async () => {
  const prisma = { outgoingWebhookEvent: { findMany: async () => [{ id: "one" }, { id: "two" }, { id: "three" }], updateMany: async () => ({ count: 1 }) } };
  const statusById = { one: "DELIVERED", two: "FAILED", three: "ABANDONED" };
  const result = await processOutgoingWebhookBatch(prisma, { deliver: async (_prisma, id) => ({ status: statusById[id] }) });
  assert.deepEqual(result, { claimed: 3, delivered: 1, failed: 1, abandoned: 1 });
});
