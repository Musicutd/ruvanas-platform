CREATE TABLE "StudioConsolePreference" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "contextKey" TEXT NOT NULL DEFAULT 'GLOBAL', "preset" TEXT NOT NULL DEFAULT 'PRESENTER',
  "panels" JSONB NOT NULL DEFAULT '[]', "sizes" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "StudioConsolePreference_organisationId_userId_contextKey_key"
  ON "StudioConsolePreference"("organisationId", "userId", "contextKey");
CREATE INDEX "StudioConsolePreference_organisationId_updatedAt_idx"
  ON "StudioConsolePreference"("organisationId", "updatedAt");

CREATE TABLE "StudioCartBank" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL, "channelId" TEXT,
  "productFamily" "PlanProductFamily" NOT NULL, "name" TEXT NOT NULL, "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "StudioCartBank_organisationId_name_channelId_key"
  ON "StudioCartBank"("organisationId", "name", "channelId");
CREATE INDEX "StudioCartBank_organisationId_channelId_updatedAt_idx"
  ON "StudioCartBank"("organisationId", "channelId", "updatedAt");

CREATE TABLE "StudioCart" (
  "id" TEXT PRIMARY KEY, "bankId" TEXT NOT NULL, "organisationId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL, "label" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "shortcut" TEXT, "behaviour" TEXT NOT NULL DEFAULT 'PLAY_ONCE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioCart_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "StudioCartBank"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudioCart_bankId_position_key" ON "StudioCart"("bankId", "position");
CREATE INDEX "StudioCart_organisationId_mediaAssetId_idx" ON "StudioCart"("organisationId", "mediaAssetId");
ALTER TABLE "StudioCart" ADD CONSTRAINT "StudioCart_position_nonnegative" CHECK ("position" >= 0);
ALTER TABLE "StudioCart" ADD CONSTRAINT "StudioCart_behaviour_valid" CHECK ("behaviour" IN ('PLAY_ONCE', 'LOOP', 'FADE'));

CREATE TABLE "StudioMixPoint" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL, "mediaAssetId" TEXT NOT NULL,
  "type" TEXT NOT NULL, "positionMs" INTEGER NOT NULL, "provenance" TEXT NOT NULL DEFAULT 'MANUAL',
  "version" INTEGER NOT NULL DEFAULT 1, "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "StudioMixPoint_organisationId_mediaAssetId_type_key"
  ON "StudioMixPoint"("organisationId", "mediaAssetId", "type");
CREATE INDEX "StudioMixPoint_organisationId_mediaAssetId_idx"
  ON "StudioMixPoint"("organisationId", "mediaAssetId");
ALTER TABLE "StudioMixPoint" ADD CONSTRAINT "StudioMixPoint_position_nonnegative" CHECK ("positionMs" >= 0);
ALTER TABLE "StudioMixPoint" ADD CONSTRAINT "StudioMixPoint_type_valid" CHECK ("type" IN ('CUE_IN', 'INTRO_END', 'MIX_START', 'FADE_START', 'END'));

CREATE TABLE "StudioPresenterNote" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL, "channelId" TEXT NOT NULL,
  "playoutSessionId" TEXT, "programmeScheduleId" TEXT, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "alertAt" TIMESTAMP(3), "acknowledgedAt" TIMESTAMP(3), "acknowledgedByUserId" TEXT,
  "createdByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "StudioPresenterNote_organisationId_channelId_alertAt_idx"
  ON "StudioPresenterNote"("organisationId", "channelId", "alertAt");
CREATE INDEX "StudioPresenterNote_organisationId_playoutSessionId_idx"
  ON "StudioPresenterNote"("organisationId", "playoutSessionId");
