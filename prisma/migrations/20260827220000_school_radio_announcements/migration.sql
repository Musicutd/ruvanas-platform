-- Phase 3E: staff-managed school announcements and approved broadcast slots.
ALTER TYPE "PlaybackItemType" ADD VALUE IF NOT EXISTS 'SCHOOL_ANNOUNCEMENT';

CREATE TYPE "SchoolPublishingPolicy" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');
CREATE TYPE "SchoolAnnouncementStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "SchoolBroadcastSlotStatus" AS ENUM ('APPROVED', 'CANCELLED', 'COMPLETED');

ALTER TABLE "Plan" ADD COLUMN "schoolRadioEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SchoolProfile" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "displayName" TEXT,
  "publishingPolicy" "SchoolPublishingPolicy" NOT NULL DEFAULT 'PRIVATE',
  "policyVersion" TEXT NOT NULL DEFAULT 'school-radio-v1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolAnnouncement" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "promoVersionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "status" "SchoolAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "policyVersion" TEXT NOT NULL DEFAULT 'school-radio-v1',
  "createdByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolBroadcastSlot" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "locationId" TEXT,
  "zoneId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "SchoolBroadcastSlotStatus" NOT NULL DEFAULT 'APPROVED',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "approvedByUserId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolBroadcastSlot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PlayoutIntent"
  ALTER COLUMN "campaignId" DROP NOT NULL,
  ADD COLUMN "schoolBroadcastSlotId" TEXT;

ALTER TABLE "ProofOfPlayEvent"
  ADD COLUMN "schoolBroadcastSlotId" TEXT;

DROP CONSTRAINT IF EXISTS "ProofOfPlayEvent_item_shape_check" ON "ProofOfPlayEvent";

ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_item_shape_check" CHECK (
  ("itemType" = 'MUSIC' AND "trackId" IS NOT NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NULL AND "playoutIntentId" IS NULL)
  OR
  ("itemType" = 'PROMO' AND "trackId" IS NULL AND "campaignId" IS NOT NULL AND "schoolBroadcastSlotId" IS NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
  OR
  ("itemType" = 'SCHOOL_ANNOUNCEMENT' AND "trackId" IS NULL AND "campaignId" IS NULL AND "schoolBroadcastSlotId" IS NOT NULL AND "promoVersionId" IS NOT NULL AND "playoutIntentId" IS NOT NULL)
);

ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_source_check" CHECK (
  (("campaignId" IS NOT NULL)::int + ("schoolBroadcastSlotId" IS NOT NULL)::int) = 1
);
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_target_check" CHECK (
  (("locationId" IS NOT NULL)::int + ("zoneId" IS NOT NULL)::int) = 1
);
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_time_check" CHECK ("startsAt" < "endsAt");
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_revision_check" CHECK ("revision" > 0);

CREATE UNIQUE INDEX "SchoolProfile_organisationId_key" ON "SchoolProfile"("organisationId");
CREATE INDEX "SchoolProfile_publishingPolicy_idx" ON "SchoolProfile"("publishingPolicy");
CREATE INDEX "SchoolAnnouncement_organisationId_status_idx" ON "SchoolAnnouncement"("organisationId", "status");
CREATE INDEX "SchoolAnnouncement_promoVersionId_idx" ON "SchoolAnnouncement"("promoVersionId");
CREATE INDEX "SchoolAnnouncement_createdByUserId_idx" ON "SchoolAnnouncement"("createdByUserId");
CREATE INDEX "SchoolAnnouncement_reviewedByUserId_idx" ON "SchoolAnnouncement"("reviewedByUserId");
CREATE INDEX "SchoolBroadcastSlot_organisationId_status_startsAt_idx" ON "SchoolBroadcastSlot"("organisationId", "status", "startsAt");
CREATE INDEX "SchoolBroadcastSlot_locationId_status_startsAt_idx" ON "SchoolBroadcastSlot"("locationId", "status", "startsAt");
CREATE INDEX "SchoolBroadcastSlot_zoneId_status_startsAt_idx" ON "SchoolBroadcastSlot"("zoneId", "status", "startsAt");
CREATE INDEX "SchoolBroadcastSlot_announcementId_idx" ON "SchoolBroadcastSlot"("announcementId");
CREATE INDEX "SchoolBroadcastSlot_approvedByUserId_idx" ON "SchoolBroadcastSlot"("approvedByUserId");
CREATE UNIQUE INDEX "PlayoutIntent_playerId_schoolBroadcastSlotId_plannedStart_key" ON "PlayoutIntent"("playerId", "schoolBroadcastSlotId", "plannedStart");
CREATE INDEX "PlayoutIntent_schoolBroadcastSlotId_plannedStart_idx" ON "PlayoutIntent"("schoolBroadcastSlotId", "plannedStart");
CREATE INDEX "ProofOfPlayEvent_schoolBroadcastSlotId_occurredAt_idx" ON "ProofOfPlayEvent"("schoolBroadcastSlotId", "occurredAt");

ALTER TABLE "SchoolProfile" ADD CONSTRAINT "SchoolProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolAnnouncement" ADD CONSTRAINT "SchoolAnnouncement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolAnnouncement" ADD CONSTRAINT "SchoolAnnouncement_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolAnnouncement" ADD CONSTRAINT "SchoolAnnouncement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolAnnouncement" ADD CONSTRAINT "SchoolAnnouncement_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "SchoolAnnouncement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_schoolBroadcastSlotId_fkey" FOREIGN KEY ("schoolBroadcastSlotId") REFERENCES "SchoolBroadcastSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProofOfPlayEvent" ADD CONSTRAINT "ProofOfPlayEvent_schoolBroadcastSlotId_fkey" FOREIGN KEY ("schoolBroadcastSlotId") REFERENCES "SchoolBroadcastSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
