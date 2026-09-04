-- Stage 19.3: saved, explainable smart-playlist rules feeding the existing
-- MusicMode rotation and playout pipeline.
CREATE TYPE "MusicModeSource" AS ENUM ('MANUAL', 'SMART_PLAYLIST');
CREATE TYPE "SmartPlaylistStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "SmartPlaylistSort" AS ENUM ('ARTIST_TITLE', 'RELEASE_YEAR_DESC', 'RELEASE_YEAR_ASC', 'RECENTLY_ADDED');
CREATE TYPE "SmartPlaylistRuleField" AS ENUM ('GENRE', 'ARTIST', 'ALBUM', 'RELEASE_YEAR', 'EXPLICIT', 'LIBRARY_TYPE');
CREATE TYPE "SmartPlaylistRuleOperator" AS ENUM ('IS', 'IS_NOT', 'CONTAINS', 'AT_LEAST', 'AT_MOST');

ALTER TABLE "MusicMode"
  ADD COLUMN "source" "MusicModeSource" NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "SmartPlaylist" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "musicModeId" TEXT NOT NULL,
  "status" "SmartPlaylistStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "materializedVersion" INTEGER NOT NULL DEFAULT 0,
  "maxTracks" INTEGER NOT NULL DEFAULT 250,
  "defaultWeight" INTEGER NOT NULL DEFAULT 100,
  "sort" "SmartPlaylistSort" NOT NULL DEFAULT 'ARTIST_TITLE',
  "rightsUse" "MusicRightsUse" NOT NULL DEFAULT 'ONLINE_RADIO',
  "territory" TEXT,
  "lastMaterializedAt" TIMESTAMP(3),
  "lastMaterializedCount" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartPlaylist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartPlaylistRule" (
  "id" TEXT NOT NULL,
  "smartPlaylistId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "field" "SmartPlaylistRuleField" NOT NULL,
  "operator" "SmartPlaylistRuleOperator" NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartPlaylistRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartPlaylist_musicModeId_key" ON "SmartPlaylist"("musicModeId");
CREATE UNIQUE INDEX "SmartPlaylist_id_organisationId_key" ON "SmartPlaylist"("id", "organisationId");
CREATE UNIQUE INDEX "SmartPlaylist_musicModeId_organisationId_key" ON "SmartPlaylist"("musicModeId", "organisationId");
CREATE INDEX "SmartPlaylist_organisationId_status_updatedAt_idx" ON "SmartPlaylist"("organisationId", "status", "updatedAt");
CREATE INDEX "SmartPlaylist_createdByUserId_createdAt_idx" ON "SmartPlaylist"("createdByUserId", "createdAt");
CREATE INDEX "SmartPlaylist_publishedByUserId_publishedAt_idx" ON "SmartPlaylist"("publishedByUserId", "publishedAt");
CREATE UNIQUE INDEX "SmartPlaylistRule_smartPlaylistId_position_key" ON "SmartPlaylistRule"("smartPlaylistId", "position");
CREATE INDEX "SmartPlaylistRule_smartPlaylistId_field_idx" ON "SmartPlaylistRule"("smartPlaylistId", "field");

ALTER TABLE "SmartPlaylist" ADD CONSTRAINT "SmartPlaylist_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartPlaylist" ADD CONSTRAINT "SmartPlaylist_musicModeId_organisationId_fkey"
  FOREIGN KEY ("musicModeId", "organisationId") REFERENCES "MusicMode"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartPlaylist" ADD CONSTRAINT "SmartPlaylist_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmartPlaylist" ADD CONSTRAINT "SmartPlaylist_publishedByUserId_fkey"
  FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartPlaylistRule" ADD CONSTRAINT "SmartPlaylistRule_smartPlaylistId_fkey"
  FOREIGN KEY ("smartPlaylistId") REFERENCES "SmartPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartPlaylist" ADD CONSTRAINT "SmartPlaylist_limits_check"
  CHECK ("version" >= 1 AND "materializedVersion" >= 0 AND "maxTracks" BETWEEN 1 AND 1000 AND "defaultWeight" BETWEEN 1 AND 1000 AND "lastMaterializedCount" >= 0);
ALTER TABLE "SmartPlaylistRule" ADD CONSTRAINT "SmartPlaylistRule_position_check"
  CHECK ("position" >= 0 AND length(btrim("value")) BETWEEN 1 AND 120);
