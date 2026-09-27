-- Preserve the exact named facility-group targeting choice for historical
-- proof reports, even if the group's name or membership later changes.
ALTER TABLE "CorrectionsProgrammeDistribution"
  ADD COLUMN "targetGroupId" TEXT,
  ADD COLUMN "targetGroupName" TEXT;

ALTER TABLE "CorrectionsNetworkAudioDistribution"
  ADD COLUMN "targetGroupId" TEXT,
  ADD COLUMN "targetGroupName" TEXT;
