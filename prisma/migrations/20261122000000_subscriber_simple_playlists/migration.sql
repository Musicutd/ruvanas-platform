CREATE TYPE "SimplePlaylistBuildMode" AS ENUM ('RANDOM_GENRE_POOL', 'GENRE_SEQUENCE');

ALTER TABLE "Channel" ADD COLUMN "musicRightsUse" "MusicRightsUse";

-- Preserve known rights profiles without guessing a pillar for an unlinked
-- legacy channel. Unknown channels need explicit operator classification.
UPDATE "Channel" AS channel SET "musicRightsUse" = policy."rightsUse"
FROM "AutoDjPolicy" AS policy
WHERE policy."channelId" = channel."id" AND policy."organisationId" = channel."organisationId";

UPDATE "Channel" AS channel SET "musicRightsUse" =
  CASE station."productFamily"::text
    WHEN 'RETAIL' THEN 'RETAIL_RADIO'::"MusicRightsUse"
    WHEN 'SCHOOL' THEN 'SCHOOL_RADIO'::"MusicRightsUse"
    WHEN 'ONLINE' THEN 'ONLINE_RADIO'::"MusicRightsUse"
    WHEN 'HEALTH' THEN 'HEALTH_RADIO'::"MusicRightsUse"
    WHEN 'FAITH' THEN 'FAITH_RADIO'::"MusicRightsUse"
    WHEN 'ORGANISATIONS' THEN 'ORGANISATIONS_RADIO'::"MusicRightsUse"
    ELSE NULL
  END
FROM "Station" AS station
WHERE channel."stationId" = station."id" AND channel."organisationId" = station."organisationId";

ALTER TABLE "SmartPlaylist"
  ADD COLUMN "simpleBuildMode" "SimplePlaylistBuildMode",
  ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "genreCodes" JSONB;

CREATE TABLE "SubscriberPlaylistEvent" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "smartPlaylistId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriberPlaylistEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriberPlaylistEvent_id_organisationId_key" ON "SubscriberPlaylistEvent"("id", "organisationId");
CREATE INDEX "SubscriberPlaylistEvent_organisationId_channelId_startsAt_endsAt_idx" ON "SubscriberPlaylistEvent"("organisationId", "channelId", "startsAt", "endsAt");
CREATE INDEX "SubscriberPlaylistEvent_smartPlaylistId_endsAt_idx" ON "SubscriberPlaylistEvent"("smartPlaylistId", "endsAt");

ALTER TABLE "SubscriberPlaylistEvent" ADD CONSTRAINT "SubscriberPlaylistEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriberPlaylistEvent" ADD CONSTRAINT "SubscriberPlaylistEvent_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriberPlaylistEvent" ADD CONSTRAINT "SubscriberPlaylistEvent_smartPlaylistId_organisationId_fkey" FOREIGN KEY ("smartPlaylistId", "organisationId") REFERENCES "SmartPlaylist"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriberPlaylistEvent" ADD CONSTRAINT "SubscriberPlaylistEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
