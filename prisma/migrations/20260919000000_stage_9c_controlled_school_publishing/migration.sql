ALTER TABLE "Plan" ADD COLUMN "schoolPublicPublishingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "schoolPublicPublishingEnabled" BOOLEAN;

CREATE TYPE "SchoolPublicationDecisionType" AS ENUM ('PUBLISHED', 'UNPUBLISHED', 'AUTO_WITHDRAWN');

ALTER TABLE "SchoolPodcastEpisode"
  ADD COLUMN "publicationRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publicationPolicyVersion" TEXT,
  ADD COLUMN "lastPolicyCheckAt" TIMESTAMP(3),
  ADD COLUMN "unpublishReason" TEXT;

CREATE TABLE "SchoolPublicationDecision" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "podcastEpisodeId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "decision" "SchoolPublicationDecisionType" NOT NULL,
    "policyVersion" TEXT NOT NULL DEFAULT 'school-publication-v1',
    "policySnapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolPublicationDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SchoolPublicationDecision_organisationId_createdAt_idx" ON "SchoolPublicationDecision"("organisationId", "createdAt");
CREATE INDEX "SchoolPublicationDecision_podcastEpisodeId_createdAt_idx" ON "SchoolPublicationDecision"("podcastEpisodeId", "createdAt");
CREATE INDEX "SchoolPublicationDecision_actorUserId_idx" ON "SchoolPublicationDecision"("actorUserId");

ALTER TABLE "SchoolPublicationDecision" ADD CONSTRAINT "SchoolPublicationDecision_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPublicationDecision" ADD CONSTRAINT "SchoolPublicationDecision_podcastEpisodeId_fkey" FOREIGN KEY ("podcastEpisodeId") REFERENCES "SchoolPodcastEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPublicationDecision" ADD CONSTRAINT "SchoolPublicationDecision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
