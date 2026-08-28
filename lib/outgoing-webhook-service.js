import crypto from "node:crypto";
import dns from "node:dns/promises";
import { decryptSecret } from "@/lib/crypto";
import {
  buildWebhookRequest,
  isPrivateNetworkAddress,
  publicWebhookPayload,
  retryDelayMs,
  validateWebhookEndpoint,
  webhookIdempotencyKey
} from "@/lib/outgoing-webhooks.mjs";

const MAX_ATTEMPTS = 5;

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
  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateNetworkAddress(entry.address))) {
    throw new Error("The webhook hostname does not resolve to a public address.");
  }
}

export async function deliverWebhookEvent(prisma, eventId, fetchImpl = fetch) {
  const event = await prisma.outgoingWebhookEvent.findUnique({ include: { connection: true }, where: { id: eventId } });
  if (!event) throw new Error("Webhook event not found.");
  if (event.status === "DELIVERED") return event;
  if (event.connection.status !== "CONNECTED" || event.connection.revokedAt) throw new Error("Webhook connection is not active.");
  if (event.attemptCount >= MAX_ATTEMPTS) throw new Error("Webhook retry limit reached.");

  const attemptNumber = event.attemptCount + 1;
  let responseStatus = null;
  let errorMessage = null;
  const secret = decryptSecret(event.connection.encryptedSecret);
  const request = buildWebhookRequest(event, secret);

  try {
    await assertPublicDns(event.connection.endpointUrl);
    const response = await fetchImpl(event.connection.endpointUrl, {
      method: "POST",
      headers: request.headers,
      body: request.rawBody,
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    responseStatus = response.status;
    if (!response.ok) throw new Error(`Endpoint returned HTTP ${response.status}.`);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message.slice(0, 500) : "Webhook delivery failed.";
  }

  const delivered = !errorMessage;
  const exhausted = !delivered && attemptNumber >= MAX_ATTEMPTS;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.webhookDeliveryAttempt.create({ data: { eventId: event.id, attemptNumber, requestSha256: request.requestSha256, responseStatus, errorMessage } });
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

export function generateWebhookSecret() {
  return `rvwhsec_${crypto.randomBytes(32).toString("hex")}`;
}

