CREATE TYPE "RetailMediaPartnerKind" AS ENUM ('ADVERTISER', 'AGENCY');
CREATE TYPE "RetailMediaPartnerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "RetailMediaInventoryStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "RetailMediaPriceModel" AS ENUM ('FIXED_FEE', 'PER_PLAY', 'CPM', 'CUSTOM');
CREATE TYPE "RetailMediaInventoryTargetType" AS ENUM ('BRAND', 'LOCATION_GROUP', 'ZONE');
CREATE TYPE "RetailMediaOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'FULFILLED');
CREATE TYPE "RetailMediaCreativeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Plan" ADD COLUMN "retailMediaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "retailMediaEnabled" BOOLEAN;

CREATE TABLE "RetailMediaPartner" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "kind" "RetailMediaPartnerKind" NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "billingReference" TEXT,
  "status" "RetailMediaPartnerStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetailMediaPartner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetailMediaInventoryPackage" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "RetailMediaInventoryStatus" NOT NULL DEFAULT 'DRAFT',
  "priceModel" "RetailMediaPriceModel" NOT NULL,
  "currencyCode" VARCHAR(3),
  "unitPriceMinor" INTEGER,
  "maxPlays" INTEGER NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE NOT NULL,
  "restrictionNotes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetailMediaInventoryPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetailMediaInventoryTarget" (
  "id" TEXT NOT NULL,
  "inventoryPackageId" TEXT NOT NULL,
  "targetType" "RetailMediaInventoryTargetType" NOT NULL,
  "brandId" TEXT,
  "locationGroupId" TEXT,
  "zoneId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetailMediaInventoryTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetailMediaInventoryDaypart" (
  "id" TEXT NOT NULL,
  "inventoryPackageId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetailMediaInventoryDaypart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetailMediaOrder" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "agencyId" TEXT,
  "inventoryPackageId" TEXT NOT NULL,
  "campaignId" TEXT,
  "name" TEXT NOT NULL,
  "purchaseOrderReference" TEXT,
  "status" "RetailMediaOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetailMediaOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetailMediaOrderCreative" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "promoVersionId" TEXT NOT NULL,
  "status" "RetailMediaCreativeStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetailMediaOrderCreative_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetailMediaPartner_organisationId_kind_name_key" ON "RetailMediaPartner"("organisationId", "kind", "name");
CREATE INDEX "RetailMediaPartner_organisationId_status_kind_idx" ON "RetailMediaPartner"("organisationId", "status", "kind");
CREATE UNIQUE INDEX "RetailMediaInventoryPackage_organisationId_name_key" ON "RetailMediaInventoryPackage"("organisationId", "name");
CREATE INDEX "RetailMediaInventoryPackage_organisationId_status_effectiveFrom_effectiveTo_idx" ON "RetailMediaInventoryPackage"("organisationId", "status", "effectiveFrom", "effectiveTo");
CREATE INDEX "RetailMediaInventoryPackage_createdByUserId_idx" ON "RetailMediaInventoryPackage"("createdByUserId");
CREATE UNIQUE INDEX "RetailMediaInventoryTarget_inventoryPackageId_targetType_brandId_locationGroupId_zoneId_key" ON "RetailMediaInventoryTarget"("inventoryPackageId", "targetType", "brandId", "locationGroupId", "zoneId");
CREATE INDEX "RetailMediaInventoryTarget_inventoryPackageId_targetType_idx" ON "RetailMediaInventoryTarget"("inventoryPackageId", "targetType");
CREATE INDEX "RetailMediaInventoryTarget_brandId_idx" ON "RetailMediaInventoryTarget"("brandId");
CREATE INDEX "RetailMediaInventoryTarget_locationGroupId_idx" ON "RetailMediaInventoryTarget"("locationGroupId");
CREATE INDEX "RetailMediaInventoryTarget_zoneId_idx" ON "RetailMediaInventoryTarget"("zoneId");
CREATE UNIQUE INDEX "RetailMediaInventoryTarget_package_brand_key" ON "RetailMediaInventoryTarget"("inventoryPackageId", "brandId") WHERE "brandId" IS NOT NULL;
CREATE UNIQUE INDEX "RetailMediaInventoryTarget_package_group_key" ON "RetailMediaInventoryTarget"("inventoryPackageId", "locationGroupId") WHERE "locationGroupId" IS NOT NULL;
CREATE UNIQUE INDEX "RetailMediaInventoryTarget_package_zone_key" ON "RetailMediaInventoryTarget"("inventoryPackageId", "zoneId") WHERE "zoneId" IS NOT NULL;
CREATE UNIQUE INDEX "RetailMediaInventoryDaypart_inventoryPackageId_weekday_startMinute_endMinute_key" ON "RetailMediaInventoryDaypart"("inventoryPackageId", "weekday", "startMinute", "endMinute");
CREATE INDEX "RetailMediaInventoryDaypart_inventoryPackageId_weekday_startMinute_idx" ON "RetailMediaInventoryDaypart"("inventoryPackageId", "weekday", "startMinute");
CREATE UNIQUE INDEX "RetailMediaOrder_campaignId_key" ON "RetailMediaOrder"("campaignId");
CREATE INDEX "RetailMediaOrder_organisationId_status_createdAt_idx" ON "RetailMediaOrder"("organisationId", "status", "createdAt");
CREATE INDEX "RetailMediaOrder_advertiserId_idx" ON "RetailMediaOrder"("advertiserId");
CREATE INDEX "RetailMediaOrder_agencyId_idx" ON "RetailMediaOrder"("agencyId");
CREATE INDEX "RetailMediaOrder_inventoryPackageId_idx" ON "RetailMediaOrder"("inventoryPackageId");
CREATE INDEX "RetailMediaOrder_approvedByUserId_idx" ON "RetailMediaOrder"("approvedByUserId");
CREATE UNIQUE INDEX "RetailMediaOrderCreative_orderId_promoVersionId_key" ON "RetailMediaOrderCreative"("orderId", "promoVersionId");
CREATE INDEX "RetailMediaOrderCreative_promoVersionId_status_idx" ON "RetailMediaOrderCreative"("promoVersionId", "status");
CREATE INDEX "RetailMediaOrderCreative_reviewedById_idx" ON "RetailMediaOrderCreative"("reviewedById");

ALTER TABLE "RetailMediaInventoryPackage" ADD CONSTRAINT "RetailMediaInventoryPackage_dates_check" CHECK ("effectiveTo" >= "effectiveFrom");
ALTER TABLE "RetailMediaInventoryPackage" ADD CONSTRAINT "RetailMediaInventoryPackage_maxPlays_check" CHECK ("maxPlays" > 0);
ALTER TABLE "RetailMediaInventoryPackage" ADD CONSTRAINT "RetailMediaInventoryPackage_currency_check" CHECK ("currencyCode" IS NULL OR "currencyCode" ~ '^[A-Z]{3}$');
ALTER TABLE "RetailMediaInventoryPackage" ADD CONSTRAINT "RetailMediaInventoryPackage_price_check" CHECK ("unitPriceMinor" IS NULL OR "unitPriceMinor" >= 0);
ALTER TABLE "RetailMediaInventoryPackage" ADD CONSTRAINT "RetailMediaInventoryPackage_terms_check" CHECK ("priceModel" = 'CUSTOM' OR ("currencyCode" IS NOT NULL AND "unitPriceMinor" IS NOT NULL));
ALTER TABLE "RetailMediaInventoryDaypart" ADD CONSTRAINT "RetailMediaInventoryDaypart_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "RetailMediaInventoryDaypart" ADD CONSTRAINT "RetailMediaInventoryDaypart_minutes_check" CHECK ("startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 1 AND 1440 AND "endMinute" > "startMinute");
ALTER TABLE "RetailMediaInventoryTarget" ADD CONSTRAINT "RetailMediaInventoryTarget_shape_check" CHECK (
  ("targetType" = 'BRAND' AND "brandId" IS NOT NULL AND "locationGroupId" IS NULL AND "zoneId" IS NULL) OR
  ("targetType" = 'LOCATION_GROUP' AND "brandId" IS NULL AND "locationGroupId" IS NOT NULL AND "zoneId" IS NULL) OR
  ("targetType" = 'ZONE' AND "brandId" IS NULL AND "locationGroupId" IS NULL AND "zoneId" IS NOT NULL)
);

ALTER TABLE "RetailMediaPartner" ADD CONSTRAINT "RetailMediaPartner_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryPackage" ADD CONSTRAINT "RetailMediaInventoryPackage_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryPackage" ADD CONSTRAINT "RetailMediaInventoryPackage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryTarget" ADD CONSTRAINT "RetailMediaInventoryTarget_inventoryPackageId_fkey" FOREIGN KEY ("inventoryPackageId") REFERENCES "RetailMediaInventoryPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryTarget" ADD CONSTRAINT "RetailMediaInventoryTarget_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryTarget" ADD CONSTRAINT "RetailMediaInventoryTarget_locationGroupId_fkey" FOREIGN KEY ("locationGroupId") REFERENCES "LocationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryTarget" ADD CONSTRAINT "RetailMediaInventoryTarget_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaInventoryDaypart" ADD CONSTRAINT "RetailMediaInventoryDaypart_inventoryPackageId_fkey" FOREIGN KEY ("inventoryPackageId") REFERENCES "RetailMediaInventoryPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrder" ADD CONSTRAINT "RetailMediaOrder_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrder" ADD CONSTRAINT "RetailMediaOrder_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "RetailMediaPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrder" ADD CONSTRAINT "RetailMediaOrder_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "RetailMediaPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrder" ADD CONSTRAINT "RetailMediaOrder_inventoryPackageId_fkey" FOREIGN KEY ("inventoryPackageId") REFERENCES "RetailMediaInventoryPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrder" ADD CONSTRAINT "RetailMediaOrder_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrder" ADD CONSTRAINT "RetailMediaOrder_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrderCreative" ADD CONSTRAINT "RetailMediaOrderCreative_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RetailMediaOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrderCreative" ADD CONSTRAINT "RetailMediaOrderCreative_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetailMediaOrderCreative" ADD CONSTRAINT "RetailMediaOrderCreative_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
