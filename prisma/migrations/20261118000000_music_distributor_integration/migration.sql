-- Provider-neutral music-distributor catalogue integration foundation.
CREATE TYPE "MusicDistributorConnectionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'DEGRADED', 'REVOKED');
CREATE TYPE "MusicDistributorAuthType" AS ENUM ('OAUTH2_CLIENT_CREDENTIALS');
CREATE TYPE "MusicDistributorDeliveryMode" AS ENUM ('DOWNLOAD', 'PROTECTED_STREAM');
CREATE TYPE "MusicDistributorItemStatus" AS ENUM ('ACTIVE', 'TAKEN_DOWN', 'UNAVAILABLE');
CREATE TYPE "MusicDistributorSyncKind" AS ENUM ('FULL', 'DELTA', 'TAKEDOWN', 'RECONCILIATION');
CREATE TYPE "MusicDistributorReconciliationAction" AS ENUM ('CREATED', 'UPDATED', 'UNCHANGED', 'RIGHTS_CHANGED', 'TAKEN_DOWN', 'UNAVAILABLE', 'RESTORED', 'DUPLICATE', 'REJECTED');
CREATE TYPE "MusicDistributorUsageDeliveryStatus" AS ENUM ('QUEUED', 'DELIVERED', 'FAILED', 'ABANDONED');

CREATE TABLE "MusicDistributorConnection" (
  "id" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "status" "MusicDistributorConnectionStatus" NOT NULL DEFAULT 'DRAFT',
  "authType" "MusicDistributorAuthType" NOT NULL DEFAULT 'OAUTH2_CLIENT_CREDENTIALS',
  "apiBaseUrl" TEXT NOT NULL,
  "tokenUrl" TEXT NOT NULL,
  "cataloguePath" TEXT NOT NULL DEFAULT '/v1/catalogue',
  "usageReportPath" TEXT,
  "clientCredentialsEncrypted" TEXT NOT NULL,
  "oauthScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "defaultMinimumCatalogueLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'FOCUSED',
  "defaultPermittedTerritories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "defaultPermittedUses" "MusicRightsUse"[] NOT NULL DEFAULT ARRAY[]::"MusicRightsUse"[],
  "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
  "syncCursor" TEXT,
  "nextSyncAt" TIMESTAMP(3),
  "syncLeaseOwner" TEXT,
  "syncLeaseUntil" TIMESTAMP(3),
  "lastAuthenticatedAt" TIMESTAMP(3),
  "lastSuccessfulSyncAt" TIMESTAMP(3),
  "lastErrorAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "configuration" JSONB,
  "pausedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicDistributorConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicDistributorRelease" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalReleaseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "label" TEXT,
  "releaseDate" DATE,
  "status" "MusicDistributorItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadataChecksum" CHAR(64) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "takenDownAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicDistributorRelease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicDistributorCollection" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalCollectionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "minimumCatalogueLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'FOCUSED',
  "permittedTerritories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "permittedUses" "MusicRightsUse"[] NOT NULL DEFAULT ARRAY[]::"MusicRightsUse"[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadataChecksum" CHAR(64) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicDistributorCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicDistributorTrack" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "releaseId" TEXT,
  "trackId" TEXT,
  "externalTrackId" TEXT NOT NULL,
  "externalRecordingId" TEXT,
  "isrc" TEXT,
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL,
  "album" TEXT,
  "label" TEXT,
  "genreCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isExplicit" BOOLEAN NOT NULL DEFAULT false,
  "deliveryMode" "MusicDistributorDeliveryMode" NOT NULL,
  "sourceUrlEncrypted" TEXT,
  "sourceChecksumSha256" CHAR(64),
  "sourceMimeType" TEXT,
  "sourceSizeBytes" BIGINT,
  "minimumCatalogueLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'FOCUSED',
  "permittedTerritories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "permittedUses" "MusicRightsUse"[] NOT NULL DEFAULT ARRAY[]::"MusicRightsUse"[],
  "licenceStartsAt" DATE,
  "licenceExpiresAt" DATE,
  "rightsHolder" TEXT NOT NULL,
  "rightsReference" TEXT NOT NULL,
  "status" "MusicDistributorItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "takedownReason" TEXT,
  "takenDownAt" TIMESTAMP(3),
  "metadataChecksum" CHAR(64) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicDistributorTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicDistributorCollectionTrack" (
  "collectionId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicDistributorCollectionTrack_pkey" PRIMARY KEY ("collectionId", "trackId")
);

CREATE TABLE "MusicDistributorSyncRun" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "kind" "MusicDistributorSyncKind" NOT NULL,
  "status" "IntegrationSyncRunStatus" NOT NULL DEFAULT 'PENDING',
  "cursorBefore" TEXT,
  "cursorAfter" TEXT,
  "releasesReceived" INTEGER NOT NULL DEFAULT 0,
  "tracksReceived" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "takenDownCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "safeErrorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicDistributorSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicDistributorReconciliationEvent" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "syncRunId" TEXT,
  "distributorTrackId" TEXT,
  "externalTrackId" TEXT NOT NULL,
  "action" "MusicDistributorReconciliationAction" NOT NULL,
  "previousChecksum" CHAR(64),
  "currentChecksum" CHAR(64),
  "details" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicDistributorReconciliationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicDistributorUsageDelivery" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "periodFrom" DATE NOT NULL,
  "periodUntil" DATE NOT NULL,
  "status" "MusicDistributorUsageDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "eventCount" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "payloadSha256" CHAR(64) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicDistributorUsageDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MusicDistributorConnection_name_key" ON "MusicDistributorConnection"("name");
CREATE UNIQUE INDEX "MusicDistributorConnection_providerKey_key" ON "MusicDistributorConnection"("providerKey");
CREATE INDEX "MusicDistributorConnection_status_nextSyncAt_idx" ON "MusicDistributorConnection"("status", "nextSyncAt");
CREATE INDEX "MusicDistributorConnection_syncLeaseUntil_idx" ON "MusicDistributorConnection"("syncLeaseUntil");
CREATE UNIQUE INDEX "MusicDistributorRelease_connectionId_externalReleaseId_key" ON "MusicDistributorRelease"("connectionId", "externalReleaseId");
CREATE INDEX "MusicDistributorRelease_connectionId_status_lastSeenAt_idx" ON "MusicDistributorRelease"("connectionId", "status", "lastSeenAt");
CREATE UNIQUE INDEX "MusicDistributorCollection_connectionId_externalCollectionId_key" ON "MusicDistributorCollection"("connectionId", "externalCollectionId");
CREATE INDEX "MusicDistributorCollection_connectionId_active_minimumCatalogueLevel_idx" ON "MusicDistributorCollection"("connectionId", "active", "minimumCatalogueLevel");
CREATE UNIQUE INDEX "MusicDistributorTrack_connectionId_externalTrackId_key" ON "MusicDistributorTrack"("connectionId", "externalTrackId");
CREATE INDEX "MusicDistributorTrack_connectionId_status_lastSeenAt_idx" ON "MusicDistributorTrack"("connectionId", "status", "lastSeenAt");
CREATE INDEX "MusicDistributorTrack_connectionId_isrc_idx" ON "MusicDistributorTrack"("connectionId", "isrc");
CREATE INDEX "MusicDistributorTrack_trackId_idx" ON "MusicDistributorTrack"("trackId");
CREATE INDEX "MusicDistributorTrack_licenceExpiresAt_idx" ON "MusicDistributorTrack"("licenceExpiresAt");
CREATE INDEX "MusicDistributorTrack_minimumCatalogueLevel_status_idx" ON "MusicDistributorTrack"("minimumCatalogueLevel", "status");
CREATE INDEX "MusicDistributorCollectionTrack_trackId_idx" ON "MusicDistributorCollectionTrack"("trackId");
CREATE INDEX "MusicDistributorSyncRun_connectionId_status_createdAt_idx" ON "MusicDistributorSyncRun"("connectionId", "status", "createdAt");
CREATE INDEX "MusicDistributorSyncRun_status_nextRetryAt_idx" ON "MusicDistributorSyncRun"("status", "nextRetryAt");
CREATE INDEX "MusicDistributorReconciliationEvent_connectionId_occurredAt_idx" ON "MusicDistributorReconciliationEvent"("connectionId", "occurredAt");
CREATE INDEX "MusicDistributorReconciliationEvent_syncRunId_action_idx" ON "MusicDistributorReconciliationEvent"("syncRunId", "action");
CREATE INDEX "MusicDistributorReconciliationEvent_distributorTrackId_occurredAt_idx" ON "MusicDistributorReconciliationEvent"("distributorTrackId", "occurredAt");
CREATE UNIQUE INDEX "MusicDistributorUsageDelivery_idempotencyKey_key" ON "MusicDistributorUsageDelivery"("idempotencyKey");
CREATE UNIQUE INDEX "MusicDistributorUsageDelivery_connectionId_periodFrom_periodUntil_key" ON "MusicDistributorUsageDelivery"("connectionId", "periodFrom", "periodUntil");
CREATE INDEX "MusicDistributorUsageDelivery_status_nextAttemptAt_idx" ON "MusicDistributorUsageDelivery"("status", "nextAttemptAt");
CREATE INDEX "MusicDistributorUsageDelivery_connectionId_createdAt_idx" ON "MusicDistributorUsageDelivery"("connectionId", "createdAt");

ALTER TABLE "MusicDistributorConnection" ADD CONSTRAINT "MusicDistributorConnection_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorRelease" ADD CONSTRAINT "MusicDistributorRelease_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MusicDistributorConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorCollection" ADD CONSTRAINT "MusicDistributorCollection_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MusicDistributorConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorTrack" ADD CONSTRAINT "MusicDistributorTrack_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MusicDistributorConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorTrack" ADD CONSTRAINT "MusicDistributorTrack_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MusicDistributorRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorTrack" ADD CONSTRAINT "MusicDistributorTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorCollectionTrack" ADD CONSTRAINT "MusicDistributorCollectionTrack_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MusicDistributorCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorCollectionTrack" ADD CONSTRAINT "MusicDistributorCollectionTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicDistributorTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorSyncRun" ADD CONSTRAINT "MusicDistributorSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MusicDistributorConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorReconciliationEvent" ADD CONSTRAINT "MusicDistributorReconciliationEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MusicDistributorConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorReconciliationEvent" ADD CONSTRAINT "MusicDistributorReconciliationEvent_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "MusicDistributorSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorReconciliationEvent" ADD CONSTRAINT "MusicDistributorReconciliationEvent_distributorTrackId_fkey" FOREIGN KEY ("distributorTrackId") REFERENCES "MusicDistributorTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MusicDistributorUsageDelivery" ADD CONSTRAINT "MusicDistributorUsageDelivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MusicDistributorConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MusicDistributorConnection" ADD CONSTRAINT "MusicDistributorConnection_sync_interval_check" CHECK ("syncIntervalMinutes" BETWEEN 15 AND 10080);
ALTER TABLE "MusicDistributorTrack" ADD CONSTRAINT "MusicDistributorTrack_source_checksum_check" CHECK ("sourceChecksumSha256" IS NULL OR "sourceChecksumSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "MusicDistributorTrack" ADD CONSTRAINT "MusicDistributorTrack_rights_window_check" CHECK ("licenceStartsAt" IS NULL OR "licenceExpiresAt" IS NULL OR "licenceStartsAt" <= "licenceExpiresAt");
ALTER TABLE "MusicDistributorUsageDelivery" ADD CONSTRAINT "MusicDistributorUsageDelivery_period_check" CHECK ("periodFrom" < "periodUntil");
