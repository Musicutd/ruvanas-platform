CREATE TABLE "CorrectionsSyndicationOffer" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "sourceFacilityId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OFFERED',
  "offeredByUserId" TEXT NOT NULL,
  "acceptedByUserId" TEXT,
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  CONSTRAINT "CorrectionsSyndicationOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorrectionsSyndicationOffer_status_check" CHECK ("status" IN ('OFFERED','ACCEPTED','REJECTED','WITHDRAWN')),
  CONSTRAINT "CorrectionsSyndicationOffer_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsSyndicationOffer_sourceFacilityId_fkey" FOREIGN KEY ("sourceFacilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsSyndicationOffer_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "CorrectionsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsSyndicationOffer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CorrectionsSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorrectionsSyndicationOffer_submissionId_key" ON "CorrectionsSyndicationOffer"("submissionId");
CREATE INDEX "CorrectionsSyndicationOffer_organisationId_status_idx" ON "CorrectionsSyndicationOffer"("organisationId", "status");
CREATE INDEX "CorrectionsSyndicationOffer_sourceFacilityId_status_idx" ON "CorrectionsSyndicationOffer"("sourceFacilityId", "status");

ALTER TABLE "CorrectionsProgrammeDistribution" ADD COLUMN "syndicationOfferId" TEXT;
ALTER TABLE "CorrectionsProgrammeDistribution" ADD CONSTRAINT "CorrectionsProgrammeDistribution_syndicationOfferId_fkey"
  FOREIGN KEY ("syndicationOfferId") REFERENCES "CorrectionsSyndicationOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CorrectionsProgrammeDistribution_syndicationOfferId_idx" ON "CorrectionsProgrammeDistribution"("syndicationOfferId");
