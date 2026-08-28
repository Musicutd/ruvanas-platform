CREATE TYPE "SchoolNetworkRole" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

CREATE TABLE "SchoolNetwork" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolNetwork_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolNetworkMember" (
  "id" TEXT NOT NULL,
  "schoolNetworkId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "SchoolNetworkRole" NOT NULL DEFAULT 'VIEWER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolNetworkMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolNetworkSchool" (
  "id" TEXT NOT NULL,
  "schoolNetworkId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolNetworkSchool_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditLog" ADD COLUMN "schoolNetworkId" TEXT;

CREATE UNIQUE INDEX "SchoolNetwork_slug_key" ON "SchoolNetwork"("slug");
CREATE INDEX "SchoolNetwork_createdByUserId_idx" ON "SchoolNetwork"("createdByUserId");
CREATE UNIQUE INDEX "SchoolNetworkMember_schoolNetworkId_userId_key" ON "SchoolNetworkMember"("schoolNetworkId", "userId");
CREATE INDEX "SchoolNetworkMember_userId_idx" ON "SchoolNetworkMember"("userId");
CREATE INDEX "SchoolNetworkMember_schoolNetworkId_role_idx" ON "SchoolNetworkMember"("schoolNetworkId", "role");
CREATE UNIQUE INDEX "SchoolNetworkSchool_organisationId_key" ON "SchoolNetworkSchool"("organisationId");
CREATE UNIQUE INDEX "SchoolNetworkSchool_schoolNetworkId_organisationId_key" ON "SchoolNetworkSchool"("schoolNetworkId", "organisationId");
CREATE INDEX "SchoolNetworkSchool_schoolNetworkId_active_idx" ON "SchoolNetworkSchool"("schoolNetworkId", "active");
CREATE INDEX "AuditLog_schoolNetworkId_idx" ON "AuditLog"("schoolNetworkId");

ALTER TABLE "SchoolNetwork" ADD CONSTRAINT "SchoolNetwork_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolNetworkMember" ADD CONSTRAINT "SchoolNetworkMember_schoolNetworkId_fkey" FOREIGN KEY ("schoolNetworkId") REFERENCES "SchoolNetwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolNetworkMember" ADD CONSTRAINT "SchoolNetworkMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolNetworkSchool" ADD CONSTRAINT "SchoolNetworkSchool_schoolNetworkId_fkey" FOREIGN KEY ("schoolNetworkId") REFERENCES "SchoolNetwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolNetworkSchool" ADD CONSTRAINT "SchoolNetworkSchool_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_schoolNetworkId_fkey" FOREIGN KEY ("schoolNetworkId") REFERENCES "SchoolNetwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

