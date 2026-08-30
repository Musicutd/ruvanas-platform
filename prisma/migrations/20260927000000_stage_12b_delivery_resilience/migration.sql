-- Stage 12B: bounded recovery for abandoned outgoing webhook deliveries.

ALTER TABLE "OutgoingWebhookEvent"
ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRecoveredAt" TIMESTAMP(3);

ALTER TABLE "OutgoingWebhookEvent"
ADD CONSTRAINT "OutgoingWebhookEvent_recoveryCount_check"
CHECK ("recoveryCount" BETWEEN 0 AND 3);
