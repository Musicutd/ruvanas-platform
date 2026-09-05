CREATE TYPE "BroadcastProcessingProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "BroadcastProcessingCodec" AS ENUM ('MP3', 'AAC', 'WAV');
CREATE TYPE "AudioProcessingQcStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED');

CREATE TABLE "BroadcastProcessingProfile" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "purpose" TEXT,
  "status" "BroadcastProcessingProfileStatus" NOT NULL DEFAULT 'DRAFT',
  "codec" "BroadcastProcessingCodec" NOT NULL DEFAULT 'MP3',
  "bitrateKbps" INTEGER NOT NULL DEFAULT 192,
  "sampleRateHz" INTEGER NOT NULL DEFAULT 48000,
  "targetLufs" DOUBLE PRECISION NOT NULL DEFAULT -16,
  "truePeakDbfs" DOUBLE PRECISION NOT NULL DEFAULT -1.5,
  "maxLoudnessRangeLu" DOUBLE PRECISION NOT NULL DEFAULT 12,
  "highpassHz" INTEGER NOT NULL DEFAULT 30,
  "lowpassHz" INTEGER NOT NULL DEFAULT 18000,
  "compressionThresholdDb" DOUBLE PRECISION NOT NULL DEFAULT -18,
  "compressionRatio" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  "compressionAttackMs" INTEGER NOT NULL DEFAULT 20,
  "compressionReleaseMs" INTEGER NOT NULL DEFAULT 250,
  "limiterEnabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BroadcastProcessingProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BroadcastProcessingProfile_bounds_check" CHECK (
    char_length("name") BETWEEN 2 AND 120 AND
    ("purpose" IS NULL OR char_length("purpose") <= 500) AND
    "bitrateKbps" BETWEEN 64 AND 320 AND
    "sampleRateHz" IN (44100, 48000) AND
    "targetLufs" BETWEEN -24 AND -9 AND
    "truePeakDbfs" BETWEEN -3 AND -0.5 AND
    "maxLoudnessRangeLu" BETWEEN 1 AND 20 AND
    "highpassHz" BETWEEN 20 AND 200 AND
    "lowpassHz" BETWEEN 8000 AND 20000 AND
    "highpassHz" < "lowpassHz" AND
    "compressionThresholdDb" BETWEEN -40 AND -6 AND
    "compressionRatio" BETWEEN 1 AND 10 AND
    "compressionAttackMs" BETWEEN 1 AND 200 AND
    "compressionReleaseMs" BETWEEN 20 AND 2000 AND
    "version" >= 1
  )
);

ALTER TABLE "AudioRender"
  ADD COLUMN "broadcastProcessingProfileId" TEXT,
  ADD COLUMN "broadcastProcessingProfileRevision" INTEGER,
  ADD COLUMN "processingProfileJson" JSONB,
  ADD COLUMN "processingKey" TEXT,
  ADD COLUMN "processingQcStatus" "AudioProcessingQcStatus",
  ADD COLUMN "processingQcNotes" TEXT,
  ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "AudioRender_processing_contract_check" CHECK (
    ("broadcastProcessingProfileId" IS NULL AND "broadcastProcessingProfileRevision" IS NULL AND "processingProfileJson" IS NULL AND "processingKey" IS NULL AND "processingQcStatus" IS NULL) OR
    ("broadcastProcessingProfileId" IS NOT NULL AND "broadcastProcessingProfileRevision" >= 1 AND "processingProfileJson" IS NOT NULL AND "processingKey" IS NOT NULL AND "processingQcStatus" IS NOT NULL)
  ),
  ADD CONSTRAINT "AudioRender_processing_attempts_check" CHECK ("processingAttempts" BETWEEN 0 AND 3);

CREATE UNIQUE INDEX "BroadcastProcessingProfile_id_organisationId_key" ON "BroadcastProcessingProfile"("id", "organisationId");
CREATE UNIQUE INDEX "BroadcastProcessingProfile_organisationId_name_key" ON "BroadcastProcessingProfile"("organisationId", "name");
CREATE INDEX "BroadcastProcessingProfile_organisationId_status_updatedAt_idx" ON "BroadcastProcessingProfile"("organisationId", "status", "updatedAt");
CREATE INDEX "BroadcastProcessingProfile_createdByUserId_idx" ON "BroadcastProcessingProfile"("createdByUserId");
CREATE UNIQUE INDEX "AudioRender_processingKey_key" ON "AudioRender"("processingKey");
CREATE INDEX "AudioRender_broadcastProcessingProfileId_processingQcStatus_createdAt_idx" ON "AudioRender"("broadcastProcessingProfileId", "processingQcStatus", "createdAt");

ALTER TABLE "BroadcastProcessingProfile" ADD CONSTRAINT "BroadcastProcessingProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BroadcastProcessingProfile" ADD CONSTRAINT "BroadcastProcessingProfile_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudioRender" ADD CONSTRAINT "AudioRender_broadcastProcessingProfileId_fkey" FOREIGN KEY ("broadcastProcessingProfileId") REFERENCES "BroadcastProcessingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
