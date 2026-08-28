CREATE TYPE "EnterpriseIdentityProtocol" AS ENUM ('OIDC', 'SAML');
CREATE TYPE "EnterpriseIdentityProviderStatus" AS ENUM ('DRAFT', 'READY', 'DISABLED');
CREATE TYPE "ServiceAccountStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

ALTER TABLE "Session"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'PASSWORD';

ALTER TABLE "AuditLog" ADD COLUMN "actorServiceAccountId" TEXT;

CREATE TABLE "EnterpriseSecurityPolicy" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "ssoRequired" BOOLEAN NOT NULL DEFAULT false,
  "passwordFallback" BOOLEAN NOT NULL DEFAULT true,
  "sessionMaxAgeMinutes" INTEGER NOT NULL DEFAULT 43200,
  "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 1440,
  "allowedEmailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnterpriseSecurityPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EnterpriseIdentityProvider" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "protocol" "EnterpriseIdentityProtocol" NOT NULL,
  "status" "EnterpriseIdentityProviderStatus" NOT NULL DEFAULT 'DRAFT',
  "issuer" TEXT NOT NULL,
  "clientId" TEXT,
  "metadataUrl" TEXT,
  "emailDomain" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnterpriseIdentityProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EnterpriseIdentityLink" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "emailAtProvider" TEXT,
  "lastAuthenticatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnterpriseIdentityLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceAccount" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "ServiceAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiKey" (
  "id" TEXT NOT NULL,
  "serviceAccountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnterpriseSecurityPolicy_organisationId_key" ON "EnterpriseSecurityPolicy"("organisationId");
CREATE UNIQUE INDEX "EnterpriseIdentityProvider_organisationId_issuer_key" ON "EnterpriseIdentityProvider"("organisationId", "issuer");
CREATE INDEX "EnterpriseIdentityProvider_organisationId_status_idx" ON "EnterpriseIdentityProvider"("organisationId", "status");
CREATE UNIQUE INDEX "EnterpriseIdentityLink_providerId_subject_key" ON "EnterpriseIdentityLink"("providerId", "subject");
CREATE UNIQUE INDEX "EnterpriseIdentityLink_providerId_userId_key" ON "EnterpriseIdentityLink"("providerId", "userId");
CREATE INDEX "EnterpriseIdentityLink_userId_idx" ON "EnterpriseIdentityLink"("userId");
CREATE UNIQUE INDEX "ServiceAccount_organisationId_name_key" ON "ServiceAccount"("organisationId", "name");
CREATE INDEX "ServiceAccount_organisationId_status_idx" ON "ServiceAccount"("organisationId", "status");
CREATE INDEX "ServiceAccount_createdByUserId_idx" ON "ServiceAccount"("createdByUserId");
CREATE UNIQUE INDEX "ApiKey_tokenHash_key" ON "ApiKey"("tokenHash");
CREATE INDEX "ApiKey_serviceAccountId_status_idx" ON "ApiKey"("serviceAccountId", "status");
CREATE INDEX "ApiKey_prefix_idx" ON "ApiKey"("prefix");
CREATE INDEX "Session_revokedAt_idx" ON "Session"("revokedAt");
CREATE INDEX "AuditLog_actorServiceAccountId_idx" ON "AuditLog"("actorServiceAccountId");

ALTER TABLE "EnterpriseSecurityPolicy" ADD CONSTRAINT "EnterpriseSecurityPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseIdentityProvider" ADD CONSTRAINT "EnterpriseIdentityProvider_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseIdentityLink" ADD CONSTRAINT "EnterpriseIdentityLink_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "EnterpriseIdentityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseIdentityLink" ADD CONSTRAINT "EnterpriseIdentityLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceAccount" ADD CONSTRAINT "ServiceAccount_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceAccount" ADD CONSTRAINT "ServiceAccount_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorServiceAccountId_fkey" FOREIGN KEY ("actorServiceAccountId") REFERENCES "ServiceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
