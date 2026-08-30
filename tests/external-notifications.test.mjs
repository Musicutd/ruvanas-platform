import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildNotificationEmail, notificationEmailConfig } from "../lib/notification-email.mjs";
import { sendNotificationEmail } from "../lib/notification-email-service.js";
import { processOutgoingWebhookBatch, recoverAbandonedWebhookEvents } from "../lib/outgoing-webhook-service.js";

test("email notifications are disabled unless every provider setting is valid", () => {
  assert.deepEqual(notificationEmailConfig({}), { configured: false, endpoint: null, token: null, from: null, failover: null });
  assert.equal(notificationEmailConfig({ NOTIFICATION_EMAIL_ENDPOINT: "https://mail.example/send" }).configured, false);
  assert.equal(notificationEmailConfig({ NOTIFICATION_EMAIL_ENDPOINT: "http://localhost/send", NOTIFICATION_EMAIL_TOKEN: "provider-token-longer-than-twenty-four-characters", NOTIFICATION_EMAIL_FROM: "alerts@ruvanas.example" }).configured, false);
  const config = notificationEmailConfig({
    NOTIFICATION_EMAIL_ENDPOINT: "https://mail.example/send",
    NOTIFICATION_EMAIL_TOKEN: "provider-token-longer-than-twenty-four-characters",
    NOTIFICATION_EMAIL_FROM: "alerts@ruvanas.example"
  });
  assert.equal(config.configured, true);
  assert.equal(config.endpoint, "https://mail.example/send");
  assert.equal(config.failover, null);
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
  assert.deepEqual(result, { claimed: 3, delivered: 1, failed: 1, abandoned: 1, workerErrors: 0 });
});

test("webhook worker isolates an unexpected delivery error and continues the batch", async () => {
  const updates = [];
  const prisma = { outgoingWebhookEvent: { findMany: async () => [{ id: "one" }, { id: "two" }], updateMany: async (input) => { updates.push(input); return { count: 1 }; } } };
  const result = await processOutgoingWebhookBatch(prisma, { deliver: async (_prisma, id) => {
    if (id === "one") throw new Error("provider detail must not stop the batch");
    return { status: "DELIVERED" };
  } });
  assert.deepEqual(result, { claimed: 2, delivered: 1, failed: 1, abandoned: 0, workerErrors: 1 });
  assert.equal(updates.some((entry) => entry.data?.lastError === "WEBHOOK_WORKER_ERROR"), true);
});

const EMAIL_EVENT = { id: "notice-2", type: "STREAM_ERROR", severity: "WARNING", title: "Stream degraded", message: "A monitored source requires attention.", occurredAt: "2026-09-27T10:00:00.000Z", correlationId: "stream-2" };
const EMAIL_ENV = {
  NOTIFICATION_EMAIL_ENDPOINT: "https://primary-mail.example/send",
  NOTIFICATION_EMAIL_TOKEN: "primary-provider-token-longer-than-twenty-four-characters",
  NOTIFICATION_EMAIL_FROM: "alerts@ruvanas.example",
  NOTIFICATION_EMAIL_FAILOVER_ENDPOINT: "https://secondary-mail.example/send",
  NOTIFICATION_EMAIL_FAILOVER_TOKEN: "secondary-provider-token-longer-than-twenty-four-characters",
  NOTIFICATION_EMAIL_FAILOVER_FROM: "backup@ruvanas.example"
};

test("email delivery uses the secondary provider only after an explicit safe primary failure", async () => {
  const requests = [];
  const result = await sendNotificationEmail({
    event: EMAIL_EVENT,
    recipientEmail: "owner@example.test",
    env: EMAIL_ENV,
    dnsLookup: async () => [{ address: "8.8.8.8" }],
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body), idempotencyKey: options.headers["x-idempotency-key"] });
      return url.includes("primary") ? { ok: false, status: 503 } : { ok: true, status: 202 };
    }
  });
  assert.equal(result.provider, "failover");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.equal(requests[1].body.from, "backup@ruvanas.example");
});

test("email delivery does not fail over after an ambiguous network error", async () => {
  let requests = 0;
  await assert.rejects(() => sendNotificationEmail({
    event: EMAIL_EVENT,
    recipientEmail: "owner@example.test",
    env: EMAIL_ENV,
    dnsLookup: async () => [{ address: "8.8.8.8" }],
    fetchImpl: async () => { requests += 1; throw new Error("ambiguous connection reset"); }
  }), (error) => error.code === "EMAIL_PROVIDER_UNAVAILABLE");
  assert.equal(requests, 1);
});

test("abandoned webhook recovery is bounded and preserves delivery evidence", { skip: process.env.RUN_DATABASE_TESTS !== "1" }, async () => {
  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();
  const suffix = randomUUID();
  try {
    const user = await database.user.create({ data: { email: `webhook-recovery-${suffix}@example.test`, passwordHash: "test-only", name: "Webhook recovery tester" } });
    const organisation = await database.organisation.create({ data: { name: `Webhook recovery ${suffix}`, slug: `webhook-recovery-${suffix}` } });
    const connection = await database.integrationConnection.create({ data: { organisationId: organisation.id, createdByUserId: user.id, name: `Recovery connection ${suffix}`, endpointUrl: "https://partner.example/webhook", encryptedSecret: "test-not-used", subscribedEventTypes: ["notification.created"] } });
    const event = await database.outgoingWebhookEvent.create({
      data: { organisationId: organisation.id, connectionId: connection.id, eventType: "notification.created", idempotencyKey: `recovery:${suffix}`, payload: { notificationId: suffix }, status: "ABANDONED", attemptCount: 5, recoveryCount: 0, lastError: "WEBHOOK_HTTP_503" }
    });
    await database.webhookDeliveryAttempt.create({ data: { eventId: event.id, attemptNumber: 5, requestSha256: "a".repeat(64), responseStatus: 503, errorMessage: "WEBHOOK_HTTP_503" } });
    assert.deepEqual(await recoverAbandonedWebhookEvents(database, { connectionId: connection.id }), { eligible: 1, recovered: 1 });
    const recovered = await database.outgoingWebhookEvent.findUniqueOrThrow({ where: { id: event.id }, include: { attempts: true } });
    assert.equal(recovered.status, "FAILED");
    assert.equal(recovered.attemptCount, 5);
    assert.equal(recovered.recoveryCount, 1);
    assert.equal(recovered.lastError, "MANUAL_RECOVERY_QUEUED");
    assert.ok(recovered.lastRecoveredAt instanceof Date);
    assert.equal(recovered.attempts.length, 1);
    assert.equal(recovered.attempts[0].attemptNumber, 5);
    await database.outgoingWebhookEvent.update({ where: { id: event.id }, data: { status: "ABANDONED", recoveryCount: 3 } });
    assert.deepEqual(await recoverAbandonedWebhookEvents(database, { connectionId: connection.id }), { eligible: 0, recovered: 0 });
  } finally {
    await database.organisation.deleteMany({ where: { slug: `webhook-recovery-${suffix}` } });
    await database.user.deleteMany({ where: { email: `webhook-recovery-${suffix}@example.test` } });
    await database.$disconnect();
  }
});
