CREATE TYPE "SchoolSafeguardingReadinessStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW');
CREATE TYPE "SchoolConsentModel" AS ENUM ('SCHOOL_POLICY', 'PARENT_OR_GUARDIAN', 'BOTH');
CREATE TYPE "SchoolStudentIdentityMode" AS ENUM ('DISABLED', 'INVITATION_ONLY', 'IDENTITY_FEDERATION');

CREATE TABLE "SchoolSafeguardingReadiness" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "status" "SchoolSafeguardingReadinessStatus" NOT NULL DEFAULT 'DRAFT',
  "targetCountries" JSONB NOT NULL DEFAULT '[]',
  "minimumStudentAge" INTEGER,
  "maximumStudentAge" INTEGER,
  "consentModel" "SchoolConsentModel",
  "studentIdentityMode" "SchoolStudentIdentityMode" NOT NULL DEFAULT 'DISABLED',
  "privacyContactEmail" TEXT,
  "rawRecordingRetentionDays" INTEGER,
  "consentEvidenceRetentionDays" INTEGER,
  "localPolicyReference" TEXT,
  "notes" TEXT,
  "staffModerationConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "noDirectMessagingConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "privateByDefaultConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "submittedAt" TIMESTAMP(3),
  "submittedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolSafeguardingReadiness_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolSafeguardingReadiness_organisationId_key" ON "SchoolSafeguardingReadiness"("organisationId");
CREATE INDEX "SchoolSafeguardingReadiness_status_idx" ON "SchoolSafeguardingReadiness"("status");

ALTER TABLE "SchoolSafeguardingReadiness"
ADD CONSTRAINT "SchoolSafeguardingReadiness_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchoolSafeguardingReadiness"
ADD CONSTRAINT "SchoolSafeguardingReadiness_age_check"
CHECK (
  ("minimumStudentAge" IS NULL AND "maximumStudentAge" IS NULL)
  OR
  ("minimumStudentAge" BETWEEN 3 AND 24 AND "maximumStudentAge" BETWEEN 3 AND 24 AND "minimumStudentAge" <= "maximumStudentAge")
);

ALTER TABLE "SchoolSafeguardingReadiness"
ADD CONSTRAINT "SchoolSafeguardingReadiness_raw_retention_check"
CHECK ("rawRecordingRetentionDays" IS NULL OR "rawRecordingRetentionDays" BETWEEN 1 AND 3650);

ALTER TABLE "SchoolSafeguardingReadiness"
ADD CONSTRAINT "SchoolSafeguardingReadiness_consent_retention_check"
CHECK ("consentEvidenceRetentionDays" IS NULL OR "consentEvidenceRetentionDays" BETWEEN 30 AND 3650);
