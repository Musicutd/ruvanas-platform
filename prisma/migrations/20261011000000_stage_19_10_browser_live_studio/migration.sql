-- Stage 19.10: extend the existing governed Live Studio for Online Radio.
CREATE TYPE "LiveStudioProduct" AS ENUM ('SCHOOL_RADIO', 'ONLINE_RADIO');

ALTER TABLE "LiveStudioSession"
  ALTER COLUMN "programmeId" DROP NOT NULL,
  ALTER COLUMN "fallbackPromoVersionId" DROP NOT NULL,
  ADD COLUMN "product" "LiveStudioProduct" NOT NULL DEFAULT 'SCHOOL_RADIO',
  ADD COLUMN "djAccessGrantId" TEXT,
  ADD COLUMN "externalLiveSourceId" TEXT,
  ADD COLUMN "mixerStateJson" JSONB,
  ADD COLUMN "providerKey" TEXT,
  ADD COLUMN "providerSessionRef" TEXT,
  ADD COLUMN "providerPublishEncrypted" TEXT,
  ADD COLUMN "providerPlaybackUrl" TEXT,
  ADD COLUMN "providerExpiresAt" TIMESTAMP(3),
  ADD COLUMN "presenterJoinedAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "DjAccessGrant_id_organisationId_channelId_key"
  ON "DjAccessGrant"("id", "organisationId", "channelId");
CREATE UNIQUE INDEX "LiveStudioSession_externalLiveSourceId_organisationId_channelId_key"
  ON "LiveStudioSession"("externalLiveSourceId", "organisationId", "channelId");
CREATE INDEX "LiveStudioSession_organisationId_product_status_scheduledStart_idx"
  ON "LiveStudioSession"("organisationId", "product", "status", "scheduledStart");
CREATE INDEX "LiveStudioSession_djAccessGrantId_status_idx"
  ON "LiveStudioSession"("djAccessGrantId", "status");
CREATE INDEX "LiveStudioSession_lastHeartbeatAt_status_idx"
  ON "LiveStudioSession"("lastHeartbeatAt", "status");

CREATE UNIQUE INDEX "LiveStudioSession_one_open_online_session_per_channel_key"
  ON "LiveStudioSession"("channelId")
  WHERE "product" = 'ONLINE_RADIO'
    AND "status" IN ('CREATED', 'SOUNDCHECK', 'READY', 'ON_AIR');

CREATE UNIQUE INDEX "LiveStudioSession_one_open_online_session_per_grant_key"
  ON "LiveStudioSession"("djAccessGrantId")
  WHERE "product" = 'ONLINE_RADIO'
    AND "status" IN ('CREATED', 'SOUNDCHECK', 'READY', 'ON_AIR');

ALTER TABLE "LiveStudioSession"
  ADD CONSTRAINT "LiveStudioSession_product_ownership_check" CHECK (
    (
      "product" = 'SCHOOL_RADIO'
      AND "programmeId" IS NOT NULL
      AND "fallbackPromoVersionId" IS NOT NULL
      AND "djAccessGrantId" IS NULL
    )
    OR
    (
      "product" = 'ONLINE_RADIO'
      AND "programmeId" IS NULL
      AND "episodeId" IS NULL
      AND "fallbackPromoVersionId" IS NULL
      AND "djAccessGrantId" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "LiveStudioSession_provider_state_check" CHECK (
    (
      "providerSessionRef" IS NULL
      AND "providerPublishEncrypted" IS NULL
      AND "providerPlaybackUrl" IS NULL
      AND "externalLiveSourceId" IS NULL
    )
    OR
    (
      "product" = 'ONLINE_RADIO'
      AND "providerKey" IS NOT NULL
      AND "providerSessionRef" IS NOT NULL
      AND "providerPublishEncrypted" IS NOT NULL
      AND "providerPlaybackUrl" IS NOT NULL
      AND "providerExpiresAt" IS NOT NULL
      AND "externalLiveSourceId" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "LiveStudioSession_version_check" CHECK ("sessionVersion" >= 0),
  ADD CONSTRAINT "LiveStudioSession_window_check" CHECK ("scheduledEnd" > "scheduledStart");

ALTER TABLE "LiveStudioSession"
  DROP CONSTRAINT "LiveStudioSession_channelId_fkey";

ALTER TABLE "LiveStudioSession"
  ADD CONSTRAINT "LiveStudioSession_channelId_organisationId_fkey"
    FOREIGN KEY ("channelId", "organisationId")
    REFERENCES "Channel"("id", "organisationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LiveStudioSession_djAccessGrantId_organisationId_channelId_fkey"
    FOREIGN KEY ("djAccessGrantId", "organisationId", "channelId")
    REFERENCES "DjAccessGrant"("id", "organisationId", "channelId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LiveStudioSession_externalLiveSourceId_organisationId_channelId_fkey"
    FOREIGN KEY ("externalLiveSourceId", "organisationId", "channelId")
    REFERENCES "ExternalLiveSource"("id", "organisationId", "channelId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
