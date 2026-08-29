CREATE TABLE "SchoolPublicationDailyAggregate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "podcastEpisodeId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "metadataListingCount" INTEGER NOT NULL DEFAULT 0,
    "audioRequestCount" INTEGER NOT NULL DEFAULT 0,
    "audioBytesOffered" BIGINT NOT NULL DEFAULT 0,
    "fullAudioRequestCount" INTEGER NOT NULL DEFAULT 0,
    "rangeAudioRequestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPublicationDailyAggregate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolPublicationDailyAggregate_organisationId_podcastEpisodeId_bucketStart_key" ON "SchoolPublicationDailyAggregate"("organisationId", "podcastEpisodeId", "bucketStart");
CREATE INDEX "SchoolPublicationDailyAggregate_organisationId_bucketStart_idx" ON "SchoolPublicationDailyAggregate"("organisationId", "bucketStart");
CREATE INDEX "SchoolPublicationDailyAggregate_podcastEpisodeId_bucketStart_idx" ON "SchoolPublicationDailyAggregate"("podcastEpisodeId", "bucketStart");

ALTER TABLE "SchoolPublicationDailyAggregate" ADD CONSTRAINT "SchoolPublicationDailyAggregate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPublicationDailyAggregate" ADD CONSTRAINT "SchoolPublicationDailyAggregate_podcastEpisodeId_fkey" FOREIGN KEY ("podcastEpisodeId") REFERENCES "SchoolPodcastEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
