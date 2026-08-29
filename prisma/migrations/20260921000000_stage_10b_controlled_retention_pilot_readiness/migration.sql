CREATE TYPE "SchoolRetentionHoldScope" AS ENUM ('ORGANISATION', 'EPISODE', 'CONTRIBUTOR', 'MEDIA_ASSET');
CREATE TYPE "SchoolPilotReadinessStatus" AS ENUM ('IN_PROGRESS', 'BLOCKED', 'READY');

CREATE TABLE "SchoolRetentionHold" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "scope" "SchoolRetentionHoldScope" NOT NULL,
    "referenceId" TEXT,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "releasedByUserId" TEXT,
    "releaseReason" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolRetentionHold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolPilotReadiness" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "status" "SchoolPilotReadinessStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "staffTrainingConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "emergencyWithdrawalDrillConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "retentionReviewConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "supportContactsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "recoveryPlanConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPilotReadiness_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SchoolRetentionHold_organisationId_releasedAt_createdAt_idx" ON "SchoolRetentionHold"("organisationId", "releasedAt", "createdAt");
CREATE INDEX "SchoolRetentionHold_organisationId_scope_referenceId_idx" ON "SchoolRetentionHold"("organisationId", "scope", "referenceId");
CREATE INDEX "SchoolRetentionHold_createdByUserId_idx" ON "SchoolRetentionHold"("createdByUserId");
CREATE INDEX "SchoolRetentionHold_releasedByUserId_idx" ON "SchoolRetentionHold"("releasedByUserId");
CREATE UNIQUE INDEX "SchoolRetentionHold_active_scope_reference_key" ON "SchoolRetentionHold"("organisationId", "scope", COALESCE("referenceId", '')) WHERE "releasedAt" IS NULL;
CREATE UNIQUE INDEX "SchoolPilotReadiness_organisationId_key" ON "SchoolPilotReadiness"("organisationId");
CREATE INDEX "SchoolPilotReadiness_status_updatedAt_idx" ON "SchoolPilotReadiness"("status", "updatedAt");
CREATE INDEX "SchoolPilotReadiness_updatedByUserId_idx" ON "SchoolPilotReadiness"("updatedByUserId");

ALTER TABLE "SchoolRetentionHold" ADD CONSTRAINT "SchoolRetentionHold_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolRetentionHold" ADD CONSTRAINT "SchoolRetentionHold_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolRetentionHold" ADD CONSTRAINT "SchoolRetentionHold_releasedByUserId_fkey" FOREIGN KEY ("releasedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotReadiness" ADD CONSTRAINT "SchoolPilotReadiness_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotReadiness" ADD CONSTRAINT "SchoolPilotReadiness_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
