CREATE TYPE "BetaProgrammeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED');
CREATE TYPE "BetaParticipantStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'REMOVED');
CREATE TYPE "BetaFeedbackCategory" AS ENUM ('USABILITY', 'RELIABILITY', 'CONTENT', 'ACCESS', 'FEATURE_REQUEST', 'OTHER');
CREATE TYPE "BetaFeedbackSeverity" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'BLOCKER');
CREATE TYPE "BetaFeedbackStatus" AS ENUM ('NEW', 'TRIAGED', 'PLANNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

CREATE TABLE "BetaProgramme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "BetaProgrammeStatus" NOT NULL DEFAULT 'DRAFT',
    "maxOrganisations" INTEGER NOT NULL DEFAULT 25,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BetaProgramme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BetaParticipant" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "product" "PlanProductFamily" NOT NULL,
    "status" "BetaParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "admittedByUserId" TEXT NOT NULL,
    "internalNote" TEXT,
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BetaParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BetaFeedback" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "triagedByUserId" TEXT,
    "product" "PlanProductFamily" NOT NULL,
    "category" "BetaFeedbackCategory" NOT NULL,
    "severity" "BetaFeedbackSeverity" NOT NULL DEFAULT 'NORMAL',
    "status" "BetaFeedbackStatus" NOT NULL DEFAULT 'NEW',
    "rating" INTEGER,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "adminResponse" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BetaProgramme_status_createdAt_idx" ON "BetaProgramme"("status", "createdAt");
CREATE UNIQUE INDEX "BetaParticipant_programmeId_organisationId_product_key" ON "BetaParticipant"("programmeId", "organisationId", "product");
CREATE INDEX "BetaParticipant_organisationId_status_updatedAt_idx" ON "BetaParticipant"("organisationId", "status", "updatedAt");
CREATE INDEX "BetaParticipant_programmeId_status_product_idx" ON "BetaParticipant"("programmeId", "status", "product");
CREATE INDEX "BetaFeedback_programmeId_status_severity_createdAt_idx" ON "BetaFeedback"("programmeId", "status", "severity", "createdAt");
CREATE INDEX "BetaFeedback_organisationId_status_createdAt_idx" ON "BetaFeedback"("organisationId", "status", "createdAt");
CREATE INDEX "BetaFeedback_participantId_createdAt_idx" ON "BetaFeedback"("participantId", "createdAt");

ALTER TABLE "BetaProgramme" ADD CONSTRAINT "BetaProgramme_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BetaParticipant" ADD CONSTRAINT "BetaParticipant_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "BetaProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BetaParticipant" ADD CONSTRAINT "BetaParticipant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BetaParticipant" ADD CONSTRAINT "BetaParticipant_admittedByUserId_fkey" FOREIGN KEY ("admittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "BetaProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "BetaParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_triagedByUserId_fkey" FOREIGN KEY ("triagedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
