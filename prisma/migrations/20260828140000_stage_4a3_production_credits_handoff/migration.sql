CREATE TYPE "ProductionFundingStatus" AS ENUM ('LEGACY_UNMETERED', 'PENDING', 'RESERVED', 'CONSUMED', 'RELEASED');
CREATE TYPE "ProductionCreditEntryType" AS ENUM ('GRANT', 'PURCHASE', 'RESERVE', 'CONSUME', 'RELEASE', 'EXPIRY', 'ADJUSTMENT');

ALTER TYPE "ProductionOrderEventType" ADD VALUE IF NOT EXISTS 'FUNDING_CHANGED';
ALTER TYPE "ProductionOrderEventType" ADD VALUE IF NOT EXISTS 'PROMO_HANDOFF_CREATED';

ALTER TABLE "ProductionOrder"
  ADD COLUMN "fundingStatus" "ProductionFundingStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "promoAssetId" TEXT;

UPDATE "ProductionOrder" SET "fundingStatus" = 'LEGACY_UNMETERED';

CREATE TABLE "ProductionCreditLedgerEntry" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "orderId" TEXT,
  "actorUserId" TEXT,
  "sequence" INTEGER NOT NULL,
  "entryType" "ProductionCreditEntryType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "availableDelta" INTEGER NOT NULL,
  "reservedDelta" INTEGER NOT NULL,
  "availableAfter" INTEGER NOT NULL,
  "reservedAfter" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "externalReference" TEXT,
  "note" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionCreditLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionCreditLedgerEntry_quantity_check" CHECK ("quantity" <> 0),
  CONSTRAINT "ProductionCreditLedgerEntry_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "ProductionCreditLedgerEntry_available_check" CHECK ("availableAfter" >= 0),
  CONSTRAINT "ProductionCreditLedgerEntry_reserved_check" CHECK ("reservedAfter" >= 0)
);

CREATE UNIQUE INDEX "ProductionOrder_promoAssetId_key" ON "ProductionOrder"("promoAssetId");
CREATE UNIQUE INDEX "PromoVersion_promoAssetId_sourceReference_key" ON "PromoVersion"("promoAssetId", "sourceReference");
CREATE UNIQUE INDEX "ProductionCreditLedgerEntry_idempotencyKey_key" ON "ProductionCreditLedgerEntry"("idempotencyKey");
CREATE UNIQUE INDEX "ProductionCreditLedgerEntry_organisationId_sequence_key" ON "ProductionCreditLedgerEntry"("organisationId", "sequence");
CREATE INDEX "ProductionOrder_organisationId_fundingStatus_idx" ON "ProductionOrder"("organisationId", "fundingStatus");
CREATE INDEX "ProductionCreditLedgerEntry_organisationId_createdAt_idx" ON "ProductionCreditLedgerEntry"("organisationId", "createdAt");
CREATE INDEX "ProductionCreditLedgerEntry_orderId_createdAt_idx" ON "ProductionCreditLedgerEntry"("orderId", "createdAt");
CREATE INDEX "ProductionCreditLedgerEntry_actorUserId_createdAt_idx" ON "ProductionCreditLedgerEntry"("actorUserId", "createdAt");
CREATE INDEX "ProductionCreditLedgerEntry_entryType_createdAt_idx" ON "ProductionCreditLedgerEntry"("entryType", "createdAt");

ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_promoAssetId_fkey" FOREIGN KEY ("promoAssetId") REFERENCES "PromoAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionCreditLedgerEntry" ADD CONSTRAINT "ProductionCreditLedgerEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionCreditLedgerEntry" ADD CONSTRAINT "ProductionCreditLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionCreditLedgerEntry" ADD CONSTRAINT "ProductionCreditLedgerEntry_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


