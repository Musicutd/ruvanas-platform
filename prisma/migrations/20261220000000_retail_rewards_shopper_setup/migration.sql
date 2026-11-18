-- Dormant shopper preparation only. No users, invitations, credentials,
-- memberships, entitlements, sessions, feature flags or backfill are created.
-- Retain this additive table on application rollback. Older application code
-- does not manage dormant preparations; activation requires a separate flow.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE "RewardShopperSetup" (
  "shopperId" TEXT NOT NULL,
  "emailCanonical" VARCHAR(254) NOT NULL,
  "organisationId" TEXT NOT NULL,
  "createdByUserId" VARCHAR(191) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardShopperSetup_pkey" PRIMARY KEY ("shopperId"),
  CONSTRAINT "RewardShopperSetup_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("shopperId") AND
    "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("createdByUserId")),
  CONSTRAINT "RewardShopperSetup_email_check" CHECK (
    "ruvanas_rewards_email_canonical_valid"("emailCanonical")),
  CONSTRAINT "RewardShopperSetup_timestamp_check" CHECK (isfinite("createdAt"))
);

CREATE UNIQUE INDEX "RewardShopperSetup_emailCanonical_key" ON "RewardShopperSetup"("emailCanonical");
CREATE INDEX "RewardShopperSetup_org_time_idx" ON "RewardShopperSetup"("organisationId", "createdAt");

ALTER TABLE "RewardShopperSetup" ADD CONSTRAINT "RewardShopperSetup_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "RewardShopper"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardShopperSetup" ADD CONSTRAINT "RewardShopperSetup_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The email reservation and its provenance cannot be rebound. This preparation
-- is not redemption/audit history: deletion is not forbidden by a DB trigger,
-- but this release exposes no delete action or automatic reset exception.
CREATE FUNCTION "ruvanas_prevent_reward_shopper_setup_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Rewards shopper setup identity is immutable';
END;
$$;
CREATE TRIGGER "RewardShopperSetup_immutable_identity" BEFORE UPDATE ON "RewardShopperSetup"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_shopper_setup_update"();

COMMIT;
