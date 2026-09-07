CREATE TYPE "BetaReviewDecision" AS ENUM ('CONTINUE_BETA', 'PAUSE_AND_FIX', 'EXPAND_COHORT', 'END_BETA');

CREATE TABLE "BetaProgrammeReview" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "decision" "BetaReviewDecision" NOT NULL,
    "reviewNote" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "snapshot" JSONB NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BetaProgrammeReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BetaProgrammeReview_programmeId_createdAt_idx" ON "BetaProgrammeReview"("programmeId", "createdAt");
CREATE INDEX "BetaProgrammeReview_decision_createdAt_idx" ON "BetaProgrammeReview"("decision", "createdAt");

ALTER TABLE "BetaProgrammeReview" ADD CONSTRAINT "BetaProgrammeReview_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "BetaProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BetaProgrammeReview" ADD CONSTRAINT "BetaProgrammeReview_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
