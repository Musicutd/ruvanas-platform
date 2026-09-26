CREATE TYPE "CorrectionsContributorStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "CorrectionsStudioSessionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUBMITTED', 'COMPLETED', 'REVOKED');
ALTER TYPE "NotificationType" ADD VALUE 'CORRECTIONS_REVIEW_REQUEST';

CREATE TABLE "CorrectionsContributor" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "localReference" TEXT,
  "status" "CorrectionsContributorStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "CorrectionsContributor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorrectionsStudioSession" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "contributorId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "supervisorUserId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "status" "CorrectionsStudioSessionStatus" NOT NULL DEFAULT 'DRAFT',
  "accessTokenHash" TEXT,
  "capabilityScope" JSONB NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsStudioSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CorrectionsSubmission"
  ADD COLUMN "contributorId" TEXT,
  ADD COLUMN "studioSessionId" TEXT,
  ADD COLUMN "studioProjectId" TEXT,
  ADD COLUMN "studioVersionId" TEXT;

CREATE INDEX "CorrectionsContributor_organisationId_facilityId_status_idx" ON "CorrectionsContributor"("organisationId", "facilityId", "status");
CREATE UNIQUE INDEX "CorrectionsStudioSession_accessTokenHash_key" ON "CorrectionsStudioSession"("accessTokenHash");
CREATE INDEX "CorrectionsStudioSession_organisationId_facilityId_status_expiresAt_idx" ON "CorrectionsStudioSession"("organisationId", "facilityId", "status", "expiresAt");
CREATE INDEX "CorrectionsStudioSession_contributorId_status_idx" ON "CorrectionsStudioSession"("contributorId", "status");
CREATE INDEX "CorrectionsStudioSession_projectId_status_idx" ON "CorrectionsStudioSession"("projectId", "status");
CREATE UNIQUE INDEX "CorrectionsStudioSession_one_active_project" ON "CorrectionsStudioSession"("organisationId", "projectId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "CorrectionsStudioSession_one_active_contributor" ON "CorrectionsStudioSession"("organisationId", "contributorId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "CorrectionsSubmission_studioSessionId_key" ON "CorrectionsSubmission"("studioSessionId");
CREATE INDEX "CorrectionsSubmission_contributorId_submittedAt_idx" ON "CorrectionsSubmission"("contributorId", "submittedAt");

ALTER TABLE "CorrectionsContributor" ADD CONSTRAINT "CorrectionsContributor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsContributor" ADD CONSTRAINT "CorrectionsContributor_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsContributor" ADD CONSTRAINT "CorrectionsContributor_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsStudioSession" ADD CONSTRAINT "CorrectionsStudioSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsStudioSession" ADD CONSTRAINT "CorrectionsStudioSession_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsStudioSession" ADD CONSTRAINT "CorrectionsStudioSession_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "CorrectionsContributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsStudioSession" ADD CONSTRAINT "CorrectionsStudioSession_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "CorrectionsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsStudioSession" ADD CONSTRAINT "CorrectionsStudioSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsStudioSession" ADD CONSTRAINT "CorrectionsStudioSession_supervisorUserId_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsStudioSession" ADD CONSTRAINT "CorrectionsStudioSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsSubmission" ADD CONSTRAINT "CorrectionsSubmission_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "CorrectionsContributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsSubmission" ADD CONSTRAINT "CorrectionsSubmission_studioSessionId_fkey" FOREIGN KEY ("studioSessionId") REFERENCES "CorrectionsStudioSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsSubmission" ADD CONSTRAINT "CorrectionsSubmission_studioProjectId_fkey" FOREIGN KEY ("studioProjectId") REFERENCES "AudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsSubmission" ADD CONSTRAINT "CorrectionsSubmission_studioVersionId_fkey" FOREIGN KEY ("studioVersionId") REFERENCES "AudioProjectVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
