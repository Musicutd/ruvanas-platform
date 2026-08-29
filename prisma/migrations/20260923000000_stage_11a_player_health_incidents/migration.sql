-- Stage 11A: sampled player heartbeat history and operational health incidents.

CREATE TYPE "PlayerHeartbeatSampleKind" AS ENUM ('PERIODIC', 'RECOVERY');
CREATE TYPE "PlayerHealthIncidentKind" AS ENUM ('HEARTBEAT_MISSED', 'SOURCE_ERROR', 'PLAYBACK_ERROR', 'MANUAL');
CREATE TYPE "PlayerHealthIncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "PlayerHealthIncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "PlayerHeartbeatSample" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "kind" "PlayerHeartbeatSampleKind" NOT NULL DEFAULT 'PERIODIC',
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "appVersion" TEXT,
    "manifestVersion" TEXT,
    "sourceStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerHeartbeatSample_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlayerHeartbeatSample_bucket_check" CHECK ("observedAt" >= "bucketStart")
);

CREATE TABLE "PlayerHealthIncident" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "kind" "PlayerHealthIncidentKind" NOT NULL DEFAULT 'HEARTBEAT_MISSED',
    "severity" "PlayerHealthIncidentSeverity" NOT NULL DEFAULT 'LOW',
    "status" "PlayerHealthIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgementNote" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerHealthIncident_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlayerHealthIncident_window_check" CHECK ("lastObservedAt" >= "firstObservedAt"),
    CONSTRAINT "PlayerHealthIncident_ack_check" CHECK ("status" <> 'ACKNOWLEDGED' OR "acknowledgedAt" IS NOT NULL),
    CONSTRAINT "PlayerHealthIncident_resolution_check" CHECK (
      ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND length(trim("resolutionNote")) >= 3)
      OR
      ("status" <> 'RESOLVED' AND "resolvedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "PlayerHeartbeatSample_playerId_bucketStart_key"
ON "PlayerHeartbeatSample"("playerId", "bucketStart");

CREATE INDEX "PlayerHeartbeatSample_organisation_observed_idx"
ON "PlayerHeartbeatSample"("organisationId", "observedAt");

CREATE INDEX "PlayerHeartbeatSample_location_observed_idx"
ON "PlayerHeartbeatSample"("locationId", "observedAt");

CREATE INDEX "PlayerHeartbeatSample_zone_observed_idx"
ON "PlayerHeartbeatSample"("zoneId", "observedAt");

CREATE INDEX "PlayerHealthIncident_org_status_severity_idx"
ON "PlayerHealthIncident"("organisationId", "status", "severity");

CREATE INDEX "PlayerHealthIncident_player_status_idx"
ON "PlayerHealthIncident"("playerId", "status");

CREATE INDEX "PlayerHealthIncident_location_first_idx"
ON "PlayerHealthIncident"("locationId", "firstObservedAt");

CREATE INDEX "PlayerHealthIncident_zone_first_idx"
ON "PlayerHealthIncident"("zoneId", "firstObservedAt");

CREATE INDEX "PlayerHealthIncident_firstObservedAt_idx"
ON "PlayerHealthIncident"("firstObservedAt");

CREATE UNIQUE INDEX "PlayerHealthIncident_one_open_heartbeat_per_player"
ON "PlayerHealthIncident"("playerId")
WHERE "kind" = 'HEARTBEAT_MISSED' AND "status" IN ('OPEN', 'ACKNOWLEDGED');

ALTER TABLE "PlayerHeartbeatSample"
ADD CONSTRAINT "PlayerHeartbeatSample_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerHeartbeatSample"
ADD CONSTRAINT "PlayerHeartbeatSample_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerHealthIncident"
ADD CONSTRAINT "PlayerHealthIncident_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerHealthIncident"
ADD CONSTRAINT "PlayerHealthIncident_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerHealthIncident"
ADD CONSTRAINT "PlayerHealthIncident_acknowledgedById_fkey"
FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlayerHealthIncident"
ADD CONSTRAINT "PlayerHealthIncident_resolvedById_fkey"
FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

