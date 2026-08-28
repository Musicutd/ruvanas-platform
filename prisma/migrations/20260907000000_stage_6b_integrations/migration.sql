CREATE TYPE "IntegrationKind" AS ENUM ('OUTGOING_WEBHOOK', 'POS_METRICS', 'INVENTORY_METRICS', 'FOOTFALL_METRICS');
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('CONNECTED', 'DEGRADED', 'DISCONNECTED', 'REVOKED');
CREATE TYPE "IntegrationSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'ABANDONED');

CREATE TABLE "IntegrationConnection" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "IntegrationKind" NOT NULL DEFAULT 'OUTGOING_WEBHOOK',
  "providerKey" TEXT NOT NULL DEFAULT 'GENERIC_WEBHOOK_V1',
  "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "endpointUrl" TEXT,
  "encryptedSecret" TEXT,
  "subscribedEventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "configuration" JSONB,
  "lastSuccessfulSyncAt" TIMESTAMP(3),
  "lastErrorAt" TIMESTAMP(3),
  "lastErrorMessage" TEXT,
  "disconnectedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationSyncRun" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "status" "IntegrationSyncRunStatus" NOT NULL DEFAULT 'PENDING',
  "sourceTimestamp" TIMESTAMP(3),
  "summary" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutgoingWebhookEvent" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutgoingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "requestSha256" TEXT NOT NULL,
  "responseStatus" INTEGER,
  "errorMessage" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationConnection_organisationId_name_key" ON "IntegrationConnection"("organisationId", "name");
CREATE INDEX "IntegrationConnection_organisationId_status_idx" ON "IntegrationConnection"("organisationId", "status");
CREATE INDEX "IntegrationConnection_kind_status_idx" ON "IntegrationConnection"("kind", "status");
CREATE INDEX "IntegrationSyncRun_organisationId_createdAt_idx" ON "IntegrationSyncRun"("organisationId", "createdAt");
CREATE INDEX "IntegrationSyncRun_connectionId_status_createdAt_idx" ON "IntegrationSyncRun"("connectionId", "status", "createdAt");
CREATE UNIQUE INDEX "OutgoingWebhookEvent_connectionId_idempotencyKey_key" ON "OutgoingWebhookEvent"("connectionId", "idempotencyKey");
CREATE INDEX "OutgoingWebhookEvent_organisationId_status_nextAttemptAt_idx" ON "OutgoingWebhookEvent"("organisationId", "status", "nextAttemptAt");
CREATE INDEX "OutgoingWebhookEvent_connectionId_createdAt_idx" ON "OutgoingWebhookEvent"("connectionId", "createdAt");
CREATE UNIQUE INDEX "WebhookDeliveryAttempt_eventId_attemptNumber_key" ON "WebhookDeliveryAttempt"("eventId", "attemptNumber");
CREATE INDEX "WebhookDeliveryAttempt_eventId_attemptedAt_idx" ON "WebhookDeliveryAttempt"("eventId", "attemptedAt");

ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutgoingWebhookEvent" ADD CONSTRAINT "OutgoingWebhookEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutgoingWebhookEvent" ADD CONSTRAINT "OutgoingWebhookEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OutgoingWebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

