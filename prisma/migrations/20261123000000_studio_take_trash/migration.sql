ALTER TABLE "AudioTake"
  ADD COLUMN "trashedAt" TIMESTAMP(3),
  ADD COLUMN "purgeAfter" TIMESTAMP(3),
  ADD COLUMN "permanentlyDeletedAt" TIMESTAMP(3);

CREATE INDEX "AudioTake_organisationId_trashedAt_idx"
  ON "AudioTake"("organisationId", "trashedAt");

CREATE INDEX "AudioTake_purgeAfter_permanentlyDeletedAt_idx"
  ON "AudioTake"("purgeAfter", "permanentlyDeletedAt");

