CREATE TABLE "PreprovisionedRadioStream" (
  "id" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL DEFAULT 'CENTOVA_CAST',
  "centovaUsername" TEXT NOT NULL,
  "streamUrl" TEXT NOT NULL,
  "serverHost" TEXT NOT NULL,
  "serverPort" INTEGER NOT NULL,
  "sourcePort" INTEGER NOT NULL,
  "sourceUsername" TEXT,
  "sourcePasswordEncrypted" TEXT,
  "listenerLimit" INTEGER NOT NULL,
  "maxBitrateKbps" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUARANTINED',
  "verifiedAt" TIMESTAMP(3),
  "stationId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PreprovisionedRadioStream_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PreprovisionedRadioStream_status_check" CHECK ("status" IN ('AVAILABLE', 'CLAIMED', 'QUARANTINED', 'RETIRED')),
  CONSTRAINT "PreprovisionedRadioStream_ports_check" CHECK ("serverPort" BETWEEN 1 AND 65535 AND "sourcePort" BETWEEN 1 AND 65535),
  CONSTRAINT "PreprovisionedRadioStream_limits_check" CHECK ("listenerLimit" > 0 AND "maxBitrateKbps" BETWEEN 8 AND 320),
  CONSTRAINT "PreprovisionedRadioStream_ready_check" CHECK (
    "status" NOT IN ('AVAILABLE', 'CLAIMED') OR
    ("verifiedAt" IS NOT NULL AND "sourcePasswordEncrypted" IS NOT NULL AND "sourcePasswordEncrypted" <> '')
  ),
  CONSTRAINT "PreprovisionedRadioStream_claim_check" CHECK (
    ("status" = 'CLAIMED' AND "stationId" IS NOT NULL AND "claimedAt" IS NOT NULL) OR
    ("status" <> 'CLAIMED' AND "stationId" IS NULL AND "claimedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "PreprovisionedRadioStream_centovaUsername_key" ON "PreprovisionedRadioStream"("centovaUsername");
CREATE UNIQUE INDEX "PreprovisionedRadioStream_streamUrl_key" ON "PreprovisionedRadioStream"("streamUrl");
CREATE UNIQUE INDEX "PreprovisionedRadioStream_stationId_key" ON "PreprovisionedRadioStream"("stationId");
CREATE UNIQUE INDEX "PreprovisionedRadioStream_serverHost_sourcePort_key" ON "PreprovisionedRadioStream"("serverHost", "sourcePort");
CREATE INDEX "PreprovisionedRadioStream_status_maxBitrateKbps_listenerLim_idx" ON "PreprovisionedRadioStream"("status", "maxBitrateKbps", "listenerLimit");
