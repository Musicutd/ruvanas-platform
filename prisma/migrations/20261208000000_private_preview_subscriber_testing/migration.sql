-- An owner must explicitly opt a valid isolated tester into subscriber actions.
-- Existing grants, plans, expiry dates, playback approvals and sessions do not change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "PrivatePreviewAccess"
ADD COLUMN "subscriberTestingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- A plan mirror is opt-in and starts empty. The original subscription plan is
-- retained so existing stream and music approvals remain valid.
ALTER TABLE "Subscription"
ADD COLUMN "subscriberTestPlanSnapshot" JSONB;

COMMIT;
