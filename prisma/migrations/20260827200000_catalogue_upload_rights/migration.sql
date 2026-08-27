ALTER TABLE "Track"
  ADD COLUMN "rightsHolder" TEXT,
  ADD COLUMN "rightsReference" TEXT,
  ADD COLUMN "permittedTerritories" TEXT,
  ADD COLUMN "licenceExpiresAt" DATE,
  ADD COLUMN "rightsConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "rightsConfirmedById" TEXT;

CREATE INDEX "Track_rightsConfirmedById_idx" ON "Track"("rightsConfirmedById");
CREATE INDEX "Track_licenceExpiresAt_idx" ON "Track"("licenceExpiresAt");

ALTER TABLE "Track"
  ADD CONSTRAINT "Track_rightsConfirmedById_fkey"
  FOREIGN KEY ("rightsConfirmedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

