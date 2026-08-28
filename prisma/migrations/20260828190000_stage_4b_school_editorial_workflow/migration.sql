CREATE TYPE "SchoolProgrammeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "SchoolEpisodeStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "SchoolPublicationScope" AS ENUM ('INTERNAL_ONLY', 'PUBLIC');
CREATE TYPE "StudentContributorStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "SchoolSubmissionStatus" AS ENUM ('SUBMITTED', 'SUPERSEDED', 'WITHDRAWN');
CREATE TYPE "SchoolModerationDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED');
CREATE TYPE "ConsentRecordStatus" AS ENUM ('PENDING', 'GRANTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "StaffSupervisor" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "displayTitle" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffSupervisor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentGroup" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "supervisorId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "academicYear" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentContributor" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "studentGroupId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "referenceCode" TEXT,
  "status" "StudentContributorStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentContributor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolProgramme" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "studentGroupId" TEXT,
  "supervisorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "SchoolProgrammeStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolProgramme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolEpisode" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "status" "SchoolEpisodeStatus" NOT NULL DEFAULT 'DRAFT',
  "publicationScope" "SchoolPublicationScope" NOT NULL DEFAULT 'INTERNAL_ONLY',
  "createdByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolEpisode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolEpisodeContributor" (
  "episodeId" TEXT NOT NULL,
  "contributorId" TEXT NOT NULL,
  "creditedAs" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolEpisodeContributor_pkey" PRIMARY KEY ("episodeId", "contributorId")
);

CREATE TABLE "SchoolSubmission" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "promoVersionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "notes" TEXT,
  "status" "SchoolSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
  "submittedByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolModerationReview" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "decision" "SchoolModerationDecision" NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolModerationReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentRecord" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "contributorId" TEXT NOT NULL,
  "episodeId" TEXT,
  "status" "ConsentRecordStatus" NOT NULL DEFAULT 'PENDING',
  "policyVersion" TEXT NOT NULL DEFAULT 'school-radio-v1',
  "notes" TEXT,
  "recordedByUserId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffSupervisor_organisationId_userId_key" ON "StaffSupervisor"("organisationId", "userId");
CREATE INDEX "StaffSupervisor_organisationId_active_idx" ON "StaffSupervisor"("organisationId", "active");
CREATE UNIQUE INDEX "StudentGroup_organisationId_name_academicYear_key" ON "StudentGroup"("organisationId", "name", "academicYear");
CREATE INDEX "StudentGroup_organisationId_supervisorId_idx" ON "StudentGroup"("organisationId", "supervisorId");
CREATE UNIQUE INDEX "StudentContributor_studentGroupId_displayName_key" ON "StudentContributor"("studentGroupId", "displayName");
CREATE INDEX "StudentContributor_organisationId_status_idx" ON "StudentContributor"("organisationId", "status");
CREATE UNIQUE INDEX "SchoolProgramme_organisationId_title_key" ON "SchoolProgramme"("organisationId", "title");
CREATE INDEX "SchoolProgramme_organisationId_status_idx" ON "SchoolProgramme"("organisationId", "status");
CREATE INDEX "SchoolProgramme_studentGroupId_idx" ON "SchoolProgramme"("studentGroupId");
CREATE INDEX "SchoolEpisode_organisationId_status_idx" ON "SchoolEpisode"("organisationId", "status");
CREATE INDEX "SchoolEpisode_programmeId_createdAt_idx" ON "SchoolEpisode"("programmeId", "createdAt");
CREATE INDEX "SchoolEpisodeContributor_contributorId_idx" ON "SchoolEpisodeContributor"("contributorId");
CREATE UNIQUE INDEX "SchoolSubmission_episodeId_revision_key" ON "SchoolSubmission"("episodeId", "revision");
CREATE INDEX "SchoolSubmission_organisationId_status_idx" ON "SchoolSubmission"("organisationId", "status");
CREATE INDEX "SchoolSubmission_promoVersionId_idx" ON "SchoolSubmission"("promoVersionId");
CREATE INDEX "SchoolModerationReview_organisationId_createdAt_idx" ON "SchoolModerationReview"("organisationId", "createdAt");
CREATE INDEX "SchoolModerationReview_episodeId_createdAt_idx" ON "SchoolModerationReview"("episodeId", "createdAt");
CREATE INDEX "SchoolModerationReview_submissionId_idx" ON "SchoolModerationReview"("submissionId");
CREATE INDEX "ConsentRecord_organisationId_contributorId_status_idx" ON "ConsentRecord"("organisationId", "contributorId", "status");
CREATE INDEX "ConsentRecord_episodeId_status_idx" ON "ConsentRecord"("episodeId", "status");

ALTER TABLE "StaffSupervisor" ADD CONSTRAINT "StaffSupervisor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffSupervisor" ADD CONSTRAINT "StaffSupervisor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "StaffSupervisor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentContributor" ADD CONSTRAINT "StudentContributor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentContributor" ADD CONSTRAINT "StudentContributor_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "StudentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolProgramme" ADD CONSTRAINT "SchoolProgramme_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolProgramme" ADD CONSTRAINT "SchoolProgramme_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "StudentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolProgramme" ADD CONSTRAINT "SchoolProgramme_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "StaffSupervisor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolProgramme" ADD CONSTRAINT "SchoolProgramme_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisode" ADD CONSTRAINT "SchoolEpisode_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisode" ADD CONSTRAINT "SchoolEpisode_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "SchoolProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisode" ADD CONSTRAINT "SchoolEpisode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeContributor" ADD CONSTRAINT "SchoolEpisodeContributor_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeContributor" ADD CONSTRAINT "SchoolEpisodeContributor_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "StudentContributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolSubmission" ADD CONSTRAINT "SchoolSubmission_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolSubmission" ADD CONSTRAINT "SchoolSubmission_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolSubmission" ADD CONSTRAINT "SchoolSubmission_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolSubmission" ADD CONSTRAINT "SchoolSubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolModerationReview" ADD CONSTRAINT "SchoolModerationReview_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolModerationReview" ADD CONSTRAINT "SchoolModerationReview_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolModerationReview" ADD CONSTRAINT "SchoolModerationReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "SchoolSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolModerationReview" ADD CONSTRAINT "SchoolModerationReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "StudentContributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
