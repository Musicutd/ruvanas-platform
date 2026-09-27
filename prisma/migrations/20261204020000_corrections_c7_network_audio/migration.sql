CREATE TABLE "CorrectionsNetworkAudioDistribution" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "sourceFacilityId" TEXT,
  "targetFacilityId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "rehabilitationId" TEXT,
  "announcementId" TEXT,
  "mediaAssetId" TEXT NOT NULL,
  "promoVersionId" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "territoryCode" TEXT NOT NULL,
  "status" "CorrectionsDistributionStatus" NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionsNetworkAudioDistribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorrectionsNetworkAudioDistribution_kind_check" CHECK (
    ("kind" = 'REHABILITATION' AND "rehabilitationId" IS NOT NULL AND "announcementId" IS NULL) OR
    ("kind" = 'ANNOUNCEMENT' AND "announcementId" IS NOT NULL AND "rehabilitationId" IS NULL)
  ),
  CONSTRAINT "CorrectionsNetworkAudioDistribution_period_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"),
  CONSTRAINT "CorrectionsNetworkAudioDistribution_territory_check" CHECK ("territoryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "CorrectionsNetworkAudioDistribution_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkAudioDistribution_sourceFacilityId_fkey" FOREIGN KEY ("sourceFacilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkAudioDistribution_targetFacilityId_fkey" FOREIGN KEY ("targetFacilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkAudioDistribution_rehabilitationId_fkey" FOREIGN KEY ("rehabilitationId") REFERENCES "CorrectionsRehabContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkAudioDistribution_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "CorrectionsAnnouncement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkAudioDistribution_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkAudioDistribution_promoVersionId_fkey" FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectionsNetworkAudioDistribution_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorrectionsNetworkAudioDistribution_rehabilitationId_targetFacilityId_promoVersionId_key" ON "CorrectionsNetworkAudioDistribution"("rehabilitationId", "targetFacilityId", "promoVersionId");
CREATE UNIQUE INDEX "CorrectionsNetworkAudioDistribution_announcementId_targetFacilityId_key" ON "CorrectionsNetworkAudioDistribution"("announcementId", "targetFacilityId");
CREATE INDEX "CorrectionsNetworkAudioDistribution_organisationId_targetFacilityId_status_idx" ON "CorrectionsNetworkAudioDistribution"("organisationId", "targetFacilityId", "status");

ALTER TABLE "CorrectionsNetworkWindow" ADD COLUMN "audioDistributionId" TEXT;
ALTER TABLE "CorrectionsNetworkWindow" ADD CONSTRAINT "CorrectionsNetworkWindow_audioDistributionId_fkey"
  FOREIGN KEY ("audioDistributionId") REFERENCES "CorrectionsNetworkAudioDistribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsNetworkWindow" ADD CONSTRAINT "CorrectionsNetworkWindow_single_distribution_check"
  CHECK ("distributionId" IS NULL OR "audioDistributionId" IS NULL);
CREATE INDEX "CorrectionsNetworkWindow_audioDistributionId_idx" ON "CorrectionsNetworkWindow"("audioDistributionId");
