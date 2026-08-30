-- Stage 11D: leased background jobs, bounded retries, dead-letter recovery,
-- and tenant-scoped in-app notification delivery.

CREATE TYPE "JobType" AS ENUM ('NOTIFICATION_DELIVERY');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'LEASED', 'RETRY_SCHEDULED', 'SUCCEEDED', 'DEAD_LETTER');
CREATE TYPE "NotificationType" AS ENUM ('PLAYER_OFFLINE', 'STREAM_ERROR', 'CAMPAIGN_FAILURE', 'PRODUCTION_ORDER_UPDATE', 'BILLING_STATE', 'SCHOOL_REVIEW_REQUEST', 'CONSENT_EXPIRY');
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WEBHOOK');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'SKIPPED', 'FAILED');

CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "idempotencyKey" TEXT,
    "correlationId" TEXT NOT NULL,
    "requestId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Job_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 25),
    CONSTRAINT "Job_lease_check" CHECK (
      ("status" = 'LEASED' AND "leaseToken" IS NOT NULL AND "leaseOwner" IS NOT NULL AND "leaseUntil" IS NOT NULL)
      OR
      ("status" <> 'LEASED' AND "leaseToken" IS NULL AND "leaseOwner" IS NULL AND "leaseUntil" IS NULL)
    ),
    CONSTRAINT "Job_completion_check" CHECK ("status" <> 'SUCCEEDED' OR "completedAt" IS NOT NULL),
    CONSTRAINT "Job_dead_letter_check" CHECK ("status" <> 'DEAD_LETTER' OR "deadLetteredAt" IS NOT NULL)
);

CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "dedupeKey" TEXT,
    "correlationId" TEXT NOT NULL,
    "deliveryJobId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryQueuedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "notificationEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationDelivery_delivered_check" CHECK ("status" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "Job_organisationId_type_idempotencyKey_key" ON "Job"("organisationId", "type", "idempotencyKey");
CREATE INDEX "Job_status_availableAt_priority_idx" ON "Job"("status", "availableAt", "priority");
CREATE INDEX "Job_leaseUntil_idx" ON "Job"("leaseUntil");
CREATE INDEX "Job_organisationId_createdAt_idx" ON "Job"("organisationId", "createdAt");
CREATE INDEX "Job_correlationId_idx" ON "Job"("correlationId");

CREATE UNIQUE INDEX "NotificationEvent_organisationId_dedupeKey_key" ON "NotificationEvent"("organisationId", "dedupeKey");
CREATE UNIQUE INDEX "NotificationEvent_deliveryJobId_key" ON "NotificationEvent"("deliveryJobId");
CREATE INDEX "NotificationEvent_organisationId_occurredAt_idx" ON "NotificationEvent"("organisationId", "occurredAt");
CREATE INDEX "NotificationEvent_type_occurredAt_idx" ON "NotificationEvent"("type", "occurredAt");
CREATE INDEX "NotificationEvent_correlationId_idx" ON "NotificationEvent"("correlationId");

CREATE UNIQUE INDEX "NotificationPreference_organisationId_userId_type_channel_key" ON "NotificationPreference"("organisationId", "userId", "type", "channel");
CREATE INDEX "NotificationPreference_userId_organisationId_idx" ON "NotificationPreference"("userId", "organisationId");

CREATE UNIQUE INDEX "NotificationDelivery_notificationEventId_userId_channel_key" ON "NotificationDelivery"("notificationEventId", "userId", "channel");
CREATE INDEX "NotificationDelivery_userId_organisationId_readAt_createdAt_idx" ON "NotificationDelivery"("userId", "organisationId", "readAt", "createdAt");
CREATE INDEX "NotificationDelivery_organisationId_status_createdAt_idx" ON "NotificationDelivery"("organisationId", "status", "createdAt");

ALTER TABLE "Job" ADD CONSTRAINT "Job_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_deliveryJobId_fkey" FOREIGN KEY ("deliveryJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationEventId_fkey" FOREIGN KEY ("notificationEventId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
