-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'OWNER', 'MANAGER', 'CONTENT_EDITOR', 'VIEWER');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');
CREATE TYPE "StationStatus" AS ENUM ('DRAFT', 'PENDING_SETUP', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "LocationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED');
CREATE TYPE "ZoneStatus" AS ENUM ('ACTIVE', 'PAUSED', 'OFFLINE');
CREATE TYPE "ChannelStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "StreamServerType" AS ENUM ('SHOUTCAST_V2', 'ICECAST_V2');
CREATE TYPE "AudioCodec" AS ENUM ('MP3', 'AAC');
CREATE TYPE "SourceConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR');
CREATE TYPE "PlayoutEventType" AS ENUM ('WORKER_STARTED', 'WORKER_STOPPED', 'WORKER_HEARTBEAT', 'SOURCE_CONNECTING', 'SOURCE_CONNECTED', 'SOURCE_DISCONNECTED', 'SOURCE_ERROR', 'TRACK_STARTED', 'TRACK_FINISHED', 'TRACK_FAILED');
CREATE TYPE "MediaType" AS ENUM ('MUSIC', 'COMMERCIAL', 'JINGLE', 'ANNOUNCEMENT', 'VOICEOVER');
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'READY', 'PROCESSING', 'REJECTED', 'ARCHIVED', 'DELETED');
CREATE TYPE "MediaLibraryType" AS ENUM ('RUVANAS_CATALOGUE', 'ORGANISATION_PROMO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganisationMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganisationMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "stationLimit" INTEGER NOT NULL DEFAULT 1,
    "storageLimitGb" INTEGER NOT NULL,
    "listenerLimit" INTEGER NOT NULL,
    "maxBitrateKbps" INTEGER NOT NULL,
    "includesRuvanasCatalogue" BOOLEAN NOT NULL DEFAULT false,
    "promoUploadEnabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "brandId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "LocationStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Malta',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ZoneStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "status" "StationStatus" NOT NULL DEFAULT 'DRAFT',
    "storageUsedMb" INTEGER NOT NULL DEFAULT 0,
    "listenerLimit" INTEGER NOT NULL,
    "storageLimitGb" INTEGER NOT NULL,
    "maxBitrateKbps" INTEGER NOT NULL,
    "providerName" TEXT,
    "providerAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "brandId" TEXT,
    "stationId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelAssignment" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StationStreamConfig" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "centovaUsername" TEXT,
    "streamUrl" TEXT,
    "mountPoint" TEXT,
    "serverHost" TEXT,
    "serverPort" INTEGER,
    "bitrateKbps" INTEGER,
    "serverType" "StreamServerType" NOT NULL DEFAULT 'SHOUTCAST_V2',
    "outputCodec" "AudioCodec" NOT NULL DEFAULT 'MP3',
    "sampleRateHz" INTEGER NOT NULL DEFAULT 44100,
    "outputChannels" INTEGER NOT NULL DEFAULT 2,
    "sourceConnectionStatus" "SourceConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastConnectedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "adminPasswordEncrypted" TEXT,
    "sourcePasswordEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StationStreamConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayoutEvent" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "eventType" "PlayoutEventType" NOT NULL,
    "assetId" TEXT,
    "message" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayoutEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "libraryType" "MediaLibraryType" NOT NULL DEFAULT 'ORGANISATION_PROMO',
    "name" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "durationSeconds" INTEGER,
    "mediaType" "MediaType" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaGenre" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaGenre_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAssetGenre" (
    "mediaAssetId" TEXT NOT NULL,
    "mediaGenreId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAssetGenre_pkey" PRIMARY KEY ("mediaAssetId", "mediaGenreId")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");
CREATE UNIQUE INDEX "OrganisationMember_userId_organisationId_key" ON "OrganisationMember"("userId", "organisationId");
CREATE INDEX "OrganisationMember_organisationId_idx" ON "OrganisationMember"("organisationId");
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
CREATE UNIQUE INDEX "Subscription_organisationId_key" ON "Subscription"("organisationId");
CREATE UNIQUE INDEX "Brand_organisationId_slug_key" ON "Brand"("organisationId", "slug");
CREATE INDEX "Brand_organisationId_idx" ON "Brand"("organisationId");
CREATE UNIQUE INDEX "Location_organisationId_slug_key" ON "Location"("organisationId", "slug");
CREATE INDEX "Location_organisationId_idx" ON "Location"("organisationId");
CREATE INDEX "Location_brandId_idx" ON "Location"("brandId");
CREATE UNIQUE INDEX "Zone_locationId_slug_key" ON "Zone"("locationId", "slug");
CREATE INDEX "Zone_locationId_idx" ON "Zone"("locationId");
CREATE UNIQUE INDEX "Station_slug_key" ON "Station"("slug");
CREATE INDEX "Station_organisationId_idx" ON "Station"("organisationId");
CREATE UNIQUE INDEX "Channel_organisationId_slug_key" ON "Channel"("organisationId", "slug");
CREATE INDEX "Channel_organisationId_idx" ON "Channel"("organisationId");
CREATE INDEX "Channel_brandId_idx" ON "Channel"("brandId");
CREATE INDEX "Channel_stationId_idx" ON "Channel"("stationId");
CREATE UNIQUE INDEX "ChannelAssignment_channelId_zoneId_key" ON "ChannelAssignment"("channelId", "zoneId");
CREATE INDEX "ChannelAssignment_zoneId_idx" ON "ChannelAssignment"("zoneId");
CREATE UNIQUE INDEX "StationStreamConfig_stationId_key" ON "StationStreamConfig"("stationId");
CREATE INDEX "PlayoutEvent_channelId_occurredAt_idx" ON "PlayoutEvent"("channelId", "occurredAt");
CREATE INDEX "PlayoutEvent_stationId_occurredAt_idx" ON "PlayoutEvent"("stationId", "occurredAt");
CREATE INDEX "PlayoutEvent_eventType_occurredAt_idx" ON "PlayoutEvent"("eventType", "occurredAt");
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_organisationId_idx" ON "MediaAsset"("organisationId");
CREATE INDEX "MediaAsset_libraryType_idx" ON "MediaAsset"("libraryType");
CREATE INDEX "MediaAsset_organisationId_libraryType_idx" ON "MediaAsset"("organisationId", "libraryType");
CREATE INDEX "MediaAsset_organisationId_mediaType_idx" ON "MediaAsset"("organisationId", "mediaType");
CREATE INDEX "MediaAsset_organisationId_status_idx" ON "MediaAsset"("organisationId", "status");
CREATE INDEX "MediaAsset_libraryType_status_idx" ON "MediaAsset"("libraryType", "status");
CREATE UNIQUE INDEX "MediaGenre_name_key" ON "MediaGenre"("name");
CREATE UNIQUE INDEX "MediaGenre_slug_key" ON "MediaGenre"("slug");
CREATE INDEX "MediaAssetGenre_mediaGenreId_idx" ON "MediaAssetGenre"("mediaGenreId");
CREATE INDEX "MediaAssetGenre_mediaAssetId_idx" ON "MediaAssetGenre"("mediaAssetId");
CREATE INDEX "AuditLog_organisationId_idx" ON "AuditLog"("organisationId");
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Location" ADD CONSTRAINT "Location_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Location" ADD CONSTRAINT "Location_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Station" ADD CONSTRAINT "Station_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelAssignment" ADD CONSTRAINT "ChannelAssignment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelAssignment" ADD CONSTRAINT "ChannelAssignment_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StationStreamConfig" ADD CONSTRAINT "StationStreamConfig_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayoutEvent" ADD CONSTRAINT "PlayoutEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayoutEvent" ADD CONSTRAINT "PlayoutEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAssetGenre" ADD CONSTRAINT "MediaAssetGenre_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAssetGenre" ADD CONSTRAINT "MediaAssetGenre_mediaGenreId_fkey" FOREIGN KEY ("mediaGenreId") REFERENCES "MediaGenre"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

