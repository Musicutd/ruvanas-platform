CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ENDED', 'ARCHIVED');
CREATE TYPE "CampaignPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'VERY_HIGH');
CREATE TYPE "CampaignTargetType" AS ENUM ('ALL_LOCATIONS', 'BRAND', 'LOCATION_GROUP', 'LOCATION', 'ZONE');
CREATE TYPE "CampaignSchedulingMode" AS ENUM ('PLAYS_PER_HOUR', 'INTERVAL', 'EXACT_TIMES', 'ADVANCED_DAYPART', 'SMART_PRIORITY');
CREATE TYPE "CampaignWindowMode" AS ENUM ('PLAYS_PER_HOUR', 'INTERVAL', 'EXACT_TIME');

CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "promoVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "CampaignPriority" NOT NULL DEFAULT 'NORMAL',
    "schedulingMode" "CampaignSchedulingMode" NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "respectOpeningHours" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE NOT NULL,
    "maxPromoMinutesPerHour" INTEGER NOT NULL DEFAULT 12,
    "minSamePromoGapMinutes" INTEGER NOT NULL DEFAULT 15,
    "minAnyPromoGapMinutes" INTEGER NOT NULL DEFAULT 2,
    "publicationRevision" INTEGER NOT NULL DEFAULT 0,
    "publishedConfigurationHash" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Campaign_date_range_check" CHECK ("effectiveTo" >= "effectiveFrom"),
    CONSTRAINT "Campaign_max_promo_minutes_check" CHECK ("maxPromoMinutesPerHour" BETWEEN 1 AND 60),
    CONSTRAINT "Campaign_same_gap_check" CHECK ("minSamePromoGapMinutes" BETWEEN 1 AND 720),
    CONSTRAINT "Campaign_any_gap_check" CHECK ("minAnyPromoGapMinutes" BETWEEN 0 AND 720),
    CONSTRAINT "Campaign_publication_revision_check" CHECK ("publicationRevision" >= 0)
);

CREATE TABLE "CampaignTarget" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "targetType" "CampaignTargetType" NOT NULL,
    "brandId" TEXT,
    "locationGroupId" TEXT,
    "locationId" TEXT,
    "zoneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignTarget_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CampaignTarget_shape_check" CHECK (
      ("targetType" = 'ALL_LOCATIONS' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "locationId" IS NULL AND "zoneId" IS NULL) OR
      ("targetType" = 'BRAND' AND "brandId" IS NOT NULL AND "locationGroupId" IS NULL AND "locationId" IS NULL AND "zoneId" IS NULL) OR
      ("targetType" = 'LOCATION_GROUP' AND "brandId" IS NULL AND "locationGroupId" IS NOT NULL AND "locationId" IS NULL AND "zoneId" IS NULL) OR
      ("targetType" = 'LOCATION' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "locationId" IS NOT NULL AND "zoneId" IS NULL) OR
      ("targetType" = 'ZONE' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "locationId" IS NULL AND "zoneId" IS NOT NULL)
    )
);

CREATE TABLE "CampaignRule" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "playsPerHour" INTEGER,
    "intervalMinutes" INTEGER,
    "exactTimeHardStart" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CampaignRule_plays_per_hour_check" CHECK ("playsPerHour" IS NULL OR "playsPerHour" BETWEEN 1 AND 12),
    CONSTRAINT "CampaignRule_interval_check" CHECK ("intervalMinutes" IS NULL OR "intervalMinutes" BETWEEN 5 AND 180)
);

CREATE TABLE "CampaignSchedule" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "windowMode" "CampaignWindowMode" NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "exactMinute" INTEGER,
    "playsPerHour" INTEGER,
    "intervalMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CampaignSchedule_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "CampaignSchedule_start_check" CHECK ("startMinute" IS NULL OR "startMinute" BETWEEN 0 AND 1439),
    CONSTRAINT "CampaignSchedule_end_check" CHECK ("endMinute" IS NULL OR "endMinute" BETWEEN 1 AND 1440),
    CONSTRAINT "CampaignSchedule_exact_check" CHECK ("exactMinute" IS NULL OR "exactMinute" BETWEEN 0 AND 1439),
    CONSTRAINT "CampaignSchedule_plays_check" CHECK ("playsPerHour" IS NULL OR "playsPerHour" BETWEEN 1 AND 12),
    CONSTRAINT "CampaignSchedule_interval_check" CHECK ("intervalMinutes" IS NULL OR "intervalMinutes" BETWEEN 5 AND 180),
    CONSTRAINT "CampaignSchedule_shape_check" CHECK (
      ("windowMode" = 'EXACT_TIME' AND "exactMinute" IS NOT NULL AND "startMinute" IS NULL AND "endMinute" IS NULL AND "playsPerHour" IS NULL AND "intervalMinutes" IS NULL) OR
      ("windowMode" = 'PLAYS_PER_HOUR' AND "exactMinute" IS NULL AND "startMinute" IS NOT NULL AND "endMinute" IS NOT NULL AND "startMinute" <> "endMinute" AND "playsPerHour" IS NOT NULL AND "intervalMinutes" IS NULL) OR
      ("windowMode" = 'INTERVAL' AND "exactMinute" IS NULL AND "startMinute" IS NOT NULL AND "endMinute" IS NOT NULL AND "startMinute" <> "endMinute" AND "playsPerHour" IS NULL AND "intervalMinutes" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "CampaignRule_campaignId_key" ON "CampaignRule"("campaignId");
CREATE INDEX "Campaign_organisationId_status_idx" ON "Campaign"("organisationId", "status");
CREATE INDEX "Campaign_promoVersionId_status_idx" ON "Campaign"("promoVersionId", "status");
CREATE INDEX "Campaign_effectiveFrom_effectiveTo_idx" ON "Campaign"("effectiveFrom", "effectiveTo");
CREATE INDEX "CampaignTarget_campaignId_targetType_idx" ON "CampaignTarget"("campaignId", "targetType");
CREATE INDEX "CampaignTarget_brandId_idx" ON "CampaignTarget"("brandId");
CREATE INDEX "CampaignTarget_locationGroupId_idx" ON "CampaignTarget"("locationGroupId");
CREATE INDEX "CampaignTarget_locationId_idx" ON "CampaignTarget"("locationId");
CREATE INDEX "CampaignTarget_zoneId_idx" ON "CampaignTarget"("zoneId");
CREATE UNIQUE INDEX "CampaignTarget_all_locations_key" ON "CampaignTarget"("campaignId") WHERE "targetType" = 'ALL_LOCATIONS';
CREATE UNIQUE INDEX "CampaignTarget_brand_key" ON "CampaignTarget"("campaignId", "brandId") WHERE "targetType" = 'BRAND';
CREATE UNIQUE INDEX "CampaignTarget_group_key" ON "CampaignTarget"("campaignId", "locationGroupId") WHERE "targetType" = 'LOCATION_GROUP';
CREATE UNIQUE INDEX "CampaignTarget_location_key" ON "CampaignTarget"("campaignId", "locationId") WHERE "targetType" = 'LOCATION';
CREATE UNIQUE INDEX "CampaignTarget_zone_key" ON "CampaignTarget"("campaignId", "zoneId") WHERE "targetType" = 'ZONE';
CREATE INDEX "CampaignSchedule_campaignId_weekday_startMinute_idx" ON "CampaignSchedule"("campaignId", "weekday", "startMinute");
CREATE INDEX "CampaignSchedule_campaignId_weekday_exactMinute_idx" ON "CampaignSchedule"("campaignId", "weekday", "exactMinute");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_locationGroupId_fkey" FOREIGN KEY ("locationGroupId") REFERENCES "LocationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRule" ADD CONSTRAINT "CampaignRule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignSchedule" ADD CONSTRAINT "CampaignSchedule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
