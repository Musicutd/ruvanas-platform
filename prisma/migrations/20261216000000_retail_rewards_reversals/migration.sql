-- RR-03d: additive immutable correction evidence. No reversal/backfill/activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE UNIQUE INDEX "RewardRedemption_id_organisationId_key" ON "RewardRedemption"("id", "organisationId");

CREATE TABLE "RewardRedemptionReversal" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "redemptionId" TEXT NOT NULL,
  "actorUserId" VARCHAR(191) NOT NULL,
  "actorOrganisationMemberId" VARCHAR(191) NOT NULL,
  "reason" VARCHAR(32) NOT NULL,
  "idempotencyKeyHash" VARCHAR(64) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardRedemptionReversal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardRedemptionReversal_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("redemptionId") AND "ruvanas_rewards_identifier_valid"("actorUserId") AND
    "ruvanas_rewards_identifier_valid"("actorOrganisationMemberId")),
  CONSTRAINT "RewardRedemptionReversal_reason_check" CHECK ("reason" IN ('WRONG_COUPON','PURCHASE_CANCELLED','DUPLICATE_CHECKOUT')),
  CONSTRAINT "RewardRedemptionReversal_hashes_check" CHECK ("idempotencyKeyHash" ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "RewardRedemptionReversal_time_check" CHECK (isfinite("occurredAt"))
);
CREATE UNIQUE INDEX "RewardRedemptionReversal_redemptionId_key" ON "RewardRedemptionReversal"("redemptionId");
CREATE UNIQUE INDEX "RewardRedemptionReversal_redemptionId_organisationId_key" ON "RewardRedemptionReversal"("redemptionId", "organisationId");
CREATE UNIQUE INDEX "RewardReversal_member_request_key" ON "RewardRedemptionReversal"("organisationId", "actorOrganisationMemberId", "idempotencyKeyHash");
CREATE INDEX "RewardRedemptionReversal_organisationId_occurredAt_idx" ON "RewardRedemptionReversal"("organisationId", "occurredAt");
ALTER TABLE "RewardRedemptionReversal" ADD CONSTRAINT "RewardRedemptionReversal_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardRedemptionReversal" ADD CONSTRAINT "RewardRedemptionReversal_redemptionId_organisationId_fkey"
  FOREIGN KEY ("redemptionId", "organisationId") REFERENCES "RewardRedemption"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER "RewardRedemptionReversal_immutable" BEFORE UPDATE OR DELETE ON "RewardRedemptionReversal"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();
CREATE TRIGGER "RewardRedemptionReversal_no_truncate" BEFORE TRUNCATE ON "RewardRedemptionReversal"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();

COMMIT;
