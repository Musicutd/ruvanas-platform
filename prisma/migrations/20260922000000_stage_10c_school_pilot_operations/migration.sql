CREATE TYPE "SchoolPilotRunStatus" AS ENUM ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "SchoolPilotEventKind" AS ENUM ('DRILL', 'INCIDENT');
CREATE TYPE "SchoolPilotEventCategory" AS ENUM ('EMERGENCY_WITHDRAWAL', 'SERVICE_RECOVERY', 'SUPPORT_ESCALATION', 'CONTENT_SAFETY', 'PLATFORM_AVAILABILITY', 'OTHER');
CREATE TYPE "SchoolPilotEventSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "SchoolPilotEventStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "SchoolPilotEventOutcome" AS ENUM ('PASSED', 'NEEDS_ACTION', 'NOT_APPLICABLE');

CREATE TABLE "SchoolPilotRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SchoolPilotRunStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedStartAt" TIMESTAMP(3) NOT NULL,
    "plannedEndAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "transitionReason" TEXT,
    "readinessSnapshot" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPilotRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SchoolPilotRun_planned_window_check" CHECK ("plannedEndAt" > "plannedStartAt")
);

CREATE TABLE "SchoolPilotEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "kind" "SchoolPilotEventKind" NOT NULL,
    "category" "SchoolPilotEventCategory" NOT NULL,
    "severity" "SchoolPilotEventSeverity" NOT NULL,
    "status" "SchoolPilotEventStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "SchoolPilotEventOutcome",
    "summary" TEXT NOT NULL,
    "responseActions" TEXT,
    "resolutionNotes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPilotEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SchoolPilotEvent_drill_outcome_check" CHECK (
      ("kind" = 'DRILL' AND "outcome" IS NOT NULL AND "status" = 'RESOLVED') OR
      ("kind" = 'INCIDENT' AND "outcome" IS NULL)
    )
);

CREATE INDEX "SchoolPilotRun_organisationId_status_plannedStartAt_idx" ON "SchoolPilotRun"("organisationId", "status", "plannedStartAt");
CREATE INDEX "SchoolPilotRun_createdByUserId_idx" ON "SchoolPilotRun"("createdByUserId");
CREATE INDEX "SchoolPilotRun_updatedByUserId_idx" ON "SchoolPilotRun"("updatedByUserId");
CREATE UNIQUE INDEX "SchoolPilotRun_one_operational_per_organisation_key" ON "SchoolPilotRun"("organisationId") WHERE "status" IN ('ACTIVE', 'PAUSED');
CREATE INDEX "SchoolPilotEvent_organisationId_status_occurredAt_idx" ON "SchoolPilotEvent"("organisationId", "status", "occurredAt");
CREATE INDEX "SchoolPilotEvent_pilotRunId_occurredAt_idx" ON "SchoolPilotEvent"("pilotRunId", "occurredAt");
CREATE INDEX "SchoolPilotEvent_createdByUserId_idx" ON "SchoolPilotEvent"("createdByUserId");
CREATE INDEX "SchoolPilotEvent_acknowledgedByUserId_idx" ON "SchoolPilotEvent"("acknowledgedByUserId");
CREATE INDEX "SchoolPilotEvent_resolvedByUserId_idx" ON "SchoolPilotEvent"("resolvedByUserId");

ALTER TABLE "SchoolPilotRun" ADD CONSTRAINT "SchoolPilotRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotRun" ADD CONSTRAINT "SchoolPilotRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotRun" ADD CONSTRAINT "SchoolPilotRun_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotEvent" ADD CONSTRAINT "SchoolPilotEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotEvent" ADD CONSTRAINT "SchoolPilotEvent_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "SchoolPilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotEvent" ADD CONSTRAINT "SchoolPilotEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotEvent" ADD CONSTRAINT "SchoolPilotEvent_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolPilotEvent" ADD CONSTRAINT "SchoolPilotEvent_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
