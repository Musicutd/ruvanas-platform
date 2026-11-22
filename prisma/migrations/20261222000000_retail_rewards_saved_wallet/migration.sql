-- Additive bookmark storage. Rollback: retain this unused table and unique
-- profile index when reverting application code; no existing records change.
CREATE UNIQUE INDEX "RewardPublicShopProfile_id_organisationId_key"
ON "RewardPublicShopProfile"("id", "organisationId");

CREATE TABLE "RewardSavedVoucher" (
  "id" TEXT NOT NULL,
  "shopperId" TEXT NOT NULL,
  "shopProfileId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardSavedVoucher_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardSavedVoucher_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "RewardShopper"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "RewardSavedVoucher_shopProfileId_organisationId_fkey" FOREIGN KEY ("shopProfileId", "organisationId") REFERENCES "RewardPublicShopProfile"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "RewardSavedVoucher_offerId_organisationId_fkey" FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOffer"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "RewardSavedVoucher_shopperId_shopProfileId_offerId_key" ON "RewardSavedVoucher"("shopperId", "shopProfileId", "offerId");
CREATE INDEX "RewardSavedVoucher_shopperId_createdAt_id_idx" ON "RewardSavedVoucher"("shopperId", "createdAt", "id");
CREATE INDEX "RewardSavedVoucher_shopProfileId_organisationId_idx" ON "RewardSavedVoucher"("shopProfileId", "organisationId");
CREATE INDEX "RewardSavedVoucher_offerId_organisationId_idx" ON "RewardSavedVoucher"("offerId", "organisationId");
