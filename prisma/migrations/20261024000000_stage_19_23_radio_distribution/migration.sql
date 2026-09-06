CREATE TYPE "RadioDistributionKind" AS ENUM ('DIRECTORY', 'STREAM_CDN', 'APP_PLATFORM', 'VOICE_ASSISTANT');
CREATE TYPE "RadioDistributionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'REVOKED');

CREATE UNIQUE INDEX "IntegrationConnection_id_organisationId_key" ON "IntegrationConnection"("id", "organisationId");

CREATE TABLE "RadioDistributionDestination" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "channelId" TEXT,
  "connectionId" TEXT NOT NULL,
  "kind" "RadioDistributionKind" NOT NULL,
  "status" "RadioDistributionStatus" NOT NULL DEFAULT 'DRAFT',
  "providerKey" TEXT NOT NULL,
  "listingName" TEXT NOT NULL,
  "territoryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "languageCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "policyVersion" TEXT NOT NULL DEFAULT 'radio-distribution-v1',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "configurationHash" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "activatedByUserId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RadioDistributionDestination_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RadioDistributionDestination_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "RadioDistributionDestination_provider_check" CHECK ("providerKey" ~ '^[A-Z0-9][A-Z0-9._-]{1,79}$'),
  CONSTRAINT "RadioDistributionDestination_territories_check" CHECK (cardinality("territoryCodes") BETWEEN 1 AND 250),
  CONSTRAINT "RadioDistributionDestination_languages_check" CHECK (cardinality("languageCodes") BETWEEN 1 AND 20),
  CONSTRAINT "RadioDistributionDestination_categories_check" CHECK (cardinality("categories") BETWEEN 1 AND 20),
  CONSTRAINT "RadioDistributionDestination_channel_check" CHECK (("kind" = 'STREAM_CDN' AND "channelId" IS NOT NULL) OR ("kind" <> 'STREAM_CDN' AND "channelId" IS NULL)),
  CONSTRAINT "RadioDistributionDestination_activation_check" CHECK ("status" <> 'ACTIVE' OR ("configurationHash" IS NOT NULL AND "activatedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "RadioDistributionDestination_connectionId_key" ON "RadioDistributionDestination"("connectionId");
CREATE UNIQUE INDEX "RadioDistributionDestination_connectionId_organisationId_key" ON "RadioDistributionDestination"("connectionId", "organisationId");
CREATE UNIQUE INDEX "RadioDistributionDestination_org_station_kind_provider_key" ON "RadioDistributionDestination"("organisationId", "stationId", "kind", "providerKey");
CREATE INDEX "RadioDistributionDestination_organisationId_status_updatedAt_idx" ON "RadioDistributionDestination"("organisationId", "status", "updatedAt");
CREATE INDEX "RadioDistributionDestination_stationId_kind_status_idx" ON "RadioDistributionDestination"("stationId", "kind", "status");
CREATE INDEX "RadioDistributionDestination_channelId_status_idx" ON "RadioDistributionDestination"("channelId", "status");
CREATE INDEX "RadioDistributionDestination_createdByUserId_idx" ON "RadioDistributionDestination"("createdByUserId");
CREATE INDEX "RadioDistributionDestination_activatedByUserId_idx" ON "RadioDistributionDestination"("activatedByUserId");

ALTER TABLE "RadioDistributionDestination" ADD CONSTRAINT "RadioDistributionDestination_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadioDistributionDestination" ADD CONSTRAINT "RadioDistributionDestination_station_org_fkey" FOREIGN KEY ("stationId", "organisationId") REFERENCES "Station"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadioDistributionDestination" ADD CONSTRAINT "RadioDistributionDestination_channel_station_org_fkey" FOREIGN KEY ("channelId", "stationId", "organisationId") REFERENCES "Channel"("id", "stationId", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioDistributionDestination" ADD CONSTRAINT "RadioDistributionDestination_connection_org_fkey" FOREIGN KEY ("connectionId", "organisationId") REFERENCES "IntegrationConnection"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioDistributionDestination" ADD CONSTRAINT "RadioDistributionDestination_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioDistributionDestination" ADD CONSTRAINT "RadioDistributionDestination_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
