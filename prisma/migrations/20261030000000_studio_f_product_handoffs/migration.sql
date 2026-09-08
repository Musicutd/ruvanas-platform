CREATE TYPE "StudioProductDestination" AS ENUM ('RETAIL_PROMOTION', 'SCHOOL_EPISODE', 'ONLINE_PODCAST');

CREATE TABLE "StudioProductHandoff" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "renderId" TEXT NOT NULL,
    "promoVersionId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "targetEpisodeId" TEXT,
    "destination" "StudioProductDestination" NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "workflowPath" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioProductHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudioProductHandoff_destinationKey_key" ON "StudioProductHandoff"("destinationKey");
CREATE INDEX "StudioProductHandoff_organisationId_createdAt_idx" ON "StudioProductHandoff"("organisationId", "createdAt");
CREATE INDEX "StudioProductHandoff_projectId_createdAt_idx" ON "StudioProductHandoff"("projectId", "createdAt");
CREATE INDEX "StudioProductHandoff_renderId_destination_idx" ON "StudioProductHandoff"("renderId", "destination");
CREATE INDEX "StudioProductHandoff_targetEpisodeId_idx" ON "StudioProductHandoff"("targetEpisodeId");
CREATE INDEX "StudioProductHandoff_createdByUserId_idx" ON "StudioProductHandoff"("createdByUserId");

ALTER TABLE "StudioProductHandoff" ADD CONSTRAINT "StudioProductHandoff_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioProductHandoff" ADD CONSTRAINT "StudioProductHandoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioProductHandoff" ADD CONSTRAINT "StudioProductHandoff_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "AudioRender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioProductHandoff" ADD CONSTRAINT "StudioProductHandoff_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioProductHandoff" ADD CONSTRAINT "StudioProductHandoff_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioProductHandoff" ADD CONSTRAINT "StudioProductHandoff_targetEpisodeId_fkey" FOREIGN KEY ("targetEpisodeId") REFERENCES "SchoolEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioProductHandoff" ADD CONSTRAINT "StudioProductHandoff_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
