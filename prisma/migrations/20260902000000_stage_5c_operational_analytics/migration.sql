CREATE TABLE "AnalyticsHourlyAggregate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "zoneName" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "plannedCount" INTEGER NOT NULL DEFAULT 0,
    "campaignPlannedCount" INTEGER NOT NULL DEFAULT 0,
    "schoolPlannedCount" INTEGER NOT NULL DEFAULT 0,
    "playbackStartedCount" INTEGER NOT NULL DEFAULT 0,
    "playbackCompletedCount" INTEGER NOT NULL DEFAULT 0,
    "playbackFailedCount" INTEGER NOT NULL DEFAULT 0,
    "playbackInterruptedCount" INTEGER NOT NULL DEFAULT 0,
    "musicCompletedCount" INTEGER NOT NULL DEFAULT 0,
    "promoCompletedCount" INTEGER NOT NULL DEFAULT 0,
    "schoolCompletedCount" INTEGER NOT NULL DEFAULT 0,
    "heartbeatCount" INTEGER NOT NULL DEFAULT 0,
    "firstHeartbeatAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsHourlyAggregate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnalyticsHourlyAggregate_non_negative_counts_check" CHECK (
      "plannedCount" >= 0 AND "campaignPlannedCount" >= 0 AND "schoolPlannedCount" >= 0 AND
      "playbackStartedCount" >= 0 AND "playbackCompletedCount" >= 0 AND
      "playbackFailedCount" >= 0 AND "playbackInterruptedCount" >= 0 AND
      "musicCompletedCount" >= 0 AND "promoCompletedCount" >= 0 AND
      "schoolCompletedCount" >= 0 AND "heartbeatCount" >= 0
    ),
    CONSTRAINT "AnalyticsHourlyAggregate_hour_bucket_check" CHECK (
      date_trunc('hour', "bucketStart") = "bucketStart"
    )
);

CREATE TABLE "AnalyticsAggregationCursor" (
    "organisationId" TEXT NOT NULL,
    "lastIntentCreatedAt" TIMESTAMP(3),
    "lastIntentId" TEXT,
    "lastProofReceivedAt" TIMESTAMP(3),
    "lastProofEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsAggregationCursor_pkey" PRIMARY KEY ("organisationId")
);

CREATE UNIQUE INDEX "AnalyticsHourlyAggregate_organisationId_playerId_bucketStart_key"
ON "AnalyticsHourlyAggregate"("organisationId", "playerId", "bucketStart");

CREATE INDEX "AnalyticsHourlyAggregate_organisationId_bucketStart_idx"
ON "AnalyticsHourlyAggregate"("organisationId", "bucketStart");

CREATE INDEX "AnalyticsHourlyAggregate_organisationId_locationId_bucketStart_idx"
ON "AnalyticsHourlyAggregate"("organisationId", "locationId", "bucketStart");

CREATE INDEX "AnalyticsHourlyAggregate_organisationId_zoneId_bucketStart_idx"
ON "AnalyticsHourlyAggregate"("organisationId", "zoneId", "bucketStart");

ALTER TABLE "AnalyticsHourlyAggregate"
ADD CONSTRAINT "AnalyticsHourlyAggregate_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsAggregationCursor"
ADD CONSTRAINT "AnalyticsAggregationCursor_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
