-- RR-02 LOCAL CANDIDATE. Additive offer management only; no program/grant
-- activation, backfill, consumer account, billing or streaming changes.
-- Keep these tables and immutable history on application rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "RewardOfferState" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'CANCELLED');
CREATE TYPE "RewardOfferLocationScope" AS ENUM ('DRAFT', 'PUBLISHED');
ALTER TYPE "RewardAuditAction" ADD VALUE 'OFFER_CREATED';
ALTER TYPE "RewardAuditAction" ADD VALUE 'OFFER_DRAFT_SAVED';
ALTER TYPE "RewardAuditAction" ADD VALUE 'OFFER_PUBLISHED';
ALTER TYPE "RewardAuditAction" ADD VALUE 'OFFER_PAUSED';
ALTER TYPE "RewardAuditAction" ADD VALUE 'OFFER_RESUMED';
ALTER TYPE "RewardAuditAction" ADD VALUE 'OFFER_CANCELLED';
ALTER TYPE "RewardAuditTargetType" ADD VALUE 'OFFER';

CREATE UNIQUE INDEX "RewardProgram_id_organisationId_key" ON "RewardProgram"("id", "organisationId");

-- Offer terms are validated fully by the strict server contract. This envelope
-- rejects unversioned/scalar/oversized values even for direct database writers.
CREATE FUNCTION "ruvanas_rewards_offer_terms_envelope_valid"(terms JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (jsonb_typeof(terms) = 'object'
    AND octet_length(terms::text) <= 131072
    AND terms -> 'schemaVersion' = '1'::jsonb) IS TRUE;
$$;

CREATE TABLE "RewardOffer" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "state" "RewardOfferState" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "draft" JSONB NOT NULL,
  "lastRevision" INTEGER NOT NULL DEFAULT 0,
  "publishedRevision" INTEGER,
  "publishedStartsAt" TIMESTAMPTZ(3),
  "publishedEndsAt" TIMESTAMPTZ(3),
  "createdByUserId" VARCHAR(191) NOT NULL,
  "updatedByUserId" VARCHAR(191) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RewardOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardOffer_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("programId") AND "ruvanas_rewards_identifier_valid"("createdByUserId") AND
    "ruvanas_rewards_identifier_valid"("updatedByUserId")),
  CONSTRAINT "RewardOffer_version_check" CHECK ("version" >= 1 AND "lastRevision" >= 0),
  CONSTRAINT "RewardOffer_draft_check" CHECK ("ruvanas_rewards_offer_terms_envelope_valid"("draft")),
  CONSTRAINT "RewardOffer_publication_check" CHECK (
    ("publishedRevision" IS NULL AND "lastRevision" = 0 AND "publishedStartsAt" IS NULL AND "publishedEndsAt" IS NULL AND "state" IN ('DRAFT', 'CANCELLED')) OR
    ("publishedRevision" IS NOT NULL AND "publishedRevision" >= 1 AND "publishedRevision" <= "lastRevision" AND
      "publishedStartsAt" IS NOT NULL AND "publishedEndsAt" IS NOT NULL AND
      isfinite("publishedStartsAt") AND isfinite("publishedEndsAt") AND "publishedStartsAt" < "publishedEndsAt" AND
      "state" IN ('PUBLISHED', 'PAUSED', 'CANCELLED'))),
  CONSTRAINT "RewardOffer_timestamps_check" CHECK (isfinite("createdAt") AND isfinite("updatedAt"))
);

CREATE TABLE "RewardOfferLocation" (
  "organisationId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "scope" "RewardOfferLocationScope" NOT NULL,
  CONSTRAINT "RewardOfferLocation_pkey" PRIMARY KEY ("offerId", "scope", "locationId"),
  CONSTRAINT "RewardOfferLocation_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("organisationId") AND "ruvanas_rewards_identifier_valid"("offerId") AND
    "ruvanas_rewards_identifier_valid"("locationId"))
);

CREATE TABLE "RewardOfferRevision" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "terms" JSONB NOT NULL,
  "actorUserId" VARCHAR(191) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardOfferRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardOfferRevision_identifiers_check" CHECK (
    "ruvanas_rewards_identifier_valid"("id") AND "ruvanas_rewards_identifier_valid"("organisationId") AND
    "ruvanas_rewards_identifier_valid"("offerId") AND "ruvanas_rewards_identifier_valid"("actorUserId")),
  CONSTRAINT "RewardOfferRevision_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "RewardOfferRevision_terms_check" CHECK ("ruvanas_rewards_offer_terms_envelope_valid"("terms")),
  CONSTRAINT "RewardOfferRevision_timestamp_check" CHECK (isfinite("createdAt"))
);

CREATE UNIQUE INDEX "RewardOffer_id_organisationId_key" ON "RewardOffer"("id", "organisationId");
CREATE INDEX "RewardOffer_organisationId_updatedAt_id_idx" ON "RewardOffer"("organisationId", "updatedAt", "id");
CREATE INDEX "RewardOffer_organisationId_state_publishedEndsAt_idx" ON "RewardOffer"("organisationId", "state", "publishedEndsAt");
CREATE INDEX "RewardOffer_programId_organisationId_idx" ON "RewardOffer"("programId", "organisationId");
CREATE INDEX "RewardOfferLocation_locationId_organisationId_idx" ON "RewardOfferLocation"("locationId", "organisationId");
CREATE INDEX "RewardOfferLocation_organisationId_offerId_idx" ON "RewardOfferLocation"("organisationId", "offerId");
CREATE UNIQUE INDEX "RewardOfferRevision_offerId_revision_key" ON "RewardOfferRevision"("offerId", "revision");
CREATE UNIQUE INDEX "RewardOfferRevision_tenant_revision_key" ON "RewardOfferRevision"("offerId", "revision", "organisationId");
CREATE INDEX "RewardOfferRevision_organisationId_offerId_createdAt_idx" ON "RewardOfferRevision"("organisationId", "offerId", "createdAt");

ALTER TABLE "RewardOffer" ADD CONSTRAINT "RewardOffer_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOffer" ADD CONSTRAINT "RewardOffer_programId_organisationId_fkey" FOREIGN KEY ("programId", "organisationId") REFERENCES "RewardProgram"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOfferLocation" ADD CONSTRAINT "RewardOfferLocation_offerId_organisationId_fkey" FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOffer"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOfferLocation" ADD CONSTRAINT "RewardOfferLocation_locationId_organisationId_fkey" FOREIGN KEY ("locationId", "organisationId") REFERENCES "Location"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOfferRevision" ADD CONSTRAINT "RewardOfferRevision_offerId_organisationId_fkey" FOREIGN KEY ("offerId", "organisationId") REFERENCES "RewardOffer"("id", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RewardOffer" ADD CONSTRAINT "RewardOffer_published_revision_fkey" FOREIGN KEY ("id", "publishedRevision", "organisationId") REFERENCES "RewardOfferRevision"("offerId", "revision", "organisationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "ruvanas_prevent_reward_revision_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Published Rewards revisions are immutable';
END;
$$;
CREATE TRIGGER "RewardOfferRevision_immutable"
  BEFORE UPDATE OR DELETE ON "RewardOfferRevision"
  FOR EACH ROW EXECUTE FUNCTION "ruvanas_prevent_reward_revision_mutation"();
CREATE TRIGGER "RewardOfferRevision_no_truncate"
  BEFORE TRUNCATE ON "RewardOfferRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION "ruvanas_prevent_reward_revision_mutation"();

-- Preserve the existing metadata allowlist and add bounded numeric offer
-- counters. No title, legal terms, shopper identity or arbitrary payload enters
-- audit metadata; immutable terms are held by RewardOfferRevision instead.
CREATE OR REPLACE FUNCTION "ruvanas_rewards_audit_metadata_valid"(metadata JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  entry RECORD;
  scalar TEXT;
BEGIN
  IF jsonb_typeof(metadata) <> 'object' OR octet_length(metadata::text) > 16384 THEN RETURN false; END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(metadata) LOOP
    scalar := entry.value #>> '{}';
    CASE
      WHEN entry.key IN ('before', 'after') THEN
        IF NOT "ruvanas_rewards_audit_snapshot_valid"(entry.value) THEN RETURN false; END IF;
      WHEN entry.key = 'reasonCode' THEN
        IF NOT (jsonb_typeof(entry.value) = 'string' AND scalar IN
          ('MANUAL_INTERNAL', 'OWNER_REQUEST', 'REVOKED', 'EXPIRED', 'SUSPENDED', 'CORRECTION')) THEN RETURN false; END IF;
      WHEN entry.key IN ('version', 'revision') THEN
        IF jsonb_typeof(entry.value) <> 'number' OR scalar::numeric < 0 OR
          scalar::numeric > 2147483647 OR mod(scalar::numeric, 1) <> 0 THEN RETURN false; END IF;
      ELSE RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

-- Cast to text so newly added enum values are not used before their transaction
-- commits. All existing action/target combinations remain valid and unchanged.
ALTER TABLE "RewardAuditEvent" DROP CONSTRAINT "RewardAuditEvent_target_check";
ALTER TABLE "RewardAuditEvent" ADD CONSTRAINT "RewardAuditEvent_target_check" CHECK (
  ("targetType"::text = 'PROGRAM' AND "action"::text IN ('PROGRAM_CREATED', 'PROGRAM_CHANGED')) OR
  ("targetType"::text = 'ENTITLEMENT_GRANT' AND "action"::text IN ('ENTITLEMENT_CREATED', 'ENTITLEMENT_CHANGED', 'ENTITLEMENT_REVOKED')) OR
  ("targetType"::text = 'STAFF_GRANT' AND "action"::text IN ('STAFF_GRANT_CREATED', 'STAFF_GRANT_CHANGED', 'STAFF_GRANT_REVOKED')) OR
  ("targetType"::text = 'OFFER' AND "action"::text IN ('OFFER_CREATED', 'OFFER_DRAFT_SAVED', 'OFFER_PUBLISHED', 'OFFER_PAUSED', 'OFFER_RESUMED', 'OFFER_CANCELLED')));

COMMIT;
