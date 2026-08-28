CREATE TYPE "DataRequestType" AS ENUM ('EXPORT', 'CORRECTION', 'DELETION', 'RESTRICTION');
CREATE TYPE "DataRequestStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'AWAITING_INFORMATION', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED');
CREATE TYPE "RetentionJobStatus" AS ENUM ('QUEUED', 'DRY_RUN_READY', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

CREATE TABLE "CompliancePolicy" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompliancePolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyAcceptance" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "acceptedByUserId" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evidence" JSONB,
  CONSTRAINT "PolicyAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataRequest" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "subjectUserId" TEXT,
  "subjectEmail" TEXT,
  "type" "DataRequestType" NOT NULL,
  "status" "DataRequestStatus" NOT NULL DEFAULT 'OPEN',
  "reference" TEXT NOT NULL,
  "notes" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "completedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetentionPolicy" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "rawPlaybackDays" INTEGER NOT NULL DEFAULT 395,
  "playerHeartbeatDays" INTEGER NOT NULL DEFAULT 90,
  "audioProjectDays" INTEGER NOT NULL DEFAULT 730,
  "supportTicketDays" INTEGER NOT NULL DEFAULT 730,
  "auditDays" INTEGER NOT NULL DEFAULT 2555,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetentionJob" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" "RetentionJobStatus" NOT NULL DEFAULT 'QUEUED',
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  "policySnapshot" JSONB NOT NULL,
  "cutoffs" JSONB NOT NULL,
  "candidateCounts" JSONB,
  "errorMessage" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "reference" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "linkedEntityType" TEXT,
  "linkedEntityId" TEXT,
  "incidentStartedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditExportSeal" (
  "id" TEXT NOT NULL,
  "sequence" SERIAL NOT NULL,
  "organisationId" TEXT NOT NULL,
  "exportJobId" TEXT NOT NULL,
  "previousSealHash" TEXT,
  "contentSha256" TEXT NOT NULL,
  "sealHash" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "fromAt" TIMESTAMP(3) NOT NULL,
  "untilAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditExportSeal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompliancePolicy_key_version_key" ON "CompliancePolicy"("key", "version");
CREATE INDEX "CompliancePolicy_active_effectiveAt_idx" ON "CompliancePolicy"("active", "effectiveAt");
CREATE UNIQUE INDEX "PolicyAcceptance_organisationId_policyId_acceptedByUserId_key" ON "PolicyAcceptance"("organisationId", "policyId", "acceptedByUserId");
CREATE INDEX "PolicyAcceptance_organisationId_acceptedAt_idx" ON "PolicyAcceptance"("organisationId", "acceptedAt");
CREATE INDEX "PolicyAcceptance_policyId_idx" ON "PolicyAcceptance"("policyId");
CREATE UNIQUE INDEX "DataRequest_reference_key" ON "DataRequest"("reference");
CREATE INDEX "DataRequest_organisationId_status_dueAt_idx" ON "DataRequest"("organisationId", "status", "dueAt");
CREATE INDEX "DataRequest_subjectUserId_idx" ON "DataRequest"("subjectUserId");
CREATE UNIQUE INDEX "RetentionPolicy_organisationId_key" ON "RetentionPolicy"("organisationId");
CREATE INDEX "RetentionJob_organisationId_createdAt_idx" ON "RetentionJob"("organisationId", "createdAt");
CREATE INDEX "RetentionJob_status_createdAt_idx" ON "RetentionJob"("status", "createdAt");
CREATE UNIQUE INDEX "SupportTicket_reference_key" ON "SupportTicket"("reference");
CREATE INDEX "SupportTicket_organisationId_status_createdAt_idx" ON "SupportTicket"("organisationId", "status", "createdAt");
CREATE INDEX "SupportTicket_assignedToUserId_status_idx" ON "SupportTicket"("assignedToUserId", "status");
CREATE INDEX "SupportTicket_linkedEntityType_linkedEntityId_idx" ON "SupportTicket"("linkedEntityType", "linkedEntityId");
CREATE UNIQUE INDEX "AuditExportSeal_sequence_key" ON "AuditExportSeal"("sequence");
CREATE UNIQUE INDEX "AuditExportSeal_exportJobId_key" ON "AuditExportSeal"("exportJobId");
CREATE UNIQUE INDEX "AuditExportSeal_sealHash_key" ON "AuditExportSeal"("sealHash");
CREATE INDEX "AuditExportSeal_organisationId_sequence_idx" ON "AuditExportSeal"("organisationId", "sequence");
CREATE INDEX "AuditExportSeal_organisationId_createdAt_idx" ON "AuditExportSeal"("organisationId", "createdAt");

ALTER TABLE "CompliancePolicy" ADD CONSTRAINT "CompliancePolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PolicyAcceptance" ADD CONSTRAINT "PolicyAcceptance_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyAcceptance" ADD CONSTRAINT "PolicyAcceptance_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CompliancePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyAcceptance" ADD CONSTRAINT "PolicyAcceptance_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetentionJob" ADD CONSTRAINT "RetentionJob_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetentionJob" ADD CONSTRAINT "RetentionJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditExportSeal" ADD CONSTRAINT "AuditExportSeal_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditExportSeal" ADD CONSTRAINT "AuditExportSeal_exportJobId_fkey" FOREIGN KEY ("exportJobId") REFERENCES "ReportExportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

