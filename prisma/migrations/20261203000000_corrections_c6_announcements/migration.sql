CREATE TYPE "CorrectionsAnnouncementStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');
CREATE TYPE "CorrectionsAnnouncementApprovalMode" AS ENUM ('CREATOR_PUBLISH', 'EXPLICIT', 'DUAL');
CREATE TYPE "CorrectionsOverrideType" AS ENUM ('PRIORITY', 'EMERGENCY');
CREATE TYPE "CorrectionsOverrideStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CLEARED', 'SUPERSEDED', 'EXPIRED');

ALTER TABLE "CorrectionsFacility"
  ADD COLUMN "announcementApprovalMode" "CorrectionsAnnouncementApprovalMode" NOT NULL DEFAULT 'EXPLICIT',
  ADD COLUMN "priorityEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergencyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergencyDualControl" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergencyDrillsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CorrectionsFacilityGrant"
  ADD COLUMN "canPriorityActivate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canPriorityStop" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canEmergencyActivate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canEmergencyClear" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CorrectionsAnnouncement" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "promoVersionId" TEXT NOT NULL,
  "status" "CorrectionsAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "secondApproverUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "CorrectionsAnnouncement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorrectionsAnnouncement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsAnnouncement_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsAnnouncement_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsAnnouncement_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsAnnouncement_approval_check" CHECK (
    ("status" = 'DRAFT' AND "approvedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'ARCHIVED') AND "approvedAt" IS NOT NULL)
  )
);
CREATE INDEX "CorrectionsAnnouncement_organisationId_facilityId_status_idx" ON "CorrectionsAnnouncement"("organisationId", "facilityId", "status");

CREATE TABLE "CorrectionsOverride" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "type" "CorrectionsOverrideType" NOT NULL,
  "status" "CorrectionsOverrideStatus" NOT NULL DEFAULT 'ACTIVE',
  "category" TEXT NOT NULL,
  "drill" BOOLEAN NOT NULL DEFAULT false,
  "targetZoneIds" TEXT[] NOT NULL,
  "targetPlayerIds" TEXT[] NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "initiatedByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "endedByUserId" TEXT,
  CONSTRAINT "CorrectionsOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorrectionsOverride_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsOverride_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsOverride_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "CorrectionsAnnouncement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsOverride_window_check" CHECK ("expiresAt" > "startedAt"),
  CONSTRAINT "CorrectionsOverride_targets_check" CHECK (cardinality("targetZoneIds") > 0 AND cardinality("targetPlayerIds") > 0)
);
CREATE UNIQUE INDEX "CorrectionsOverride_organisationId_idempotencyKey_key" ON "CorrectionsOverride"("organisationId", "idempotencyKey");
CREATE INDEX "CorrectionsOverride_organisationId_facilityId_status_expire_idx" ON "CorrectionsOverride"("organisationId", "facilityId", "status", "expiresAt");

ALTER TABLE "PlayoutIntent"
  ADD COLUMN "correctionsAnnouncementId" TEXT,
  ADD COLUMN "correctionsOverrideId" TEXT;
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_correctionsAnnouncementId_fkey"
  FOREIGN KEY ("correctionsAnnouncementId") REFERENCES "CorrectionsAnnouncement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_correctionsOverrideId_fkey"
  FOREIGN KEY ("correctionsOverrideId") REFERENCES "CorrectionsOverride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PlayoutIntent_correctionsAnnouncementId_plannedStart_idx" ON "PlayoutIntent"("correctionsAnnouncementId", "plannedStart");
CREATE INDEX "PlayoutIntent_correctionsOverrideId_plannedStart_idx" ON "PlayoutIntent"("correctionsOverrideId", "plannedStart");

ALTER TABLE "PlayoutIntent" DROP CONSTRAINT "PlayoutIntent_corrections_target_check";
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_corrections_target_check" CHECK (
  ("correctionsAnnouncementId" IS NULL AND "correctionsOverrideId" IS NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NULL AND "correctionsSubmissionId" IS NULL AND "correctionsTrackId" IS NULL)
  OR ("correctionsAnnouncementId" IS NULL AND "correctionsOverrideId" IS NULL AND "correctionsProgrammeId" IS NOT NULL AND "correctionsSubmissionId" IS NOT NULL AND (("correctionsRequestId" IS NOT NULL AND "correctionsRehabContentId" IS NULL) OR ("correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NOT NULL)))
  OR ("correctionsAnnouncementId" IS NOT NULL AND "correctionsRequestId" IS NULL AND "correctionsRehabContentId" IS NULL AND "correctionsProgrammeId" IS NULL AND "correctionsSubmissionId" IS NULL AND "correctionsTrackId" IS NULL)
);
ALTER TABLE "PlayoutIntent" DROP CONSTRAINT "PlayoutIntent_source_check";
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_source_check" CHECK (
  (("campaignId" IS NOT NULL)::int + ("schoolBroadcastSlotId" IS NOT NULL)::int + ("correctionsRequestId" IS NOT NULL)::int + ("correctionsRehabContentId" IS NOT NULL)::int + ("correctionsAnnouncementId" IS NOT NULL)::int) = 1
);
ALTER TABLE "ProofOfPlayEvent" DROP CONSTRAINT "ProofOfPlayEvent_item_shape_check";
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_item_shape_check" CHECK (
  ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NULL)
  OR ("itemType" = 'PROMO' AND "trackId" IS NULL AND "campaignId" IS NOT NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'SCHOOL_ANNOUNCEMENT' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NOT NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" = 'CORRECTIONS_REQUEST')
  OR ("itemType" = 'CORRECTIONS_AUDIO' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "playoutIntentId" IS NOT NULL AND "programmingSource" IN ('CORRECTIONS_REQUEST', 'CORRECTIONS_REHABILITATION', 'CORRECTIONS_STANDARD', 'CORRECTIONS_PRIORITY', 'CORRECTIONS_EMERGENCY'))
);
