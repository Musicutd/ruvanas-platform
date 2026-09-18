ALTER TABLE "StationStreamConfig"
  ADD COLUMN "sourcePort" INTEGER,
  ADD COLUMN "sourceUsername" TEXT,
  ADD COLUMN "outboundAutoDjEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "encoderLeaseOwner" TEXT,
  ADD COLUMN "encoderLeaseUntil" TIMESTAMP(3);

CREATE INDEX "StationStreamConfig_outboundAutoDjEnabled_encoderLeaseUntil_idx"
  ON "StationStreamConfig"("outboundAutoDjEnabled", "encoderLeaseUntil");
