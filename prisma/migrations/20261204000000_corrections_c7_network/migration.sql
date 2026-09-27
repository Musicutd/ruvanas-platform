CREATE TYPE "CorrectionsNetworkWindowKind" AS ENUM ('CENTRAL', 'LOCAL');
CREATE TYPE "CorrectionsDistributionStatus" AS ENUM ('ACTIVE', 'WITHDRAWN');

CREATE TABLE "CorrectionsNetworkGrant" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "organisationMemberId" TEXT NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT false,
  "canManage" BOOLEAN NOT NULL DEFAULT false,
  "canPolicy" BOOLEAN NOT NULL DEFAULT false,
  "canProgramme" BOOLEAN NOT NULL DEFAULT false,
  "canDistribute" BOOLEAN NOT NULL DEFAULT false,
  "canReport" BOOLEAN NOT NULL DEFAULT false,
  "canAudit" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsNetworkGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorrectionsNetworkGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkGrant_organisationMemberId_fkey" FOREIGN KEY ("organisationMemberId") REFERENCES "OrganisationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorrectionsNetworkGrant_organisationMemberId_key" ON "CorrectionsNetworkGrant"("organisationMemberId");
CREATE INDEX "CorrectionsNetworkGrant_organisationId_idx" ON "CorrectionsNetworkGrant"("organisationId");

CREATE TABLE "CorrectionsNetworkWindow" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "kind" "CorrectionsNetworkWindowKind" NOT NULL,
  "mandatory" BOOLEAN NOT NULL DEFAULT false,
  "distributionId" TEXT,
  "weekday" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "allowedContentTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorrectionsNetworkWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorrectionsNetworkWindow_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkWindow_time_check" CHECK ("weekday" BETWEEN 0 AND 6 AND "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 1 AND 1440 AND "endMinute" > "startMinute")
);
CREATE INDEX "CorrectionsNetworkWindow_organisationId_facilityId_weekday_active_idx" ON "CorrectionsNetworkWindow"("organisationId", "facilityId", "weekday", "active");

CREATE TABLE "CorrectionsProgrammeDistribution" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "sourceFacilityId" TEXT NOT NULL,
  "targetFacilityId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "status" "CorrectionsDistributionStatus" NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionsProgrammeDistribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorrectionsProgrammeDistribution_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsProgrammeDistribution_sourceFacilityId_fkey" FOREIGN KEY ("sourceFacilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsProgrammeDistribution_targetFacilityId_fkey" FOREIGN KEY ("targetFacilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsProgrammeDistribution_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "CorrectionsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsProgrammeDistribution_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CorrectionsSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsProgrammeDistribution_window_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
);
CREATE UNIQUE INDEX "CorrectionsProgrammeDistribution_submissionId_targetFacilityId_key" ON "CorrectionsProgrammeDistribution"("submissionId", "targetFacilityId");
CREATE INDEX "CorrectionsProgrammeDistribution_organisationId_targetFacilityId_status_idx" ON "CorrectionsProgrammeDistribution"("organisationId", "targetFacilityId", "status");

ALTER TABLE "CorrectionsNetworkWindow" ADD CONSTRAINT "CorrectionsNetworkWindow_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsNetworkWindow" ADD CONSTRAINT "CorrectionsNetworkWindow_distributionId_fkey"
  FOREIGN KEY ("distributionId") REFERENCES "CorrectionsProgrammeDistribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CorrectionsNetworkWindow_distributionId_idx" ON "CorrectionsNetworkWindow"("distributionId");
