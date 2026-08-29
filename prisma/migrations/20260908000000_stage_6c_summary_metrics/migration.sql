CREATE TYPE "IntegrationMetricType" AS ENUM (
  'POS_NET_SALES_MINOR',
  'POS_TRANSACTION_COUNT',
  'INVENTORY_UNITS_ON_HAND',
  'INVENTORY_STOCKOUT_COUNT',
  'FOOTFALL_ENTRIES',
  'FOOTFALL_EXITS'
);

CREATE TABLE "IntegrationMetricSummary" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "metricType" "IntegrationMetricType" NOT NULL,
  "value" DECIMAL(20,4) NOT NULL,
  "unit" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "windowEndedAt" TIMESTAMP(3) NOT NULL,
  "sourceTimestamp" TIMESTAMP(3) NOT NULL,
  "dimensions" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IntegrationMetricSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationMetricSummary_connectionId_externalId_key"
  ON "IntegrationMetricSummary"("connectionId", "externalId");
CREATE INDEX "IntegrationMetricSummary_organisationId_sourceTimestamp_idx"
  ON "IntegrationMetricSummary"("organisationId", "sourceTimestamp");
CREATE INDEX "IntegrationMetricSummary_locationId_metricType_windowStartedAt_idx"
  ON "IntegrationMetricSummary"("locationId", "metricType", "windowStartedAt");
CREATE INDEX "IntegrationMetricSummary_connectionId_createdAt_idx"
  ON "IntegrationMetricSummary"("connectionId", "createdAt");

ALTER TABLE "IntegrationMetricSummary"
  ADD CONSTRAINT "IntegrationMetricSummary_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationMetricSummary"
  ADD CONSTRAINT "IntegrationMetricSummary_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationMetricSummary"
  ADD CONSTRAINT "IntegrationMetricSummary_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
