ALTER TYPE "ProductionOrderEventType" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_CHANGED';
ALTER TYPE "ProductionOrderEventType" ADD VALUE IF NOT EXISTS 'FILE_ADDED';
ALTER TYPE "ProductionOrderEventType" ADD VALUE IF NOT EXISTS 'SCRIPT_VERSION_CREATED';
ALTER TYPE "ProductionOrderEventType" ADD VALUE IF NOT EXISTS 'REVISION_REQUESTED';
ALTER TYPE "ProductionOrderEventType" ADD VALUE IF NOT EXISTS 'REVISION_RESOLVED';

CREATE TYPE "ProductionOrderFileKind" AS ENUM ('BRIEF_ATTACHMENT', 'AUDIO_PREVIEW', 'FINAL_MASTER');
CREATE TYPE "ProductionRevisionStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "ProductionOrderFile" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "kind" "ProductionOrderFileKind" NOT NULL,
  "originalName" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionOrderFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionScriptVersion" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "languageCode" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "productionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionScriptVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionRevisionRequest" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "resolvedByUserId" TEXT,
  "message" TEXT NOT NULL,
  "status" "ProductionRevisionStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ProductionRevisionRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionOrderFile_storageKey_key" ON "ProductionOrderFile"("storageKey");
CREATE INDEX "ProductionOrderFile_organisationId_createdAt_idx" ON "ProductionOrderFile"("organisationId", "createdAt");
CREATE INDEX "ProductionOrderFile_orderId_kind_createdAt_idx" ON "ProductionOrderFile"("orderId", "kind", "createdAt");
CREATE INDEX "ProductionOrderFile_uploadedByUserId_createdAt_idx" ON "ProductionOrderFile"("uploadedByUserId", "createdAt");

CREATE UNIQUE INDEX "ProductionScriptVersion_orderId_version_key" ON "ProductionScriptVersion"("orderId", "version");
CREATE INDEX "ProductionScriptVersion_organisationId_createdAt_idx" ON "ProductionScriptVersion"("organisationId", "createdAt");
CREATE INDEX "ProductionScriptVersion_createdByUserId_createdAt_idx" ON "ProductionScriptVersion"("createdByUserId", "createdAt");

CREATE INDEX "ProductionRevisionRequest_organisationId_status_createdAt_idx" ON "ProductionRevisionRequest"("organisationId", "status", "createdAt");
CREATE INDEX "ProductionRevisionRequest_orderId_status_createdAt_idx" ON "ProductionRevisionRequest"("orderId", "status", "createdAt");
CREATE INDEX "ProductionRevisionRequest_requestedByUserId_createdAt_idx" ON "ProductionRevisionRequest"("requestedByUserId", "createdAt");

ALTER TABLE "ProductionOrderFile" ADD CONSTRAINT "ProductionOrderFile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderFile" ADD CONSTRAINT "ProductionOrderFile_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderFile" ADD CONSTRAINT "ProductionOrderFile_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionScriptVersion" ADD CONSTRAINT "ProductionScriptVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionScriptVersion" ADD CONSTRAINT "ProductionScriptVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionScriptVersion" ADD CONSTRAINT "ProductionScriptVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionRevisionRequest" ADD CONSTRAINT "ProductionRevisionRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionRevisionRequest" ADD CONSTRAINT "ProductionRevisionRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionRevisionRequest" ADD CONSTRAINT "ProductionRevisionRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionRevisionRequest" ADD CONSTRAINT "ProductionRevisionRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionOrderFile" ADD CONSTRAINT "ProductionOrderFile_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 52428800);
ALTER TABLE "ProductionScriptVersion" ADD CONSTRAINT "ProductionScriptVersion_version_check" CHECK ("version" > 0);

