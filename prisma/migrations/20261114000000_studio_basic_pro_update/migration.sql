CREATE TYPE "StudioPlayoutMode" AS ENUM ('AUTO', 'ASSIST', 'MANUAL');
CREATE TYPE "StudioPlayoutStatus" AS ENUM ('ACTIVE', 'FALLBACK', 'ENDED');
CREATE TYPE "StudioQueueArea" AS ENUM ('PREPARE', 'LIVE', 'PLAYED');
CREATE TYPE "StudioQueueItemStatus" AS ENUM ('READY', 'ON_AIR', 'PLAYED', 'SKIPPED', 'BLOCKED');
CREATE TYPE "StudioProgrammeRole" AS ENUM ('INTRO', 'OUTRO', 'JINGLE', 'BED', 'PROMO', 'PRERECORDED_SEGMENT', 'INTERVIEW', 'RECURRING_FEATURE');
CREATE TYPE "StudioBroadcastDestinationType" AS ENUM ('RUVANAS_MANAGED', 'ICECAST', 'SHOUTCAST');
CREATE TYPE "StudioBroadcastConnectionState" AS ENUM ('STANDBY', 'CONNECTED', 'RECONNECTING', 'FAILED', 'DISABLED');
CREATE TYPE "StudioBroadcastSessionStatus" AS ENUM ('ACTIVE', 'STOPPING', 'ENDED');

ALTER TABLE "Plan" ADD COLUMN "studioExternalDestinationLimit" INTEGER;

CREATE TABLE "StudioPlayoutSession" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL, "channelId" TEXT NOT NULL,
  "productFamily" "PlanProductFamily" NOT NULL, "title" TEXT NOT NULL,
  "mode" "StudioPlayoutMode" NOT NULL DEFAULT 'AUTO', "status" "StudioPlayoutStatus" NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 0, "currentItemId" TEXT, "fallbackAutoDjId" TEXT,
  "outputHealth" TEXT NOT NULL DEFAULT 'FALLBACK_READY', "lastCommandAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3), "endedReason" TEXT, "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "StudioPlayoutItem" (
  "id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "mediaAssetId" TEXT NOT NULL,
  "area" "StudioQueueArea" NOT NULL DEFAULT 'PREPARE', "status" "StudioQueueItemStatus" NOT NULL DEFAULT 'READY',
  "position" INTEGER NOT NULL DEFAULT 0, "title" TEXT NOT NULL, "artistOrProgramme" TEXT, "itemType" TEXT NOT NULL DEFAULT 'AUDIO',
  "durationMs" INTEGER, "cueInMs" INTEGER NOT NULL DEFAULT 0, "cueOutMs" INTEGER,
  "fadeInMs" INTEGER NOT NULL DEFAULT 0, "fadeOutMs" INTEGER NOT NULL DEFAULT 0, "gainDb" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "locked" BOOLEAN NOT NULL DEFAULT false, "rightsReady" BOOLEAN NOT NULL DEFAULT false, "readinessReason" TEXT,
  "estimatedStartAt" TIMESTAMP(3), "startedAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3), "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "StudioPlayoutCommand" (
  "id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL, "expectedRevision" INTEGER NOT NULL, "result" JSONB, "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "StudioProgrammePack" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "productFamily" "PlanProductFamily" NOT NULL, "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "StudioProgrammePackItem" (
  "id" TEXT PRIMARY KEY, "packId" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "mediaAssetId" TEXT NOT NULL,
  "role" "StudioProgrammeRole" NOT NULL, "position" INTEGER NOT NULL, "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "StudioBroadcastDestination" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL, "stationId" TEXT, "name" TEXT NOT NULL,
  "type" "StudioBroadcastDestinationType" NOT NULL, "host" TEXT, "port" INTEGER, "mountOrService" TEXT,
  "codec" "AudioCodec" NOT NULL DEFAULT 'MP3', "bitrateKbps" INTEGER, "credentialEncrypted" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "primaryGroup" TEXT, "isBackup" BOOLEAN NOT NULL DEFAULT false,
  "connectionState" "StudioBroadcastConnectionState" NOT NULL DEFAULT 'STANDBY', "reconnectAttempt" INTEGER NOT NULL DEFAULT 0,
  "nextReconnectAt" TIMESTAMP(3), "lastConnectedAt" TIMESTAMP(3), "lastDisconnectedAt" TIMESTAMP(3), "lastSafeError" TEXT,
  "listenerCount" INTEGER, "listenerTelemetryAt" TIMESTAMP(3), "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "StudioBroadcastSession" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL, "playoutSessionId" TEXT NOT NULL,
  "status" "StudioBroadcastSessionStatus" NOT NULL DEFAULT 'ACTIVE', "revision" INTEGER NOT NULL DEFAULT 0,
  "automaticMetadata" TEXT, "metadataOverride" TEXT, "metadataOverrideItemId" TEXT, "createdByUserId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3), "endedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "StudioBroadcastSessionDestination" (
  "sessionId" TEXT NOT NULL, "destinationId" TEXT NOT NULL, "state" "StudioBroadcastConnectionState" NOT NULL DEFAULT 'STANDBY',
  "reconnectAttempt" INTEGER NOT NULL DEFAULT 0, "nextReconnectAt" TIMESTAMP(3), "lastConnectedAt" TIMESTAMP(3),
  "lastDisconnectedAt" TIMESTAMP(3), "lastSafeError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, PRIMARY KEY ("sessionId", "destinationId")
);

CREATE UNIQUE INDEX "StudioPlayoutCommand_organisationId_idempotencyKey_key" ON "StudioPlayoutCommand"("organisationId", "idempotencyKey");
CREATE UNIQUE INDEX "StudioProgrammePack_organisationId_name_key" ON "StudioProgrammePack"("organisationId", "name");
CREATE UNIQUE INDEX "StudioProgrammePackItem_packId_position_key" ON "StudioProgrammePackItem"("packId", "position");
CREATE UNIQUE INDEX "StudioBroadcastDestination_organisationId_name_key" ON "StudioBroadcastDestination"("organisationId", "name");
CREATE INDEX "StudioPlayoutSession_organisationId_status_updatedAt_idx" ON "StudioPlayoutSession"("organisationId", "status", "updatedAt");
CREATE INDEX "StudioPlayoutSession_channelId_status_idx" ON "StudioPlayoutSession"("channelId", "status");
CREATE INDEX "StudioPlayoutItem_sessionId_area_position_idx" ON "StudioPlayoutItem"("sessionId", "area", "position");
CREATE INDEX "StudioPlayoutItem_organisationId_status_idx" ON "StudioPlayoutItem"("organisationId", "status");
CREATE INDEX "StudioPlayoutItem_mediaAssetId_idx" ON "StudioPlayoutItem"("mediaAssetId");
CREATE INDEX "StudioPlayoutCommand_sessionId_createdAt_idx" ON "StudioPlayoutCommand"("sessionId", "createdAt");
CREATE INDEX "StudioProgrammePack_organisationId_updatedAt_idx" ON "StudioProgrammePack"("organisationId", "updatedAt");
CREATE INDEX "StudioProgrammePackItem_organisationId_mediaAssetId_idx" ON "StudioProgrammePackItem"("organisationId", "mediaAssetId");
CREATE INDEX "StudioBroadcastDestination_organisationId_enabled_connectionState_idx" ON "StudioBroadcastDestination"("organisationId", "enabled", "connectionState");
CREATE INDEX "StudioBroadcastDestination_stationId_idx" ON "StudioBroadcastDestination"("stationId");
CREATE INDEX "StudioBroadcastSession_organisationId_status_updatedAt_idx" ON "StudioBroadcastSession"("organisationId", "status", "updatedAt");
CREATE INDEX "StudioBroadcastSession_playoutSessionId_idx" ON "StudioBroadcastSession"("playoutSessionId");

CREATE TABLE "StudioBroadcastCommand" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "expectedRevision" INTEGER,
    "result" JSONB,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioBroadcastCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudioBroadcastCommand_organisationId_idempotencyKey_key" ON "StudioBroadcastCommand"("organisationId", "idempotencyKey");
CREATE INDEX "StudioBroadcastCommand_sessionId_createdAt_idx" ON "StudioBroadcastCommand"("sessionId", "createdAt");
ALTER TABLE "StudioBroadcastCommand" ADD CONSTRAINT "StudioBroadcastCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudioBroadcastSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "StudioBroadcastSessionDestination_destinationId_state_idx" ON "StudioBroadcastSessionDestination"("destinationId", "state");

ALTER TABLE "StudioPlayoutSession" ADD CONSTRAINT "StudioPlayoutSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioPlayoutSession" ADD CONSTRAINT "StudioPlayoutSession_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioPlayoutItem" ADD CONSTRAINT "StudioPlayoutItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudioPlayoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioPlayoutItem" ADD CONSTRAINT "StudioPlayoutItem_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioPlayoutCommand" ADD CONSTRAINT "StudioPlayoutCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudioPlayoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioProgrammePackItem" ADD CONSTRAINT "StudioProgrammePackItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "StudioProgrammePack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioProgrammePackItem" ADD CONSTRAINT "StudioProgrammePackItem_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioBroadcastSessionDestination" ADD CONSTRAINT "StudioBroadcastSessionDestination_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudioBroadcastSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioBroadcastSessionDestination" ADD CONSTRAINT "StudioBroadcastSessionDestination_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "StudioBroadcastDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
