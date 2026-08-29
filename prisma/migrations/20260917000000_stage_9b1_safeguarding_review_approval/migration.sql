ALTER TYPE "SchoolSafeguardingReadinessStatus" ADD VALUE 'CHANGES_REQUESTED';
ALTER TYPE "SchoolSafeguardingReadinessStatus" ADD VALUE 'APPROVED';

CREATE TYPE "SchoolSafeguardingReviewDecision" AS ENUM ('CHANGES_REQUESTED', 'APPROVED');

CREATE TABLE "SchoolSafeguardingReview" (
  "id" TEXT NOT NULL,
  "readinessId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "decision" "SchoolSafeguardingReviewDecision" NOT NULL,
  "notes" TEXT,
  "policyVersion" TEXT NOT NULL DEFAULT 'school-safeguarding-readiness-v1',
  "policySnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolSafeguardingReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SchoolSafeguardingReview_readinessId_createdAt_idx" ON "SchoolSafeguardingReview"("readinessId", "createdAt");
CREATE INDEX "SchoolSafeguardingReview_organisationId_createdAt_idx" ON "SchoolSafeguardingReview"("organisationId", "createdAt");
CREATE INDEX "SchoolSafeguardingReview_reviewerUserId_idx" ON "SchoolSafeguardingReview"("reviewerUserId");

ALTER TABLE "SchoolSafeguardingReview"
ADD CONSTRAINT "SchoolSafeguardingReview_readinessId_fkey"
FOREIGN KEY ("readinessId") REFERENCES "SchoolSafeguardingReadiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchoolSafeguardingReview"
ADD CONSTRAINT "SchoolSafeguardingReview_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchoolSafeguardingReview"
ADD CONSTRAINT "SchoolSafeguardingReview_reviewerUserId_fkey"
FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
