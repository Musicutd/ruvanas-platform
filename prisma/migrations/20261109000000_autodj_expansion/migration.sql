CREATE TYPE "AutoDjState" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'BLOCKED');
CREATE TYPE "AutoDjTargetType" AS ENUM ('LOCATION', 'ZONE', 'SCHOOL', 'CHANNEL');
CREATE TYPE "GeneratedPlaylistStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INVALIDATED', 'ARCHIVED');
ALTER TYPE "MusicModeSource" ADD VALUE 'GENERATED_PLAYLIST';

ALTER TABLE "AutoDjPolicy"
  ADD COLUMN "state" "AutoDjState" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "targetType" "AutoDjTargetType" NOT NULL DEFAULT 'CHANNEL',
  ADD COLUMN "targetId" TEXT,
  ADD COLUMN "rightsUse" "MusicRightsUse" NOT NULL DEFAULT 'ONLINE_RADIO',
  ADD COLUMN "territory" TEXT,
  ADD COLUMN "sourceScopes" JSONB NOT NULL DEFAULT '["RUVANAS_CORE"]',
  ADD COLUMN "selectedGenreCodes" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "entitlementLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "blockedReason" TEXT;

UPDATE "AutoDjPolicy"
SET "state" = CASE WHEN "enabled" THEN 'ACTIVE'::"AutoDjState" ELSE 'DRAFT'::"AutoDjState" END,
    "targetId" = "channelId";

ALTER TABLE "MediaAsset" ADD COLUMN "licensedCatalogue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MediaGenre" ADD COLUMN "minimumCatalogueLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'PREMIUM';
ALTER TABLE "MusicModeTrack" ADD COLUMN "position" INTEGER;
CREATE INDEX "MusicModeTrack_musicModeId_position_idx" ON "MusicModeTrack"("musicModeId", "position");

UPDATE "MediaGenre" SET "minimumCatalogueLevel" = 'FOCUSED'
WHERE lower(regexp_replace("slug", '[^a-z0-9]+', '', 'g')) IN ('pop', 'hiphop', 'dance', 'rock');
UPDATE "MediaGenre" SET "minimumCatalogueLevel" = 'PROFESSIONAL'
WHERE lower(regexp_replace("slug", '[^a-z0-9]+', '', 'g')) IN ('country', 'latin', 'caribbean', 'christian');

CREATE TABLE "GeneratedPlaylist" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "musicModeId" TEXT,
  "name" TEXT NOT NULL,
  "status" "GeneratedPlaylistStatus" NOT NULL DEFAULT 'DRAFT',
  "targetType" "AutoDjTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "scheduledDate" DATE NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "rightsUse" "MusicRightsUse" NOT NULL,
  "territory" TEXT,
  "sourceScopes" JSONB NOT NULL DEFAULT '[]',
  "selectedGenreCodes" JSONB NOT NULL DEFAULT '[]',
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "publishedVersion" INTEGER NOT NULL DEFAULT 0,
  "entitlementLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'NONE',
  "invalidReason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeneratedPlaylist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeneratedPlaylist_window_check" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440),
  CONSTRAINT "GeneratedPlaylist_version_check" CHECK ("currentVersion" >= 1 AND "publishedVersion" >= 0 AND "publishedVersion" <= "currentVersion")
);

CREATE TABLE "GeneratedPlaylistVersion" (
  "id" TEXT NOT NULL,
  "generatedPlaylistId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "seed" TEXT NOT NULL,
  "requestedDurationSeconds" INTEGER NOT NULL,
  "generatedDurationSeconds" INTEGER NOT NULL,
  "toleranceSeconds" INTEGER NOT NULL DEFAULT 180,
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "genreDistribution" JSONB NOT NULL DEFAULT '{}',
  "entitlementLevel" "LicensedMusicCatalogueLevel" NOT NULL DEFAULT 'NONE',
  "publishedAt" TIMESTAMP(3),
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneratedPlaylistVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeneratedPlaylistItem" (
  "id" TEXT NOT NULL,
  "generatedPlaylistVersionId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "startOffsetSeconds" INTEGER NOT NULL,
  "endOffsetSeconds" INTEGER NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "genreCode" TEXT NOT NULL,
  "sourceScope" TEXT NOT NULL,
  "explanation" TEXT,
  CONSTRAINT "GeneratedPlaylistItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeneratedPlaylistItem_timing_check" CHECK ("position" >= 0 AND "startOffsetSeconds" >= 0 AND "endOffsetSeconds" > "startOffsetSeconds" AND "durationSeconds" > 0)
);

CREATE UNIQUE INDEX "GeneratedPlaylist_id_organisationId_key" ON "GeneratedPlaylist"("id", "organisationId");
CREATE INDEX "GeneratedPlaylist_organisationId_status_updatedAt_idx" ON "GeneratedPlaylist"("organisationId", "status", "updatedAt");
CREATE INDEX "GeneratedPlaylist_targetType_targetId_scheduledDate_idx" ON "GeneratedPlaylist"("targetType", "targetId", "scheduledDate");
CREATE INDEX "GeneratedPlaylist_musicModeId_idx" ON "GeneratedPlaylist"("musicModeId");
CREATE INDEX "GeneratedPlaylist_createdByUserId_idx" ON "GeneratedPlaylist"("createdByUserId");
CREATE INDEX "GeneratedPlaylist_publishedByUserId_idx" ON "GeneratedPlaylist"("publishedByUserId");
CREATE UNIQUE INDEX "GeneratedPlaylistVersion_generatedPlaylistId_version_key" ON "GeneratedPlaylistVersion"("generatedPlaylistId", "version");
CREATE INDEX "GeneratedPlaylistVersion_generatedPlaylistId_generatedAt_idx" ON "GeneratedPlaylistVersion"("generatedPlaylistId", "generatedAt");
CREATE UNIQUE INDEX "GeneratedPlaylistItem_generatedPlaylistVersionId_position_key" ON "GeneratedPlaylistItem"("generatedPlaylistVersionId", "position");
CREATE INDEX "GeneratedPlaylistItem_trackId_idx" ON "GeneratedPlaylistItem"("trackId");

ALTER TABLE "GeneratedPlaylist" ADD CONSTRAINT "GeneratedPlaylist_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedPlaylist" ADD CONSTRAINT "GeneratedPlaylist_musicModeId_organisationId_fkey" FOREIGN KEY ("musicModeId", "organisationId") REFERENCES "MusicMode"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneratedPlaylist" ADD CONSTRAINT "GeneratedPlaylist_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneratedPlaylist" ADD CONSTRAINT "GeneratedPlaylist_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GeneratedPlaylistVersion" ADD CONSTRAINT "GeneratedPlaylistVersion_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedPlaylistItem" ADD CONSTRAINT "GeneratedPlaylistItem_generatedPlaylistVersionId_fkey" FOREIGN KEY ("generatedPlaylistVersionId") REFERENCES "GeneratedPlaylistVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedPlaylistItem" ADD CONSTRAINT "GeneratedPlaylistItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
