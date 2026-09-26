CREATE TYPE "CorrectionsRequestAvailability" AS ENUM ('DISABLED', 'INTERNAL_ONLY', 'FAMILY_AND_INTERNAL');
CREATE TYPE "CorrectionsRequestSource" AS ENUM ('INTERNAL', 'FAMILY');
CREATE TYPE "CorrectionsRequestType" AS ENUM ('SONG', 'PROGRAMME', 'DEDICATION', 'MESSAGE', 'REHABILITATION_SUGGESTION');
CREATE TYPE "CorrectionsRequestStatus" AS ENUM ('RECEIVED', 'SCREENING', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PLAYED', 'ARCHIVED');
CREATE TYPE "CorrectionsRehabStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "CorrectionsDevelopmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

ALTER TABLE "CorrectionsFacility"
  ADD COLUMN "requestAvailability" "CorrectionsRequestAvailability" NOT NULL DEFAULT 'DISABLED',
  ADD COLUMN "publicRequestCode" TEXT,
  ADD COLUMN "songRequestsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "messageRequestsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dedicationsEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "CorrectionsFacility_publicRequestCode_key" ON "CorrectionsFacility"("publicRequestCode");

CREATE TABLE "CorrectionsRequest" (
  "id" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "facilityId" TEXT NOT NULL,
  "source" "CorrectionsRequestSource" NOT NULL, "type" "CorrectionsRequestType" NOT NULL,
  "status" "CorrectionsRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "senderDisplayName" TEXT, "relationship" TEXT, "recipientReference" TEXT,
  "recipientDisplayName" TEXT, "wingOrUnit" TEXT, "songTitle" TEXT, "songArtist" TEXT,
  "originalMessage" TEXT, "onAirRecipient" TEXT, "onAirMessage" TEXT,
  "trackId" TEXT, "programmeId" TEXT, "dedupeKey" TEXT, "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorrectionsRequest_dedupeKey_key" ON "CorrectionsRequest"("dedupeKey");
CREATE INDEX "CorrectionsRequest_org_facility_status_created_idx" ON "CorrectionsRequest"("organisationId", "facilityId", "status", "createdAt");
CREATE INDEX "CorrectionsRequest_facilityId_source_createdAt_idx" ON "CorrectionsRequest"("facilityId", "source", "createdAt");
CREATE INDEX "CorrectionsRequest_programmeId_idx" ON "CorrectionsRequest"("programmeId");
ALTER TABLE "CorrectionsRequest" ADD CONSTRAINT "CorrectionsRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsRequest" ADD CONSTRAINT "CorrectionsRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsRequest" ADD CONSTRAINT "CorrectionsRequest_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "CorrectionsProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CorrectionsRequest" ADD CONSTRAINT "CorrectionsRequest_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CorrectionsRequestDecision" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL, "action" TEXT NOT NULL,
  "fromStatus" "CorrectionsRequestStatus" NOT NULL,
  "toStatus" "CorrectionsRequestStatus" NOT NULL,
  "moderatorUserId" TEXT NOT NULL, "note" TEXT,
  "onAirRecipient" TEXT, "onAirMessage" TEXT, "trackId" TEXT, "programmeId" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionsRequestDecision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CorrectionsRequestDecision_requestId_decidedAt_idx" ON "CorrectionsRequestDecision"("requestId", "decidedAt");
CREATE INDEX "CorrectionsRequestDecision_org_facility_decided_idx" ON "CorrectionsRequestDecision"("organisationId", "facilityId", "decidedAt");
ALTER TABLE "CorrectionsRequestDecision" ADD CONSTRAINT "CorrectionsRequestDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CorrectionsRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CorrectionsRehabCategory" (
  "id" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "code" TEXT NOT NULL,
  "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionsRehabCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorrectionsRehabCategory_organisationId_code_key" ON "CorrectionsRehabCategory"("organisationId", "code");
ALTER TABLE "CorrectionsRehabCategory" ADD CONSTRAINT "CorrectionsRehabCategory_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CorrectionsRehabContent" (
  "id" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "facilityId" TEXT,
  "categoryId" TEXT NOT NULL, "mediaAssetId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "description" TEXT, "providerName" TEXT NOT NULL,
  "languageCode" TEXT NOT NULL DEFAULT 'und', "sourceNotes" TEXT, "accessibilityNotes" TEXT,
  "expiresAt" TIMESTAMP(3), "reviewAt" TIMESTAMP(3),
  "status" "CorrectionsRehabStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL, "reviewedByUserId" TEXT, "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsRehabContent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CorrectionsRehabContent_organisationId_facilityId_status_idx" ON "CorrectionsRehabContent"("organisationId", "facilityId", "status");
CREATE INDEX "CorrectionsRehabContent_mediaAssetId_idx" ON "CorrectionsRehabContent"("mediaAssetId");
CREATE INDEX "CorrectionsRehabContent_expiresAt_idx" ON "CorrectionsRehabContent"("expiresAt");
ALTER TABLE "CorrectionsRehabContent" ADD CONSTRAINT "CorrectionsRehabContent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsRehabContent" ADD CONSTRAINT "CorrectionsRehabContent_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsRehabContent" ADD CONSTRAINT "CorrectionsRehabContent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CorrectionsRehabCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsRehabContent" ADD CONSTRAINT "CorrectionsRehabContent_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CorrectionsRehabProgrammeItem" (
  "id" TEXT NOT NULL, "programmeId" TEXT NOT NULL, "contentId" TEXT NOT NULL,
  "position" INTEGER NOT NULL, "addedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionsRehabProgrammeItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorrectionsRehabProgrammeItem_programmeId_contentId_key" ON "CorrectionsRehabProgrammeItem"("programmeId", "contentId");
CREATE UNIQUE INDEX "CorrectionsRehabProgrammeItem_programmeId_position_key" ON "CorrectionsRehabProgrammeItem"("programmeId", "position");
ALTER TABLE "CorrectionsRehabProgrammeItem" ADD CONSTRAINT "CorrectionsRehabProgrammeItem_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "CorrectionsProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsRehabProgrammeItem" ADD CONSTRAINT "CorrectionsRehabProgrammeItem_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "CorrectionsRehabContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CorrectionsDevelopmentModule" (
  "id" TEXT NOT NULL, "organisationId" TEXT NOT NULL, "code" TEXT NOT NULL,
  "title" TEXT NOT NULL, "position" INTEGER NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CorrectionsDevelopmentModule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorrectionsDevelopmentModule_organisationId_code_key" ON "CorrectionsDevelopmentModule"("organisationId", "code");
CREATE INDEX "CorrectionsDevelopmentModule_organisationId_position_idx" ON "CorrectionsDevelopmentModule"("organisationId", "position");
ALTER TABLE "CorrectionsDevelopmentModule" ADD CONSTRAINT "CorrectionsDevelopmentModule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CorrectionsContributorMilestone" (
  "id" TEXT NOT NULL, "contributorId" TEXT NOT NULL, "moduleId" TEXT NOT NULL,
  "status" "CorrectionsDevelopmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "completedAt" TIMESTAMP(3), "supervisorUserId" TEXT, "note" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsContributorMilestone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorrectionsContributorMilestone_contributorId_moduleId_key" ON "CorrectionsContributorMilestone"("contributorId", "moduleId");
ALTER TABLE "CorrectionsContributorMilestone" ADD CONSTRAINT "CorrectionsContributorMilestone_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "CorrectionsContributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsContributorMilestone" ADD CONSTRAINT "CorrectionsContributorMilestone_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "CorrectionsDevelopmentModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
