CREATE TYPE "ComplimentaryAccessStatus" AS ENUM ('ISSUED', 'ACTIVE', 'REVOKED');

CREATE TABLE "ComplimentaryAccessCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeSuffix" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "ComplimentaryAccessStatus" NOT NULL DEFAULT 'ISSUED',
  "note" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "redeemedByUserId" TEXT,
  "revokedByUserId" TEXT,
  "redeemedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplimentaryAccessCode_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Subscription"
  ADD COLUMN "complimentaryAccessCodeId" TEXT,
  ADD COLUMN "complimentaryAccessActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "complimentaryAccessActivatedAt" TIMESTAMP(3),
  ADD COLUMN "complimentaryPlanName" TEXT,
  ADD COLUMN "complimentaryPlanCode" TEXT,
  ADD COLUMN "complimentaryStationLimit" INTEGER,
  ADD COLUMN "complimentaryStorageLimitGb" INTEGER,
  ADD COLUMN "complimentaryListenerLimit" INTEGER,
  ADD COLUMN "complimentaryMaxBitrateKbps" INTEGER,
  ADD COLUMN "complimentaryIncludesCatalogue" BOOLEAN,
  ADD COLUMN "complimentaryPromoUploadEnabled" BOOLEAN,
  ADD COLUMN "complimentarySchoolRadioEnabled" BOOLEAN,
  ADD COLUMN "complimentarySchoolPublicPublishingEnabled" BOOLEAN,
  ADD COLUMN "complimentaryRetailMediaEnabled" BOOLEAN,
  ADD COLUMN "complimentaryDigitalSignageEnabled" BOOLEAN;

CREATE UNIQUE INDEX "ComplimentaryAccessCode_codeHash_key" ON "ComplimentaryAccessCode"("codeHash");
CREATE INDEX "ComplimentaryAccessCode_organisationId_status_createdAt_idx" ON "ComplimentaryAccessCode"("organisationId", "status", "createdAt");
CREATE INDEX "ComplimentaryAccessCode_planId_status_idx" ON "ComplimentaryAccessCode"("planId", "status");
CREATE UNIQUE INDEX "Subscription_complimentaryAccessCodeId_key" ON "Subscription"("complimentaryAccessCodeId");

ALTER TABLE "ComplimentaryAccessCode" ADD CONSTRAINT "ComplimentaryAccessCode_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplimentaryAccessCode" ADD CONSTRAINT "ComplimentaryAccessCode_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplimentaryAccessCode" ADD CONSTRAINT "ComplimentaryAccessCode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplimentaryAccessCode" ADD CONSTRAINT "ComplimentaryAccessCode_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplimentaryAccessCode" ADD CONSTRAINT "ComplimentaryAccessCode_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_complimentaryAccessCodeId_fkey" FOREIGN KEY ("complimentaryAccessCodeId") REFERENCES "ComplimentaryAccessCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
