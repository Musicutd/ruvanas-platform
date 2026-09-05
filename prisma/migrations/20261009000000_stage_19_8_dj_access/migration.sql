-- Stage 19.8: scoped, time-bounded DJ access using existing Ruvanas identities.
CREATE TYPE "DjAccessGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "DjAccessCapability" AS ENUM ('VIEW_CHANNEL', 'CONTROL_EXTERNAL_LIVE', 'START_BROWSER_STUDIO', 'RECORD_LIVE_SESSION');

CREATE TABLE "DjAccessGrant" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "granteeUserId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "capabilities" "DjAccessCapability"[] NOT NULL DEFAULT ARRAY['VIEW_CHANNEL']::"DjAccessCapability"[],
    "status" "DjAccessGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DjAccessGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DjAccessGrant_window_check" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "DjAccessGrant_revoke_state_check" CHECK (
      ("status" = 'ACTIVE' AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL)
      OR
      ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
    ),
    CONSTRAINT "DjAccessGrant_capabilities_check" CHECK (cardinality("capabilities") > 0)
);

CREATE TABLE "DjAccessToken" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DjAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DjAccessToken_tokenHash_key" ON "DjAccessToken"("tokenHash");
CREATE UNIQUE INDEX "DjAccessGrant_one_open_grant_per_presenter_channel_key" ON "DjAccessGrant"("channelId", "granteeUserId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "DjAccessToken_one_live_token_per_grant_key" ON "DjAccessToken"("grantId") WHERE "revokedAt" IS NULL;
CREATE INDEX "DjAccessGrant_organisationId_status_startsAt_endsAt_idx" ON "DjAccessGrant"("organisationId", "status", "startsAt", "endsAt");
CREATE INDEX "DjAccessGrant_channelId_status_startsAt_endsAt_idx" ON "DjAccessGrant"("channelId", "status", "startsAt", "endsAt");
CREATE INDEX "DjAccessGrant_granteeUserId_status_startsAt_endsAt_idx" ON "DjAccessGrant"("granteeUserId", "status", "startsAt", "endsAt");
CREATE INDEX "DjAccessToken_grantId_revokedAt_expiresAt_idx" ON "DjAccessToken"("grantId", "revokedAt", "expiresAt");
CREATE INDEX "DjAccessToken_expiresAt_idx" ON "DjAccessToken"("expiresAt");

ALTER TABLE "DjAccessGrant" ADD CONSTRAINT "DjAccessGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DjAccessGrant" ADD CONSTRAINT "DjAccessGrant_channelId_organisationId_fkey" FOREIGN KEY ("channelId", "organisationId") REFERENCES "Channel"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DjAccessGrant" ADD CONSTRAINT "DjAccessGrant_grantee_membership_fkey" FOREIGN KEY ("granteeUserId", "organisationId") REFERENCES "OrganisationMember"("userId", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DjAccessGrant" ADD CONSTRAINT "DjAccessGrant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DjAccessGrant" ADD CONSTRAINT "DjAccessGrant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DjAccessToken" ADD CONSTRAINT "DjAccessToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "DjAccessGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
