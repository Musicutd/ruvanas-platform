CREATE TYPE "SchoolEpisodeExchangeOfferStatus" AS ENUM ('AVAILABLE', 'PAUSED', 'WITHDRAWN');
CREATE TYPE "SchoolEpisodeExchangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'REVOKED');

CREATE TABLE "SchoolEpisodeExchangeOffer" (
    "id" TEXT NOT NULL,
    "schoolNetworkId" TEXT NOT NULL,
    "sourceOrganisationId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "approvedPromoVersionId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceSummary" TEXT,
    "languageCode" TEXT NOT NULL DEFAULT 'und',
    "durationSeconds" INTEGER,
    "status" "SchoolEpisodeExchangeOfferStatus" NOT NULL DEFAULT 'AVAILABLE',
    "consentConfirmed" BOOLEAN NOT NULL,
    "policyVersion" TEXT NOT NULL DEFAULT 'school-network-exchange-v1',
    "createdByUserId" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolEpisodeExchangeOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SchoolEpisodeExchangeOffer_consent_check" CHECK ("consentConfirmed" = true),
    CONSTRAINT "SchoolEpisodeExchangeOffer_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" > 0),
    CONSTRAINT "SchoolEpisodeExchangeOffer_withdrawn_check" CHECK (("status" = 'WITHDRAWN' AND "withdrawnAt" IS NOT NULL) OR "status" <> 'WITHDRAWN')
);

CREATE TABLE "SchoolEpisodeExchangeRequest" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "targetOrganisationId" TEXT NOT NULL,
    "status" "SchoolEpisodeExchangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "intendedUse" TEXT NOT NULL,
    "decisionNotes" TEXT,
    "policyVersion" TEXT NOT NULL DEFAULT 'school-network-exchange-v1',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "importedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolEpisodeExchangeRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SchoolEpisodeExchangeRequest_intended_use_check" CHECK (char_length(btrim("intendedUse")) BETWEEN 20 AND 500),
    CONSTRAINT "SchoolEpisodeExchangeRequest_decision_check" CHECK (("status" = 'PENDING' AND "decidedAt" IS NULL) OR ("status" <> 'PENDING' AND "decidedAt" IS NOT NULL)),
    CONSTRAINT "SchoolEpisodeExchangeRequest_revoked_check" CHECK (("status" = 'REVOKED' AND "revokedAt" IS NOT NULL) OR ("status" <> 'REVOKED' AND "revokedAt" IS NULL))
);

ALTER TABLE "SchoolAnnouncement" ADD COLUMN "sourceExchangeRequestId" TEXT;

CREATE UNIQUE INDEX "SchoolEpisodeExchangeOffer_network_episode_key" ON "SchoolEpisodeExchangeOffer"("schoolNetworkId", "episodeId");
CREATE INDEX "SchoolEpisodeExchangeOffer_network_status_idx" ON "SchoolEpisodeExchangeOffer"("schoolNetworkId", "status", "availableAt");
CREATE INDEX "SchoolEpisodeExchangeOffer_source_status_idx" ON "SchoolEpisodeExchangeOffer"("sourceOrganisationId", "status");
CREATE INDEX "SchoolEpisodeExchangeOffer_promo_idx" ON "SchoolEpisodeExchangeOffer"("approvedPromoVersionId");
CREATE INDEX "SchoolEpisodeExchangeOffer_creator_idx" ON "SchoolEpisodeExchangeOffer"("createdByUserId");

CREATE UNIQUE INDEX "SchoolEpisodeExchangeRequest_offer_target_key" ON "SchoolEpisodeExchangeRequest"("offerId", "targetOrganisationId");
CREATE INDEX "SchoolEpisodeExchangeRequest_target_status_idx" ON "SchoolEpisodeExchangeRequest"("targetOrganisationId", "status", "requestedAt");
CREATE INDEX "SchoolEpisodeExchangeRequest_requester_idx" ON "SchoolEpisodeExchangeRequest"("requestedByUserId");
CREATE INDEX "SchoolEpisodeExchangeRequest_decider_idx" ON "SchoolEpisodeExchangeRequest"("decidedByUserId");
CREATE INDEX "SchoolEpisodeExchangeRequest_importer_idx" ON "SchoolEpisodeExchangeRequest"("importedByUserId");

CREATE UNIQUE INDEX "SchoolAnnouncement_sourceExchangeRequestId_key" ON "SchoolAnnouncement"("sourceExchangeRequestId");
CREATE INDEX "SchoolAnnouncement_sourceExchangeRequestId_idx" ON "SchoolAnnouncement"("sourceExchangeRequestId");

ALTER TABLE "SchoolEpisodeExchangeOffer" ADD CONSTRAINT "SchoolEpisodeExchangeOffer_network_fkey" FOREIGN KEY ("schoolNetworkId") REFERENCES "SchoolNetwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeExchangeOffer" ADD CONSTRAINT "SchoolEpisodeExchangeOffer_source_fkey" FOREIGN KEY ("sourceOrganisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeExchangeOffer" ADD CONSTRAINT "SchoolEpisodeExchangeOffer_episode_fkey" FOREIGN KEY ("episodeId") REFERENCES "SchoolEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeExchangeOffer" ADD CONSTRAINT "SchoolEpisodeExchangeOffer_promo_fkey" FOREIGN KEY ("approvedPromoVersionId") REFERENCES "PromoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeExchangeOffer" ADD CONSTRAINT "SchoolEpisodeExchangeOffer_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SchoolEpisodeExchangeRequest" ADD CONSTRAINT "SchoolEpisodeExchangeRequest_offer_fkey" FOREIGN KEY ("offerId") REFERENCES "SchoolEpisodeExchangeOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeExchangeRequest" ADD CONSTRAINT "SchoolEpisodeExchangeRequest_target_fkey" FOREIGN KEY ("targetOrganisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeExchangeRequest" ADD CONSTRAINT "SchoolEpisodeExchangeRequest_requester_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeExchangeRequest" ADD CONSTRAINT "SchoolEpisodeExchangeRequest_decider_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolEpisodeExchangeRequest" ADD CONSTRAINT "SchoolEpisodeExchangeRequest_importer_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SchoolAnnouncement" ADD CONSTRAINT "SchoolAnnouncement_sourceExchangeRequestId_fkey" FOREIGN KEY ("sourceExchangeRequestId") REFERENCES "SchoolEpisodeExchangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
