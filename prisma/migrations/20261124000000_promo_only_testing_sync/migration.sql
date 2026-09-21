-- Promo Only testing integration extends the existing provider-neutral catalogue.
-- Production remains application-locked; this migration only adds metadata and audit state.
CREATE TYPE "MusicProviderGenreMappingType" AS ENUM ('EXACT', 'ALIAS', 'MANUAL');
CREATE TYPE "MusicProviderGenreReviewStatus" AS ENUM ('APPROVED', 'PENDING');

ALTER TABLE "Track"
  ADD COLUMN "releaseDate" DATE,
  ADD COLUMN "recordLabel" TEXT,
  ADD COLUMN "contentWarning" TEXT,
  ADD COLUMN "catalogueProvider" TEXT,
  ADD COLUMN "minimumCatalogueLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'NONE';

ALTER TABLE "MediaGenre"
  ADD COLUMN "normalizedKey" TEXT,
  ADD COLUMN "sourceProvider" TEXT,
  ADD COLUMN "sourceExternalValue" TEXT,
  ADD COLUMN "autoCreated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerReviewStatus" "MusicProviderGenreReviewStatus" NOT NULL DEFAULT 'APPROVED';

WITH normalized AS (
  SELECT
    "id",
    LOWER(REGEXP_REPLACE(TRIM("name"), '\s+', ' ', 'g')) AS key,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(REGEXP_REPLACE(TRIM("name"), '\s+', ' ', 'g'))
      ORDER BY "createdAt", "id"
    ) AS position
  FROM "MediaGenre"
)
UPDATE "MediaGenre" AS genre
SET "normalizedKey" = normalized.key
FROM normalized
WHERE genre."id" = normalized."id" AND normalized.position = 1;

ALTER TABLE "MusicDistributorTrack"
  ADD COLUMN "externalTitleId" TEXT,
  ADD COLUMN "mixName" TEXT,
  ADD COLUMN "bpm" INTEGER,
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "releaseDate" DATE,
  ADD COLUMN "sourceGenre" TEXT,
  ADD COLUMN "canonicalGenreId" TEXT,
  ADD COLUMN "contentWarning" TEXT,
  ADD COLUMN "endType" TEXT,
  ADD COLUMN "mediaType" TEXT,
  ADD COLUMN "providerMetadata" JSONB,
  ADD COLUMN "importState" TEXT NOT NULL DEFAULT 'METADATA_READY',
  ADD COLUMN "audioStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "autoDjReady" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "downloadRetryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastImportErrorCode" TEXT,
  ADD COLUMN "sourceModifiedAt" TIMESTAMP(3);

ALTER TABLE "MusicDistributorSyncRun"
  ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "mode" TEXT,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "enrichedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "downloadedCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "MusicProviderFeedItem" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "externalGuid" TEXT,
  "sourceUrl" TEXT,
  "publishedAt" TIMESTAMP(3),
  "rawHash" CHAR(64) NOT NULL,
  "normalizedPayload" JSONB NOT NULL,
  "externalReleaseId" TEXT,
  "externalTrackId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicProviderFeedItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicProviderGenreMapping" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "sourceGenre" TEXT NOT NULL,
  "normalizedSourceGenre" TEXT NOT NULL,
  "catalogGenreId" TEXT NOT NULL,
  "mappingType" "MusicProviderGenreMappingType" NOT NULL DEFAULT 'EXACT',
  "reviewStatus" "MusicProviderGenreReviewStatus" NOT NULL DEFAULT 'APPROVED',
  "autoCreated" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicProviderGenreMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaGenre_normalizedKey_key" ON "MediaGenre"("normalizedKey");
CREATE INDEX "MediaGenre_sourceProvider_active_idx" ON "MediaGenre"("sourceProvider", "active");
CREATE INDEX "MusicDistributorTrack_canonicalGenreId_status_idx" ON "MusicDistributorTrack"("canonicalGenreId", "status");
CREATE INDEX "MusicDistributorTrack_importState_audioStatus_idx" ON "MusicDistributorTrack"("importState", "audioStatus");
CREATE UNIQUE INDEX "MusicDistributorSyncRun_correlationId_key" ON "MusicDistributorSyncRun"("correlationId");
CREATE UNIQUE INDEX "MusicProviderFeedItem_connectionId_idempotencyKey_key" ON "MusicProviderFeedItem"("connectionId", "idempotencyKey");
CREATE INDEX "MusicProviderFeedItem_connectionId_status_lastSeenAt_idx" ON "MusicProviderFeedItem"("connectionId", "status", "lastSeenAt");
CREATE INDEX "MusicProviderFeedItem_externalTrackId_idx" ON "MusicProviderFeedItem"("externalTrackId");
CREATE INDEX "MusicProviderFeedItem_externalReleaseId_idx" ON "MusicProviderFeedItem"("externalReleaseId");
CREATE UNIQUE INDEX "MusicProviderGenreMapping_provider_normalizedSourceGenre_key" ON "MusicProviderGenreMapping"("provider", "normalizedSourceGenre");
CREATE INDEX "MusicProviderGenreMapping_catalogGenreId_active_idx" ON "MusicProviderGenreMapping"("catalogGenreId", "active");
CREATE INDEX "MusicProviderGenreMapping_provider_reviewStatus_idx" ON "MusicProviderGenreMapping"("provider", "reviewStatus");

ALTER TABLE "MusicDistributorTrack"
  ADD CONSTRAINT "MusicDistributorTrack_canonicalGenreId_fkey"
  FOREIGN KEY ("canonicalGenreId") REFERENCES "MediaGenre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MusicProviderFeedItem"
  ADD CONSTRAINT "MusicProviderFeedItem_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "MusicDistributorConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MusicProviderGenreMapping"
  ADD CONSTRAINT "MusicProviderGenreMapping_catalogGenreId_fkey"
  FOREIGN KEY ("catalogGenreId") REFERENCES "MediaGenre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MusicDistributorTrack"
  ADD CONSTRAINT "MusicDistributorTrack_bpm_check" CHECK ("bpm" IS NULL OR "bpm" BETWEEN 20 AND 300),
  ADD CONSTRAINT "MusicDistributorTrack_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" BETWEEN 1 AND 86400),
  ADD CONSTRAINT "MusicDistributorTrack_download_retry_check" CHECK ("downloadRetryCount" >= 0);
