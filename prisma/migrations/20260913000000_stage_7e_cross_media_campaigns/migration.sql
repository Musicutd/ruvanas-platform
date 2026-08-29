ALTER TABLE "RetailMediaOrder"
ADD COLUMN "fulfilledByUserId" TEXT,
ADD COLUMN "fulfilledAt" TIMESTAMP(3),
ADD COLUMN "fulfilmentRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "fulfilmentConfigurationHash" TEXT;

CREATE INDEX "RetailMediaOrder_fulfilledByUserId_idx" ON "RetailMediaOrder"("fulfilledByUserId");

ALTER TABLE "RetailMediaOrder"
ADD CONSTRAINT "RetailMediaOrder_fulfilledByUserId_fkey"
FOREIGN KEY ("fulfilledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
