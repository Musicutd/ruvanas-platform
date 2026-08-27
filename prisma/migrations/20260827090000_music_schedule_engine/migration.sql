CREATE TYPE "MusicScheduleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "MusicSchedule" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "locationId" TEXT,
    "zoneId" TEXT,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "MusicScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MusicSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MusicSchedule_one_target_check" CHECK (num_nonnulls("locationId", "zoneId") = 1),
    CONSTRAINT "MusicSchedule_version_check" CHECK ("version" > 0),
    CONSTRAINT "MusicSchedule_effective_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE TABLE "ScheduleSlot" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "musicModeId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleSlot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScheduleSlot_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "ScheduleSlot_start_minute_check" CHECK ("startMinute" BETWEEN 0 AND 1439),
    CONSTRAINT "ScheduleSlot_end_minute_check" CHECK ("endMinute" BETWEEN 0 AND 1439),
    CONSTRAINT "ScheduleSlot_non_empty_check" CHECK ("startMinute" <> "endMinute"),
    CONSTRAINT "ScheduleSlot_priority_check" CHECK ("priority" BETWEEN 0 AND 100)
);

CREATE INDEX "MusicSchedule_organisationId_status_idx" ON "MusicSchedule"("organisationId", "status");
CREATE INDEX "MusicSchedule_locationId_status_version_idx" ON "MusicSchedule"("locationId", "status", "version");
CREATE INDEX "MusicSchedule_zoneId_status_version_idx" ON "MusicSchedule"("zoneId", "status", "version");
CREATE UNIQUE INDEX "MusicSchedule_one_published_location_idx" ON "MusicSchedule"("locationId") WHERE "status" = 'PUBLISHED' AND "locationId" IS NOT NULL;
CREATE UNIQUE INDEX "MusicSchedule_one_published_zone_idx" ON "MusicSchedule"("zoneId") WHERE "status" = 'PUBLISHED' AND "zoneId" IS NOT NULL;
CREATE INDEX "ScheduleSlot_scheduleId_weekday_startMinute_idx" ON "ScheduleSlot"("scheduleId", "weekday", "startMinute");
CREATE INDEX "ScheduleSlot_musicModeId_idx" ON "ScheduleSlot"("musicModeId");

ALTER TABLE "MusicSchedule" ADD CONSTRAINT "MusicSchedule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicSchedule" ADD CONSTRAINT "MusicSchedule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicSchedule" ADD CONSTRAINT "MusicSchedule_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "MusicSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_musicModeId_fkey" FOREIGN KEY ("musicModeId") REFERENCES "MusicMode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
