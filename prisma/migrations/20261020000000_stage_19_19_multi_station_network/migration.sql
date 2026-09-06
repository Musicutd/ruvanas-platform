CREATE TYPE "StationNetworkStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "StationNetworkAgreementStatus" AS ENUM ('INVITED', 'ACTIVE', 'DECLINED', 'REVOKED');

CREATE TABLE "StationNetwork" (
  "id" TEXT NOT NULL,
  "ownerOrganisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" "StationNetworkStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationNetwork_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StationNetworkAgreement" (
  "id" TEXT NOT NULL,
  "stationNetworkId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "stationOrganisationId" TEXT NOT NULL,
  "status" "StationNetworkAgreementStatus" NOT NULL DEFAULT 'INVITED',
  "termsVersion" TEXT NOT NULL DEFAULT 'station-network-membership-v1',
  "invitedByUserId" TEXT NOT NULL,
  "decidedByUserId" TEXT,
  "revokedByUserId" TEXT,
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationNetworkAgreement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StationNetwork_slug_key" ON "StationNetwork"("slug");
CREATE UNIQUE INDEX "StationNetwork_id_ownerOrganisationId_key" ON "StationNetwork"("id", "ownerOrganisationId");
CREATE INDEX "StationNetwork_ownerOrganisationId_status_idx" ON "StationNetwork"("ownerOrganisationId", "status");
CREATE INDEX "StationNetwork_createdByUserId_idx" ON "StationNetwork"("createdByUserId");
CREATE UNIQUE INDEX "StationNetworkAgreement_stationNetworkId_stationId_key" ON "StationNetworkAgreement"("stationNetworkId", "stationId");
CREATE INDEX "StationNetworkAgreement_stationOrganisationId_status_idx" ON "StationNetworkAgreement"("stationOrganisationId", "status");
CREATE INDEX "StationNetworkAgreement_stationNetworkId_status_idx" ON "StationNetworkAgreement"("stationNetworkId", "status");
CREATE INDEX "StationNetworkAgreement_stationId_status_idx" ON "StationNetworkAgreement"("stationId", "status");

ALTER TABLE "AuditLog" ADD COLUMN "stationNetworkId" TEXT;
CREATE INDEX "AuditLog_stationNetworkId_idx" ON "AuditLog"("stationNetworkId");

ALTER TABLE "StationNetwork" ADD CONSTRAINT "StationNetwork_ownerOrganisationId_fkey"
  FOREIGN KEY ("ownerOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StationNetwork" ADD CONSTRAINT "StationNetwork_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StationNetworkAgreement" ADD CONSTRAINT "StationNetworkAgreement_stationNetworkId_fkey"
  FOREIGN KEY ("stationNetworkId") REFERENCES "StationNetwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StationNetworkAgreement" ADD CONSTRAINT "StationNetworkAgreement_stationId_stationOrganisationId_fkey"
  FOREIGN KEY ("stationId", "stationOrganisationId") REFERENCES "Station"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StationNetworkAgreement" ADD CONSTRAINT "StationNetworkAgreement_stationOrganisationId_fkey"
  FOREIGN KEY ("stationOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StationNetworkAgreement" ADD CONSTRAINT "StationNetworkAgreement_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StationNetworkAgreement" ADD CONSTRAINT "StationNetworkAgreement_decidedByUserId_fkey"
  FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StationNetworkAgreement" ADD CONSTRAINT "StationNetworkAgreement_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_stationNetworkId_fkey"
  FOREIGN KEY ("stationNetworkId") REFERENCES "StationNetwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
