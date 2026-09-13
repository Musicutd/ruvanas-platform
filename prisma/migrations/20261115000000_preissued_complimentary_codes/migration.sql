ALTER TABLE "ComplimentaryAccessCode"
  ALTER COLUMN "organisationId" DROP NOT NULL,
  ADD COLUMN "recipientEmail" TEXT;

CREATE INDEX "ComplimentaryAccessCode_recipientEmail_status_createdAt_idx"
  ON "ComplimentaryAccessCode"("recipientEmail", "status", "createdAt");
