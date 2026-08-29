CREATE TYPE "DigitalSignageVideoJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "DigitalSignageTakeoverStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED');

ALTER TABLE "DigitalSignageAsset" DROP CONSTRAINT "DigitalSignageAsset_dimensions_check";
ALTER TABLE "DigitalSignageAsset" ADD CONSTRAINT "DigitalSignageAsset_dimensions_check" CHECK (
  ("status" IN ('PROCESSING', 'FAILED') AND "width" >= 0 AND "height" >= 0)
  OR ("status" NOT IN ('PROCESSING', 'FAILED') AND "width" > 0 AND "height" > 0)
);

CREATE TABLE "RetailMediaOrderVisualCreative" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "signageAssetId" TEXT NOT NULL,
  "status" "RetailMediaCreativeStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetailMediaOrderVisualCreative_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigitalSignageVideoJob" (
  "id" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "status" "DigitalSignageVideoJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "sourceMimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DigitalSignageVideoJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DigitalSignagePlaylist" ADD COLUMN "retailMediaOrderId" TEXT;

CREATE TABLE "DigitalSignageTakeover" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "DigitalSignageTakeoverStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "activatedByUserId" TEXT,
  "endedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DigitalSignageTakeover_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalSignageTakeover_window_check" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + INTERVAL '24 hours')
);

CREATE TABLE "DigitalSignageTakeoverDevice" (
  "takeoverId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DigitalSignageTakeoverDevice_pkey" PRIMARY KEY ("takeoverId", "deviceId")
);

ALTER TABLE "DigitalSignageDeliveryProof"
  ADD COLUMN "takeoverId" TEXT,
  ADD COLUMN "retailMediaOrderId" TEXT;

CREATE UNIQUE INDEX "RetailMediaVisualCreative_order_asset_key" ON "RetailMediaOrderVisualCreative"("orderId", "signageAssetId");
CREATE INDEX "RetailMediaVisualCreative_asset_status_idx" ON "RetailMediaOrderVisualCreative"("signageAssetId", "status");
CREATE INDEX "RetailMediaVisualCreative_reviewer_idx" ON "RetailMediaOrderVisualCreative"("reviewedById");
CREATE UNIQUE INDEX "DigitalSignageVideoJob_asset_key" ON "DigitalSignageVideoJob"("assetId");
CREATE INDEX "DigitalSignageVideoJob_status_created_idx" ON "DigitalSignageVideoJob"("status", "createdAt");
CREATE INDEX "DigitalSignagePlaylist_retail_order_idx" ON "DigitalSignagePlaylist"("retailMediaOrderId");
CREATE INDEX "DigitalSignageTakeover_org_status_window_idx" ON "DigitalSignageTakeover"("organisationId", "status", "startsAt", "endsAt");
CREATE INDEX "DigitalSignageTakeover_playlist_idx" ON "DigitalSignageTakeover"("playlistId");
CREATE INDEX "DigitalSignageTakeover_creator_idx" ON "DigitalSignageTakeover"("createdByUserId");
CREATE INDEX "DigitalSignageTakeoverDevice_device_idx" ON "DigitalSignageTakeoverDevice"("deviceId");
CREATE INDEX "DigitalSignageProof_takeover_occurred_idx" ON "DigitalSignageDeliveryProof"("takeoverId", "occurredAt");
CREATE INDEX "DigitalSignageProof_retail_order_occurred_idx" ON "DigitalSignageDeliveryProof"("retailMediaOrderId", "occurredAt");

ALTER TABLE "RetailMediaOrderVisualCreative"
  ADD CONSTRAINT "RetailMediaVisualCreative_order_fkey" FOREIGN KEY ("orderId") REFERENCES "RetailMediaOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RetailMediaVisualCreative_asset_fkey" FOREIGN KEY ("signageAssetId") REFERENCES "DigitalSignageAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RetailMediaVisualCreative_reviewer_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DigitalSignageVideoJob"
  ADD CONSTRAINT "DigitalSignageVideoJob_asset_fkey" FOREIGN KEY ("assetId") REFERENCES "DigitalSignageAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DigitalSignagePlaylist"
  ADD CONSTRAINT "DigitalSignagePlaylist_retail_order_fkey" FOREIGN KEY ("retailMediaOrderId") REFERENCES "RetailMediaOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DigitalSignageTakeover"
  ADD CONSTRAINT "DigitalSignageTakeover_org_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageTakeover_playlist_fkey" FOREIGN KEY ("playlistId") REFERENCES "DigitalSignagePlaylist"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageTakeover_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageTakeover_activator_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageTakeover_ender_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DigitalSignageTakeoverDevice"
  ADD CONSTRAINT "DigitalSignageTakeoverDevice_takeover_fkey" FOREIGN KEY ("takeoverId") REFERENCES "DigitalSignageTakeover"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageTakeoverDevice_device_fkey" FOREIGN KEY ("deviceId") REFERENCES "DigitalSignageDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DigitalSignageDeliveryProof"
  ADD CONSTRAINT "DigitalSignageProof_takeover_fkey" FOREIGN KEY ("takeoverId") REFERENCES "DigitalSignageTakeover"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageProof_retail_order_fkey" FOREIGN KEY ("retailMediaOrderId") REFERENCES "RetailMediaOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
