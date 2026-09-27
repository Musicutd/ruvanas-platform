-- A private, approved programme can be the last-resort facility source.
-- This is not the public AutoDJ path and creates no public rights grant.
ALTER TYPE "CorrectionsNetworkWindowKind" ADD VALUE 'FALLBACK';

ALTER TABLE "ProofOfPlayEvent" DROP CONSTRAINT "ProofOfPlayEvent_item_shape_check";
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_item_shape_check" CHECK (
  ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NULL)
  OR ("itemType" = 'PROMO' AND "trackId" IS NULL AND "campaignId" IS NOT NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'SCHOOL_ANNOUNCEMENT' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NOT NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" = 'CORRECTIONS_REQUEST')
  OR ("itemType" = 'CORRECTIONS_AUDIO' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" IN (
    'CORRECTIONS_REQUEST', 'CORRECTIONS_REHABILITATION', 'CORRECTIONS_STANDARD', 'CORRECTIONS_PRIORITY', 'CORRECTIONS_EMERGENCY',
    'CORRECTIONS_CENTRAL', 'CORRECTIONS_LOCAL', 'CORRECTIONS_SYNDICATED', 'CORRECTIONS_CENTRAL_REHAB', 'CORRECTIONS_CENTRAL_ANNOUNCE',
    'CORRECTIONS_FALLBACK'
  ))
);
