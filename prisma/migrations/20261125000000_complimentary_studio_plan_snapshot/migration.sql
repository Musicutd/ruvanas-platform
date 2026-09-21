ALTER TABLE "Subscription"
  ADD COLUMN "complimentaryPlanTierNumber" INTEGER,
  ADD COLUMN "complimentaryPlanProductFamily" "PlanProductFamily",
  ADD COLUMN "complimentaryStudioExternalDestinationLimit" INTEGER;

-- Restore Studio entitlements for grants made before these fields were saved.
-- The grant's own plan ID is the authority, not a possibly different paid plan.
UPDATE "Subscription" AS subscription
SET "complimentaryPlanTierNumber" = plan."tierNumber",
    "complimentaryPlanProductFamily" = plan."productFamily",
    "complimentaryStudioExternalDestinationLimit" = plan."studioExternalDestinationLimit"
FROM "ComplimentaryAccessCode" AS access
JOIN "Plan" AS plan ON plan."id" = access."planId"
WHERE subscription."complimentaryAccessCodeId" = access."id"
  AND subscription."complimentaryAccessActive" = TRUE
  AND subscription."complimentaryPlanCode" = plan."code";
