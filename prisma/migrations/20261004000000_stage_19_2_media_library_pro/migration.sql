-- Stage 19.2: organisation-owned music, rights metadata and a shared review gate.
ALTER TYPE "MediaLibraryType" ADD VALUE 'ORGANISATION_MUSIC';

CREATE TYPE "MusicRightsBasis" AS ENUM ('OWNED_MASTER', 'DIRECT_LICENCE', 'DISTRIBUTOR_LICENCE', 'OTHER');
CREATE TYPE "MusicRightsReviewStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "MusicRightsUse" AS ENUM ('RETAIL_RADIO', 'SCHOOL_RADIO', 'ONLINE_RADIO');

ALTER TABLE "Track"
  ADD COLUMN "rightsBasis" "MusicRightsBasis",
  ADD COLUMN "permittedUses" "MusicRightsUse"[] NOT NULL DEFAULT ARRAY[]::"MusicRightsUse"[],
  ADD COLUMN "licenceStartsAt" DATE,
  ADD COLUMN "rightsReviewStatus" "MusicRightsReviewStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "rightsReviewNotes" TEXT,
  ADD COLUMN "rightsReviewedAt" TIMESTAMP(3),
  ADD COLUMN "rightsReviewedById" TEXT;

-- Existing Ruvanas catalogue tracks were already uploaded and confirmed by a
-- platform administrator. Preserve their current playout behaviour explicitly.
UPDATE "Track" AS track
SET
  "rightsBasis" = 'OTHER',
  "permittedUses" = ARRAY['RETAIL_RADIO', 'SCHOOL_RADIO', 'ONLINE_RADIO']::"MusicRightsUse"[],
  "rightsReviewStatus" = 'APPROVED',
  "rightsReviewedAt" = COALESCE(track."rightsConfirmedAt", track."updatedAt"),
  "rightsReviewedById" = track."rightsConfirmedById"
FROM "MediaAsset" AS asset
WHERE track."mediaAssetId" = asset."id"
  AND asset."libraryType" = 'RUVANAS_CATALOGUE';

CREATE INDEX "Track_rightsReviewStatus_idx" ON "Track"("rightsReviewStatus");
CREATE INDEX "Track_rightsReviewedById_idx" ON "Track"("rightsReviewedById");
CREATE INDEX "Track_licenceStartsAt_idx" ON "Track"("licenceStartsAt");

ALTER TABLE "Track" ADD CONSTRAINT "Track_rightsReviewedById_fkey"
  FOREIGN KEY ("rightsReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
