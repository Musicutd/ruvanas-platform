ALTER TYPE "NotificationType" ADD VALUE 'LISTENER_REQUEST';

CREATE TYPE "ListenerRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PLAYED', 'ARCHIVED');

ALTER TABLE "Station"
  ADD COLUMN "listenerRequestsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "listenerRequestInstructions" TEXT;

CREATE TABLE "ListenerRequest" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "sessionHash" CHAR(64) NOT NULL,
  "dedupeKey" CHAR(64) NOT NULL,
  "artist" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT,
  "status" "ListenerRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListenerRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListenerRequestBlock" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "sessionHash" CHAR(64) NOT NULL,
  "reason" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "revokedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListenerRequestBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListenerRequest_stationId_dedupeKey_key" ON "ListenerRequest"("stationId", "dedupeKey");
CREATE INDEX "ListenerRequest_organisationId_status_createdAt_idx" ON "ListenerRequest"("organisationId", "status", "createdAt");
CREATE INDEX "ListenerRequest_stationId_status_createdAt_idx" ON "ListenerRequest"("stationId", "status", "createdAt");
CREATE INDEX "ListenerRequest_channelId_status_createdAt_idx" ON "ListenerRequest"("channelId", "status", "createdAt");
CREATE INDEX "ListenerRequest_stationId_sessionHash_createdAt_idx" ON "ListenerRequest"("stationId", "sessionHash", "createdAt");
CREATE INDEX "ListenerRequest_reviewedByUserId_idx" ON "ListenerRequest"("reviewedByUserId");
CREATE UNIQUE INDEX "ListenerRequestBlock_stationId_sessionHash_key" ON "ListenerRequestBlock"("stationId", "sessionHash");
CREATE INDEX "ListenerRequestBlock_organisationId_active_createdAt_idx" ON "ListenerRequestBlock"("organisationId", "active", "createdAt");
CREATE INDEX "ListenerRequestBlock_stationId_active_idx" ON "ListenerRequestBlock"("stationId", "active");
CREATE INDEX "ListenerRequestBlock_createdByUserId_idx" ON "ListenerRequestBlock"("createdByUserId");
CREATE INDEX "ListenerRequestBlock_revokedByUserId_idx" ON "ListenerRequestBlock"("revokedByUserId");

ALTER TABLE "ListenerRequest" ADD CONSTRAINT "ListenerRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerRequest" ADD CONSTRAINT "ListenerRequest_stationId_organisationId_fkey" FOREIGN KEY ("stationId", "organisationId") REFERENCES "Station"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerRequest" ADD CONSTRAINT "ListenerRequest_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerRequest" ADD CONSTRAINT "ListenerRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListenerRequestBlock" ADD CONSTRAINT "ListenerRequestBlock_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerRequestBlock" ADD CONSTRAINT "ListenerRequestBlock_stationId_organisationId_fkey" FOREIGN KEY ("stationId", "organisationId") REFERENCES "Station"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListenerRequestBlock" ADD CONSTRAINT "ListenerRequestBlock_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListenerRequestBlock" ADD CONSTRAINT "ListenerRequestBlock_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
