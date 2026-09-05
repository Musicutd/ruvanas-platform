CREATE TYPE "VoiceTrackSegueStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

ALTER TYPE "RadioClockItemType" ADD VALUE IF NOT EXISTS 'VOICE_TRACK';

CREATE TABLE "VoiceTrackSegue" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "VoiceTrackSegueStatus" NOT NULL DEFAULT 'DRAFT',
  "audioProjectId" TEXT NOT NULL,
  "audioRenderId" TEXT NOT NULL,
  "voicePromoVersionId" TEXT NOT NULL,
  "outgoingTrackId" TEXT NOT NULL,
  "incomingTrackId" TEXT NOT NULL,
  "outgoingCueOutMs" INTEGER NOT NULL,
  "voiceTrimStartMs" INTEGER NOT NULL DEFAULT 0,
  "voiceTrimEndMs" INTEGER NOT NULL,
  "incomingIntroEndMs" INTEGER NOT NULL,
  "outgoingOverlapMs" INTEGER NOT NULL DEFAULT 2000,
  "incomingOverlapMs" INTEGER NOT NULL DEFAULT 2000,
  "duckingDb" DOUBLE PRECISION NOT NULL DEFAULT -12,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VoiceTrackSegue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VoiceTrackSegue_cue_bounds_check" CHECK (
    "outgoingCueOutMs" > 0 AND
    "voiceTrimStartMs" >= 0 AND
    "voiceTrimEndMs" > "voiceTrimStartMs" AND
    "incomingIntroEndMs" >= 0 AND
    "outgoingOverlapMs" BETWEEN 0 AND 30000 AND
    "incomingOverlapMs" BETWEEN 0 AND 30000 AND
    "outgoingOverlapMs" <= "outgoingCueOutMs" AND
    "incomingOverlapMs" <= "incomingIntroEndMs" AND
    "outgoingOverlapMs" + "incomingOverlapMs" <= "voiceTrimEndMs" - "voiceTrimStartMs" AND
    "duckingDb" BETWEEN -36 AND 0
  ),
  CONSTRAINT "VoiceTrackSegue_approval_check" CHECK (
    "status" <> 'APPROVED' OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  )
);

ALTER TABLE "RadioClockItem" ADD COLUMN "voiceTrackSegueId" TEXT;

ALTER TABLE "RadioClockItem" DROP CONSTRAINT "RadioClockItem_type_source_check";
ALTER TABLE "RadioClockItem" ADD CONSTRAINT "RadioClockItem_type_source_check" CHECK (
  ("type" = 'MUSIC_MODE' AND "musicModeId" IS NOT NULL AND "trackId" IS NULL AND "promoVersionId" IS NULL AND "voiceTrackSegueId" IS NULL AND "schoolRundownId" IS NULL) OR
  ("type" = 'MUSIC_TRACK' AND "musicModeId" IS NULL AND "trackId" IS NOT NULL AND "promoVersionId" IS NULL AND "voiceTrackSegueId" IS NULL AND "schoolRundownId" IS NULL) OR
  ("type" = 'PROMO' AND "musicModeId" IS NULL AND "trackId" IS NULL AND "promoVersionId" IS NOT NULL AND "voiceTrackSegueId" IS NULL AND "schoolRundownId" IS NULL) OR
  ("type" = 'VOICE_TRACK' AND "musicModeId" IS NULL AND "trackId" IS NULL AND "promoVersionId" IS NULL AND "voiceTrackSegueId" IS NOT NULL AND "schoolRundownId" IS NULL) OR
  ("type" = 'SHOW_RUNDOWN' AND "musicModeId" IS NULL AND "trackId" IS NULL AND "promoVersionId" IS NULL AND "voiceTrackSegueId" IS NULL AND "schoolRundownId" IS NOT NULL) OR
  ("type" = 'MARKER' AND "musicModeId" IS NULL AND "trackId" IS NULL AND "promoVersionId" IS NULL AND "voiceTrackSegueId" IS NULL AND "schoolRundownId" IS NULL)
);

CREATE UNIQUE INDEX "VoiceTrackSegue_id_organisationId_key" ON "VoiceTrackSegue"("id", "organisationId");
CREATE INDEX "VoiceTrackSegue_organisationId_status_updatedAt_idx" ON "VoiceTrackSegue"("organisationId", "status", "updatedAt");
CREATE INDEX "VoiceTrackSegue_channelId_status_idx" ON "VoiceTrackSegue"("channelId", "status");
CREATE INDEX "VoiceTrackSegue_audioProjectId_idx" ON "VoiceTrackSegue"("audioProjectId");
CREATE INDEX "VoiceTrackSegue_audioRenderId_idx" ON "VoiceTrackSegue"("audioRenderId");
CREATE INDEX "VoiceTrackSegue_voicePromoVersionId_idx" ON "VoiceTrackSegue"("voicePromoVersionId");
CREATE INDEX "VoiceTrackSegue_outgoingTrackId_idx" ON "VoiceTrackSegue"("outgoingTrackId");
CREATE INDEX "VoiceTrackSegue_incomingTrackId_idx" ON "VoiceTrackSegue"("incomingTrackId");
CREATE INDEX "VoiceTrackSegue_createdByUserId_idx" ON "VoiceTrackSegue"("createdByUserId");
CREATE INDEX "VoiceTrackSegue_approvedByUserId_idx" ON "VoiceTrackSegue"("approvedByUserId");
CREATE INDEX "RadioClockItem_voiceTrackSegueId_idx" ON "RadioClockItem"("voiceTrackSegueId");

ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_audioProjectId_fkey" FOREIGN KEY ("audioProjectId") REFERENCES "AudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_audioRenderId_fkey" FOREIGN KEY ("audioRenderId") REFERENCES "AudioRender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_voicePromoVersionId_fkey" FOREIGN KEY ("voicePromoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_outgoingTrackId_fkey" FOREIGN KEY ("outgoingTrackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_incomingTrackId_fkey" FOREIGN KEY ("incomingTrackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceTrackSegue" ADD CONSTRAINT "VoiceTrackSegue_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioClockItem" ADD CONSTRAINT "RadioClockItem_voiceTrackSegueId_fkey" FOREIGN KEY ("voiceTrackSegueId") REFERENCES "VoiceTrackSegue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
