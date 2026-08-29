CREATE TYPE "DigitalSignagePlaylistStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');
CREATE TYPE "DigitalSignageDeliveryEventType" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

CREATE TABLE "DigitalSignagePlaylist" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "layoutId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "DigitalSignagePlaylistStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "activeDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "dailyStartMinute" INTEGER NOT NULL DEFAULT 0,
  "dailyEndMinute" INTEGER NOT NULL DEFAULT 1440,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "publishedByUserId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DigitalSignagePlaylist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalSignagePlaylist_version_check" CHECK ("version" > 0),
  CONSTRAINT "DigitalSignagePlaylist_window_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt"),
  CONSTRAINT "DigitalSignagePlaylist_days_check" CHECK ("activeDays" <@ ARRAY[0,1,2,3,4,5,6] AND cardinality("activeDays") <= 7),
  CONSTRAINT "DigitalSignagePlaylist_daily_check" CHECK ("dailyStartMinute" >= 0 AND "dailyStartMinute" <= 1439 AND "dailyEndMinute" >= 1 AND "dailyEndMinute" <= 1440 AND "dailyStartMinute" <> "dailyEndMinute"),
  CONSTRAINT "DigitalSignagePlaylist_priority_check" CHECK ("priority" >= 0 AND "priority" <= 100)
);

CREATE TABLE "DigitalSignagePlaylistItem" (
  "id" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "regionId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "durationSeconds" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DigitalSignagePlaylistItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalSignagePlaylistItem_position_check" CHECK ("position" >= 0),
  CONSTRAINT "DigitalSignagePlaylistItem_duration_check" CHECK ("durationSeconds" >= 3 AND "durationSeconds" <= 86400)
);

CREATE TABLE "DigitalSignagePlaylistDevice" (
  "playlistId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DigitalSignagePlaylistDevice_pkey" PRIMARY KEY ("playlistId", "deviceId")
);

CREATE TABLE "DigitalSignageDeliveryProof" (
  "id" TEXT NOT NULL,
  "clientEventId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "playlistItemId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "manifestVersion" VARCHAR(24) NOT NULL,
  "eventType" "DigitalSignageDeliveryEventType" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failureReason" TEXT,

  CONSTRAINT "DigitalSignageDeliveryProof_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DigitalSignagePlaylist_org_name_key" ON "DigitalSignagePlaylist"("organisationId", "name");
CREATE INDEX "DigitalSignagePlaylist_org_status_window_idx" ON "DigitalSignagePlaylist"("organisationId", "status", "startsAt", "endsAt");
CREATE INDEX "DigitalSignagePlaylist_layout_idx" ON "DigitalSignagePlaylist"("layoutId");
CREATE INDEX "DigitalSignagePlaylist_creator_idx" ON "DigitalSignagePlaylist"("createdByUserId");
CREATE INDEX "DigitalSignagePlaylist_publisher_idx" ON "DigitalSignagePlaylist"("publishedByUserId");

CREATE UNIQUE INDEX "DigitalSignagePlaylistItem_region_position_key" ON "DigitalSignagePlaylistItem"("playlistId", "regionId", "position");
CREATE INDEX "DigitalSignagePlaylistItem_asset_idx" ON "DigitalSignagePlaylistItem"("assetId");
CREATE INDEX "DigitalSignagePlaylistItem_region_idx" ON "DigitalSignagePlaylistItem"("regionId");

CREATE INDEX "DigitalSignagePlaylistDevice_device_idx" ON "DigitalSignagePlaylistDevice"("deviceId");

CREATE UNIQUE INDEX "DigitalSignageDeliveryProof_client_event_key" ON "DigitalSignageDeliveryProof"("clientEventId");
CREATE INDEX "DigitalSignageProof_org_occurred_idx" ON "DigitalSignageDeliveryProof"("organisationId", "occurredAt");
CREATE INDEX "DigitalSignageProof_device_occurred_idx" ON "DigitalSignageDeliveryProof"("deviceId", "occurredAt");
CREATE INDEX "DigitalSignageProof_playlist_event_idx" ON "DigitalSignageDeliveryProof"("playlistId", "eventType", "occurredAt");
CREATE INDEX "DigitalSignageProof_asset_occurred_idx" ON "DigitalSignageDeliveryProof"("assetId", "occurredAt");

ALTER TABLE "DigitalSignagePlaylist"
  ADD CONSTRAINT "DigitalSignagePlaylist_org_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignagePlaylist_layout_fkey" FOREIGN KEY ("layoutId") REFERENCES "DigitalSignageLayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignagePlaylist_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignagePlaylist_publisher_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DigitalSignagePlaylistItem"
  ADD CONSTRAINT "DigitalSignagePlaylistItem_playlist_fkey" FOREIGN KEY ("playlistId") REFERENCES "DigitalSignagePlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignagePlaylistItem_region_fkey" FOREIGN KEY ("regionId") REFERENCES "DigitalSignageLayoutRegion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignagePlaylistItem_asset_fkey" FOREIGN KEY ("assetId") REFERENCES "DigitalSignageAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DigitalSignagePlaylistDevice"
  ADD CONSTRAINT "DigitalSignagePlaylistDevice_playlist_fkey" FOREIGN KEY ("playlistId") REFERENCES "DigitalSignagePlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignagePlaylistDevice_device_fkey" FOREIGN KEY ("deviceId") REFERENCES "DigitalSignageDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DigitalSignageDeliveryProof"
  ADD CONSTRAINT "DigitalSignageProof_org_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageProof_device_fkey" FOREIGN KEY ("deviceId") REFERENCES "DigitalSignageDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageProof_playlist_fkey" FOREIGN KEY ("playlistId") REFERENCES "DigitalSignagePlaylist"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageProof_item_fkey" FOREIGN KEY ("playlistItemId") REFERENCES "DigitalSignagePlaylistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageProof_asset_fkey" FOREIGN KEY ("assetId") REFERENCES "DigitalSignageAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
