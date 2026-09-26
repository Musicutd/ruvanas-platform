CREATE TYPE "CorrectionsProgrammeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'STAFF_REVIEW', 'STAFF_APPROVED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "CorrectionsSubmissionStatus" AS ENUM ('SUBMITTED', 'STAFF_APPROVED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED');
CREATE TYPE "CorrectionsReviewStage" AS ENUM ('STAFF', 'FACILITY');
CREATE TYPE "CorrectionsReviewDecision" AS ENUM ('APPROVE', 'CHANGES_REQUESTED', 'REJECT');
CREATE TYPE "CorrectionsFacilityGrantPermission" AS ENUM ('MANAGER', 'EDITOR', 'VIEWER');

ALTER TABLE "CorrectionsProfile" ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CorrectionsFacility"
  ADD COLUMN "dualApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "CorrectionsProgramme" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "CorrectionsProgrammeStatus" NOT NULL DEFAULT 'DRAFT',
  "latestRevision" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsProgramme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorrectionsSubmission" (
  "id" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "renderId" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "organisationPolicyVersion" INTEGER NOT NULL,
  "facilityPolicyVersion" INTEGER NOT NULL,
  "dualApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
  "status" "CorrectionsSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
  "titleSnapshot" TEXT NOT NULL,
  "descriptionSnapshot" TEXT,
  "evidenceSnapshot" JSONB NOT NULL,
  "submittedByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionsSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorrectionsReview" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "stage" "CorrectionsReviewStage" NOT NULL,
  "decision" "CorrectionsReviewDecision" NOT NULL,
  "note" TEXT NOT NULL,
  "evidenceSnapshot" JSONB NOT NULL,
  "reviewedByUserId" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionsReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorrectionsFacilityGrant" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "organisationMemberId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "permission" "CorrectionsFacilityGrantPermission" NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsFacilityGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CorrectionsProgramme_organisationId_facilityId_status_idx" ON "CorrectionsProgramme"("organisationId", "facilityId", "status");
CREATE INDEX "CorrectionsProgramme_facilityId_updatedAt_idx" ON "CorrectionsProgramme"("facilityId", "updatedAt");
CREATE UNIQUE INDEX "CorrectionsSubmission_programmeId_revision_key" ON "CorrectionsSubmission"("programmeId", "revision");
CREATE INDEX "CorrectionsSubmission_organisationId_facilityId_status_idx" ON "CorrectionsSubmission"("organisationId", "facilityId", "status");
CREATE INDEX "CorrectionsSubmission_renderId_idx" ON "CorrectionsSubmission"("renderId");
CREATE UNIQUE INDEX "CorrectionsReview_submissionId_stage_key" ON "CorrectionsReview"("submissionId", "stage");
CREATE INDEX "CorrectionsReview_reviewedByUserId_reviewedAt_idx" ON "CorrectionsReview"("reviewedByUserId", "reviewedAt");
CREATE UNIQUE INDEX "CorrectionsFacilityGrant_organisationMemberId_facilityId_key" ON "CorrectionsFacilityGrant"("organisationMemberId", "facilityId");
CREATE INDEX "CorrectionsFacilityGrant_organisationId_facilityId_permission_idx" ON "CorrectionsFacilityGrant"("organisationId", "facilityId", "permission");

ALTER TABLE "CorrectionsProgramme" ADD CONSTRAINT "CorrectionsProgramme_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsProgramme" ADD CONSTRAINT "CorrectionsProgramme_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsProgramme" ADD CONSTRAINT "CorrectionsProgramme_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsSubmission" ADD CONSTRAINT "CorrectionsSubmission_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "CorrectionsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsSubmission" ADD CONSTRAINT "CorrectionsSubmission_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "AudioRender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsSubmission" ADD CONSTRAINT "CorrectionsSubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsReview" ADD CONSTRAINT "CorrectionsReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CorrectionsSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsReview" ADD CONSTRAINT "CorrectionsReview_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsFacilityGrant" ADD CONSTRAINT "CorrectionsFacilityGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsFacilityGrant" ADD CONSTRAINT "CorrectionsFacilityGrant_organisationMemberId_fkey" FOREIGN KEY ("organisationMemberId") REFERENCES "OrganisationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsFacilityGrant" ADD CONSTRAINT "CorrectionsFacilityGrant_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsFacilityGrant" ADD CONSTRAINT "CorrectionsFacilityGrant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
