-- C7 reuses the private PlayoutIntent / ProofOfPlayEvent path. Extend only
-- its CHECK constraints for version-pinned network programme playback;
-- existing campaign, School and C5/C6 Corrections rows remain valid.
ALTER TABLE "PlayoutIntent" DROP CONSTRAINT "PlayoutIntent_corrections_target_check";
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_corrections_target_check" CHECK (
  ("correctionsAnnouncementId" IS NULL AND "correctionsOverrideId" IS NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NULL AND "correctionsSubmissionId" IS NULL AND "correctionsTrackId" IS NULL)
  OR ("correctionsAnnouncementId" IS NULL AND "correctionsOverrideId" IS NULL AND "correctionsProgrammeId" IS NOT NULL AND "correctionsSubmissionId" IS NOT NULL AND (("correctionsRequestId" IS NOT NULL AND "correctionsRehabContentId" IS NULL) OR ("correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NOT NULL)))
  OR ("correctionsAnnouncementId" IS NOT NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NULL AND "correctionsSubmissionId" IS NULL AND "correctionsTrackId" IS NULL)
  OR ("correctionsAnnouncementId" IS NULL AND "correctionsOverrideId" IS NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NOT NULL AND "correctionsSubmissionId" IS NOT NULL AND "correctionsTrackId" IS NULL AND "sourceRevision" LIKE 'c7:%')
);

ALTER TABLE "PlayoutIntent" DROP CONSTRAINT "PlayoutIntent_source_check";
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_source_check" CHECK (
  (("campaignId" IS NOT NULL)::int + ("schoolBroadcastSlotId" IS NOT NULL)::int + ("correctionsRequestId" IS NOT NULL)::int + ("correctionsRehabContentId" IS NOT NULL)::int + ("correctionsAnnouncementId" IS NOT NULL)::int
    + ("correctionsProgrammeId" IS NOT NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL)::int) = 1
);

ALTER TABLE "ProofOfPlayEvent" DROP CONSTRAINT "ProofOfPlayEvent_item_shape_check";
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_item_shape_check" CHECK (
  ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NULL)
  OR ("itemType" = 'PROMO' AND "trackId" IS NULL AND "campaignId" IS NOT NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'SCHOOL_ANNOUNCEMENT' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NOT NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" = 'CORRECTIONS_REQUEST')
  OR ("itemType" = 'CORRECTIONS_AUDIO' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" IN ('CORRECTIONS_REQUEST', 'CORRECTIONS_REHABILITATION', 'CORRECTIONS_STANDARD', 'CORRECTIONS_PRIORITY', 'CORRECTIONS_EMERGENCY', 'CORRECTIONS_CENTRAL', 'CORRECTIONS_LOCAL'))
);
