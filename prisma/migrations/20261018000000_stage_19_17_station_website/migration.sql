CREATE TYPE "StationWebsiteTheme" AS ENUM ('MIDNIGHT', 'LIGHT', 'VIBRANT');
CREATE TYPE "StationDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'ACTIVE', 'DISABLED');

ALTER TABLE "Station"
  ADD COLUMN "stationWebsiteEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stationWebsiteHeadline" TEXT,
  ADD COLUMN "stationWebsiteAbout" TEXT,
  ADD COLUMN "stationWebsiteHeroImageUrl" TEXT,
  ADD COLUMN "stationWebsiteContactEmail" TEXT,
  ADD COLUMN "stationWebsiteTheme" "StationWebsiteTheme" NOT NULL DEFAULT 'MIDNIGHT',
  ADD COLUMN "stationWebsiteLinks" JSONB,
  ADD COLUMN "stationWebsiteShowNowPlaying" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "stationWebsiteShowPodcasts" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "StationDomain" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "status" "StationDomainStatus" NOT NULL DEFAULT 'PENDING',
  "verificationToken" TEXT NOT NULL,
  "lastCheckedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StationDomain_hostname_key" ON "StationDomain"("hostname");
CREATE UNIQUE INDEX "StationDomain_id_organisationId_key" ON "StationDomain"("id", "organisationId");
CREATE INDEX "StationDomain_organisationId_status_idx" ON "StationDomain"("organisationId", "status");
CREATE INDEX "StationDomain_stationId_status_idx" ON "StationDomain"("stationId", "status");

ALTER TABLE "StationDomain" ADD CONSTRAINT "StationDomain_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StationDomain" ADD CONSTRAINT "StationDomain_stationId_organisationId_fkey"
  FOREIGN KEY ("stationId", "organisationId") REFERENCES "Station"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
