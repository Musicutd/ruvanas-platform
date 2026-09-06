CREATE TYPE "NewsroomProduct" AS ENUM ('ONLINE_RADIO', 'SCHOOL_RADIO');

ALTER TYPE "SchoolNewsStoryType" ADD VALUE IF NOT EXISTS 'WEATHER';
ALTER TYPE "SchoolNewsStoryType" ADD VALUE IF NOT EXISTS 'TRAFFIC';
ALTER TYPE "SchoolNewsStoryType" ADD VALUE IF NOT EXISTS 'COMMUNITY';
ALTER TYPE "SchoolNewsStoryType" ADD VALUE IF NOT EXISTS 'BUSINESS';
ALTER TYPE "SchoolNewsStoryType" ADD VALUE IF NOT EXISTS 'PUBLIC_SERVICE';

ALTER TABLE "SchoolNewsStory"
  ADD COLUMN "product" "NewsroomProduct" NOT NULL DEFAULT 'SCHOOL_RADIO',
  ADD COLUMN "stationId" TEXT,
  ADD COLUMN "channelId" TEXT,
  ADD COLUMN "audioProjectId" TEXT,
  ADD COLUMN "publishedByUserId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AudioProject_id_organisationId_key" ON "AudioProject"("id", "organisationId");
CREATE UNIQUE INDEX "SchoolNewsStory_id_organisationId_key" ON "SchoolNewsStory"("id", "organisationId");
DROP INDEX "SchoolNewsStory_organisationId_status_deadline_idx";
CREATE INDEX "SchoolNewsStory_organisationId_product_status_deadline_idx" ON "SchoolNewsStory"("organisationId", "product", "status", "deadline");
CREATE INDEX "SchoolNewsStory_stationId_status_idx" ON "SchoolNewsStory"("stationId", "status");
CREATE INDEX "SchoolNewsStory_channelId_status_idx" ON "SchoolNewsStory"("channelId", "status");
CREATE INDEX "SchoolNewsStory_audioProjectId_idx" ON "SchoolNewsStory"("audioProjectId");

ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_stationId_organisationId_fkey"
  FOREIGN KEY ("stationId", "organisationId") REFERENCES "Station"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_channelId_stationId_organisationId_fkey"
  FOREIGN KEY ("channelId", "stationId", "organisationId") REFERENCES "Channel"("id", "stationId", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_audioProjectId_organisationId_fkey"
  FOREIGN KEY ("audioProjectId", "organisationId") REFERENCES "AudioProject"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_publishedByUserId_fkey"
  FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NewsStoryRevision" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "storyId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "script" TEXT,
  "factCheckNotes" TEXT,
  "sourcesJson" JSONB,
  "audioProjectId" TEXT,
  "interviewMediaAssetId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsStoryRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsStoryRevision_storyId_revision_key" ON "NewsStoryRevision"("storyId", "revision");
CREATE INDEX "NewsStoryRevision_organisationId_createdAt_idx" ON "NewsStoryRevision"("organisationId", "createdAt");
CREATE INDEX "NewsStoryRevision_audioProjectId_idx" ON "NewsStoryRevision"("audioProjectId");
CREATE INDEX "NewsStoryRevision_interviewMediaAssetId_idx" ON "NewsStoryRevision"("interviewMediaAssetId");

ALTER TABLE "NewsStoryRevision" ADD CONSTRAINT "NewsStoryRevision_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsStoryRevision" ADD CONSTRAINT "NewsStoryRevision_storyId_organisationId_fkey"
  FOREIGN KEY ("storyId", "organisationId") REFERENCES "SchoolNewsStory"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsStoryRevision" ADD CONSTRAINT "NewsStoryRevision_audioProjectId_organisationId_fkey"
  FOREIGN KEY ("audioProjectId", "organisationId") REFERENCES "AudioProject"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NewsStoryRevision" ADD CONSTRAINT "NewsStoryRevision_interviewMediaAssetId_organisationId_fkey"
  FOREIGN KEY ("interviewMediaAssetId", "organisationId") REFERENCES "MediaAsset"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NewsStoryRevision" ADD CONSTRAINT "NewsStoryRevision_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "NewsStoryDecision" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "storyId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" "SchoolNewsStoryStatus" NOT NULL,
  "toStatus" "SchoolNewsStoryStatus" NOT NULL,
  "note" TEXT,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsStoryDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NewsStoryDecision_organisationId_createdAt_idx" ON "NewsStoryDecision"("organisationId", "createdAt");
CREATE INDEX "NewsStoryDecision_storyId_createdAt_idx" ON "NewsStoryDecision"("storyId", "createdAt");

ALTER TABLE "NewsStoryDecision" ADD CONSTRAINT "NewsStoryDecision_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsStoryDecision" ADD CONSTRAINT "NewsStoryDecision_storyId_organisationId_fkey"
  FOREIGN KEY ("storyId", "organisationId") REFERENCES "SchoolNewsStory"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsStoryDecision" ADD CONSTRAINT "NewsStoryDecision_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
