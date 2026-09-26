-- C5.1 attaches governed Corrections delivery to the existing per-player
-- PlayoutIntent and signed ProofOfPlayEvent path. Existing intent rows are unchanged.
ALTER TABLE "PlayoutIntent"
  ADD COLUMN "correctionsRequestId" TEXT,
  ADD COLUMN "correctionsRehabContentId" TEXT,
  ADD COLUMN "correctionsProgrammeId" TEXT,
  ADD COLUMN "correctionsSubmissionId" TEXT,
  ADD COLUMN "correctionsTrackId" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_correctionsRequestId_fkey"
  FOREIGN KEY ("correctionsRequestId") REFERENCES "CorrectionsRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_correctionsRehabContentId_fkey"
  FOREIGN KEY ("correctionsRehabContentId") REFERENCES "CorrectionsRehabContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_correctionsProgrammeId_fkey"
  FOREIGN KEY ("correctionsProgrammeId") REFERENCES "CorrectionsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_correctionsSubmissionId_fkey"
  FOREIGN KEY ("correctionsSubmissionId") REFERENCES "CorrectionsSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_correctionsTrackId_fkey"
  FOREIGN KEY ("correctionsTrackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PlayoutIntent_correctionsRequestId_plannedStart_idx" ON "PlayoutIntent"("correctionsRequestId", "plannedStart");
CREATE INDEX "PlayoutIntent_correctionsRehabContentId_plannedStart_idx" ON "PlayoutIntent"("correctionsRehabContentId", "plannedStart");
CREATE INDEX "PlayoutIntent_correctionsProgrammeId_plannedStart_idx" ON "PlayoutIntent"("correctionsProgrammeId", "plannedStart");

ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_corrections_target_check" CHECK (
  ("correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NULL AND "correctionsSubmissionId" IS NULL AND "correctionsTrackId" IS NULL)
  OR
  ("correctionsProgrammeId" IS NOT NULL AND "correctionsSubmissionId" IS NOT NULL
    AND (("correctionsRequestId" IS NOT NULL AND "correctionsRehabContentId" IS NULL)
      OR ("correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NOT NULL)))
);

-- Preserve the original campaign/school one-source rule for existing rows,
-- while allowing exactly one guarded Corrections source for C5.1 intents.
ALTER TABLE "PlayoutIntent" DROP CONSTRAINT "PlayoutIntent_source_check";
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_source_check" CHECK (
  (("campaignId" IS NOT NULL)::int + ("schoolBroadcastSlotId" IS NOT NULL)::int
    + ("correctionsRequestId" IS NOT NULL)::int + ("correctionsRehabContentId" IS NOT NULL)::int) = 1
);

-- A signed Corrections completion uses the same evidence table, but only
-- its pinned per-player intent may supply the source. Older event shapes
-- remain exactly as before.
ALTER TABLE "ProofOfPlayEvent" DROP CONSTRAINT "ProofOfPlayEvent_item_shape_check";
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_item_shape_check" CHECK (
  ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NULL)
  OR ("itemType" = 'PROMO' AND "trackId" IS NULL AND "campaignId" IS NOT NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'SCHOOL_ANNOUNCEMENT' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NOT NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" = 'CORRECTIONS_REQUEST')
  OR ("itemType" = 'CORRECTIONS_AUDIO' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" IN ('CORRECTIONS_REQUEST', 'CORRECTIONS_REHABILITATION'))
);
