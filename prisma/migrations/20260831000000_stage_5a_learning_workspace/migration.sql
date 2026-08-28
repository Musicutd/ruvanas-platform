CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');
CREATE TYPE "AssignmentSubmissionStatus" AS ENUM ('SUBMITTED', 'REVISION_REQUESTED', 'ASSESSED', 'WITHDRAWN');
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'RELEASED');
CREATE TYPE "PortfolioEntryStatus" AS ENUM ('PRIVATE', 'ARCHIVED');

CREATE TABLE "Assignment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "studentGroupId" TEXT NOT NULL,
  "programmeId" TEXT,
  "title" TEXT NOT NULL,
  "brief" TEXT,
  "templateCode" TEXT NOT NULL,
  "allowedTools" JSONB,
  "dueAt" TIMESTAMP(3),
  "status" "AssignmentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Rubric" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RubricCriterion" (
  "id" TEXT NOT NULL,
  "rubricId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "maxScore" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RubricCriterion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentSubmission" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "audioProjectId" TEXT,
  "episodeId" TEXT,
  "status" "AssignmentSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "reflection" TEXT,
  "recordedByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentSubmissionContributor" (
  "submissionId" TEXT NOT NULL,
  "contributorId" TEXT NOT NULL,
  "projectRole" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentSubmissionContributor_pkey" PRIMARY KEY ("submissionId", "contributorId")
);

CREATE TABLE "Assessment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
  "totalScore" INTEGER NOT NULL,
  "maximumScore" INTEGER NOT NULL,
  "narrativeNotes" TEXT,
  "revisionRequest" TEXT,
  "assessedByUserId" TEXT NOT NULL,
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssessmentScore" (
  "assessmentId" TEXT NOT NULL,
  "criterionId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "notes" TEXT,
  CONSTRAINT "AssessmentScore_pkey" PRIMARY KEY ("assessmentId", "criterionId")
);

CREATE TABLE "AssessmentAnnotation" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "positionMs" INTEGER NOT NULL,
  "endMs" INTEGER,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentAnnotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioEntry" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "contributorId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "assessmentId" TEXT,
  "title" TEXT NOT NULL,
  "projectRole" TEXT,
  "reflection" TEXT,
  "skillsJson" JSONB,
  "status" "PortfolioEntryStatus" NOT NULL DEFAULT 'PRIVATE',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortfolioEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Assignment_organisationId_status_dueAt_idx" ON "Assignment"("organisationId", "status", "dueAt");
CREATE INDEX "Assignment_studentGroupId_status_idx" ON "Assignment"("studentGroupId", "status");
CREATE INDEX "Assignment_programmeId_idx" ON "Assignment"("programmeId");
CREATE UNIQUE INDEX "Rubric_assignmentId_key" ON "Rubric"("assignmentId");
CREATE UNIQUE INDEX "RubricCriterion_rubricId_position_key" ON "RubricCriterion"("rubricId", "position");
CREATE INDEX "RubricCriterion_rubricId_idx" ON "RubricCriterion"("rubricId");
CREATE INDEX "AssignmentSubmission_organisationId_status_submittedAt_idx" ON "AssignmentSubmission"("organisationId", "status", "submittedAt");
CREATE INDEX "AssignmentSubmission_assignmentId_revision_idx" ON "AssignmentSubmission"("assignmentId", "revision");
CREATE INDEX "AssignmentSubmission_audioProjectId_idx" ON "AssignmentSubmission"("audioProjectId");
CREATE INDEX "AssignmentSubmission_episodeId_idx" ON "AssignmentSubmission"("episodeId");
CREATE INDEX "AssignmentSubmissionContributor_contributorId_idx" ON "AssignmentSubmissionContributor"("contributorId");
CREATE UNIQUE INDEX "Assessment_submissionId_key" ON "Assessment"("submissionId");
CREATE INDEX "Assessment_organisationId_status_assessedAt_idx" ON "Assessment"("organisationId", "status", "assessedAt");
CREATE INDEX "Assessment_assessedByUserId_idx" ON "Assessment"("assessedByUserId");
CREATE INDEX "AssessmentScore_criterionId_idx" ON "AssessmentScore"("criterionId");
CREATE INDEX "AssessmentAnnotation_assessmentId_positionMs_idx" ON "AssessmentAnnotation"("assessmentId", "positionMs");
CREATE UNIQUE INDEX "PortfolioEntry_submissionId_contributorId_key" ON "PortfolioEntry"("submissionId", "contributorId");
CREATE INDEX "PortfolioEntry_organisationId_status_updatedAt_idx" ON "PortfolioEntry"("organisationId", "status", "updatedAt");
CREATE INDEX "PortfolioEntry_contributorId_status_idx" ON "PortfolioEntry"("contributorId", "status");
CREATE INDEX "PortfolioEntry_assessmentId_idx" ON "PortfolioEntry"("assessmentId");

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "StudentGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "SchoolProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_audioProjectId_fkey" FOREIGN KEY ("audioProjectId") REFERENCES "AudioProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmissionContributor" ADD CONSTRAINT "AssignmentSubmissionContributor_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmissionContributor" ADD CONSTRAINT "AssignmentSubmissionContributor_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "StudentContributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_assessedByUserId_fkey" FOREIGN KEY ("assessedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RubricCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentAnnotation" ADD CONSTRAINT "AssessmentAnnotation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioEntry" ADD CONSTRAINT "PortfolioEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioEntry" ADD CONSTRAINT "PortfolioEntry_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "StudentContributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortfolioEntry" ADD CONSTRAINT "PortfolioEntry_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioEntry" ADD CONSTRAINT "PortfolioEntry_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortfolioEntry" ADD CONSTRAINT "PortfolioEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
