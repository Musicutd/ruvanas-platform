CREATE TYPE "AudioProjectType" AS ENUM ('QUICK_RECORD');
CREATE TYPE "AudioProjectStatus" AS ENUM ('DRAFT', 'RECORDING', 'UPLOADING', 'READY', 'SUBMITTED', 'ARCHIVED');
CREATE TYPE "AudioTakeStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED');
CREATE TYPE "AudioUploadStatus" AS ENUM ('INITIATED', 'UPLOADING', 'COMPLETING', 'COMPLETED', 'ABORTED', 'FAILED', 'EXPIRED');

CREATE TABLE "AudioProject" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "programmeId" TEXT,
  "episodeId" TEXT,
  "studentGroupId" TEXT,
  "title" TEXT NOT NULL,
  "type" "AudioProjectType" NOT NULL DEFAULT 'QUICK_RECORD',
  "status" "AudioProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "editDecision" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioProjectVersion" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "state" JSONB NOT NULL,
  "reason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudioProjectVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioTake" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "promoVersionId" TEXT,
  "recordedByUserId" TEXT NOT NULL,
  "deviceLabel" TEXT,
  "durationMs" INTEGER,
  "status" "AudioTakeStatus" NOT NULL DEFAULT 'PROCESSING',
  "sourceEditDecision" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioTake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolAudioUploadSession" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "status" "AudioUploadStatus" NOT NULL DEFAULT 'INITIATED',
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "expectedSizeBytes" BIGINT NOT NULL,
  "partSizeBytes" INTEGER NOT NULL,
  "partCount" INTEGER NOT NULL,
  "quarantineKey" TEXT NOT NULL,
  "multipartUploadId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolAudioUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolAudioUploadPart" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "partNumber" INTEGER NOT NULL,
  "eTag" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolAudioUploadPart_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AudioProjectVersion_projectId_version_key" ON "AudioProjectVersion"("projectId", "version");
CREATE UNIQUE INDEX "SchoolAudioUploadSession_quarantineKey_key" ON "SchoolAudioUploadSession"("quarantineKey");
CREATE UNIQUE INDEX "SchoolAudioUploadSession_multipartUploadId_key" ON "SchoolAudioUploadSession"("multipartUploadId");
CREATE UNIQUE INDEX "SchoolAudioUploadPart_sessionId_partNumber_key" ON "SchoolAudioUploadPart"("sessionId", "partNumber");
CREATE INDEX "AudioProject_organisationId_status_idx" ON "AudioProject"("organisationId", "status");
CREATE INDEX "AudioProject_episodeId_idx" ON "AudioProject"("episodeId");
CREATE INDEX "AudioProject_createdByUserId_updatedAt_idx" ON "AudioProject"("createdByUserId", "updatedAt");
CREATE INDEX "AudioProjectVersion_createdByUserId_createdAt_idx" ON "AudioProjectVersion"("createdByUserId", "createdAt");
CREATE INDEX "AudioTake_organisationId_createdAt_idx" ON "AudioTake"("organisationId", "createdAt");
CREATE INDEX "AudioTake_projectId_createdAt_idx" ON "AudioTake"("projectId", "createdAt");
CREATE INDEX "AudioTake_mediaAssetId_idx" ON "AudioTake"("mediaAssetId");
CREATE INDEX "AudioTake_promoVersionId_idx" ON "AudioTake"("promoVersionId");
CREATE INDEX "SchoolAudioUploadSession_organisationId_status_idx" ON "SchoolAudioUploadSession"("organisationId", "status");
CREATE INDEX "SchoolAudioUploadSession_projectId_createdAt_idx" ON "SchoolAudioUploadSession"("projectId", "createdAt");
CREATE INDEX "SchoolAudioUploadSession_expiresAt_status_idx" ON "SchoolAudioUploadSession"("expiresAt", "status");
CREATE INDEX "SchoolAudioUploadPart_sessionId_idx" ON "SchoolAudioUploadPart"("sessionId");

ALTER TABLE "AudioProject" ADD CONSTRAINT "AudioProject_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioProject" ADD CONSTRAINT "AudioProject_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "SchoolProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AudioProject" ADD CONSTRAINT "AudioProject_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AudioProject" ADD CONSTRAINT "AudioProject_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "StudentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AudioProject" ADD CONSTRAINT "AudioProject_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudioProjectVersion" ADD CONSTRAINT "AudioProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioProjectVersion" ADD CONSTRAINT "AudioProjectVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudioTake" ADD CONSTRAINT "AudioTake_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioTake" ADD CONSTRAINT "AudioTake_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioTake" ADD CONSTRAINT "AudioTake_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudioTake" ADD CONSTRAINT "AudioTake_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AudioTake" ADD CONSTRAINT "AudioTake_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolAudioUploadSession" ADD CONSTRAINT "SchoolAudioUploadSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolAudioUploadSession" ADD CONSTRAINT "SchoolAudioUploadSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolAudioUploadSession" ADD CONSTRAINT "SchoolAudioUploadSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolAudioUploadPart" ADD CONSTRAINT "SchoolAudioUploadPart_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SchoolAudioUploadSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

