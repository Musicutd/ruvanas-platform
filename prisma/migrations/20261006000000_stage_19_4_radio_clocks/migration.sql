CREATE TYPE "RadioClockStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "RadioClockItemType" AS ENUM ('MUSIC_MODE', 'MUSIC_TRACK', 'PROMO', 'SHOW_RUNDOWN', 'MARKER');
CREATE TYPE "RadioClockTransition" AS ENUM ('CLEAN', 'CROSSFADE', 'DUCK_VOICE', 'HARD_START');

CREATE TABLE "RadioClock" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" "RadioClockStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "publishedVersion" INTEGER NOT NULL DEFAULT 0,
  "durationSeconds" INTEGER NOT NULL DEFAULT 3600,
  "createdByUserId" TEXT NOT NULL,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RadioClock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RadioClock_duration_check" CHECK ("durationSeconds" = 3600),
  CONSTRAINT "RadioClock_version_check" CHECK ("version" > 0 AND "publishedVersion" >= 0 AND "publishedVersion" <= "version")
);

CREATE TABLE "RadioClockItem" (
  "id" TEXT NOT NULL,
  "radioClockId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "type" "RadioClockItemType" NOT NULL,
  "label" TEXT NOT NULL,
  "offsetSeconds" INTEGER NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "transition" "RadioClockTransition" NOT NULL DEFAULT 'CLEAN',
  "transitionSeconds" INTEGER NOT NULL DEFAULT 0,
  "musicModeId" TEXT,
  "trackId" TEXT,
  "promoVersionId" TEXT,
  "schoolRundownId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RadioClockItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RadioClockItem_timing_check" CHECK ("position" >= 0 AND "offsetSeconds" >= 0 AND "durationSeconds" >= 0 AND "transitionSeconds" BETWEEN 0 AND 30),
  CONSTRAINT "RadioClockItem_transition_check" CHECK (
    ("transition" IN ('CLEAN', 'HARD_START') AND "transitionSeconds" = 0) OR
    ("transition" IN ('CROSSFADE', 'DUCK_VOICE') AND "transitionSeconds" > 0)
  ),
  CONSTRAINT "RadioClockItem_type_source_check" CHECK (
    ("type" = 'MUSIC_MODE' AND "musicModeId" IS NOT NULL AND "trackId" IS NULL AND "promoVersionId" IS NULL AND "schoolRundownId" IS NULL) OR
    ("type" = 'MUSIC_TRACK' AND "musicModeId" IS NULL AND "trackId" IS NOT NULL AND "promoVersionId" IS NULL AND "schoolRundownId" IS NULL) OR
    ("type" = 'PROMO' AND "musicModeId" IS NULL AND "trackId" IS NULL AND "promoVersionId" IS NOT NULL AND "schoolRundownId" IS NULL) OR
    ("type" = 'SHOW_RUNDOWN' AND "musicModeId" IS NULL AND "trackId" IS NULL AND "promoVersionId" IS NULL AND "schoolRundownId" IS NOT NULL) OR
    ("type" = 'MARKER' AND "musicModeId" IS NULL AND "trackId" IS NULL AND "promoVersionId" IS NULL AND "schoolRundownId" IS NULL)
  )
);

CREATE UNIQUE INDEX "RadioClock_organisationId_slug_key" ON "RadioClock"("organisationId", "slug");
CREATE UNIQUE INDEX "RadioClock_id_organisationId_key" ON "RadioClock"("id", "organisationId");
CREATE INDEX "RadioClock_organisationId_status_updatedAt_idx" ON "RadioClock"("organisationId", "status", "updatedAt");
CREATE INDEX "RadioClock_createdByUserId_createdAt_idx" ON "RadioClock"("createdByUserId", "createdAt");
CREATE INDEX "RadioClock_publishedByUserId_publishedAt_idx" ON "RadioClock"("publishedByUserId", "publishedAt");

CREATE UNIQUE INDEX "RadioClockItem_radioClockId_position_key" ON "RadioClockItem"("radioClockId", "position");
CREATE INDEX "RadioClockItem_radioClockId_offsetSeconds_idx" ON "RadioClockItem"("radioClockId", "offsetSeconds");
CREATE INDEX "RadioClockItem_musicModeId_idx" ON "RadioClockItem"("musicModeId");
CREATE INDEX "RadioClockItem_trackId_idx" ON "RadioClockItem"("trackId");
CREATE INDEX "RadioClockItem_promoVersionId_idx" ON "RadioClockItem"("promoVersionId");
CREATE INDEX "RadioClockItem_schoolRundownId_idx" ON "RadioClockItem"("schoolRundownId");

ALTER TABLE "RadioClock" ADD CONSTRAINT "RadioClock_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadioClock" ADD CONSTRAINT "RadioClock_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioClock" ADD CONSTRAINT "RadioClock_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RadioClockItem" ADD CONSTRAINT "RadioClockItem_radioClockId_fkey" FOREIGN KEY ("radioClockId") REFERENCES "RadioClock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadioClockItem" ADD CONSTRAINT "RadioClockItem_musicModeId_fkey" FOREIGN KEY ("musicModeId") REFERENCES "MusicMode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioClockItem" ADD CONSTRAINT "RadioClockItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioClockItem" ADD CONSTRAINT "RadioClockItem_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioClockItem" ADD CONSTRAINT "RadioClockItem_schoolRundownId_fkey" FOREIGN KEY ("schoolRundownId") REFERENCES "SchoolRundown"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
