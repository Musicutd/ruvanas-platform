-- Stage 19.7: provider-neutral, health-gated external live sources.
CREATE TYPE "ExternalLiveSourceStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "ExternalLiveCredentialType" AS ENUM ('NONE', 'BASIC', 'BEARER');

CREATE TABLE "ExternalLiveSource" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL DEFAULT 'GENERIC_HTTP',
    "streamUrl" TEXT NOT NULL,
    "credentialType" "ExternalLiveCredentialType" NOT NULL DEFAULT 'NONE',
    "credentialUsername" TEXT,
    "credentialEncrypted" TEXT,
    "status" "ExternalLiveSourceStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "healthStatus" "StreamProbeStatus",
    "lastHealthCheckedAt" TIMESTAMP(3),
    "lastHealthyAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastLatencyMs" INTEGER,
    "lastHttpStatus" INTEGER,
    "lastContentType" TEXT,
    "lastErrorCode" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "activatedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalLiveSource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExternalLiveSource_window_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt"),
    CONSTRAINT "ExternalLiveSource_basic_username_check" CHECK ("credentialType" <> 'BASIC' OR "credentialUsername" IS NOT NULL),
    CONSTRAINT "ExternalLiveSource_secret_check" CHECK ("credentialType" = 'NONE' OR "credentialEncrypted" IS NOT NULL)
);

CREATE UNIQUE INDEX "ExternalLiveSource_organisationId_channelId_name_key" ON "ExternalLiveSource"("organisationId", "channelId", "name");
CREATE UNIQUE INDEX "ExternalLiveSource_one_active_per_channel_key" ON "ExternalLiveSource"("channelId") WHERE "status" = 'ACTIVE';
CREATE INDEX "ExternalLiveSource_organisationId_status_idx" ON "ExternalLiveSource"("organisationId", "status");
CREATE INDEX "ExternalLiveSource_channelId_status_startsAt_endsAt_idx" ON "ExternalLiveSource"("channelId", "status", "startsAt", "endsAt");
CREATE INDEX "ExternalLiveSource_healthStatus_lastHealthCheckedAt_idx" ON "ExternalLiveSource"("healthStatus", "lastHealthCheckedAt");

ALTER TABLE "ExternalLiveSource" ADD CONSTRAINT "ExternalLiveSource_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalLiveSource" ADD CONSTRAINT "ExternalLiveSource_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalLiveSource" ADD CONSTRAINT "ExternalLiveSource_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalLiveSource" ADD CONSTRAINT "ExternalLiveSource_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
