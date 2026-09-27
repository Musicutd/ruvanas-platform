CREATE TYPE "CorrectionsEdgeNodeStatus" AS ENUM ('PENDING_ENROLMENT', 'ACTIVE', 'REVOKED', 'DECOMMISSIONED');

CREATE TABLE "CorrectionsEdgeNode" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CorrectionsEdgeNodeStatus" NOT NULL DEFAULT 'PENDING_ENROLMENT',
    "enrolmentTokenHash" CHAR(64),
    "enrolmentExpiresAt" TIMESTAMP(3),
    "credentialHash" CHAR(64),
    "keyVersion" INTEGER NOT NULL DEFAULT 0,
    "enrolledAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "softwareVersion" TEXT,
    "storageHealth" TEXT,
    "syncStatus" TEXT,
    "pendingProofCount" INTEGER NOT NULL DEFAULT 0,
    "cachedContentCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CorrectionsEdgeNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorrectionsEdgeManifest" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "version" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorrectionsEdgeManifest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CorrectionsEdgeNode_enrolmentTokenHash_key" ON "CorrectionsEdgeNode"("enrolmentTokenHash");
CREATE UNIQUE INDEX "CorrectionsEdgeNode_credentialHash_key" ON "CorrectionsEdgeNode"("credentialHash");
CREATE INDEX "CorrectionsEdgeNode_organisationId_facilityId_status_idx" ON "CorrectionsEdgeNode"("organisationId", "facilityId", "status");
CREATE INDEX "CorrectionsEdgeNode_status_lastSeenAt_idx" ON "CorrectionsEdgeNode"("status", "lastSeenAt");
CREATE UNIQUE INDEX "CorrectionsEdgeManifest_nodeId_sequence_key" ON "CorrectionsEdgeManifest"("nodeId", "sequence");
CREATE UNIQUE INDEX "CorrectionsEdgeManifest_nodeId_version_key" ON "CorrectionsEdgeManifest"("nodeId", "version");
CREATE INDEX "CorrectionsEdgeManifest_nodeId_validUntil_idx" ON "CorrectionsEdgeManifest"("nodeId", "validUntil");

ALTER TABLE "CorrectionsEdgeNode" ADD CONSTRAINT "CorrectionsEdgeNode_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorrectionsEdgeNode" ADD CONSTRAINT "CorrectionsEdgeNode_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionsEdgeManifest" ADD CONSTRAINT "CorrectionsEdgeManifest_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "CorrectionsEdgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
