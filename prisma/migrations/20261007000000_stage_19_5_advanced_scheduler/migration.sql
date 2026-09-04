CREATE TYPE "ProgrammeScheduleVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "ProgrammeScheduleRecurrence" AS ENUM ('WEEKLY', 'ONE_OFF');
CREATE TYPE "ProgrammeScheduleSourceType" AS ENUM ('MUSIC_MODE', 'RADIO_CLOCK', 'SHOW_RUNDOWN');

CREATE UNIQUE INDEX "SchoolRundown_id_organisationId_key" ON "SchoolRundown"("id", "organisationId");

CREATE TABLE "ProgrammeSchedule" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgrammeSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgrammeScheduleVersion" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ProgrammeScheduleVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT NOT NULL,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgrammeScheduleVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgrammeScheduleVersion_state_check" CHECK (
    ("status" = 'DRAFT' AND "publishedAt" IS NULL AND "isActive" = false) OR
    ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL) OR
    ("status" = 'ARCHIVED' AND "publishedAt" IS NOT NULL AND "isActive" = false)
  ),
  CONSTRAINT "ProgrammeScheduleVersion_version_check" CHECK ("version" > 0)
);

CREATE TABLE "ProgrammeScheduleItem" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "recurrence" "ProgrammeScheduleRecurrence" NOT NULL,
  "sourceType" "ProgrammeScheduleSourceType" NOT NULL,
  "weekday" INTEGER,
  "startMinute" INTEGER,
  "startsAt" TIMESTAMP(3),
  "durationMinutes" INTEGER NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "musicModeId" TEXT,
  "radioClockId" TEXT,
  "schoolRundownId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgrammeScheduleItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgrammeScheduleItem_position_check" CHECK ("position" >= 0),
  CONSTRAINT "ProgrammeScheduleItem_duration_priority_check" CHECK ("durationMinutes" BETWEEN 1 AND 1440 AND "priority" BETWEEN 0 AND 100),
  CONSTRAINT "ProgrammeScheduleItem_recurrence_check" CHECK (
    ("recurrence" = 'WEEKLY' AND "weekday" BETWEEN 0 AND 6 AND "startMinute" BETWEEN 0 AND 1439 AND "startsAt" IS NULL) OR
    ("recurrence" = 'ONE_OFF' AND "weekday" IS NULL AND "startMinute" IS NULL AND "startsAt" IS NOT NULL)
  ),
  CONSTRAINT "ProgrammeScheduleItem_source_check" CHECK (
    ("sourceType" = 'MUSIC_MODE' AND "musicModeId" IS NOT NULL AND "radioClockId" IS NULL AND "schoolRundownId" IS NULL) OR
    ("sourceType" = 'RADIO_CLOCK' AND "musicModeId" IS NULL AND "radioClockId" IS NOT NULL AND "schoolRundownId" IS NULL) OR
    ("sourceType" = 'SHOW_RUNDOWN' AND "musicModeId" IS NULL AND "radioClockId" IS NULL AND "schoolRundownId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ProgrammeSchedule_channelId_organisationId_key" ON "ProgrammeSchedule"("channelId", "organisationId");
CREATE UNIQUE INDEX "ProgrammeSchedule_id_organisationId_key" ON "ProgrammeSchedule"("id", "organisationId");
CREATE INDEX "ProgrammeSchedule_organisationId_updatedAt_idx" ON "ProgrammeSchedule"("organisationId", "updatedAt");
CREATE INDEX "ProgrammeSchedule_createdByUserId_createdAt_idx" ON "ProgrammeSchedule"("createdByUserId", "createdAt");

CREATE UNIQUE INDEX "ProgrammeScheduleVersion_scheduleId_version_key" ON "ProgrammeScheduleVersion"("scheduleId", "version");
CREATE UNIQUE INDEX "ProgrammeScheduleVersion_id_organisationId_key" ON "ProgrammeScheduleVersion"("id", "organisationId");
CREATE UNIQUE INDEX "ProgrammeScheduleVersion_one_active_key" ON "ProgrammeScheduleVersion"("scheduleId") WHERE "isActive" = true;
CREATE INDEX "ProgrammeScheduleVersion_scheduleId_status_version_idx" ON "ProgrammeScheduleVersion"("scheduleId", "status", "version");
CREATE INDEX "ProgrammeScheduleVersion_organisationId_status_updatedAt_idx" ON "ProgrammeScheduleVersion"("organisationId", "status", "updatedAt");
CREATE INDEX "ProgrammeScheduleVersion_createdByUserId_createdAt_idx" ON "ProgrammeScheduleVersion"("createdByUserId", "createdAt");
CREATE INDEX "ProgrammeScheduleVersion_publishedByUserId_publishedAt_idx" ON "ProgrammeScheduleVersion"("publishedByUserId", "publishedAt");

CREATE UNIQUE INDEX "ProgrammeScheduleItem_versionId_position_key" ON "ProgrammeScheduleItem"("versionId", "position");
CREATE INDEX "ProgrammeScheduleItem_versionId_recurrence_weekday_startMinute_idx" ON "ProgrammeScheduleItem"("versionId", "recurrence", "weekday", "startMinute");
CREATE INDEX "ProgrammeScheduleItem_organisationId_startsAt_idx" ON "ProgrammeScheduleItem"("organisationId", "startsAt");
CREATE INDEX "ProgrammeScheduleItem_musicModeId_idx" ON "ProgrammeScheduleItem"("musicModeId");
CREATE INDEX "ProgrammeScheduleItem_radioClockId_idx" ON "ProgrammeScheduleItem"("radioClockId");
CREATE INDEX "ProgrammeScheduleItem_schoolRundownId_idx" ON "ProgrammeScheduleItem"("schoolRundownId");

ALTER TABLE "ProgrammeSchedule" ADD CONSTRAINT "ProgrammeSchedule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgrammeSchedule" ADD CONSTRAINT "ProgrammeSchedule_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgrammeSchedule" ADD CONSTRAINT "ProgrammeSchedule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgrammeScheduleVersion" ADD CONSTRAINT "ProgrammeScheduleVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgrammeScheduleVersion" ADD CONSTRAINT "ProgrammeScheduleVersion_scheduleId_organisationId_fkey" FOREIGN KEY ("scheduleId", "organisationId") REFERENCES "ProgrammeSchedule"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgrammeScheduleVersion" ADD CONSTRAINT "ProgrammeScheduleVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgrammeScheduleVersion" ADD CONSTRAINT "ProgrammeScheduleVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProgrammeScheduleItem" ADD CONSTRAINT "ProgrammeScheduleItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgrammeScheduleItem" ADD CONSTRAINT "ProgrammeScheduleItem_versionId_organisationId_fkey" FOREIGN KEY ("versionId", "organisationId") REFERENCES "ProgrammeScheduleVersion"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgrammeScheduleItem" ADD CONSTRAINT "ProgrammeScheduleItem_musicModeId_organisationId_fkey" FOREIGN KEY ("musicModeId", "organisationId") REFERENCES "MusicMode"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgrammeScheduleItem" ADD CONSTRAINT "ProgrammeScheduleItem_radioClockId_organisationId_fkey" FOREIGN KEY ("radioClockId", "organisationId") REFERENCES "RadioClock"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgrammeScheduleItem" ADD CONSTRAINT "ProgrammeScheduleItem_schoolRundownId_organisationId_fkey" FOREIGN KEY ("schoolRundownId", "organisationId") REFERENCES "SchoolRundown"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
