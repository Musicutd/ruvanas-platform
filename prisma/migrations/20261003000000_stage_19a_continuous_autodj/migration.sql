-- Stage 19A: optional, channel-scoped continuous AutoDJ with an explicit backup.
ALTER TYPE "NotificationType" ADD VALUE 'AUTODJ_FAILURE';

CREATE TYPE "AutoDjPlaybackPolicy" AS ENUM ('FOLLOW_LOCATION_HOURS', 'RUN_24_7');

CREATE TABLE "AutoDjPolicy" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultMusicModeId" TEXT,
    "backupMusicModeId" TEXT,
    "playbackPolicy" "AutoDjPlaybackPolicy" NOT NULL DEFAULT 'FOLLOW_LOCATION_HOURS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoDjPolicy_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProofOfPlayEvent" ADD COLUMN "programmingSource" VARCHAR(32);

CREATE UNIQUE INDEX "AutoDjPolicy_channelId_organisationId_key" ON "AutoDjPolicy"("channelId", "organisationId");
CREATE UNIQUE INDEX "Channel_id_organisationId_key" ON "Channel"("id", "organisationId");
CREATE UNIQUE INDEX "MusicMode_id_organisationId_key" ON "MusicMode"("id", "organisationId");
CREATE INDEX "AutoDjPolicy_organisationId_enabled_idx" ON "AutoDjPolicy"("organisationId", "enabled");
CREATE INDEX "AutoDjPolicy_defaultMusicModeId_idx" ON "AutoDjPolicy"("defaultMusicModeId");
CREATE INDEX "AutoDjPolicy_backupMusicModeId_idx" ON "AutoDjPolicy"("backupMusicModeId");

ALTER TABLE "AutoDjPolicy" ADD CONSTRAINT "AutoDjPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutoDjPolicy" ADD CONSTRAINT "AutoDjPolicy_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutoDjPolicy" ADD CONSTRAINT "AutoDjPolicy_defaultMusicModeId_organisationId_fkey" FOREIGN KEY ("defaultMusicModeId", "organisationId") REFERENCES "MusicMode"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutoDjPolicy" ADD CONSTRAINT "AutoDjPolicy_backupMusicModeId_organisationId_fkey" FOREIGN KEY ("backupMusicModeId", "organisationId") REFERENCES "MusicMode"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
