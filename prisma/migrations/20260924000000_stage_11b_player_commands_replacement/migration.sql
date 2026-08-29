-- Stage 11B: expiring player diagnostics, acknowledgement evidence, and safe replacement.

CREATE TYPE "PlayerCommandKind" AS ENUM ('PING', 'REFRESH_STATE', 'REFRESH_MANIFEST', 'COLLECT_DIAGNOSTICS');
CREATE TYPE "PlayerCommandStatus" AS ENUM ('PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED', 'CANCELLED');

ALTER TABLE "Player"
ADD COLUMN "sessionRevokedAt" TIMESTAMP(3),
ADD COLUMN "retiredAt" TIMESTAMP(3),
ADD COLUMN "retiredReason" TEXT,
ADD COLUMN "replacesPlayerId" TEXT;

CREATE TABLE "PlayerCommand" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "kind" "PlayerCommandKind" NOT NULL,
    "status" "PlayerCommandStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "resultCode" TEXT,
    "resultMessage" TEXT,
    "resultDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerCommand_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlayerCommand_expiry_check" CHECK ("expiresAt" > "requestedAt"),
    CONSTRAINT "PlayerCommand_delivery_check" CHECK ("status" NOT IN ('DELIVERED', 'ACKNOWLEDGED', 'FAILED') OR "deliveredAt" IS NOT NULL),
    CONSTRAINT "PlayerCommand_ack_check" CHECK ("status" NOT IN ('ACKNOWLEDGED', 'FAILED') OR "acknowledgedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "Player_replacesPlayerId_key" ON "Player"("replacesPlayerId");
CREATE INDEX "Player_retiredAt_idx" ON "Player"("retiredAt");
CREATE INDEX "PlayerCommand_player_status_expiry_idx" ON "PlayerCommand"("playerId", "status", "expiresAt");
CREATE INDEX "PlayerCommand_organisation_requested_idx" ON "PlayerCommand"("organisationId", "requestedAt");
CREATE INDEX "PlayerCommand_requestedBy_requested_idx" ON "PlayerCommand"("requestedById", "requestedAt");
CREATE INDEX "PlayerCommand_expiresAt_idx" ON "PlayerCommand"("expiresAt");
CREATE UNIQUE INDEX "PlayerCommand_one_active_kind_per_player"
ON "PlayerCommand"("playerId", "kind")
WHERE "status" IN ('PENDING', 'DELIVERED');

ALTER TABLE "Player"
ADD CONSTRAINT "Player_replacesPlayerId_fkey"
FOREIGN KEY ("replacesPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlayerCommand"
ADD CONSTRAINT "PlayerCommand_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerCommand"
ADD CONSTRAINT "PlayerCommand_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerCommand"
ADD CONSTRAINT "PlayerCommand_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
