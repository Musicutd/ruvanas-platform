import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildWebhookRequest,
  createWebhookSignature,
  isPrivateNetworkAddress,
  normalizeWebhookEventTypes,
  publicWebhookPayload,
  retryDelayMs,
  validateWebhookEndpoint,
  webhookIdempotencyKey
} from "../lib/outgoing-webhooks.mjs";

const SECRET = "rvwhsec_stage-6b-signature-test-secret-that-is-long-enough";

test("webhook signatures authenticate the exact timestamp and raw body", () => {
  const event = { id: "evt_1", eventType: "campaign.published", idempotencyKey: "idem_1", createdAt: "2026-09-07T10:00:00.000Z", payload: { campaignId: "campaign_1" } };
  const request = buildWebhookRequest(event, SECRET, 1788775200);
  const expected = `v1=${crypto.createHmac("sha256", SECRET).update(`1788775200.${request.rawBody}`).digest("hex")}`;
  assert.equal(request.headers["x-ruvanas-signature"], expected);
  assert.equal(createWebhookSignature({ secret: SECRET, timestamp: 1788775200, rawBody: `${request.rawBody} ` }) === expected, false);
  assert.equal(request.headers["x-ruvanas-idempotency-key"], "idem_1");
});

test("idempotency keys are deterministic per source revision", () => {
  assert.equal(webhookIdempotencyKey("campaign.published", "campaign_1", "2"), webhookIdempotencyKey("campaign.published", "campaign_1", "2"));
  assert.notEqual(webhookIdempotencyKey("campaign.published", "campaign_1", "2"), webhookIdempotencyKey("campaign.published", "campaign_1", "3"));
});

test("retry delays are bounded and increase through the delivery window", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 20].map(retryDelayMs), [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000, 43_200_000]);
});

test("webhook endpoint validation blocks local networks and unsafe URL features", () => {
  assert.equal(validateWebhookEndpoint("https://partner.example/webhooks"), "https://partner.example/webhooks");
  for (const value of ["http://partner.example/hook", "https://localhost/hook", "https://127.0.0.1/hook", "https://10.0.0.5/hook", "https://[::ffff:127.0.0.1]/hook", "https://user:pass@partner.example/hook", "https://partner.example:8443/hook"]) {
    assert.throws(() => validateWebhookEndpoint(value));
  }
  assert.equal(isPrivateNetworkAddress("192.168.1.4"), true);
  assert.equal(isPrivateNetworkAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateNetworkAddress("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateNetworkAddress("fe90::1"), true);
  assert.equal(isPrivateNetworkAddress("8.8.8.8"), false);
});

test("outgoing event payloads expose only documented non-sensitive fields", () => {
  assert.deepEqual(publicWebhookPayload("proof.accepted", { playerId: "player_1", acceptedCount: 2, receivedAt: "now", studentName: "Never share", rawEvents: [1] }), { playerId: "player_1", acceptedCount: 2, receivedAt: "now" });
  assert.deepEqual(publicWebhookPayload("notification.created", { notificationId: "notice_1", type: "STREAM_ERROR", severity: "CRITICAL", title: "Source unavailable", message: "A monitored source is unavailable.", studentName: "Never share" }), { notificationId: "notice_1", type: "STREAM_ERROR", severity: "CRITICAL", title: "Source unavailable", message: "A monitored source is unavailable." });
  assert.throws(() => publicWebhookPayload("unknown.event", {}));
});

test("event subscriptions are allow-listed and deduplicated", () => {
  assert.deepEqual(normalizeWebhookEventTypes(["proof.accepted", "PROOF.ACCEPTED", "notification.created", "unknown"]), ["notification.created", "proof.accepted"]);
});

