CREATE TYPE "AudioWaveformStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED');
CREATE TYPE "AudioTrackKind" AS ENUM ('VOICE', 'MUSIC', 'EFFECT', 'MIXED');
CREATE TYPE "AudioClipKind" AS ENUM ('SOURCE', 'SILENCE');
CREATE TYPE "AudioMarkerType" AS ENUM ('INTRO', 'INTERVIEW', 'AD_PSA', 'CHAPTER', 'EDIT_NOTE', 'TEACHER_FEEDBACK');
CREATE TYPE "AudioRenderPreset" AS ENUM ('SCHOOL_RADIO_MP3', 'SPEECH_MP3', 'WAV_MASTER');
CREATE TYPE "AudioRenderStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

ALTER TABLE "AudioTake"
  ADD COLUMN "waveformStatus" "AudioWaveformStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "waveformPeaks" JSONB,
  ADD COLUMN "waveformGeneratedAt" TIMESTAMP(3);

CREATE TABLE "AudioTrack" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "kind" "AudioTrackKind" NOT NULL DEFAULT 'VOICE',
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "gainDb" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pan" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "solo" BOOLEAN NOT NULL DEFAULT false,
  "effectChainJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioClip" (
  "id" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "mediaAssetId" TEXT,
  "kind" "AudioClipKind" NOT NULL DEFAULT 'SOURCE',
  "sourceStartMs" INTEGER NOT NULL DEFAULT 0,
  "sourceEndMs" INTEGER NOT NULL,
  "timelineStartMs" INTEGER NOT NULL DEFAULT 0,
  "gainDb" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fadeInMs" INTEGER NOT NULL DEFAULT 0,
  "fadeOutMs" INTEGER NOT NULL DEFAULT 0,
  "fadeInCurve" TEXT NOT NULL DEFAULT 'linear',
  "fadeOutCurve" TEXT NOT NULL DEFAULT 'linear',
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioClip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioMarker" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "positionMs" INTEGER NOT NULL,
  "type" "AudioMarkerType" NOT NULL,
  "label" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudioMarker_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioRender" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "outputMediaAssetId" TEXT,
  "outputPromoVersionId" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "preset" "AudioRenderPreset" NOT NULL,
  "status" "AudioRenderStatus" NOT NULL DEFAULT 'QUEUED',
  "loudnessLufs" DOUBLE PRECISION,
  "resultJson" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioRender_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AudioTake_waveformStatus_createdAt_idx" ON "AudioTake"("waveformStatus", "createdAt");
CREATE INDEX "AudioTrack_projectId_order_idx" ON "AudioTrack"("projectId", "order");
CREATE INDEX "AudioClip_trackId_timelineStartMs_idx" ON "AudioClip"("trackId", "timelineStartMs");
CREATE INDEX "AudioClip_mediaAssetId_idx" ON "AudioClip"("mediaAssetId");
CREATE INDEX "AudioMarker_projectId_positionMs_idx" ON "AudioMarker"("projectId", "positionMs");
CREATE INDEX "AudioRender_organisationId_createdAt_idx" ON "AudioRender"("organisationId", "createdAt");
CREATE INDEX "AudioRender_projectId_createdAt_idx" ON "AudioRender"("projectId", "createdAt");
CREATE INDEX "AudioRender_status_createdAt_idx" ON "AudioRender"("status", "createdAt");
CREATE INDEX "AudioRender_versionId_idx" ON "AudioRender"("versionId");

ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioClip" ADD CONSTRAINT "AudioClip_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "AudioTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioClip" ADD CONSTRAINT "AudioClip_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudioMarker" ADD CONSTRAINT "AudioMarker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioMarker" ADD CONSTRAINT "AudioMarker_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudioRender" ADD CONSTRAINT "AudioRender_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioRender" ADD CONSTRAINT "AudioRender_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioRender" ADD CONSTRAINT "AudioRender_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AudioProjectVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudioRender" ADD CONSTRAINT "AudioRender_outputMediaAssetId_fkey" FOREIGN KEY ("outputMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AudioRender" ADD CONSTRAINT "AudioRender_outputPromoVersionId_fkey" FOREIGN KEY ("outputPromoVersionId") REFERENCES "PromoVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AudioRender" ADD CONSTRAINT "AudioRender_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

