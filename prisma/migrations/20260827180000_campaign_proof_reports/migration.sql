-- CreateEnum
CREATE TYPE "ReportExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- Expand immutable campaign playout evidence with location snapshots.
ALTER TABLE "PlayoutIntent"
ADD COLUMN "locationId" TEXT,
ADD COLUMN "locationName" TEXT,
ADD COLUMN "locationTimezone" TEXT,
ADD COLUMN "locationGroups" JSONB;

-- Backfill existing intents from the still-referenced zone and its current group memberships.
UPDATE "PlayoutIntent" AS intent
SET
  "locationId" = location.id,
  "locationName" = location.name,
  "locationTimezone" = location.timezone,
  "locationGroups" = COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('id', location_group.id, 'name', location_group.name)
      ORDER BY location_group.name, location_group.id
    )
    FROM "LocationGroupMember" AS membership
    JOIN "LocationGroup" AS location_group
      ON location_group.id = membership."locationGroupId"
    WHERE membership."locationId" = location.id
  ), '[]'::jsonb)
FROM "Zone" AS zone
JOIN "Location" AS location ON location.id = zone."locationId"
WHERE zone.id = intent."zoneId";

ALTER TABLE "PlayoutIntent"
ALTER COLUMN "locationId" SET NOT NULL,
ALTER COLUMN "locationName" SET NOT NULL,
ALTER COLUMN "locationTimezone" SET NOT NULL,
ALTER COLUMN "locationGroups" SET DEFAULT '[]'::jsonb,
ALTER COLUMN "locationGroups" SET NOT NULL;

-- CreateTable
CREATE TABLE "ReportExportJob" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" "ReportExportStatus" NOT NULL DEFAULT 'QUEUED',
  "reportType" TEXT NOT NULL DEFAULT 'CAMPAIGN_PROOF_CSV',
  "filters" JSONB NOT NULL,
  "csvContent" TEXT,
  "contentSha256" TEXT,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReportExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayoutIntent_locationId_plannedStart_idx" ON "PlayoutIntent"("locationId", "plannedStart");
CREATE INDEX "ReportExportJob_organisationId_createdAt_idx" ON "ReportExportJob"("organisationId", "createdAt");
CREATE INDEX "ReportExportJob_requestedByUserId_createdAt_idx" ON "ReportExportJob"("requestedByUserId", "createdAt");
CREATE INDEX "ReportExportJob_status_availableAt_leaseUntil_idx" ON "ReportExportJob"("status", "availableAt", "leaseUntil");
CREATE INDEX "ReportExportJob_expiresAt_idx" ON "ReportExportJob"("expiresAt");

-- AddForeignKey
ALTER TABLE "ReportExportJob" ADD CONSTRAINT "ReportExportJob_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportExportJob" ADD CONSTRAINT "ReportExportJob_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

