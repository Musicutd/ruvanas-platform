ALTER TYPE "PlanProductFamily" ADD VALUE IF NOT EXISTS 'CORRECTIONS';
ALTER TYPE "MusicRightsUse" ADD VALUE IF NOT EXISTS 'CORRECTIONS_RADIO';

ALTER TABLE "Plan" ADD COLUMN "correctionsRadioEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription"
  ADD COLUMN "correctionsRadioEnabled" BOOLEAN,
  ADD COLUMN "complimentaryCorrectionsRadioEnabled" BOOLEAN;
