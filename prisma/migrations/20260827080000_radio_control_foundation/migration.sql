-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MusicModeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "releaseYear" INTEGER,
    "isExplicit" BOOLEAN NOT NULL DEFAULT false,
    "status" "TrackStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicMode" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "MusicModeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicModeTrack" (
    "musicModeId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicModeTrack_pkey" PRIMARY KEY ("musicModeId", "trackId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Track_mediaAssetId_key" ON "Track"("mediaAssetId");
CREATE INDEX "Track_status_idx" ON "Track"("status");
CREATE INDEX "Track_artist_title_idx" ON "Track"("artist", "title");
CREATE UNIQUE INDEX "MusicMode_organisationId_slug_key" ON "MusicMode"("organisationId", "slug");
CREATE INDEX "MusicMode_organisationId_status_idx" ON "MusicMode"("organisationId", "status");
CREATE INDEX "MusicModeTrack_trackId_idx" ON "MusicModeTrack"("trackId");

-- Database-level programming guards
ALTER TABLE "Track" ADD CONSTRAINT "Track_releaseYear_check" CHECK ("releaseYear" IS NULL OR "releaseYear" BETWEEN 1877 AND 2200);
ALTER TABLE "MusicModeTrack" ADD CONSTRAINT "MusicModeTrack_weight_check" CHECK ("weight" BETWEEN 1 AND 1000);

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicMode" ADD CONSTRAINT "MusicMode_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicModeTrack" ADD CONSTRAINT "MusicModeTrack_musicModeId_fkey" FOREIGN KEY ("musicModeId") REFERENCES "MusicMode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicModeTrack" ADD CONSTRAINT "MusicModeTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

