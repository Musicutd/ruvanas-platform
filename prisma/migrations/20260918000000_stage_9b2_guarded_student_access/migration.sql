ALTER TYPE "UserRole" ADD VALUE 'STUDENT';

ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_role_not_student" CHECK ("role"::text <> 'STUDENT');

CREATE TYPE "SchoolStudentAccessStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

CREATE TABLE "SchoolStudentAccess" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "status" "SchoolStudentAccessStatus" NOT NULL DEFAULT 'INVITED',
    "invitationTokenHash" TEXT,
    "invitationExpiresAt" TIMESTAMP(3),
    "invitedByUserId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolStudentAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolStudentAccess_contributorId_key" ON "SchoolStudentAccess"("contributorId");
CREATE UNIQUE INDEX "SchoolStudentAccess_userId_key" ON "SchoolStudentAccess"("userId");
CREATE UNIQUE INDEX "SchoolStudentAccess_email_key" ON "SchoolStudentAccess"("email");
CREATE UNIQUE INDEX "SchoolStudentAccess_invitationTokenHash_key" ON "SchoolStudentAccess"("invitationTokenHash");
CREATE INDEX "SchoolStudentAccess_organisationId_status_idx" ON "SchoolStudentAccess"("organisationId", "status");
CREATE INDEX "SchoolStudentAccess_invitedByUserId_idx" ON "SchoolStudentAccess"("invitedByUserId");
CREATE INDEX "SchoolStudentAccess_invitationExpiresAt_idx" ON "SchoolStudentAccess"("invitationExpiresAt");

ALTER TABLE "SchoolStudentAccess" ADD CONSTRAINT "SchoolStudentAccess_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolStudentAccess" ADD CONSTRAINT "SchoolStudentAccess_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "StudentContributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolStudentAccess" ADD CONSTRAINT "SchoolStudentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SchoolStudentAccess" ADD CONSTRAINT "SchoolStudentAccess_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
