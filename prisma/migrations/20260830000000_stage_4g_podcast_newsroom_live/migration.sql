CREATE TYPE "SchoolPodcastStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');
CREATE TYPE "TranscriptStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED');
CREATE TYPE "SchoolNewsStoryType" AS ENUM ('NEWS_BULLETIN', 'INTERVIEW', 'SPORTS_RESULT', 'SCHOOL_NOTICE', 'FEATURE_STORY');
CREATE TYPE "SchoolNewsStoryStatus" AS ENUM ('PITCH', 'ASSIGNED', 'SCRIPTING', 'FACT_CHECK', 'AUDIO_PRODUCTION', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "LiveStudioStatus" AS ENUM ('CREATED', 'SOUNDCHECK', 'READY', 'ON_AIR', 'FALLBACK', 'ENDED');
CREATE TYPE "LiveConnectionQuality" AS ENUM ('UNKNOWN', 'GOOD', 'DEGRADED', 'FAILED');

CREATE TABLE "SchoolPodcastSeries" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "programmeId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "publicationScope" "SchoolPublicationScope" NOT NULL DEFAULT 'INTERNAL_ONLY',
  "rssEnabled" BOOLEAN NOT NULL DEFAULT false,
  "artworkUrl" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolPodcastSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolPodcastEpisode" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "seriesId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "status" "SchoolPodcastStatus" NOT NULL DEFAULT 'DRAFT',
  "publicationScope" "SchoolPublicationScope" NOT NULL DEFAULT 'INTERNAL_ONLY',
  "accessibleDescription" TEXT,
  "chaptersJson" JSONB,
  "createdByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "unpublishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolPodcastEpisode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Transcript" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "podcastEpisodeId" TEXT,
  "mediaAssetId" TEXT,
  "projectId" TEXT,
  "episodeId" TEXT,
  "languageCode" TEXT NOT NULL DEFAULT 'und',
  "segmentsJson" JSONB NOT NULL,
  "status" "TranscriptStatus" NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolNewsStory" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "programmeId" TEXT,
  "episodeId" TEXT,
  "title" TEXT NOT NULL,
  "type" "SchoolNewsStoryType" NOT NULL,
  "status" "SchoolNewsStoryStatus" NOT NULL DEFAULT 'PITCH',
  "deadline" TIMESTAMP(3),
  "pitch" TEXT,
  "script" TEXT,
  "factCheckNotes" TEXT,
  "sourcesJson" JSONB,
  "interviewMediaAssetId" TEXT,
  "interviewConsentConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "editorialFeedbackJson" JSONB,
  "createdByUserId" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "reviewedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolNewsStory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveStudioSession" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "episodeId" TEXT,
  "channelId" TEXT NOT NULL,
  "fallbackPromoVersionId" TEXT NOT NULL,
  "supervisorUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "LiveStudioStatus" NOT NULL DEFAULT 'CREATED',
  "connectionQuality" "LiveConnectionQuality" NOT NULL DEFAULT 'UNKNOWN',
  "soundcheckJson" JSONB,
  "scheduledStart" TIMESTAMP(3) NOT NULL,
  "scheduledEnd" TIMESTAMP(3) NOT NULL,
  "connectionApprovedAt" TIMESTAMP(3),
  "goLiveTokenHash" TEXT,
  "goLiveTokenExpiresAt" TIMESTAMP(3),
  "liveStartedAt" TIMESTAMP(3),
  "fallbackActivatedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "recordEnabled" BOOLEAN NOT NULL DEFAULT false,
  "retentionApproved" BOOLEAN NOT NULL DEFAULT false,
  "recordingMediaAssetId" TEXT,
  "endReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveStudioSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolPodcastSeries_organisationId_title_key" ON "SchoolPodcastSeries"("organisationId", "title");
CREATE INDEX "SchoolPodcastSeries_organisationId_updatedAt_idx" ON "SchoolPodcastSeries"("organisationId", "updatedAt");
CREATE INDEX "SchoolPodcastSeries_programmeId_idx" ON "SchoolPodcastSeries"("programmeId");
CREATE UNIQUE INDEX "SchoolPodcastEpisode_episodeId_key" ON "SchoolPodcastEpisode"("episodeId");
CREATE INDEX "SchoolPodcastEpisode_organisationId_status_updatedAt_idx" ON "SchoolPodcastEpisode"("organisationId", "status", "updatedAt");
CREATE INDEX "SchoolPodcastEpisode_seriesId_createdAt_idx" ON "SchoolPodcastEpisode"("seriesId", "createdAt");
CREATE UNIQUE INDEX "Transcript_podcastEpisodeId_key" ON "Transcript"("podcastEpisodeId");
CREATE INDEX "Transcript_organisationId_status_updatedAt_idx" ON "Transcript"("organisationId", "status", "updatedAt");
CREATE INDEX "Transcript_mediaAssetId_idx" ON "Transcript"("mediaAssetId");
CREATE INDEX "Transcript_projectId_idx" ON "Transcript"("projectId");
CREATE INDEX "Transcript_episodeId_idx" ON "Transcript"("episodeId");
CREATE INDEX "SchoolNewsStory_organisationId_status_deadline_idx" ON "SchoolNewsStory"("organisationId", "status", "deadline");
CREATE INDEX "SchoolNewsStory_programmeId_idx" ON "SchoolNewsStory"("programmeId");
CREATE INDEX "SchoolNewsStory_episodeId_idx" ON "SchoolNewsStory"("episodeId");
CREATE INDEX "SchoolNewsStory_interviewMediaAssetId_idx" ON "SchoolNewsStory"("interviewMediaAssetId");
CREATE INDEX "LiveStudioSession_organisationId_status_scheduledStart_idx" ON "LiveStudioSession"("organisationId", "status", "scheduledStart");
CREATE INDEX "LiveStudioSession_programmeId_idx" ON "LiveStudioSession"("programmeId");
CREATE INDEX "LiveStudioSession_episodeId_idx" ON "LiveStudioSession"("episodeId");
CREATE INDEX "LiveStudioSession_channelId_idx" ON "LiveStudioSession"("channelId");
CREATE INDEX "LiveStudioSession_fallbackPromoVersionId_idx" ON "LiveStudioSession"("fallbackPromoVersionId");
CREATE INDEX "LiveStudioSession_supervisorUserId_idx" ON "LiveStudioSession"("supervisorUserId");

ALTER TABLE "SchoolPodcastSeries" ADD CONSTRAINT "SchoolPodcastSeries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastSeries" ADD CONSTRAINT "SchoolPodcastSeries_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "SchoolProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastSeries" ADD CONSTRAINT "SchoolPodcastSeries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastEpisode" ADD CONSTRAINT "SchoolPodcastEpisode_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastEpisode" ADD CONSTRAINT "SchoolPodcastEpisode_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SchoolPodcastSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastEpisode" ADD CONSTRAINT "SchoolPodcastEpisode_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastEpisode" ADD CONSTRAINT "SchoolPodcastEpisode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastEpisode" ADD CONSTRAINT "SchoolPodcastEpisode_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_podcastEpisodeId_fkey" FOREIGN KEY ("podcastEpisodeId") REFERENCES "SchoolPodcastEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "SchoolProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_interviewMediaAssetId_fkey" FOREIGN KEY ("interviewMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolNewsStory" ADD CONSTRAINT "SchoolNewsStory_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LiveStudioSession" ADD CONSTRAINT "LiveStudioSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveStudioSession" ADD CONSTRAINT "LiveStudioSession_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "SchoolProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveStudioSession" ADD CONSTRAINT "LiveStudioSession_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LiveStudioSession" ADD CONSTRAINT "LiveStudioSession_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveStudioSession" ADD CONSTRAINT "LiveStudioSession_fallbackPromoVersionId_fkey" FOREIGN KEY ("fallbackPromoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveStudioSession" ADD CONSTRAINT "LiveStudioSession_supervisorUserId_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveStudioSession" ADD CONSTRAINT "LiveStudioSession_recordingMediaAssetId_fkey" FOREIGN KEY ("recordingMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

