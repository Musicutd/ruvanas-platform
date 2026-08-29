CREATE TYPE "DigitalSignageAssetKind" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "DigitalSignageAssetStatus" AS ENUM ('READY', 'REJECTED', 'ARCHIVED');
CREATE TYPE "DigitalSignageLayoutStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "DigitalSignageOrientation" AS ENUM ('LANDSCAPE', 'PORTRAIT', 'SQUARE', 'CUSTOM');

ALTER TABLE "Plan"
  ADD COLUMN "digitalSignageEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Subscription"
  ADD COLUMN "digitalSignageEnabled" BOOLEAN;

CREATE TABLE "DigitalSignageAsset" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "DigitalSignageAssetKind" NOT NULL DEFAULT 'IMAGE',
  "status" "DigitalSignageAssetStatus" NOT NULL DEFAULT 'READY',
  "originalName" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "durationSeconds" INTEGER,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DigitalSignageAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalSignageAsset_dimensions_check" CHECK ("width" > 0 AND "height" > 0),
  CONSTRAINT "DigitalSignageAsset_size_check" CHECK ("sizeBytes" > 0),
  CONSTRAINT "DigitalSignageAsset_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" > 0)
);

CREATE TABLE "DigitalSignageLayout" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "DigitalSignageLayoutStatus" NOT NULL DEFAULT 'DRAFT',
  "orientation" "DigitalSignageOrientation" NOT NULL DEFAULT 'LANDSCAPE',
  "canvasWidth" INTEGER NOT NULL,
  "canvasHeight" INTEGER NOT NULL,
  "backgroundColor" VARCHAR(7) NOT NULL DEFAULT '#000000',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DigitalSignageLayout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalSignageLayout_canvas_check" CHECK ("canvasWidth" > 0 AND "canvasHeight" > 0),
  CONSTRAINT "DigitalSignageLayout_color_check" CHECK ("backgroundColor" ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE "DigitalSignageLayoutRegion" (
  "id" TEXT NOT NULL,
  "layoutId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "zIndex" INTEGER NOT NULL DEFAULT 0,
  "fitMode" VARCHAR(12) NOT NULL DEFAULT 'COVER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DigitalSignageLayoutRegion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalSignageRegion_geometry_check" CHECK ("x" >= 0 AND "y" >= 0 AND "width" > 0 AND "height" > 0),
  CONSTRAINT "DigitalSignageRegion_fit_check" CHECK ("fitMode" IN ('COVER', 'CONTAIN', 'STRETCH'))
);

CREATE TABLE "DigitalSignageDevice" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "PlayerStatus" NOT NULL DEFAULT 'PENDING_ENROLMENT',
  "orientation" "DigitalSignageOrientation" NOT NULL DEFAULT 'LANDSCAPE',
  "viewportWidth" INTEGER NOT NULL,
  "viewportHeight" INTEGER NOT NULL,
  "enrolmentTokenHash" TEXT,
  "enrolmentExpiresAt" TIMESTAMP(3),
  "sessionTokenHash" TEXT,
  "enrolledAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastIpAddress" TEXT,
  "lastUserAgent" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DigitalSignageDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalSignageDevice_viewport_check" CHECK ("viewportWidth" > 0 AND "viewportHeight" > 0)
);

CREATE UNIQUE INDEX "DigitalSignageAsset_storageKey_key" ON "DigitalSignageAsset"("storageKey");
CREATE UNIQUE INDEX "DigitalSignageAsset_org_checksum_key" ON "DigitalSignageAsset"("organisationId", "checksumSha256");
CREATE INDEX "DigitalSignageAsset_org_status_kind_idx" ON "DigitalSignageAsset"("organisationId", "status", "kind");
CREATE INDEX "DigitalSignageAsset_uploadedBy_idx" ON "DigitalSignageAsset"("uploadedByUserId");

CREATE UNIQUE INDEX "DigitalSignageLayout_org_name_key" ON "DigitalSignageLayout"("organisationId", "name");
CREATE INDEX "DigitalSignageLayout_org_status_idx" ON "DigitalSignageLayout"("organisationId", "status");
CREATE INDEX "DigitalSignageLayout_createdBy_idx" ON "DigitalSignageLayout"("createdByUserId");

CREATE UNIQUE INDEX "DigitalSignageRegion_layout_name_key" ON "DigitalSignageLayoutRegion"("layoutId", "name");
CREATE INDEX "DigitalSignageRegion_layout_z_idx" ON "DigitalSignageLayoutRegion"("layoutId", "zIndex");

CREATE UNIQUE INDEX "DigitalSignageDevice_enrolment_key" ON "DigitalSignageDevice"("enrolmentTokenHash");
CREATE UNIQUE INDEX "DigitalSignageDevice_session_key" ON "DigitalSignageDevice"("sessionTokenHash");
CREATE INDEX "DigitalSignageDevice_org_status_idx" ON "DigitalSignageDevice"("organisationId", "status");
CREATE INDEX "DigitalSignageDevice_zone_idx" ON "DigitalSignageDevice"("zoneId");
CREATE INDEX "DigitalSignageDevice_createdBy_idx" ON "DigitalSignageDevice"("createdByUserId");
CREATE INDEX "DigitalSignageDevice_heartbeat_idx" ON "DigitalSignageDevice"("lastHeartbeatAt");

ALTER TABLE "DigitalSignageAsset"
  ADD CONSTRAINT "DigitalSignageAsset_org_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageAsset_uploader_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DigitalSignageLayout"
  ADD CONSTRAINT "DigitalSignageLayout_org_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageLayout_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DigitalSignageLayoutRegion"
  ADD CONSTRAINT "DigitalSignageRegion_layout_fkey" FOREIGN KEY ("layoutId") REFERENCES "DigitalSignageLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DigitalSignageDevice"
  ADD CONSTRAINT "DigitalSignageDevice_org_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageDevice_zone_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DigitalSignageDevice_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
