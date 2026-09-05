CREATE TYPE "ListenerAnalyticsEventType" AS ENUM ('SESSION_STARTED', 'HEARTBEAT', 'SESSION_ENDED', 'PLAYBACK_ERROR');

CREATE TABLE "ListenerAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sessionHash" CHAR(64) NOT NULL,
    "eventType" "ListenerAnalyticsEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listeningSeconds" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ListenerAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListenerAnalyticsHourlyAggregate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "sessionStartedCount" INTEGER NOT NULL DEFAULT 0,
    "sessionEndedCount" INTEGER NOT NULL DEFAULT 0,
    "heartbeatCount" INTEGER NOT NULL DEFAULT 0,
    "playbackErrorCount" INTEGER NOT NULL DEFAULT 0,
    "listeningSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastEventReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListenerAnalyticsHourlyAggregate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListenerAnalyticsAggregationCursor" (
    "organisationId" TEXT NOT NULL,
    "lastEventReceivedAt" TIMESTAMP(3),
    "lastEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListenerAnalyticsAggregationCursor_pkey" PRIMARY KEY ("organisationId")
);

CREATE UNIQUE INDEX "ListenerAnalyticsEvent_channelId_clientEventId_key" ON "ListenerAnalyticsEvent"("channelId", "clientEventId");
CREATE INDEX "ListenerAnalyticsEvent_organisationId_receivedAt_id_idx" ON "ListenerAnalyticsEvent"("organisationId", "receivedAt", "id");
CREATE INDEX "ListenerAnalyticsEvent_organisationId_channelId_occurredAt_idx" ON "ListenerAnalyticsEvent"("organisationId", "channelId", "occurredAt");
CREATE INDEX "ListenerAnalyticsEvent_channelId_sessionHash_occurredAt_idx" ON "ListenerAnalyticsEvent"("channelId", "sessionHash", "occurredAt");
CREATE UNIQUE INDEX "ListenerAnalyticsHourlyAggregate_organisationId_channelId_bucketStart_key" ON "ListenerAnalyticsHourlyAggregate"("organisationId", "channelId", "bucketStart");
CREATE INDEX "ListenerAnalyticsHourlyAggregate_organisationId_bucketStart_idx" ON "ListenerAnalyticsHourlyAggregate"("organisationId", "bucketStart");
CREATE INDEX "ListenerAnalyticsHourlyAggregate_channelId_bucketStart_idx" ON "ListenerAnalyticsHourlyAggregate"("channelId", "bucketStart");

ALTER TABLE "ListenerAnalyticsEvent" ADD CONSTRAINT "ListenerAnalyticsEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerAnalyticsEvent" ADD CONSTRAINT "ListenerAnalyticsEvent_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerAnalyticsHourlyAggregate" ADD CONSTRAINT "ListenerAnalyticsHourlyAggregate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerAnalyticsHourlyAggregate" ADD CONSTRAINT "ListenerAnalyticsHourlyAggregate_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerAnalyticsAggregationCursor" ADD CONSTRAINT "ListenerAnalyticsAggregationCursor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
