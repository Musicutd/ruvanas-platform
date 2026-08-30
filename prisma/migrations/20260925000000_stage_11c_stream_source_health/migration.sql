-- Stage 11C: provider-neutral stream probing, sampled source health, and source incidents.

CREATE TYPE "StreamProbeStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNREACHABLE', 'SKIPPED');

ALTER TABLE "StationStreamConfig"
ADD COLUMN "providerKey" TEXT NOT NULL DEFAULT 'CENTOVA_CAST',
ADD COLUMN "backupStreamUrl" TEXT,
ADD COLUMN "probeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "probeIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "probeTimeoutMs" INTEGER NOT NULL DEFAULT 8000,
ADD COLUMN "lastProbeAt" TIMESTAMP(3),
ADD COLUMN "lastSuccessfulProbeAt" TIMESTAMP(3),
ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastProbeHttpStatus" INTEGER,
ADD COLUMN "lastProbeLatencyMs" INTEGER,
ADD COLUMN "lastProbeContentType" TEXT;

ALTER TABLE "StationStreamConfig"
ADD CONSTRAINT "StationStreamConfig_probe_interval_check" CHECK ("probeIntervalSeconds" BETWEEN 30 AND 3600),
ADD CONSTRAINT "StationStreamConfig_probe_timeout_check" CHECK ("probeTimeoutMs" BETWEEN 1000 AND 30000),
ADD CONSTRAINT "StationStreamConfig_consecutive_failures_check" CHECK ("consecutiveFailures" >= 0);

CREATE TABLE "StationStreamHealthSample" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "streamConfigId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "status" "StreamProbeStatus" NOT NULL,
    "latencyMs" INTEGER,
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationStreamHealthSample_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StationStreamHealthSample_window_check" CHECK ("observedAt" >= "bucketStart"),
    CONSTRAINT "StationStreamHealthSample_latency_check" CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0)
);

CREATE TABLE "StationStreamHealthIncident" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "status" "PlayerHealthIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "PlayerHealthIncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgementNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StationStreamHealthIncident_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StationStreamHealthIncident_window_check" CHECK ("lastObservedAt" >= "firstObservedAt"),
    CONSTRAINT "StationStreamHealthIncident_ack_check" CHECK ("status" <> 'ACKNOWLEDGED' OR "acknowledgedAt" IS NOT NULL),
    CONSTRAINT "StationStreamHealthIncident_resolution_check" CHECK (
      ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND length(trim("resolutionNote")) >= 3)
      OR
      ("status" <> 'RESOLVED' AND "resolvedAt" IS NULL)
    )
);

CREATE INDEX "StationStreamConfig_probeEnabled_lastProbeAt_idx"
ON "StationStreamConfig"("probeEnabled", "lastProbeAt");

CREATE UNIQUE INDEX "StationStreamHealthSample_streamConfigId_bucketStart_key"
ON "StationStreamHealthSample"("streamConfigId", "bucketStart");

CREATE INDEX "StationStreamHealthSample_organisation_observed_idx"
ON "StationStreamHealthSample"("organisationId", "observedAt");

CREATE INDEX "StationStreamHealthSample_station_observed_idx"
ON "StationStreamHealthSample"("stationId", "observedAt");

CREATE INDEX "StationStreamHealthSample_status_observed_idx"
ON "StationStreamHealthSample"("status", "observedAt");

CREATE INDEX "StationStreamHealthIncident_org_status_severity_idx"
ON "StationStreamHealthIncident"("organisationId", "status", "severity");

CREATE INDEX "StationStreamHealthIncident_station_status_idx"
ON "StationStreamHealthIncident"("stationId", "status");

CREATE INDEX "StationStreamHealthIncident_lastObservedAt_idx"
ON "StationStreamHealthIncident"("lastObservedAt");

CREATE UNIQUE INDEX "StationStreamHealthIncident_one_unresolved_per_station"
ON "StationStreamHealthIncident"("stationId")
WHERE "status" IN ('OPEN', 'ACKNOWLEDGED');

ALTER TABLE "StationStreamHealthSample"
ADD CONSTRAINT "StationStreamHealthSample_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StationStreamHealthSample"
ADD CONSTRAINT "StationStreamHealthSample_stationId_fkey"
FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StationStreamHealthSample"
ADD CONSTRAINT "StationStreamHealthSample_streamConfigId_fkey"
FOREIGN KEY ("streamConfigId") REFERENCES "StationStreamConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StationStreamHealthIncident"
ADD CONSTRAINT "StationStreamHealthIncident_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StationStreamHealthIncident"
ADD CONSTRAINT "StationStreamHealthIncident_stationId_fkey"
FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StationStreamHealthIncident"
ADD CONSTRAINT "StationStreamHealthIncident_acknowledgedById_fkey"
FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StationStreamHealthIncident"
ADD CONSTRAINT "StationStreamHealthIncident_resolvedById_fkey"
FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
