CREATE TYPE "PromoAssetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "PromoVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "PromoQcStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED');
CREATE TYPE "PromoSourceType" AS ENUM ('UPLOAD', 'LEGACY_IMPORT', 'STUDIO');
CREATE TYPE "PromoProcessingJobType" AS ENUM ('PREVIEW', 'TRANSCODE', 'LOUDNESS_ANALYSIS');
CREATE TYPE "PromoProcessingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "PromoAsset" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "languageCode" TEXT NOT NULL DEFAULT 'und',
    "status" "PromoAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentApprovedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromoVersion" (
    "id" TEXT NOT NULL,
    "promoAssetId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PromoVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "qcStatus" "PromoQcStatus" NOT NULL DEFAULT 'PENDING',
    "sourceType" "PromoSourceType" NOT NULL DEFAULT 'UPLOAD',
    "sourceReference" TEXT,
    "languageCode" TEXT NOT NULL DEFAULT 'und',
    "checksumSha256" TEXT,
    "loudnessLufs" DECIMAL(5,2),
    "durationSeconds" INTEGER,
    "qcNotes" TEXT,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromoProcessingJob" (
    "id" TEXT NOT NULL,
    "promoVersionId" TEXT NOT NULL,
    "jobType" "PromoProcessingJobType" NOT NULL,
    "status" "PromoProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromoAsset_currentApprovedVersionId_key" ON "PromoAsset"("currentApprovedVersionId");
CREATE INDEX "PromoAsset_organisationId_status_idx" ON "PromoAsset"("organisationId", "status");
CREATE INDEX "PromoAsset_organisationId_name_idx" ON "PromoAsset"("organisationId", "name");
CREATE UNIQUE INDEX "PromoVersion_promoAssetId_version_key" ON "PromoVersion"("promoAssetId", "version");
CREATE INDEX "PromoVersion_promoAssetId_status_idx" ON "PromoVersion"("promoAssetId", "status");
CREATE INDEX "PromoVersion_mediaAssetId_idx" ON "PromoVersion"("mediaAssetId");
CREATE INDEX "PromoVersion_status_qcStatus_idx" ON "PromoVersion"("status", "qcStatus");
CREATE INDEX "PromoVersion_submittedById_idx" ON "PromoVersion"("submittedById");
CREATE INDEX "PromoVersion_reviewedById_idx" ON "PromoVersion"("reviewedById");
CREATE UNIQUE INDEX "PromoProcessingJob_promoVersionId_jobType_key" ON "PromoProcessingJob"("promoVersionId", "jobType");
CREATE INDEX "PromoProcessingJob_status_createdAt_idx" ON "PromoProcessingJob"("status", "createdAt");

ALTER TABLE "PromoAsset" ADD CONSTRAINT "PromoAsset_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoVersion" ADD CONSTRAINT "PromoVersion_promoAssetId_fkey"
    FOREIGN KEY ("promoAssetId") REFERENCES "PromoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoVersion" ADD CONSTRAINT "PromoVersion_mediaAssetId_fkey"
    FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoVersion" ADD CONSTRAINT "PromoVersion_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromoVersion" ADD CONSTRAINT "PromoVersion_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromoProcessingJob" ADD CONSTRAINT "PromoProcessingJob_promoVersionId_fkey"
    FOREIGN KEY ("promoVersionId") REFERENCES "PromoVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PromoAsset" (
    "id", "organisationId", "name", "mediaType", "languageCode", "status", "createdAt", "updatedAt"
)
SELECT
    'legacy_pa_' || "id",
    "organisationId",
    "name",
    "mediaType",
    'und',
    CASE WHEN "status" IN ('ARCHIVED', 'DELETED') THEN 'ARCHIVED'::"PromoAssetStatus" ELSE 'ACTIVE'::"PromoAssetStatus" END,
    "createdAt",
    "updatedAt"
FROM "MediaAsset"
WHERE "libraryType" = 'ORGANISATION_PROMO' AND "organisationId" IS NOT NULL;

INSERT INTO "PromoVersion" (
    "id", "promoAssetId", "mediaAssetId", "version", "status", "qcStatus", "sourceType",
    "languageCode", "durationSeconds", "submittedAt", "reviewedAt", "createdAt", "updatedAt"
)
SELECT
    'legacy_pv_' || "id",
    'legacy_pa_' || "id",
    "id",
    1,
    CASE
        WHEN "status" = 'READY' THEN 'APPROVED'::"PromoVersionStatus"
        WHEN "status" = 'REJECTED' THEN 'REJECTED'::"PromoVersionStatus"
        WHEN "status" IN ('ARCHIVED', 'DELETED') THEN 'SUPERSEDED'::"PromoVersionStatus"
        ELSE 'DRAFT'::"PromoVersionStatus"
    END,
    CASE
        WHEN "status" = 'READY' THEN 'PASSED'::"PromoQcStatus"
        WHEN "status" = 'REJECTED' THEN 'FAILED'::"PromoQcStatus"
        ELSE 'PENDING'::"PromoQcStatus"
    END,
    'LEGACY_IMPORT'::"PromoSourceType",
    'und',
    "durationSeconds",
    "createdAt",
    CASE WHEN "status" IN ('READY', 'REJECTED') THEN "updatedAt" ELSE NULL END,
    "createdAt",
    "updatedAt"
FROM "MediaAsset"
WHERE "libraryType" = 'ORGANISATION_PROMO' AND "organisationId" IS NOT NULL;

UPDATE "PromoAsset" AS promo
SET "currentApprovedVersionId" = 'legacy_pv_' || media."id"
FROM "MediaAsset" AS media
WHERE promo."id" = 'legacy_pa_' || media."id" AND media."status" = 'READY';

ALTER TABLE "PromoAsset" ADD CONSTRAINT "PromoAsset_currentApprovedVersionId_fkey"
    FOREIGN KEY ("currentApprovedVersionId") REFERENCES "PromoVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
