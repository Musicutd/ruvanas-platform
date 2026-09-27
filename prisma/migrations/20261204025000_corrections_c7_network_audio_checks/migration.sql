-- C7 central rehabilitation and standard announcements use a version-pinned
-- network intent without a Corrections programme/submission. Preserve every
-- previously accepted C5/C6/C7 shape and reject mixed targets.
ALTER TABLE "PlayoutIntent" DROP CONSTRAINT "PlayoutIntent_corrections_target_check";
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_corrections_target_check" CHECK (
  ("correctionsAnnouncementId" IS NULL AND "correctionsOverrideId" IS NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NULL AND "correctionsSubmissionId" IS NULL AND "correctionsTrackId" IS NULL)
  OR ("correctionsAnnouncementId" IS NULL AND "correctionsOverrideId" IS NULL AND "correctionsProgrammeId" IS NOT NULL AND "correctionsSubmissionId" IS NOT NULL AND (("correctionsRequestId" IS NOT NULL AND "correctionsRehabContentId" IS NULL) OR ("correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NOT NULL)))
  OR ("correctionsAnnouncementId" IS NOT NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NULL AND "correctionsSubmissionId" IS NULL AND "correctionsTrackId" IS NULL)
  OR ("correctionsAnnouncementId" IS NULL AND "correctionsOverrideId" IS NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NOT NULL AND "correctionsSubmissionId" IS NOT NULL AND "correctionsTrackId" IS NULL AND "sourceRevision" LIKE 'c7:%')
  OR ("correctionsOverrideId" IS NULL AND "correctionsRequestId" IS NULL AND "correctionsProgrammeId" IS NULL AND "correctionsSubmissionId" IS NULL AND "correctionsTrackId" IS NULL
      AND (("correctionsAnnouncementId" IS NOT NULL AND "correctionsRehabContentId" IS NULL) OR ("correctionsAnnouncementId" IS NULL AND "correctionsRehabContentId" IS NOT NULL))
      AND "sourceRevision" LIKE 'c7a:%')
);

ALTER TABLE "ProofOfPlayEvent" DROP CONSTRAINT "ProofOfPlayEvent_item_shape_check";
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_item_shape_check" CHECK (
  ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NULL)
  OR ("itemType" = 'PROMO' AND "trackId" IS NULL AND "campaignId" IS NOT NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'SCHOOL_ANNOUNCEMENT' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NOT NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" = 'CORRECTIONS_REQUEST')
  OR ("itemType" = 'CORRECTIONS_AUDIO' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" IN (
    'CORRECTIONS_REQUEST', 'CORRECTIONS_REHABILITATION', 'CORRECTIONS_STANDARD', 'CORRECTIONS_PRIORITY', 'CORRECTIONS_EMERGENCY',
    'CORRECTIONS_CENTRAL', 'CORRECTIONS_LOCAL', 'CORRECTIONS_SYNDICATED', 'CORRECTIONS_CENTRAL_REHAB', 'CORRECTIONS_CENTRAL_ANNOUNCE'
  ))
);
