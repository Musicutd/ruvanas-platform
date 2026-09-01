ALTER TABLE "PlayerListenerLease"
ADD COLUMN "revokedAt" TIMESTAMP(3);

DROP INDEX "PlayerListenerLease_organisationId_expiresAt_idx";

CREATE INDEX "PlayerListenerLease_organisationId_revokedAt_expiresAt_idx"
ON "PlayerListenerLease"("organisationId", "revokedAt", "expiresAt");
