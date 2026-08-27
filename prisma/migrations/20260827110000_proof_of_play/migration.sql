CREATE TYPE "ProofOfPlayEventType" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

CREATE TABLE "ProofOfPlayEvent" (
    "id" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "manifestVersion" TEXT NOT NULL,
    "eventType" "ProofOfPlayEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "positionSeconds" INTEGER,
    "failureReason" TEXT,
    "playerName" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "zoneName" TEXT NOT NULL,
    "trackTitle" TEXT NOT NULL,
    "trackArtist" TEXT NOT NULL,

    CONSTRAINT "ProofOfPlayEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProofOfPlayEvent_manifest_version_check" CHECK ("manifestVersion" ~ '^[0-9a-f]{24}$'),
    CONSTRAINT "ProofOfPlayEvent_position_check" CHECK ("positionSeconds" IS NULL OR "positionSeconds" BETWEEN 0 AND 86400)
);

CREATE UNIQUE INDEX "ProofOfPlayEvent_playerId_clientEventId_key" ON "ProofOfPlayEvent"("playerId", "clientEventId");
CREATE INDEX "ProofOfPlayEvent_organisationId_occurredAt_idx" ON "ProofOfPlayEvent"("organisationId", "occurredAt");
CREATE INDEX "ProofOfPlayEvent_playerId_occurredAt_idx" ON "ProofOfPlayEvent"("playerId", "occurredAt");
CREATE INDEX "ProofOfPlayEvent_trackId_occurredAt_idx" ON "ProofOfPlayEvent"("trackId", "occurredAt");
CREATE INDEX "ProofOfPlayEvent_manifestVersion_idx" ON "ProofOfPlayEvent"("manifestVersion");
CREATE INDEX "ProofOfPlayEvent_eventType_occurredAt_idx" ON "ProofOfPlayEvent"("eventType", "occurredAt");

ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
