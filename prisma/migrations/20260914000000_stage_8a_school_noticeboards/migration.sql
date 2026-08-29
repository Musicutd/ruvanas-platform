CREATE TYPE "SchoolNoticeboardStatus" AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TYPE "SchoolNoticeboardTheme" AS ENUM ('INFORMATION', 'CELEBRATION', 'IMPORTANT');

CREATE TABLE "SchoolNoticeboardPost" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "locationId" TEXT,
    "zoneId" TEXT,
    "status" "SchoolNoticeboardStatus" NOT NULL DEFAULT 'SCHEDULED',
    "theme" "SchoolNoticeboardTheme" NOT NULL DEFAULT 'INFORMATION',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "displaySeconds" INTEGER NOT NULL DEFAULT 15,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" TEXT NOT NULL DEFAULT 'school-noticeboard-v1',
    "createdByUserId" TEXT NOT NULL,
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolNoticeboardPost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SchoolNoticeboardPost_target_check" CHECK (num_nonnulls("locationId", "zoneId") = 1),
    CONSTRAINT "SchoolNoticeboardPost_time_check" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "SchoolNoticeboardPost_priority_check" CHECK ("priority" BETWEEN 0 AND 100),
    CONSTRAINT "SchoolNoticeboardPost_duration_check" CHECK ("displaySeconds" BETWEEN 8 AND 120)
);

CREATE INDEX "SchoolNoticeboardPost_organisationId_status_startsAt_endsAt_idx" ON "SchoolNoticeboardPost"("organisationId", "status", "startsAt", "endsAt");
CREATE INDEX "SchoolNoticeboardPost_announcementId_idx" ON "SchoolNoticeboardPost"("announcementId");
CREATE INDEX "SchoolNoticeboardPost_locationId_status_startsAt_endsAt_idx" ON "SchoolNoticeboardPost"("locationId", "status", "startsAt", "endsAt");
CREATE INDEX "SchoolNoticeboardPost_zoneId_status_startsAt_endsAt_idx" ON "SchoolNoticeboardPost"("zoneId", "status", "startsAt", "endsAt");
CREATE INDEX "SchoolNoticeboardPost_createdByUserId_idx" ON "SchoolNoticeboardPost"("createdByUserId");
CREATE INDEX "SchoolNoticeboardPost_cancelledByUserId_idx" ON "SchoolNoticeboardPost"("cancelledByUserId");

ALTER TABLE "SchoolNoticeboardPost" ADD CONSTRAINT "SchoolNoticeboardPost_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolNoticeboardPost" ADD CONSTRAINT "SchoolNoticeboardPost_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "SchoolAnnouncement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolNoticeboardPost" ADD CONSTRAINT "SchoolNoticeboardPost_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolNoticeboardPost" ADD CONSTRAINT "SchoolNoticeboardPost_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolNoticeboardPost" ADD CONSTRAINT "SchoolNoticeboardPost_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolNoticeboardPost" ADD CONSTRAINT "SchoolNoticeboardPost_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
