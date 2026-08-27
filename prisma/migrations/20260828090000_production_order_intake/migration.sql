-- Stage 4A1: tenant-scoped Ruvanas Studio production-order intake and history.

CREATE TYPE "ProductionOrderStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'IN_PRODUCTION',
  'AWAITING_CUSTOMER_APPROVAL',
  'CHANGES_REQUESTED',
  'APPROVED',
  'DELIVERED',
  'CANCELLED'
);

CREATE TYPE "ProductionOrderPriority" AS ENUM ('STANDARD', 'PRIORITY', 'URGENT');
CREATE TYPE "ProductionFundingType" AS ENUM ('PLAN_INCLUDED', 'PAID_ADD_ON');
CREATE TYPE "ProductionOrderEventType" AS ENUM ('CREATED', 'STATUS_CHANGED');

CREATE TABLE "ProductionOrder" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "title" TEXT NOT NULL,
  "promotionDetails" TEXT NOT NULL,
  "mandatoryLegalWording" TEXT,
  "languageCodes" TEXT[] NOT NULL,
  "voicePreference" TEXT,
  "toneStyle" TEXT,
  "targetDurationSeconds" INTEGER,
  "musicBedPreference" TEXT,
  "campaignStartsOn" DATE,
  "campaignEndsOn" DATE,
  "pronunciationNotes" TEXT,
  "contactName" TEXT NOT NULL,
  "contactEmail" TEXT NOT NULL,
  "fundingType" "ProductionFundingType" NOT NULL,
  "priority" "ProductionOrderPriority" NOT NULL DEFAULT 'STANDARD',
  "deadlineAt" TIMESTAMP(3),
  "status" "ProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "customerApprovedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionOrder_targetDurationSeconds_check" CHECK (
    "targetDurationSeconds" IS NULL OR ("targetDurationSeconds" BETWEEN 5 AND 600)
  ),
  CONSTRAINT "ProductionOrder_campaignDates_check" CHECK (
    ("campaignStartsOn" IS NULL AND "campaignEndsOn" IS NULL)
    OR
    ("campaignStartsOn" IS NOT NULL AND "campaignEndsOn" IS NOT NULL AND "campaignStartsOn" <= "campaignEndsOn")
  )
);

CREATE TABLE "ProductionOrderEvent" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "eventType" "ProductionOrderEventType" NOT NULL,
  "fromStatus" "ProductionOrderStatus",
  "toStatus" "ProductionOrderStatus",
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductionOrder_organisationId_status_createdAt_idx" ON "ProductionOrder"("organisationId", "status", "createdAt");
CREATE INDEX "ProductionOrder_createdByUserId_idx" ON "ProductionOrder"("createdByUserId");
CREATE INDEX "ProductionOrder_assignedToUserId_status_idx" ON "ProductionOrder"("assignedToUserId", "status");
CREATE INDEX "ProductionOrder_deadlineAt_idx" ON "ProductionOrder"("deadlineAt");
CREATE INDEX "ProductionOrderEvent_organisationId_createdAt_idx" ON "ProductionOrderEvent"("organisationId", "createdAt");
CREATE INDEX "ProductionOrderEvent_orderId_createdAt_idx" ON "ProductionOrderEvent"("orderId", "createdAt");
CREATE INDEX "ProductionOrderEvent_actorUserId_createdAt_idx" ON "ProductionOrderEvent"("actorUserId", "createdAt");

ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderEvent" ADD CONSTRAINT "ProductionOrderEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderEvent" ADD CONSTRAINT "ProductionOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderEvent" ADD CONSTRAINT "ProductionOrderEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

