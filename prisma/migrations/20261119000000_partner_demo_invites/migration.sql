CREATE TABLE "PartnerDemoInvitation" (
    "id" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "codeHash" TEXT,
    "codeSuffix" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "sessionHash" TEXT,
    "sessionExpiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerDemoInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerDemoInvitation_codeHash_key" ON "PartnerDemoInvitation"("codeHash");
CREATE UNIQUE INDEX "PartnerDemoInvitation_sessionHash_key" ON "PartnerDemoInvitation"("sessionHash");
CREATE INDEX "PartnerDemoInvitation_recipientEmail_createdAt_idx" ON "PartnerDemoInvitation"("recipientEmail", "createdAt");
CREATE INDEX "PartnerDemoInvitation_revokedAt_sessionExpiresAt_idx" ON "PartnerDemoInvitation"("revokedAt", "sessionExpiresAt");

ALTER TABLE "PartnerDemoInvitation" ADD CONSTRAINT "PartnerDemoInvitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
