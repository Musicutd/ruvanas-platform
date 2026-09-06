ALTER TABLE "Station"
  ADD COLUMN "publicPlayerEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publicPlayerTagline" TEXT,
  ADD COLUMN "publicPlayerAccent" TEXT NOT NULL DEFAULT '#f4b942';

CREATE UNIQUE INDEX "Station_id_organisationId_key"
  ON "Station"("id", "organisationId");

CREATE TABLE "PublicListenerLease" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "sessionHash" CHAR(64) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PublicListenerLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicListenerLease_stationId_sessionHash_key"
  ON "PublicListenerLease"("stationId", "sessionHash");
CREATE INDEX "PublicListenerLease_organisationId_expiresAt_idx"
  ON "PublicListenerLease"("organisationId", "expiresAt");
CREATE INDEX "PublicListenerLease_stationId_expiresAt_idx"
  ON "PublicListenerLease"("stationId", "expiresAt");
CREATE INDEX "PublicListenerLease_channelId_expiresAt_idx"
  ON "PublicListenerLease"("channelId", "expiresAt");

ALTER TABLE "PublicListenerLease"
  ADD CONSTRAINT "PublicListenerLease_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicListenerLease"
  ADD CONSTRAINT "PublicListenerLease_stationId_organisationId_fkey"
  FOREIGN KEY ("stationId", "organisationId") REFERENCES "Station"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicListenerLease"
  ADD CONSTRAINT "PublicListenerLease_channelId_organisationId_fkey"
  FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
