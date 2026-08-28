CREATE TYPE "AIAssistantType" AS ENUM (
  'PROMO_SCRIPT',
  'SCHEDULE_RULES',
  'ANALYTICS_SUMMARY',
  'SCHOOL_SCRIPT',
  'SCHOOL_SHOW_PLAN',
  'SCHOOL_PRONUNCIATION'
);

CREATE TYPE "AIJobStatus" AS ENUM ('NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED');

CREATE TYPE "AIDataClassification" AS ENUM (
  'INTERNAL',
  'CUSTOMER_CONTENT',
  'SCHOOL_CONTENT',
  'SCHOOL_STUDENT_DATA'
);

CREATE TABLE "AIJob" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "assistantType" "AIAssistantType" NOT NULL,
  "status" "AIJobStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "dataClassification" "AIDataClassification" NOT NULL DEFAULT 'INTERNAL',
  "providerKey" TEXT NOT NULL DEFAULT 'RUVANAS_TEMPLATE_V1',
  "providerDataUseApproved" BOOLEAN NOT NULL DEFAULT false,
  "privateDataSent" BOOLEAN NOT NULL DEFAULT false,
  "input" JSONB NOT NULL,
  "draftText" TEXT NOT NULL,
  "approvedText" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIArtifactMetadata" (
  "id" TEXT NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "modelKey" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provenance" JSONB NOT NULL,
  CONSTRAINT "AIArtifactMetadata_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationFeedback" (
  "id" TEXT NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AIJob_organisationId_status_createdAt_idx" ON "AIJob"("organisationId", "status", "createdAt");
CREATE INDEX "AIJob_requestedByUserId_idx" ON "AIJob"("requestedByUserId");
CREATE INDEX "AIJob_reviewedByUserId_idx" ON "AIJob"("reviewedByUserId");
CREATE UNIQUE INDEX "AIArtifactMetadata_aiJobId_key" ON "AIArtifactMetadata"("aiJobId");
CREATE UNIQUE INDEX "RecommendationFeedback_aiJobId_userId_key" ON "RecommendationFeedback"("aiJobId", "userId");
CREATE INDEX "RecommendationFeedback_userId_idx" ON "RecommendationFeedback"("userId");

ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIArtifactMetadata" ADD CONSTRAINT "AIArtifactMetadata_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AIJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AIJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

