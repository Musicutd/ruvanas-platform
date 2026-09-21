ALTER TABLE "Track"
  ADD COLUMN "mixName" TEXT,
  ADD COLUMN "bpm" INTEGER;

ALTER TABLE "Track"
  ADD CONSTRAINT "Track_bpm_check" CHECK ("bpm" IS NULL OR ("bpm" >= 20 AND "bpm" <= 300));
