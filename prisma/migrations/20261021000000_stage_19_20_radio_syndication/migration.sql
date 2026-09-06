CREATE TYPE "RadioSyndicationKind" AS ENUM ('RECORDED_PROGRAMME', 'LIVE_RELAY');
CREATE TYPE "RadioSyndicationOfferStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'PAUSED', 'WITHDRAWN');
CREATE TYPE "RadioSyndicationAgreementStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'REVOKED');

CREATE TABLE "RadioSyndicationOffer" (
  "id" TEXT NOT NULL,
  "stationNetworkId" TEXT NOT NULL,
  "sourceNetworkAgreementId" TEXT NOT NULL,
  "sourceOrganisationId" TEXT NOT NULL,
  "sourceStationId" TEXT NOT NULL,
  "kind" "RadioSyndicationKind" NOT NULL,
  "sourcePodcastEpisodeId" TEXT,
  "sourceChannelId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "rightsHolder" TEXT NOT NULL,
  "rightsReference" TEXT NOT NULL,
  "rightsBasis" "MusicRightsBasis" NOT NULL,
  "permittedTerritories" TEXT NOT NULL,
  "availableFrom" TIMESTAMP(3) NOT NULL,
  "availableUntil" TIMESTAMP(3),
  "termsVersion" TEXT NOT NULL DEFAULT 'radio-syndication-v1',
  "status" "RadioSyndicationOfferStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "publishedByUserId" TEXT,
  "changedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RadioSyndicationOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RadioSyndicationOffer_source_kind_check" CHECK (
    ("kind" = 'RECORDED_PROGRAMME' AND "sourcePodcastEpisodeId" IS NOT NULL AND "sourceChannelId" IS NULL) OR
    ("kind" = 'LIVE_RELAY' AND "sourcePodcastEpisodeId" IS NULL AND "sourceChannelId" IS NOT NULL)
  ),
  CONSTRAINT "RadioSyndicationOffer_window_check" CHECK ("availableUntil" IS NULL OR "availableUntil" > "availableFrom")
);

CREATE TABLE "RadioSyndicationAgreement" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "targetNetworkAgreementId" TEXT NOT NULL,
  "targetOrganisationId" TEXT NOT NULL,
  "targetStationId" TEXT NOT NULL,
  "targetChannelId" TEXT,
  "requestedTerritories" TEXT NOT NULL,
  "requestedFrom" TIMESTAMP(3) NOT NULL,
  "requestedUntil" TIMESTAMP(3),
  "intendedUse" TEXT NOT NULL,
  "status" "RadioSyndicationAgreementStatus" NOT NULL DEFAULT 'PENDING',
  "policyVersion" TEXT NOT NULL DEFAULT 'radio-syndication-v1',
  "requestedByUserId" TEXT NOT NULL,
  "decidedByUserId" TEXT,
  "revokedByUserId" TEXT,
  "importedByUserId" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "importedAt" TIMESTAMP(3),
  "decisionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RadioSyndicationAgreement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RadioSyndicationAgreement_window_check" CHECK ("requestedUntil" IS NULL OR "requestedUntil" > "requestedFrom")
);

CREATE INDEX "RadioSyndicationOffer_stationNetworkId_sourcePodcastEpisode_idx" ON "RadioSyndicationOffer"("stationNetworkId", "sourcePodcastEpisodeId", "status");
CREATE INDEX "RadioSyndicationOffer_stationNetworkId_sourceChannelId_stat_idx" ON "RadioSyndicationOffer"("stationNetworkId", "sourceChannelId", "status");
CREATE INDEX "RadioSyndicationOffer_stationNetworkId_status_availableFrom_idx" ON "RadioSyndicationOffer"("stationNetworkId", "status", "availableFrom");
CREATE INDEX "RadioSyndicationOffer_sourceOrganisationId_status_idx" ON "RadioSyndicationOffer"("sourceOrganisationId", "status");
CREATE INDEX "RadioSyndicationOffer_sourceStationId_status_idx" ON "RadioSyndicationOffer"("sourceStationId", "status");
CREATE INDEX "RadioSyndicationOffer_sourceNetworkAgreementId_idx" ON "RadioSyndicationOffer"("sourceNetworkAgreementId");
CREATE INDEX "RadioSyndicationAgreement_offerId_targetStationId_status_idx" ON "RadioSyndicationAgreement"("offerId", "targetStationId", "status");
CREATE INDEX "RadioSyndicationAgreement_targetOrganisationId_status_idx" ON "RadioSyndicationAgreement"("targetOrganisationId", "status");
CREATE INDEX "RadioSyndicationAgreement_targetStationId_status_idx" ON "RadioSyndicationAgreement"("targetStationId", "status");
CREATE INDEX "RadioSyndicationAgreement_targetNetworkAgreementId_idx" ON "RadioSyndicationAgreement"("targetNetworkAgreementId");
CREATE INDEX "RadioSyndicationAgreement_offerId_status_idx" ON "RadioSyndicationAgreement"("offerId", "status");

ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_stationNetworkId_fkey" FOREIGN KEY ("stationNetworkId") REFERENCES "StationNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_sourceNetworkAgreementId_fkey" FOREIGN KEY ("sourceNetworkAgreementId") REFERENCES "StationNetworkAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_sourceOrganisationId_fkey" FOREIGN KEY ("sourceOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_sourceStationId_sourceOrganisationId_fkey" FOREIGN KEY ("sourceStationId", "sourceOrganisationId") REFERENCES "Station"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_sourcePodcastEpisodeId_fkey" FOREIGN KEY ("sourcePodcastEpisodeId") REFERENCES "SchoolPodcastEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_sourceChannelId_sourceOrganisationId_fkey" FOREIGN KEY ("sourceChannelId", "sourceOrganisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationOffer" ADD CONSTRAINT "RadioSyndicationOffer_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "RadioSyndicationOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_targetNetworkAgreementId_fkey" FOREIGN KEY ("targetNetworkAgreementId") REFERENCES "StationNetworkAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_targetOrganisationId_fkey" FOREIGN KEY ("targetOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_targetStationId_targetOrganisati_fkey" FOREIGN KEY ("targetStationId", "targetOrganisationId") REFERENCES "Station"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_targetChannelId_targetOrganisati_fkey" FOREIGN KEY ("targetChannelId", "targetOrganisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioSyndicationAgreement" ADD CONSTRAINT "RadioSyndicationAgreement_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
