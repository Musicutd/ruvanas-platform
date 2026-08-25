CREATE TYPE "PlayerStatus" AS ENUM ('PENDING_ENROLMENT', 'ONLINE', 'OFFLINE', 'DISABLED');

CREATE TABLE "Player" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "PlayerStatus" NOT NULL DEFAULT 'PENDING_ENROLMENT',
  "enrolmentTokenHash" TEXT,
  "enrolmentExpiresAt" TIMESTAMP(3),
  "sessionTokenHash" TEXT,
  "enrolledAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastIpAddress" TEXT,
  "lastUserAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Player_enrolmentTokenHash_key" ON "Player"("enrolmentTokenHash");
CREATE UNIQUE INDEX "Player_sessionTokenHash_key" ON "Player"("sessionTokenHash");
CREATE INDEX "Player_organisationId_idx" ON "Player"("organisationId");
CREATE INDEX "Player_zoneId_idx" ON "Player"("zoneId");
CREATE INDEX "Player_organisationId_status_idx" ON "Player"("organisationId", "status");
CREATE INDEX "Player_lastHeartbeatAt_idx" ON "Player"("lastHeartbeatAt");

ALTER TABLE "Player"
  ADD CONSTRAINT "Player_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Player"
  ADD CONSTRAINT "Player_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "Zone"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

