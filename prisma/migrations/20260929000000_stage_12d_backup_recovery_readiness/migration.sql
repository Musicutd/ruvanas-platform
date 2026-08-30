-- Stage 12D: provider-neutral backup and recovery readiness evidence.

CREATE TYPE "RecoveryAssetKind" AS ENUM ('DATABASE', 'OBJECT_STORAGE');
CREATE TYPE "RecoveryEvidenceKind" AS ENUM ('BACKUP_VERIFICATION', 'RESTORE_DRILL');
CREATE TYPE "RecoveryEvidenceResult" AS ENUM ('PASSED', 'PARTIAL', 'FAILED');

CREATE TABLE "RecoveryControl" (
    "id" TEXT NOT NULL,
    "assetKind" "RecoveryAssetKind" NOT NULL,
    "environment" TEXT NOT NULL,
    "strategyConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "automatedBackupConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "versioningConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "targetRpoMinutes" INTEGER,
    "targetRtoMinutes" INTEGER,
    "retentionDays" INTEGER,
    "notes" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecoveryControl_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecoveryControl_targetRpoMinutes_check" CHECK ("targetRpoMinutes" IS NULL OR "targetRpoMinutes" BETWEEN 5 AND 43200),
    CONSTRAINT "RecoveryControl_targetRtoMinutes_check" CHECK ("targetRtoMinutes" IS NULL OR "targetRtoMinutes" BETWEEN 5 AND 43200),
    CONSTRAINT "RecoveryControl_retentionDays_check" CHECK ("retentionDays" IS NULL OR "retentionDays" BETWEEN 1 AND 3650),
    CONSTRAINT "RecoveryControl_notes_check" CHECK (char_length("notes") BETWEEN 8 AND 500),
    CONSTRAINT "RecoveryControl_strategy_targets_check" CHECK ("strategyConfirmed" OR ("targetRpoMinutes" IS NULL AND "targetRtoMinutes" IS NULL)),
    CONSTRAINT "RecoveryControl_versioning_scope_check" CHECK ("assetKind" = 'OBJECT_STORAGE' OR NOT "versioningConfirmed")
);

CREATE TABLE "RecoveryEvidence" (
    "id" TEXT NOT NULL,
    "recoveryControlId" TEXT NOT NULL,
    "assetKind" "RecoveryAssetKind" NOT NULL,
    "environment" TEXT NOT NULL,
    "evidenceKind" "RecoveryEvidenceKind" NOT NULL,
    "result" "RecoveryEvidenceResult" NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "backupCapturedAt" TIMESTAMP(3),
    "restoreCompletedMinutes" INTEGER,
    "notes" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecoveryEvidence_restoreCompletedMinutes_check" CHECK ("restoreCompletedMinutes" IS NULL OR "restoreCompletedMinutes" BETWEEN 1 AND 43200),
    CONSTRAINT "RecoveryEvidence_reference_check" CHECK ("evidenceReference" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$'),
    CONSTRAINT "RecoveryEvidence_notes_check" CHECK (char_length("notes") BETWEEN 8 AND 500),
    CONSTRAINT "RecoveryEvidence_kind_fields_check" CHECK (("evidenceKind" = 'RESTORE_DRILL' AND "restoreCompletedMinutes" IS NOT NULL) OR ("evidenceKind" = 'BACKUP_VERIFICATION' AND "restoreCompletedMinutes" IS NULL)),
    CONSTRAINT "RecoveryEvidence_backup_time_check" CHECK ("backupCapturedAt" IS NULL OR "backupCapturedAt" <= "performedAt")
);

CREATE UNIQUE INDEX "RecoveryControl_assetKind_environment_key" ON "RecoveryControl"("assetKind", "environment");
CREATE UNIQUE INDEX "RecoveryControl_id_assetKind_environment_key" ON "RecoveryControl"("id", "assetKind", "environment");
CREATE INDEX "RecoveryControl_environment_strategyConfirmed_idx" ON "RecoveryControl"("environment", "strategyConfirmed");
CREATE INDEX "RecoveryControl_nextReviewAt_idx" ON "RecoveryControl"("nextReviewAt");
CREATE UNIQUE INDEX "RecoveryEvidence_environment_evidenceReference_key" ON "RecoveryEvidence"("environment", "evidenceReference");
CREATE INDEX "RecoveryEvidence_assetKind_environment_evidenceKind_performedAt_idx" ON "RecoveryEvidence"("assetKind", "environment", "evidenceKind", "performedAt");
CREATE INDEX "RecoveryEvidence_result_performedAt_idx" ON "RecoveryEvidence"("result", "performedAt");
CREATE INDEX "RecoveryEvidence_recordedByUserId_idx" ON "RecoveryEvidence"("recordedByUserId");

ALTER TABLE "RecoveryControl" ADD CONSTRAINT "RecoveryControl_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecoveryEvidence" ADD CONSTRAINT "RecoveryEvidence_recoveryControlId_assetKind_environment_fkey" FOREIGN KEY ("recoveryControlId", "assetKind", "environment") REFERENCES "RecoveryControl"("id", "assetKind", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecoveryEvidence" ADD CONSTRAINT "RecoveryEvidence_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
