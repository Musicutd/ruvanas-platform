CREATE TYPE "SchoolRundownStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "SchoolRundownItemType" AS ENUM ('MUSIC_TRACK', 'JINGLE', 'VOICE_TRACK', 'INTERVIEW', 'ANNOUNCEMENT', 'SCRIPT_NOTE', 'HARD_TIME', 'FLEXIBLE_MARKER');

ALTER TYPE "AudioProjectType" ADD VALUE IF NOT EXISTS 'VOICE_TRACK';

ALTER TABLE "SchoolBroadcastSlot" ALTER COLUMN "announcementId" DROP NOT NULL;
ALTER TABLE "SchoolBroadcastSlot" ADD COLUMN "episodeId" TEXT;
ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_source_check" CHECK (("announcementId" IS NOT NULL)::integer + ("episodeId" IS NOT NULL)::integer = 1);

ALTER TABLE "PlayoutIntent" ALTER COLUMN "promoVersionId" DROP NOT NULL;
ALTER TABLE "PlayoutIntent" ADD COLUMN "schoolRundownItemId" TEXT;

CREATE TABLE "SchoolRundown" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "status" "SchoolRundownStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "approvedRevision" INTEGER,
  "createdByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolRundown_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolRundownItem" (
  "id" TEXT NOT NULL,
  "rundownId" TEXT NOT NULL,
  "type" "SchoolRundownItemType" NOT NULL,
  "position" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "notes" TEXT,
  "sourceMediaAssetId" TEXT,
  "sourceTrackId" TEXT,
  "sourcePromoVersionId" TEXT,
  "sourceAnnouncementId" TEXT,
  "sourceTakeId" TEXT,
  "estimatedDurationMs" INTEGER,
  "introCueMs" INTEGER NOT NULL DEFAULT 0,
  "outroCueMs" INTEGER NOT NULL DEFAULT 0,
  "transitionPreset" TEXT NOT NULL DEFAULT 'CLEAN',
  "cueOffsetMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolRundownItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolRundown_episodeId_key" ON "SchoolRundown"("episodeId");
CREATE INDEX "SchoolRundown_organisationId_status_updatedAt_idx" ON "SchoolRundown"("organisationId", "status", "updatedAt");
CREATE INDEX "SchoolRundown_reviewedByUserId_idx" ON "SchoolRundown"("reviewedByUserId");
CREATE UNIQUE INDEX "SchoolRundownItem_rundownId_position_key" ON "SchoolRundownItem"("rundownId", "position");
CREATE INDEX "SchoolRundownItem_sourceMediaAssetId_idx" ON "SchoolRundownItem"("sourceMediaAssetId");
CREATE INDEX "SchoolRundownItem_sourceTrackId_idx" ON "SchoolRundownItem"("sourceTrackId");
CREATE INDEX "SchoolRundownItem_sourcePromoVersionId_idx" ON "SchoolRundownItem"("sourcePromoVersionId");
CREATE INDEX "SchoolRundownItem_sourceAnnouncementId_idx" ON "SchoolRundownItem"("sourceAnnouncementId");
CREATE INDEX "SchoolRundownItem_sourceTakeId_idx" ON "SchoolRundownItem"("sourceTakeId");
CREATE INDEX "SchoolBroadcastSlot_episodeId_idx" ON "SchoolBroadcastSlot"("episodeId");
CREATE INDEX "PlayoutIntent_schoolRundownItemId_plannedStart_idx" ON "PlayoutIntent"("schoolRundownItemId", "plannedStart");

ALTER TABLE "SchoolBroadcastSlot" ADD CONSTRAINT "SchoolBroadcastSlot_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolRundown" ADD CONSTRAINT "SchoolRundown_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolRundown" ADD CONSTRAINT "SchoolRundown_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolRundown" ADD CONSTRAINT "SchoolRundown_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolRundown" ADD CONSTRAINT "SchoolRundown_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolRundownItem" ADD CONSTRAINT "SchoolRundownItem_rundownId_fkey" FOREIGN KEY ("rundownId") REFERENCES "SchoolRundown"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolRundownItem" ADD CONSTRAINT "SchoolRundownItem_sourceMediaAssetId_fkey" FOREIGN KEY ("sourceMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolRundownItem" ADD CONSTRAINT "SchoolRundownItem_sourceTrackId_fkey" FOREIGN KEY ("sourceTrackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolRundownItem" ADD CONSTRAINT "SchoolRundownItem_sourcePromoVersionId_fkey" FOREIGN KEY ("sourcePromoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolRundownItem" ADD CONSTRAINT "SchoolRundownItem_sourceAnnouncementId_fkey" FOREIGN KEY ("sourceAnnouncementId") REFERENCES "SchoolAnnouncement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolRundownItem" ADD CONSTRAINT "SchoolRundownItem_sourceTakeId_fkey" FOREIGN KEY ("sourceTakeId") REFERENCES "AudioTake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayoutIntent" ADD CONSTRAINT "PlayoutIntent_schoolRundownItemId_fkey" FOREIGN KEY ("schoolRundownItemId") REFERENCES "SchoolRundownItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

