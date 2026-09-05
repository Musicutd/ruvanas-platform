-- Stage 19.9: health-driven External Live failover with hysteresis and evidence.
CREATE TYPE "LiveFailoverState" AS ENUM ('PRIMARY', 'BACKUP', 'SCHEDULED_FALLBACK', 'RECOVERY_PENDING', 'MANUAL_OVERRIDE');
CREATE TYPE "LiveFailoverTransitionKind" AS ENUM ('POLICY_ENABLED', 'POLICY_DISABLED', 'PRIMARY_FAILED', 'BACKUP_SELECTED', 'PROGRAMMING_FALLBACK_SELECTED', 'PRIMARY_RECOVERY_PENDING', 'PRIMARY_RECOVERED', 'MANUAL_SOURCE_SELECTED', 'MANUAL_OVERRIDE_CLEARED');

CREATE TABLE "LiveFailoverPolicy" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "primarySourceId" TEXT NOT NULL,
  "backupSourceId" TEXT,
  "effectiveSourceId" TEXT,
  "manualSourceId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "state" "LiveFailoverState" NOT NULL DEFAULT 'PRIMARY',
  "failureThreshold" INTEGER NOT NULL DEFAULT 3,
  "recoveryThreshold" INTEGER NOT NULL DEFAULT 3,
  "recoveryHoldSeconds" INTEGER NOT NULL DEFAULT 60,
  "recoveryHealthyProbes" INTEGER NOT NULL DEFAULT 0,
  "transitionVersion" INTEGER NOT NULL DEFAULT 0,
  "primaryHealthySince" TIMESTAMP(3),
  "manualOverrideUntil" TIMESTAMP(3),
  "lastTransitionAt" TIMESTAMP(3),
  "lastTransitionReason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveFailoverPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveFailoverEvent" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "kind" "LiveFailoverTransitionKind" NOT NULL,
  "fromSourceId" TEXT,
  "toSourceId" TEXT,
  "reason" TEXT NOT NULL,
  "evidence" JSONB,
  "actorUserId" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveFailoverEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveFailoverPolicy_organisationId_channelId_key" ON "LiveFailoverPolicy"("organisationId", "channelId");
CREATE UNIQUE INDEX "LiveFailoverPolicy_channelId_organisationId_key" ON "LiveFailoverPolicy"("channelId", "organisationId");
CREATE UNIQUE INDEX "ExternalLiveSource_id_organisationId_channelId_key" ON "ExternalLiveSource"("id", "organisationId", "channelId");
CREATE INDEX "LiveFailoverPolicy_enabled_updatedAt_idx" ON "LiveFailoverPolicy"("enabled", "updatedAt");
CREATE INDEX "LiveFailoverPolicy_primarySourceId_idx" ON "LiveFailoverPolicy"("primarySourceId");
CREATE INDEX "LiveFailoverPolicy_backupSourceId_idx" ON "LiveFailoverPolicy"("backupSourceId");
CREATE INDEX "LiveFailoverPolicy_effectiveSourceId_idx" ON "LiveFailoverPolicy"("effectiveSourceId");
CREATE INDEX "LiveFailoverEvent_policyId_observedAt_idx" ON "LiveFailoverEvent"("policyId", "observedAt");
CREATE INDEX "LiveFailoverEvent_organisationId_observedAt_idx" ON "LiveFailoverEvent"("organisationId", "observedAt");
CREATE INDEX "LiveFailoverEvent_channelId_observedAt_idx" ON "LiveFailoverEvent"("channelId", "observedAt");

ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_primarySourceId_organisationId_channelId_fkey" FOREIGN KEY ("primarySourceId", "organisationId", "channelId") REFERENCES "ExternalLiveSource"("id", "organisationId", "channelId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_backupSourceId_organisationId_channelId_fkey" FOREIGN KEY ("backupSourceId", "organisationId", "channelId") REFERENCES "ExternalLiveSource"("id", "organisationId", "channelId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_effectiveSourceId_organisationId_channelId_fkey" FOREIGN KEY ("effectiveSourceId", "organisationId", "channelId") REFERENCES "ExternalLiveSource"("id", "organisationId", "channelId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_manualSourceId_organisationId_channelId_fkey" FOREIGN KEY ("manualSourceId", "organisationId", "channelId") REFERENCES "ExternalLiveSource"("id", "organisationId", "channelId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverEvent" ADD CONSTRAINT "LiveFailoverEvent_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "LiveFailoverPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverEvent" ADD CONSTRAINT "LiveFailoverEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveFailoverEvent" ADD CONSTRAINT "LiveFailoverEvent_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_distinct_sources_check" CHECK ("backupSourceId" IS NULL OR "backupSourceId" <> "primarySourceId");
ALTER TABLE "LiveFailoverPolicy" ADD CONSTRAINT "LiveFailoverPolicy_thresholds_check" CHECK ("failureThreshold" BETWEEN 1 AND 5 AND "recoveryThreshold" BETWEEN 1 AND 5 AND "recoveryHoldSeconds" BETWEEN 30 AND 600);
