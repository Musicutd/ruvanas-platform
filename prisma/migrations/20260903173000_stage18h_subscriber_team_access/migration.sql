-- Stage 18H: controlled subscriber team invitations.
CREATE TABLE "OrganisationInvitation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganisationInvitation_tokenHash_key" ON "OrganisationInvitation"("tokenHash");
CREATE INDEX "OrganisationInvitation_organisationId_email_idx" ON "OrganisationInvitation"("organisationId", "email");
CREATE INDEX "OrganisationInvitation_organisationId_acceptedAt_revokedAt_expiresAt_idx" ON "OrganisationInvitation"("organisationId", "acceptedAt", "revokedAt", "expiresAt");
CREATE INDEX "OrganisationInvitation_invitedByUserId_idx" ON "OrganisationInvitation"("invitedByUserId");

ALTER TABLE "OrganisationInvitation"
ADD CONSTRAINT "OrganisationInvitation_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganisationInvitation"
ADD CONSTRAINT "OrganisationInvitation_invitedByUserId_fkey"
FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrganisationInvitation"
ADD CONSTRAINT "OrganisationInvitation_acceptedByUserId_fkey"
FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
