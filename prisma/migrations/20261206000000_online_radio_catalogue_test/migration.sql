CREATE TABLE "OnlineRadioCatalogueTest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stationId" TEXT NOT NULL REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisationId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREPARED',
  "origin" TEXT NOT NULL,
  "territory" TEXT NOT NULL DEFAULT 'MT',
  "catalogueLevel" TEXT NOT NULL DEFAULT 'FOCUSED',
  "durationSeconds" INTEGER NOT NULL DEFAULT 300,
  "authorization" JSONB NOT NULL,
  "plan" JSONB NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "requestedAt" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3),
  "publicExposureAcceptedAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "stopRequestedAt" TIMESTAMP(3),
  "endedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalogue_test_duration_bound" CHECK ("durationSeconds" BETWEEN 1 AND 300),
  CONSTRAINT "catalogue_test_status" CHECK ("status" IN ('PREPARED','ARMED','RUNNING','STOPPED','COMPLETE','FAILED','EXPIRED')),
  CONSTRAINT "catalogue_test_deadline" CHECK ("deadlineAt" IS NULL OR ("requestedAt" IS NOT NULL AND "deadlineAt" > "requestedAt" AND "deadlineAt" <= "requestedAt" + INTERVAL '300 seconds' AND "deadlineAt" <= "expiresAt"))
);
CREATE INDEX "OnlineRadioCatalogueTest_stationId_status_createdAt_idx" ON "OnlineRadioCatalogueTest"("stationId", "status", "createdAt");
CREATE INDEX "OnlineRadioCatalogueTest_status_expiresAt_idx" ON "OnlineRadioCatalogueTest"("status", "expiresAt");
CREATE UNIQUE INDEX "catalogue_test_one_active_per_station" ON "OnlineRadioCatalogueTest"("stationId") WHERE "status" IN ('ARMED','RUNNING');
CREATE TABLE "OnlineRadioCatalogueTestEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "testId" TEXT NOT NULL REFERENCES "OnlineRadioCatalogueTest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "eventKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "trackId" TEXT,
  "details" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OnlineRadioCatalogueTestEvent_testId_eventKey_key" ON "OnlineRadioCatalogueTestEvent"("testId", "eventKey");
CREATE INDEX "OnlineRadioCatalogueTestEvent_testId_occurredAt_idx" ON "OnlineRadioCatalogueTestEvent"("testId", "occurredAt");
