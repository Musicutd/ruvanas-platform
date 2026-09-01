-- Stage 15B: concurrent shop/player stream leases governed by plan allowance.
CREATE TABLE "PlayerListenerLease" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "instanceHash" CHAR(64) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerListenerLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerListenerLease_playerId_instanceHash_key"
ON "PlayerListenerLease"("playerId", "instanceHash");

CREATE INDEX "PlayerListenerLease_organisationId_expiresAt_idx"
ON "PlayerListenerLease"("organisationId", "expiresAt");

CREATE INDEX "PlayerListenerLease_playerId_expiresAt_idx"
ON "PlayerListenerLease"("playerId", "expiresAt");

ALTER TABLE "PlayerListenerLease"
ADD CONSTRAINT "PlayerListenerLease_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerListenerLease"
ADD CONSTRAINT "PlayerListenerLease_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "Player"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
