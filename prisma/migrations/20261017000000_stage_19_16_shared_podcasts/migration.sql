-- Stage 19.16 keeps the established School podcast tables as the shared
-- persistence layer. Product policy remains explicit at the series boundary.
CREATE TYPE "PodcastProduct" AS ENUM ('ONLINE_RADIO', 'SCHOOL_RADIO');

ALTER TABLE "SchoolPodcastSeries"
  ADD COLUMN "product" "PodcastProduct" NOT NULL DEFAULT 'SCHOOL_RADIO',
  ADD COLUMN "stationId" TEXT,
  ADD COLUMN "channelId" TEXT,
  ADD COLUMN "feedSlug" TEXT,
  ADD COLUMN "author" TEXT;

ALTER TABLE "SchoolPodcastEpisode"
  ALTER COLUMN "episodeId" DROP NOT NULL,
  ADD COLUMN "mediaAssetId" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "explicit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "seasonNumber" INTEGER,
  ADD COLUMN "episodeNumber" INTEGER;

DROP INDEX "SchoolPodcastSeries_organisationId_title_key";
DROP INDEX "SchoolPodcastSeries_organisationId_updatedAt_idx";

CREATE UNIQUE INDEX "SchoolPodcastSeries_organisationId_product_title_key"
  ON "SchoolPodcastSeries"("organisationId", "product", "title");
CREATE UNIQUE INDEX "SchoolPodcastSeries_organisationId_feedSlug_key"
  ON "SchoolPodcastSeries"("organisationId", "feedSlug");
CREATE INDEX "SchoolPodcastSeries_organisationId_product_updatedAt_idx"
  ON "SchoolPodcastSeries"("organisationId", "product", "updatedAt");
CREATE INDEX "SchoolPodcastSeries_stationId_idx" ON "SchoolPodcastSeries"("stationId");
CREATE INDEX "SchoolPodcastSeries_channelId_idx" ON "SchoolPodcastSeries"("channelId");

CREATE UNIQUE INDEX "SchoolPodcastEpisode_seriesId_slug_key"
  ON "SchoolPodcastEpisode"("seriesId", "slug");
CREATE INDEX "SchoolPodcastEpisode_mediaAssetId_idx"
  ON "SchoolPodcastEpisode"("mediaAssetId");
CREATE UNIQUE INDEX "MediaAsset_id_organisationId_key"
  ON "MediaAsset"("id", "organisationId");

ALTER TABLE "SchoolPodcastSeries"
  ADD CONSTRAINT "SchoolPodcastSeries_stationId_fkey"
  FOREIGN KEY ("stationId", "organisationId") REFERENCES "Station"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastSeries"
  ADD CONSTRAINT "SchoolPodcastSeries_channelId_fkey"
  FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPodcastEpisode"
  ADD CONSTRAINT "SchoolPodcastEpisode_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId", "organisationId") REFERENCES "MediaAsset"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
