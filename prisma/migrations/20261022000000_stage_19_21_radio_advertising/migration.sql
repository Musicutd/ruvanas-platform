ALTER TYPE "CampaignTargetType" ADD VALUE IF NOT EXISTS 'STATION';
ALTER TYPE "CampaignTargetType" ADD VALUE IF NOT EXISTS 'CHANNEL';
ALTER TYPE "RetailMediaInventoryTargetType" ADD VALUE IF NOT EXISTS 'STATION';
ALTER TYPE "RetailMediaInventoryTargetType" ADD VALUE IF NOT EXISTS 'CHANNEL';

CREATE TYPE "RadioAdvertisingPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');
CREATE TYPE "RadioAdvertisingPacingMode" AS ENUM ('EVEN', 'PRIORITY');

ALTER TABLE "CampaignTarget" ADD COLUMN "stationId" TEXT;
ALTER TABLE "CampaignTarget" ADD COLUMN "channelId" TEXT;
ALTER TABLE "RetailMediaInventoryTarget" ADD COLUMN "stationId" TEXT;
ALTER TABLE "RetailMediaInventoryTarget" ADD COLUMN "channelId" TEXT;

ALTER TABLE "CampaignTarget" DROP CONSTRAINT "CampaignTarget_shape_check";
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_shape_check" CHECK (
  ("targetType" = 'ALL_LOCATIONS' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "locationId" IS NULL AND "zoneId" IS NULL AND "stationId" IS NULL AND "channelId" IS NULL) OR
  ("targetType" = 'BRAND' AND "brandId" IS NOT NULL AND "locationGroupId" IS NULL AND "locationId" IS NULL AND "zoneId" IS NULL AND "stationId" IS NULL AND "channelId" IS NULL) OR
  ("targetType" = 'LOCATION_GROUP' AND "brandId" IS NULL AND "locationGroupId" IS NOT NULL AND "locationId" IS NULL AND "zoneId" IS NULL AND "stationId" IS NULL AND "channelId" IS NULL) OR
  ("targetType" = 'LOCATION' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "locationId" IS NOT NULL AND "zoneId" IS NULL AND "stationId" IS NULL AND "channelId" IS NULL) OR
  ("targetType" = 'ZONE' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "locationId" IS NULL AND "zoneId" IS NOT NULL AND "stationId" IS NULL AND "channelId" IS NULL) OR
  ("targetType" = 'STATION' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "locationId" IS NULL AND "zoneId" IS NULL AND "stationId" IS NOT NULL AND "channelId" IS NULL) OR
  ("targetType" = 'CHANNEL' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "locationId" IS NULL AND "zoneId" IS NULL AND "stationId" IS NULL AND "channelId" IS NOT NULL)
);

ALTER TABLE "RetailMediaInventoryTarget" DROP CONSTRAINT "RetailMediaInventoryTarget_shape_check";
ALTER TABLE "RetailMediaInventoryTarget" ADD CONSTRAINT "RetailMediaInventoryTarget_shape_check" CHECK (
  ("targetType" = 'BRAND' AND "brandId" IS NOT NULL AND "locationGroupId" IS NULL AND "zoneId" IS NULL AND "stationId" IS NULL AND "channelId" IS NULL) OR
  ("targetType" = 'LOCATION_GROUP' AND "brandId" IS NULL AND "locationGroupId" IS NOT NULL AND "zoneId" IS NULL AND "stationId" IS NULL AND "channelId" IS NULL) OR
  ("targetType" = 'ZONE' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "zoneId" IS NOT NULL AND "stationId" IS NULL AND "channelId" IS NULL) OR
  ("targetType" = 'STATION' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "zoneId" IS NULL AND "stationId" IS NOT NULL AND "channelId" IS NULL) OR
  ("targetType" = 'CHANNEL' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "zoneId" IS NULL AND "stationId" IS NULL AND "channelId" IS NOT NULL)
);

CREATE INDEX "CampaignTarget_stationId_idx" ON "CampaignTarget"("stationId");
CREATE INDEX "CampaignTarget_channelId_idx" ON "CampaignTarget"("channelId");
CREATE UNIQUE INDEX "CampaignTarget_station_key" ON "CampaignTarget"("campaignId", "stationId") WHERE "stationId" IS NOT NULL;
CREATE UNIQUE INDEX "CampaignTarget_channel_key" ON "CampaignTarget"("campaignId", "channelId") WHERE "channelId" IS NOT NULL;
CREATE INDEX "RetailMediaInventoryTarget_stationId_idx" ON "RetailMediaInventoryTarget"("stationId");
CREATE INDEX "RetailMediaInventoryTarget_channelId_idx" ON "RetailMediaInventoryTarget"("channelId");
CREATE UNIQUE INDEX "RetailMediaInventoryTarget_package_station_key" ON "RetailMediaInventoryTarget"("inventoryPackageId", "stationId") WHERE "stationId" IS NOT NULL;
CREATE UNIQUE INDEX "RetailMediaInventoryTarget_package_channel_key" ON "RetailMediaInventoryTarget"("inventoryPackageId", "channelId") WHERE "channelId" IS NOT NULL;

ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryTarget" ADD CONSTRAINT "RetailMediaInventoryTarget_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryTarget" ADD CONSTRAINT "RetailMediaInventoryTarget_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RadioAdvertisingPolicy" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "status" "RadioAdvertisingPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "pacingMode" "RadioAdvertisingPacingMode" NOT NULL DEFAULT 'EVEN',
  "maxSpotsPerBreak" INTEGER NOT NULL DEFAULT 4,
  "maxBreakSeconds" INTEGER NOT NULL DEFAULT 180,
  "minBreakGapMinutes" INTEGER NOT NULL DEFAULT 10,
  "maxAdvertisingSecondsPerHour" INTEGER NOT NULL DEFAULT 720,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "configurationHash" TEXT,
  "policyVersion" TEXT NOT NULL DEFAULT 'radio-advertising-v1',
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RadioAdvertisingPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RadioAdvertisingPolicy_spots_check" CHECK ("maxSpotsPerBreak" BETWEEN 1 AND 12),
  CONSTRAINT "RadioAdvertisingPolicy_break_seconds_check" CHECK ("maxBreakSeconds" BETWEEN 15 AND 600),
  CONSTRAINT "RadioAdvertisingPolicy_gap_check" CHECK ("minBreakGapMinutes" BETWEEN 1 AND 180),
  CONSTRAINT "RadioAdvertisingPolicy_hour_check" CHECK ("maxAdvertisingSecondsPerHour" BETWEEN 30 AND 1800),
  CONSTRAINT "RadioAdvertisingPolicy_revision_check" CHECK ("revision" >= 0)
);

CREATE UNIQUE INDEX "RadioAdvertisingPolicy_channelId_organisationId_key" ON "RadioAdvertisingPolicy"("channelId", "organisationId");
CREATE UNIQUE INDEX "Channel_id_stationId_organisationId_key" ON "Channel"("id", "stationId", "organisationId");
CREATE INDEX "RadioAdvertisingPolicy_organisationId_status_idx" ON "RadioAdvertisingPolicy"("organisationId", "status");
CREATE INDEX "RadioAdvertisingPolicy_stationId_idx" ON "RadioAdvertisingPolicy"("stationId");
CREATE INDEX "RadioAdvertisingPolicy_createdByUserId_idx" ON "RadioAdvertisingPolicy"("createdByUserId");
CREATE INDEX "RadioAdvertisingPolicy_approvedByUserId_idx" ON "RadioAdvertisingPolicy"("approvedByUserId");

ALTER TABLE "RadioAdvertisingPolicy" ADD CONSTRAINT "RadioAdvertisingPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadioAdvertisingPolicy" ADD CONSTRAINT "RadioAdvertisingPolicy_station_org_fkey" FOREIGN KEY ("stationId", "organisationId") REFERENCES "Station"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadioAdvertisingPolicy" ADD CONSTRAINT "RadioAdvertisingPolicy_channel_station_org_fkey" FOREIGN KEY ("channelId", "stationId", "organisationId") REFERENCES "Channel"("id", "stationId", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadioAdvertisingPolicy" ADD CONSTRAINT "RadioAdvertisingPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioAdvertisingPolicy" ADD CONSTRAINT "RadioAdvertisingPolicy_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
