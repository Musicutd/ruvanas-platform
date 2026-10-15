-- Additive only: existing users, tenants, passwords, sessions and media remain unchanged.
CREATE TABLE "PrivatePreviewAccess" (
    "userId" TEXT NOT NULL,
    "organisationId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "passwordEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pillars" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivatePreviewAccess_pkey" PRIMARY KEY ("userId")
);
CREATE UNIQUE INDEX "PrivatePreviewAccess_organisationId_key" ON "PrivatePreviewAccess"("organisationId");
ALTER TABLE "PrivatePreviewAccess" ADD CONSTRAINT "PrivatePreviewAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivatePreviewAccess" ADD CONSTRAINT "PrivatePreviewAccess_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
