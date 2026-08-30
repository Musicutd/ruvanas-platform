import crypto from "node:crypto";
import dns from "node:dns/promises";
import { decryptSecret } from "./crypto.js";
import {
  buildWebhookRequest,
  isPrivateNetworkAddress,
  publicWebhookPayload,
  retryDelayMs,
  validateWebhookEndpoint,
  webhookIdempotencyKey
} from "./outgoing-webhooks.mjs";

const ATTEMPTS_PER_CYCLE = 5;
const MAX_RECOVERY_CYCLES = 3;

export async function queueOutgoingWebhookEvent(tx, { organisationId, eventType, sourceId, version, payload }) {
  const connections = await tx.integrationConnection.findMany({
    where: { organisationId, kind: "OUTGOING_WEBHOOK", status: { in: ["CONNECTED", "DEGRADED"] }, subscribedEventTypes: { has: eventType } },
    select: { id: true }
  });
  if (!connections.length) return 0;
  const safePayload = publicWebhookPayload(eventType, payload);
  const idempotencyKey = webhookIdempotencyKey(eventType, sourceId, version);
  const result = await tx.outgoingWebhookEvent.createMany({
    data: connections.map((connection) => ({ organisationId, connectionId: connection.id, eventType, idempotencyKey, payload: safePayload })),
    skipDuplicates: true
  });
  return result.count;
}

async function assertPublicDns(endpointUrl) {
  const parsed = new URL(validateWebhookEndpoint(endpointUrl));
  let addresses;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw Object.assign(new Error("Webhook hostname resolution failed."), { code: "WEBHOOK_DNS_FAILED" });
  }
  if (!addresses.length || addresses.some((entry) => isPrivateNetworkAddress(entry.address))) {
    throw Object.assign(new Error("Webhook endpoint is blocked."), { code: "WEBHOOK_ENDPOINT_BLOCKED" });
  }
}

export function safeWebhookFailureCode(error) {
  const code = String(error?.code || "").toUpperCase();
  if (["WEBHOOK_DNS_FAILED", "WEBHOOK_ENDPOINT_BLOCKED", "WEBHOOK_REQUEST_BUILD_FAILED", "WEBHOOK_TIMEOUT", "WEBHOOK_REQUEST_FAILED"].includes(code)) return code;
  if (/^WEBHOOK_HTTP_[1-5][0-9]{2}$/.test(code)) return code;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "WEBHOOK_TIMEOUT";
  return "WEBHOOK_REQUEST_FAILED";
}

function deliveryAttemptLimit(event) {
  return ATTEMPTS_PER_CYCLE * (Math.max(0, Math.min(MAX_RECOVERY_CYCLES, Number(event.recoveryCount) || 0)) + 1);
}

export async function deliverWebhookEvent(prisma, eventId, fetchImpl = fetch) {
  const event = await prisma.outgoingWebhookEvent.findUnique({ include: { connection: true }, where: { id: eventId } });
  if (!event) throw new Error("Webhook event not found.");
  if (event.status === "DELIVERED") return event;
  if (!["CONNECTED", "DEGRADED"].includes(event.connection.status) || event.connection.revokedAt) throw new Error("Webhook connection is not active.");
  const attemptLimit = deliveryAttemptLimit(event);
  if (event.attemptCount >= attemptLimit) throw new Error("Webhook retry limit reached.");

  const attemptNumber = event.attemptCount + 1;
  let responseStatus = null;
  let errorMessage = null;
  let request = null;
  let requestSha256 = crypto.createHash("sha256").update(`undelivered:${event.id}:${attemptNumber}`).digest("hex");

  try {
    const secret = decryptSecret(event.connection.encryptedSecret);
    request = buildWebhookRequest(event, secret);
    requestSha256 = request.requestSha256;
    await assertPublicDns(event.connection.endpointUrl);
    const response = await fetchImpl(event.connection.endpointUrl, {
      method: "POST",
      headers: request.headers,
      body: request.rawBody,
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    responseStatus = response.status;
    if (!response.ok) throw Object.assign(new Error("Webhook endpoint rejected the request."), { code: `WEBHOOK_HTTP_${response.status}` });
  } catch (error) {
    errorMessage = request ? safeWebhookFailureCode(error) : "WEBHOOK_REQUEST_BUILD_FAILED";
  }

  const delivered = !errorMessage;
  const exhausted = !delivered && attemptNumber >= attemptLimit;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.webhookDeliveryAttempt.create({ data: { eventId: event.id, attemptNumber, requestSha256, responseStatus, errorMessage } });
    const updated = await tx.outgoingWebhookEvent.update({
      where: { id: event.id },
      data: {
        attemptCount: attemptNumber,
        status: delivered ? "DELIVERED" : exhausted ? "ABANDONED" : "FAILED",
        deliveredAt: delivered ? now : null,
        lastError: errorMessage,
        nextAttemptAt: delivered ? now : new Date(now.getTime() + retryDelayMs(attemptNumber))
      }
    });
    await tx.integrationConnection.update({
      where: { id: event.connectionId },
      data: delivered
        ? { status: "CONNECTED", lastSuccessfulSyncAt: now, lastErrorAt: null, lastErrorMessage: null }
        : { status: "DEGRADED", lastErrorAt: now, lastErrorMessage: errorMessage }
    });
    return updated;
  });
}

export async function processOutgoingWebhookBatch(prisma, { limit = 20, connectionId, fetchImpl = fetch, deliver = deliverWebhookEvent } = {}) {
  const now = new Date();
  const events = await prisma.outgoingWebhookEvent.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
      ...(connectionId ? { connectionId } : {}),
      connection: { status: { in: ["CONNECTED", "DEGRADED"] }, revokedAt: null }
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(100, Number(limit) || 20)),
    select: { id: true }
  });
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let abandoned = 0;
  let workerErrors = 0;
  for (const event of events) {
    const lock = await prisma.outgoingWebhookEvent.updateMany({
      where: { id: event.id, status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + 2 * 60_000) }
    });
    if (lock.count !== 1) continue;
    claimed += 1;
    try {
      const result = await deliver(prisma, event.id, fetchImpl);
      if (result.status === "DELIVERED") delivered += 1;
      else if (result.status === "ABANDONED") abandoned += 1;
      else failed += 1;
    } catch {
      workerErrors += 1;
      failed += 1;
      try {
        await prisma.outgoingWebhookEvent.updateMany({
          where: { id: event.id, status: { in: ["PENDING", "FAILED"] } },
          data: { status: "FAILED", lastError: "WEBHOOK_WORKER_ERROR", nextAttemptAt: new Date(now.getTime() + retryDelayMs(1)) }
        });
      } catch {
        // Keep the batch isolated and report only the aggregate worker-error count.
      }
    }
  }
  return { claimed, delivered, failed, abandoned, workerErrors };
}

export async function recoverAbandonedWebhookEvents(prisma, { connectionId, now = new Date(), limit = 10 } = {}) {
  if (!connectionId) throw new Error("A webhook connection is required.");
  const events = await prisma.outgoingWebhookEvent.findMany({
    where: {
      connectionId,
      status: "ABANDONED",
      recoveryCount: { lt: MAX_RECOVERY_CYCLES },
      connection: { status: { in: ["CONNECTED", "DEGRADED"] }, revokedAt: null }
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(25, Number(limit) || 10)),
    select: { id: true, recoveryCount: true }
  });
  let recovered = 0;
  for (const event of events) {
    const result = await prisma.outgoingWebhookEvent.updateMany({
      where: { id: event.id, status: "ABANDONED", recoveryCount: event.recoveryCount },
      data: {
        recoveryCount: { increment: 1 },
        status: "FAILED",
        nextAttemptAt: now,
        lastRecoveredAt: now,
        lastError: "MANUAL_RECOVERY_QUEUED"
      }
    });
    recovered += result.count;
  }
  return { eligible: events.length, recovered };
}

export function generateWebhookSecret() {
  return `rvwhsec_${crypto.randomBytes(32).toString("hex")}`;
}

