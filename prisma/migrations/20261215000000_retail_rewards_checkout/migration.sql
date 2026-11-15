-- RR-03c: local-gated coupon issuance and immutable successful-use evidence.
-- Additive only: no backfill, public registration, grants or activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE "RewardOfferUsagePolicy" (
  "offerId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "timezone" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardOfferUsagePolicy_pkey" PRIMARY KEY ("offerId"),
  CONSTRAINT "RewardOfferUsagePolicy_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("offerId") AND "ruvanas_rewards_identifier_valid"("organisationId")),
  CONSTRAINT "RewardOfferUsagePolicy_timezone_check" CHECK (
    char_length("timezone") BETWEEN 1 AND 64 AND "timezone" ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'),
  CONSTRAINT "RewardOfferUsagePolicy_timestamp_check" CHECK (isfinite("createdAt"))
);
CREATE UNIQUE INDEX "RewardOfferUsagePolicy_offerId_organisationId_key" ON "RewardOfferUsagePolicy"("offerId", "organisationId");
ALTER TABLE "RewardOfferUsagePolicy" ADD CONSTRAINT "RewardOfferUsagePolicy_offerId_organisationId_fkey"
  FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOffer"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "RewardClaim" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "shopperId" TEXT NOT NULL,
  "shopperAuthVersion" INTEGER NOT NULL,
  "locationId" TEXT NOT NULL,
  "publicShopName" VARCHAR(140) NOT NULL,
  "publicShopSlug" VARCHAR(96) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardClaim_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("offerId") AND "ruvanas_rewards_identifier_valid"("shopperId") AND
    "ruvanas_rewards_identifier_valid"("locationId")),
  CONSTRAINT "RewardClaim_versions_check" CHECK ("revision" >= 1 AND "shopperAuthVersion" >= 1),
  CONSTRAINT "RewardClaim_public_shop_check" CHECK (
    "ruvanas_rewards_public_text_valid"("publicShopName", 1, 140) AND
    char_length("publicShopSlug") BETWEEN 3 AND 96 AND "publicShopSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "RewardClaim_expiry_check" CHECK (
    isfinite("createdAt") AND isfinite("expiresAt") AND "createdAt" < "expiresAt" AND
    "expiresAt" <= "createdAt" + INTERVAL '24 hours')
);
CREATE UNIQUE INDEX "RewardClaim_id_organisationId_key" ON "RewardClaim"("id", "organisationId");
CREATE UNIQUE INDEX "RewardClaim_id_shopper_key" ON "RewardClaim"("id", "shopperId");
CREATE UNIQUE INDEX "RewardClaim_receipt_scope_key" ON "RewardClaim"("id", "organisationId", "offerId", "shopperId", "locationId");
CREATE INDEX "RewardClaim_shopperId_createdAt_id_idx" ON "RewardClaim"("shopperId", "createdAt", "id");
CREATE INDEX "RewardClaim_offerId_shopperId_expiresAt_idx" ON "RewardClaim"("offerId", "shopperId", "expiresAt");
CREATE INDEX "RewardClaim_locationId_organisationId_idx" ON "RewardClaim"("locationId", "organisationId");
CREATE INDEX "RewardClaim_offerId_revision_organisationId_idx" ON "RewardClaim"("offerId", "revision", "organisationId");
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_offerId_organisationId_fkey"
  FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOffer"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_offerId_revision_organisationId_fkey"
  FOREIGN KEY ("offerId", "revision", "organisationId") REFERENCES "RewardOfferRevision"("offerId", "revision", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_locationId_organisationId_fkey"
  FOREIGN KEY ("locationId", "organisationId") REFERENCES "Location"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_shopperId_fkey"
  FOREIGN KEY ("shopperId") REFERENCES "RewardShopper"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_usage_policy_fkey"
  FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOfferUsagePolicy"("offerId", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "RewardClaimRequest" (
  "id" TEXT NOT NULL,
  "shopperId" TEXT NOT NULL,
  "idempotencyKeyHash" VARCHAR(64) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "claimId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardClaimRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardClaimRequest_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("shopperId") AND "ruvanas_rewards_identifier_valid"("claimId")),
  CONSTRAINT "RewardClaimRequest_hashes_check" CHECK ("idempotencyKeyHash" ~ '^[0-9a-f]{64}$' AND "requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RewardClaimRequest_timestamp_check" CHECK (isfinite("createdAt"))
);
CREATE UNIQUE INDEX "RewardClaimRequest_shopperId_idempotencyKeyHash_key" ON "RewardClaimRequest"("shopperId", "idempotencyKeyHash");
CREATE INDEX "RewardClaimRequest_claimId_shopperId_idx" ON "RewardClaimRequest"("claimId", "shopperId");
ALTER TABLE "RewardClaimRequest" ADD CONSTRAINT "RewardClaimRequest_claimId_shopperId_fkey"
  FOREIGN KEY ("claimId", "shopperId") REFERENCES "RewardClaim"("id", "shopperId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "RewardClaimToken" (
  "claimId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardClaimToken_pkey" PRIMARY KEY ("claimId"),
  CONSTRAINT "RewardClaimToken_identifier_check" CHECK ("ruvanas_rewards_identifier_valid"("claimId")),
  CONSTRAINT "RewardClaimToken_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RewardClaimToken_expiry_check" CHECK (
    isfinite("createdAt") AND isfinite("expiresAt") AND "createdAt" < "expiresAt" AND
    "expiresAt" <= "createdAt" + INTERVAL '5 minutes')
);
CREATE UNIQUE INDEX "RewardClaimToken_tokenHash_key" ON "RewardClaimToken"("tokenHash");
CREATE INDEX "RewardClaimToken_expiresAt_idx" ON "RewardClaimToken"("expiresAt");
ALTER TABLE "RewardClaimToken" ADD CONSTRAINT "RewardClaimToken_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "RewardClaim"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "RewardRedemption" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "shopperId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "actorUserId" VARCHAR(191) NOT NULL,
  "actorOrganisationMemberId" VARCHAR(191) NOT NULL,
  "idempotencyKeyHash" VARCHAR(64) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "eligibleSpendMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "discountMinor" INTEGER,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardRedemption_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("offerId") AND "ruvanas_rewards_identifier_valid"("shopperId") AND
    "ruvanas_rewards_identifier_valid"("locationId") AND "ruvanas_rewards_identifier_valid"("claimId") AND
    "ruvanas_rewards_identifier_valid"("actorUserId") AND "ruvanas_rewards_identifier_valid"("actorOrganisationMemberId")),
  CONSTRAINT "RewardRedemption_hashes_check" CHECK ("idempotencyKeyHash" ~ '^[0-9a-f]{64}$' AND "requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RewardRedemption_amounts_check" CHECK (
    "eligibleSpendMinor" BETWEEN 0 AND 100000000 AND
    ("discountMinor" IS NULL OR "discountMinor" BETWEEN 0 AND "eligibleSpendMinor") AND
    "currency" IN ('EUR', 'USD', 'GBP', 'CAD')),
  CONSTRAINT "RewardRedemption_timestamp_check" CHECK (isfinite("occurredAt"))
);
CREATE UNIQUE INDEX "RewardRedemption_claimId_key" ON "RewardRedemption"("claimId");
CREATE UNIQUE INDEX "RewardRedemption_claim_scope_key" ON "RewardRedemption"("claimId", "organisationId", "offerId", "shopperId", "locationId");
CREATE UNIQUE INDEX "RewardRedemption_member_request_key" ON "RewardRedemption"("organisationId", "actorOrganisationMemberId", "idempotencyKeyHash");
CREATE INDEX "RewardRedemption_organisationId_occurredAt_idx" ON "RewardRedemption"("organisationId", "occurredAt");
CREATE INDEX "RewardRedemption_offerId_occurredAt_idx" ON "RewardRedemption"("offerId", "occurredAt");
CREATE INDEX "RewardRedemption_offerId_shopperId_occurredAt_idx" ON "RewardRedemption"("offerId", "shopperId", "occurredAt");
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_claim_scope_fkey"
  FOREIGN KEY ("claimId", "organisationId", "offerId", "shopperId", "locationId")
  REFERENCES "RewardClaim"("id", "organisationId", "offerId", "shopperId", "locationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "ruvanas_prevent_reward_checkout_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Rewards issued claims and successful-use evidence are immutable';
END;
$$;
CREATE TRIGGER "RewardOfferUsagePolicy_immutable" BEFORE UPDATE OR DELETE ON "RewardOfferUsagePolicy"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();
CREATE TRIGGER "RewardOfferUsagePolicy_no_truncate" BEFORE TRUNCATE ON "RewardOfferUsagePolicy"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();
CREATE TRIGGER "RewardClaim_immutable" BEFORE UPDATE OR DELETE ON "RewardClaim"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();
CREATE TRIGGER "RewardClaim_no_truncate" BEFORE TRUNCATE ON "RewardClaim"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();
CREATE TRIGGER "RewardClaimRequest_immutable" BEFORE UPDATE OR DELETE ON "RewardClaimRequest"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();
CREATE TRIGGER "RewardClaimRequest_no_truncate" BEFORE TRUNCATE ON "RewardClaimRequest"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();
CREATE TRIGGER "RewardRedemption_immutable" BEFORE UPDATE OR DELETE ON "RewardRedemption"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();
CREATE TRIGGER "RewardRedemption_no_truncate" BEFORE TRUNCATE ON "RewardRedemption"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_checkout_mutation"();

COMMIT;
